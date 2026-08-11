/**
 * Le filet de sécurité de l'enregistrement.
 *
 * Ces tests ne vérifient pas une fonctionnalité mais une promesse : **un import
 * validé ne disparaît jamais**, quoi que fasse la base. Table jamais créée,
 * policies manquantes, réseau coupé — l'écriture doit survivre au rechargement
 * et repartir toute seule quand la base revient.
 *
 * Le client Supabase est simulé : on veut éprouver le comportement du magasin
 * face à des réponses données, pas la disponibilité d'un serveur.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Stockage en mémoire, plutôt qu'un jsdom entier pour trois méthodes. Ce qui
 * est éprouvé ici, c'est la logique du magasin — quand il écrit, quand il
 * relit, quand il efface — et non l'implémentation du navigateur.
 */
const mémoire = new Map();
globalThis.localStorage = {
  getItem: (k) => (mémoire.has(k) ? mémoire.get(k) : null),
  setItem: (k, v) => mémoire.set(k, String(v)),
  removeItem: (k) => mémoire.delete(k),
  clear: () => mémoire.clear(),
};
globalThis.window = globalThis.window ?? { addEventListener() {} };

const selectRéponse = { value: { data: null, error: null } };
const upsertRéponse = { value: { error: null } };

vi.mock('../lib/supabaseClient.js', () => ({
  configured: true,
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => selectRéponse.value }) }),
      upsert: async () => upsertRéponse.value,
    }),
  },
}));

// Le mode démonstration court-circuiterait tout le chemin testé ici.
vi.mock('../lib/demo.js', () => ({
  isDemo: () => false,
  leaveDemo: () => {},
  DEMO_STORAGE_KEY: 'budget-demo-data',
}));

const { edit, flush, loadForUser, setUser, useBudget } = await import('./useBudget.js');
const { emptyState } = await import('../lib/ledger.js');

const USER = 'utilisateur-1';
const CLÉ = `budget-local-${USER}`;

const TABLE_ABSENTE = { message: 'relation "public.budget_state" does not exist' };

/** Ajoute une écriture, comme le ferait la validation d'un import. */
function importerUneÉcriture(label = 'Salaire') {
  edit((data) => {
    data.tx.push({
      id: 1, acc: 'CH00', date: '2026-01-05', cents: 650000,
      label, norm: label.toUpperCase(), cat: null, transfer: 0,
    });
  });
}

beforeEach(() => {
  localStorage.clear();
  selectRéponse.value = { data: null, error: null };
  upsertRéponse.value = { error: null };
  useBudget.setState({ data: emptyState(), loading: false, sync: 'a-jour', error: '' });
  setUser(USER);
});

describe('enregistrement quand la base refuse', () => {
  it('écrit une copie locale avant même de tenter l’envoi', () => {
    importerUneÉcriture();
    // La copie existe immédiatement, sans attendre la réponse du serveur.
    expect(JSON.parse(localStorage.getItem(CLÉ)).tx).toHaveLength(1);
  });

  it('conserve la copie quand l’envoi échoue, et remonte la cause', async () => {
    upsertRéponse.value = { error: TABLE_ABSENTE };
    importerUneÉcriture();
    await flush();

    expect(useBudget.getState().sync).toBe('echec');
    expect(useBudget.getState().error).toMatch(/does not exist/);
    expect(JSON.parse(localStorage.getItem(CLÉ)).tx).toHaveLength(1);
  });

  it('efface la copie une fois l’envoi réussi : elle n’a plus de raison d’être', async () => {
    importerUneÉcriture();
    await flush();
    expect(useBudget.getState().sync).toBe('a-jour');
    expect(localStorage.getItem(CLÉ)).toBeNull();
  });
});

describe('rechargement', () => {
  it('reprend les écritures de la copie locale quand la base est inaccessible', async () => {
    upsertRéponse.value = { error: TABLE_ABSENTE };
    importerUneÉcriture();
    await flush();

    // Rechargement : le magasin repart de zéro, la base refuse toujours.
    useBudget.setState({ data: emptyState() });
    selectRéponse.value = { data: null, error: TABLE_ABSENTE };
    await loadForUser(USER);

    // C'est ici que tout se joue : sans filet, l'écran afficherait « aucune
    // écriture » et l'import de la veille serait perdu sans un mot.
    expect(useBudget.getState().data.tx).toHaveLength(1);
    expect(useBudget.getState().sync).toBe('echec');
  });

  it('renvoie la copie en attente dès que la base répond de nouveau', async () => {
    upsertRéponse.value = { error: TABLE_ABSENTE };
    importerUneÉcriture();
    await flush();

    // La table vient d'être créée : la base répond, mais elle est vide.
    useBudget.setState({ data: emptyState() });
    selectRéponse.value = { data: null, error: null };
    upsertRéponse.value = { error: null };
    await loadForUser(USER);
    await flush();

    // La copie locale l'emporte sur le vide renvoyé par la base — elle est
    // postérieure — puis elle est envoyée et effacée.
    expect(useBudget.getState().data.tx).toHaveLength(1);
    expect(useBudget.getState().sync).toBe('a-jour');
    expect(localStorage.getItem(CLÉ)).toBeNull();
  });

  it('ne confond pas les copies de deux comptes sur le même navigateur', async () => {
    upsertRéponse.value = { error: TABLE_ABSENTE };
    importerUneÉcriture();
    await flush();

    setUser('utilisateur-2');
    useBudget.setState({ data: emptyState() });
    selectRéponse.value = { data: null, error: TABLE_ABSENTE };
    await loadForUser('utilisateur-2');

    expect(useBudget.getState().data.tx).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem(CLÉ)).tx).toHaveLength(1);
  });

  it('prend la base quand il n’y a aucune copie en attente', async () => {
    selectRéponse.value = {
      data: { data: { ...emptyState(), tx: [{ id: 7, acc: 'CH00', date: '2026-02-01',
        cents: -1000, label: 'Coop', norm: 'COOP', cat: null, transfer: 0 }] } },
      error: null,
    };
    await loadForUser(USER);
    expect(useBudget.getState().data.tx).toHaveLength(1);
    expect(useBudget.getState().sync).toBe('a-jour');
  });
});
