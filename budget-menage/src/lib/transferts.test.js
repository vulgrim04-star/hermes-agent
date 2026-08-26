/**
 * Transferts internes : détection, regroupement, et la garantie qui compte.
 *
 * Une paire confirmée à tort **efface deux écritures des totaux** — la dépense
 * et la recette. L'erreur est silencieuse : aucun écran ne la signale, et le
 * rapprochement bancaire reste juste puisque les soldes, eux, n'ont pas bougé.
 * D'où l'obsession de ce fichier : ce qui est décidé en bloc ne doit jamais
 * emporter ce qui demandait un regard.
 */

import { describe, expect, it } from 'vitest';

import {
  decideGroupe, decideTransfer, detectTransfers, emptyState,
  groupesDeTransferts, monthTotals, normLabel, pendingCount,
} from './ledger.js';

let compteur = 0;
function ecriture(state, { acc, date, cents, label = 'VIREMENT', cat = null }) {
  compteur += 1;
  state.tx.push({
    id: compteur, acc, date, cents, label, norm: normLabel(label),
    cp: null, ext: null, cat, note: null, transfer: 0,
  });
  return compteur;
}

function deuxComptes() {
  const state = emptyState();
  state.accounts.COURANT = { key: 'COURANT', label: 'Courant' };
  state.accounts.EPARGNE = { key: 'EPARGNE', label: 'Épargne' };
  state.accounts.CARTE = { key: 'CARTE', label: 'Carte' };
  return state;
}

/** Une sortie et son entrée exactement opposée. */
function virement(state, { de = 'COURANT', vers = 'EPARGNE', cents = 50_000, date = '2026-03-05', arrivee = null } = {}) {
  ecriture(state, { acc: de, date, cents: -cents });
  ecriture(state, { acc: vers, date: arrivee || date, cents });
}

describe('détection des transferts', () => {
  it('apparie un montant exactement opposé entre deux comptes', () => {
    const state = deuxComptes();
    virement(state);
    expect(detectTransfers(state)).toBe(1);
    expect(state.transfers[0]).toMatchObject({ status: 'propose', gap: 0 });
  });

  it('n’apparie pas deux mouvements du même compte', () => {
    const state = deuxComptes();
    ecriture(state, { acc: 'COURANT', date: '2026-03-05', cents: -50_000 });
    ecriture(state, { acc: 'COURANT', date: '2026-03-05', cents: 50_000 });
    expect(detectTransfers(state)).toBe(0);
  });

  it('n’apparie pas des montants qui ne se compensent pas', () => {
    const state = deuxComptes();
    ecriture(state, { acc: 'COURANT', date: '2026-03-05', cents: -50_000 });
    ecriture(state, { acc: 'EPARGNE', date: '2026-03-05', cents: 49_900 });
    expect(detectTransfers(state)).toBe(0);
  });

  it('n’apparie pas au-delà du délai admis', () => {
    const state = deuxComptes();
    virement(state, { date: '2026-03-05', arrivee: '2026-03-20' });
    expect(detectTransfers(state)).toBe(0);
  });
});

