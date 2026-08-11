/**
 * État du budget, et sa synchronisation avec Supabase.
 *
 * Le journal entier tient dans un seul document JSON par compte, dans la table
 * `budget_state`. C'est le même parti que Cat's Eyes : simple à sauvegarder,
 * simple à restaurer, et protégé par une policy `auth.uid() = user_id` — une
 * ligne, un propriétaire, aucune lecture anonyme.
 *
 * Les écritures sont regroupées sur 800 ms : classer dix écritures à la suite
 * ne doit pas provoquer dix allers-retours réseau.
 */

import { create } from 'zustand';
import { supabase, configured } from '../lib/supabaseClient.js';
import { DEMO_STORAGE_KEY, isDemo } from '../lib/demo.js';
import { emptyState } from '../lib/ledger.js';

const TABLE = 'budget_state';
const DEBOUNCE_MS = 800;

export const useBudget = create(() => ({
  data: emptyState(),
  loading: true,
  /** 'a-jour' | 'envoi' | 'echec' — affiché dans l'en-tête, jamais deviné. */
  sync: 'a-jour',
  error: '',
}));

let userId = null;
let timer = null;
let pending = null;

export function setUser(id) {
  userId = id;
}

/** Applique une transformation locale, puis planifie l'envoi. */
export function edit(mutator) {
  const data = structuredClone(useBudget.getState().data);
  const result = mutator(data);
  useBudget.setState({ data });
  schedule(data);
  return result;
}

/* ------------------------------------------------------- filet de sécurité
 *
 * Une copie locale est écrite **avant** chaque envoi, et effacée seulement
 * quand l'envoi a réussi.
 *
 * Sans elle, un import de huit cents écritures que la base refuse d'accepter
 * — table jamais créée, policies manquantes, réseau coupé — disparaît au
 * rechargement suivant, après avoir affiché des totaux parfaitement justes.
 * C'est le mode de défaillance le plus coûteux de ce produit : on ne perd pas
 * une fonctionnalité, on perd le travail.
 *
 * La copie est nommée d'après le compte : deux personnes sur le même
 * navigateur ne se marchent pas dessus.
 */
const localKey = (id) => `budget-local-${id}`;

function saveLocal(id, data) {
  if (!id) return;
  try {
    localStorage.setItem(localKey(id), JSON.stringify(data));
  } catch {
    /* stockage plein ou refusé : il reste l'export manuel */
  }
}

/** Rend la copie en attente d'envoi, ou `null` s'il n'y en a pas. */
function readLocal(id) {
  if (!id) return null;
  try {
    const raw = localStorage.getItem(localKey(id));
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && Array.isArray(parsed.tx) ? parsed : null;
  } catch {
    return null;
  }
}

function clearLocal(id) {
  if (!id) return;
  try {
    localStorage.removeItem(localKey(id));
  } catch {
    /* rien à nettoyer */
  }
}

/**
 * Sans compte ouvert, l'application travaille **entièrement dans ce
 * navigateur** — et c'est le mode par défaut, conformément au cahier des
 * charges : « tout reste local ».
 *
 * Ce n'est pas un repli dégradé. C'est le fonctionnement nominal : aucune
 * requête réseau, donc aucune des pannes qui ont rendu l'import inutilisable —
 * table absente, projet d'un autre compte, session expirée, chargement qui ne
 * rend jamais la main.
 */
function localOnly() {
  return isDemo() || !userId;
}

function schedule(data) {
  if (localOnly()) {
    try {
      localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(data));
      useBudget.setState({ sync: 'a-jour', error: '' });
    } catch {
      useBudget.setState({ sync: 'echec', error: 'Stockage du navigateur plein ou refusé.' });
    }
    return;
  }
  if (!configured) return;
  // Écrite d'abord, envoyée ensuite : c'est l'ordre qui garantit qu'un échec
  // d'envoi ne coûte rien.
  saveLocal(userId, data);
  pending = data;
  useBudget.setState({ sync: 'envoi' });
  clearTimeout(timer);
  timer = setTimeout(flush, DEBOUNCE_MS);
}

export async function flush() {
  clearTimeout(timer);
  if (!pending || !userId || !configured) return true;
  const payload = pending;
  pending = null;

  const { error } = await supabase
    .from(TABLE)
    .upsert(
      { user_id: userId, data: payload, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    );

  if (error) {
    // La copie locale reste en place : elle sera reprise au prochain chargement
    // et renvoyée dès que la base acceptera.
    useBudget.setState({ sync: 'echec', error: error.message });
    return false;
  }
  clearLocal(userId);
  useBudget.setState({ sync: 'a-jour', error: '' });
  return true;
}

/** Envoi immédiat avant une déconnexion ou la fermeture de l'onglet. */
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { void flush(); });
}

export async function loadForUser(id) {
  userId = id;

  // Mode local : on lit le navigateur, et on rend la main tout de suite. Aucun
  // appel réseau ne peut donc laisser l'application bloquée sur « Chargement ».
  if (localOnly() || !configured) {
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem(DEMO_STORAGE_KEY) || 'null'); } catch { stored = null; }
    useBudget.setState({
      data: stored && Array.isArray(stored.tx) ? { ...emptyState(), ...stored } : emptyState(),
      loading: false,
      sync: 'a-jour',
      error: '',
    });
    return;
  }
  useBudget.setState({ loading: true });

  const attente = readLocal(id);
  const { data, error } = await supabase.from(TABLE).select('data').eq('user_id', id).maybeSingle();

  if (error) {
    // La base est inaccessible. On repart de la copie locale plutôt que d'un
    // journal vide : afficher zéro écriture ferait croire que l'import n'a
    // jamais eu lieu, et le prochain enregistrement écraserait le travail.
    useBudget.setState({
      data: attente ? { ...emptyState(), ...attente } : emptyState(),
      loading: false,
      sync: 'echec',
      error: error.message,
    });
    return;
  }

  if (attente) {
    // La base répond, mais une copie n'avait pas pu être envoyée : c'est elle
    // qui fait foi — elle est postérieure — et on la renvoie aussitôt.
    useBudget.setState({ data: { ...emptyState(), ...attente }, loading: false, sync: 'envoi', error: '' });
    pending = useBudget.getState().data;
    void flush();
    return;
  }

  useBudget.setState({
    data: data && data.data ? { ...emptyState(), ...data.data } : emptyState(),
    loading: false,
    sync: 'a-jour',
    error: '',
  });
}

/** Remplace tout l'état — restauration d'une sauvegarde. */
export async function replaceAll(next) {
  useBudget.setState({ data: next });
  schedule(next);
  return flush();
}
