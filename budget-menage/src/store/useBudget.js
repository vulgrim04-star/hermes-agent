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

function schedule(data) {
  if (isDemo()) {
    try {
      localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(data));
      useBudget.setState({ sync: 'a-jour' });
    } catch {
      useBudget.setState({ sync: 'echec', error: 'Stockage du navigateur plein ou refusé.' });
    }
    return;
  }
  if (!userId || !configured) return;
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
    // Rien n'est perdu localement : la prochaine modification réessaiera.
    useBudget.setState({ sync: 'echec', error: error.message });
    return false;
  }
  useBudget.setState({ sync: 'a-jour', error: '' });
  return true;
}

/** Envoi immédiat avant une déconnexion ou la fermeture de l'onglet. */
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { void flush(); });
}

export async function loadForUser(id) {
  userId = id;
  if (isDemo()) {
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem(DEMO_STORAGE_KEY) || 'null'); } catch { stored = null; }
    useBudget.setState({
      data: stored && Array.isArray(stored.tx) ? { ...emptyState(), ...stored } : emptyState(),
      loading: false,
    });
    return;
  }
  if (!id || !configured) {
    useBudget.setState({ data: emptyState(), loading: false });
    return;
  }
  useBudget.setState({ loading: true });

  const { data, error } = await supabase.from(TABLE).select('data').eq('user_id', id).maybeSingle();

  if (error) {
    useBudget.setState({ loading: false, sync: 'echec', error: error.message });
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