describe('regroupement par habitude', () => {
  function journal() {
    const state = deuxComptes();
    // Une habitude : le courant alimente l'épargne, trois fois, le jour même.
    virement(state, { cents: 50_000, date: '2026-01-05' });
    virement(state, { cents: 30_000, date: '2026-02-05' });
    virement(state, { cents: 30_000, date: '2026-03-05' });
    // Une autre, en sens inverse : ce n'est pas la même habitude.
    virement(state, { de: 'EPARGNE', vers: 'COURANT', cents: 20_000, date: '2026-03-10' });
    // Et une paire décalée, la seule qui demande un jugement.
    virement(state, { vers: 'CARTE', cents: 10_000, date: '2026-03-12', arrivee: '2026-03-15' });
    detectTransfers(state);
    return state;
  }

  it('range les paires du jour même par couple de comptes', () => {
    const { habitudes } = groupesDeTransferts(journal());
    expect(habitudes).toHaveLength(2);
    expect(habitudes[0]).toMatchObject({ de: 'COURANT', vers: 'EPARGNE', occurrences: 3, totalCents: 110_000 });
    expect(habitudes[0].mois).toBe(3);
  });

  it('distingue le sens : aller et retour ne se confirment pas ensemble', () => {
    const { habitudes } = groupesDeTransferts(journal());
    const retour = habitudes.find((h) => h.de === 'EPARGNE');
    expect(retour.occurrences).toBe(1);
    expect(retour.cle).not.toBe(habitudes.find((h) => h.de === 'COURANT').cle);
  });

  it('dédoublonne et ordonne les montants d’une habitude', () => {
    const { habitudes } = groupesDeTransferts(journal());
    expect(habitudes[0].montants).toEqual([50_000, 30_000]);
  });

  it('sort les paires décalées des habitudes, et les décrit', () => {
    const { habitudes, aVerifier } = groupesDeTransferts(journal());
    expect(aVerifier).toHaveLength(1);
    expect(aVerifier[0]).toMatchObject({ gap: 3, montantCents: 10_000 });
    // La garantie : aucune habitude ne contient la paire décalée.
    const dansLesHabitudes = habitudes.flatMap((h) => h.paires);
    expect(dansLesHabitudes).not.toContain(aVerifier[0].id);
  });

  it('ne lève pas sur un journal sans transfert', () => {
    expect(groupesDeTransferts(emptyState())).toEqual({ habitudes: [], aVerifier: [] });
  });
});

describe('décider en bloc', () => {
  function journal() {
    const state = deuxComptes();
    virement(state, { cents: 50_000, date: '2026-01-05' });
    virement(state, { cents: 50_000, date: '2026-02-05' });
    virement(state, { vers: 'CARTE', cents: 10_000, date: '2026-03-12', arrivee: '2026-03-15' });
    detectTransfers(state);
    return state;
  }

  it('confirme toutes les paires d’une habitude d’un geste', () => {
    const state = journal();
    const { habitudes } = groupesDeTransferts(state);
    expect(decideGroupe(state, habitudes[0].cle, 'confirme')).toMatchObject({ kind: 'decide', paires: 2 });
    expect(state.tx.filter((t) => t.transfer === 1)).toHaveLength(4);
  });

  it('n’emporte jamais la paire décalée', () => {
    const state = journal();
    const { habitudes, aVerifier } = groupesDeTransferts(state);
    for (const h of habitudes) decideGroupe(state, h.cle, 'confirme');
    // Elle est toujours en attente, et toujours seule à l'être.
    expect(pendingCount(state).toPair).toBe(1);
    expect(state.transfers.find((p) => p.id === aVerifier[0].id).status).toBe('propose');
  });

  it('refuse une clé inconnue plutôt que de ne rien faire en silence', () => {
    expect(decideGroupe(journal(), 'INEXISTANT>AILLEURS', 'confirme')).toEqual({ kind: 'introuvable' });
  });

  it('sort bien les montants des totaux du mois, ce qui est tout l’enjeu', () => {
    const state = journal();
    // Avant : le virement gonfle les deux côtés du mois de janvier.
    const avant = monthTotals(state, '2026-01');
    expect(avant.income).toBe(50_000);
    expect(avant.expense).toBe(50_000);

    const { habitudes } = groupesDeTransferts(state);
    decideGroupe(state, habitudes[0].cle, 'confirme');

    const apres = monthTotals(state, '2026-01');
    expect(apres.income).toBe(0);
    expect(apres.expense).toBe(0);
  });

  it('écarter une habitude la retire de la file sans toucher aux totaux', () => {
    const state = journal();
    const { habitudes } = groupesDeTransferts(state);
    decideGroupe(state, habitudes[0].cle, 'rejete');
    expect(monthTotals(state, '2026-01').income).toBe(50_000);
    expect(groupesDeTransferts(state).habitudes.find((h) => h.de === 'COURANT')).toBeUndefined();
  });
});

describe('décider une paire seule', () => {
  it('reste possible, et c’est ce qu’on veut pour les décalées', () => {
    const state = deuxComptes();
    virement(state, { cents: 10_000, date: '2026-03-12', arrivee: '2026-03-15' });
    detectTransfers(state);
    const { aVerifier } = groupesDeTransferts(state);
    decideTransfer(state, aVerifier[0].id, 'confirme');
    expect(pendingCount(state).toPair).toBe(0);
    expect(state.tx.filter((t) => t.transfer === 1)).toHaveLength(2);
  });
});
