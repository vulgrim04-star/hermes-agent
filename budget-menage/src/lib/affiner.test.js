/**
 * Affinage des catégories de la banque.
 *
 * Deux garanties à tenir, et elles sont de nature différente : ne remplacer
 * **que** des racines — une catégorie fine déjà posée ne doit jamais bouger —
 * et retenir le choix pour les imports suivants, faute de quoi le travail
 * serait à refaire tous les mois.
 */

import { describe, expect, it } from 'vitest';

import { aAffiner, affinerTiers, concentration, enjeuFiscal, estRacine, feuillesDe, resteAAffiner } from './affiner.js';
import { applyRules, emptyState, normLabel } from './ledger.js';

let compteur = 0;
function ecriture(state, { label, date = '2026-03-05', cents = -4_500, cat = null, cp = null, transfer = 0 }) {
  compteur += 1;
  state.tx.push({
    id: compteur, acc: 'CH00', date, cents, label,
    norm: normLabel(label), cp, ext: null, cat, note: null, transfer,
  });
  return compteur;
}

function journal() {
  const state = emptyState();
  // La banque a classé en « Santé », qui est une racine.
  ecriture(state, { label: 'SWICA KRANKENVERSICHERUNG', date: '2026-01-05', cents: -43_935, cat: 'Santé' });
  ecriture(state, { label: 'SWICA KRANKENVERSICHERUNG', date: '2026-02-05', cents: -43_935, cat: 'Santé' });
  ecriture(state, { label: 'SWICA KRANKENVERSICHERUNG', date: '2026-03-05', cents: -43_935, cat: 'Santé' });
  // Un autre tiers, une autre racine, un poids moindre.
  ecriture(state, { label: 'MIGROL SERVICE', cents: -7_559, cat: 'Transport' });
  // Et une écriture déjà fine, qui ne doit jamais remonter.
  ecriture(state, { label: 'COOP BULLE', cents: -1_265, cat: 'Courses' });
  return state;
}

describe('racines et feuilles', () => {
  it('reconnaît une racine, et seulement une racine', () => {
    expect(estRacine('Santé')).toBe(true);
    expect(estRacine('Primes LAMal')).toBe(false);
    expect(estRacine('Catégorie inventée')).toBe(false);
    expect(estRacine(null)).toBe(false);
  });

  it('rend les sous-catégories d’une racine, qui sont les seuls choix sensés', () => {
    expect(feuillesDe('Santé')).toContain('Primes LAMal');
    expect(feuillesDe('Santé')).toContain('Dentiste');
    expect(feuillesDe('Primes LAMal')).toEqual([]);
  });
});

describe('file d’affinage', () => {
  it('regroupe par tiers et classe le plus lourd en tête', () => {
    const groupes = aAffiner(journal());
    expect(groupes).toHaveLength(2);
    expect(groupes[0].label).toBe('SWICA KRANKENVERSICHERUNG');
    expect(groupes[0].occurrences).toBe(3);
    expect(groupes[0].totalCents).toBe(-131_805);
    expect(groupes[0].racine).toBe('Santé');
    expect(groupes[0].feuilles).toContain('Assurance complémentaire (LCA)');
    expect(groupes[1].label).toBe('MIGROL SERVICE');
  });

  it('ne remonte ni les écritures fines ni les transferts internes', () => {
    const state = journal();
    ecriture(state, { label: 'VIREMENT INTERNE', cat: 'Logement', transfer: 1 });
    const labels = aAffiner(state).map((g) => g.label);
    expect(labels).not.toContain('COOP BULLE');
    expect(labels).not.toContain('VIREMENT INTERNE');
  });

  it('sépare un même tiers réparti sur deux racines', () => {
    const state = emptyState();
    ecriture(state, { label: 'MIGROS', cents: -5_000, cat: 'Alimentation' });
    ecriture(state, { label: 'MIGROS', cents: -9_000, cat: 'Shopping' });
    const groupes = aAffiner(state);
    expect(groupes).toHaveLength(2);
    expect(groupes.map((g) => g.racine).sort()).toEqual(['Alimentation', 'Shopping']);
  });

  it('chiffre ce qui reste, en écritures et en francs', () => {
    expect(resteAAffiner(journal())).toMatchObject({
      tiers: 2, ecritures: 4, montantCents: 131_805 + 7_559,
    });
  });

  it('isole ce que la déclaration attend du reste', () => {
    // SWICA est classé « Santé » (primes, frais médicaux) : à enjeu fiscal.
    // MIGROL est classé « Transport », qui alimente les frais de déplacement.
    const r = resteAAffiner(journal());
    expect(r.fiscal.tiers).toBe(2);
    expect(r.fiscal.montantCents).toBe(131_805 + 7_559);
  });

  it('ne compte pas comme fiscal un tiers qui ne l’est pas', () => {
    const state = emptyState();
    ecriture(state, { label: 'CINÉMA', cents: -2_000, cat: 'Loisirs' });
    const r = resteAAffiner(state);
    expect(r.tiers).toBe(1);
    expect(r.fiscal).toEqual({ tiers: 0, ecritures: 0, montantCents: 0 });
  });
});

describe('affiner un tiers', () => {
  it('remplace la racine sur tout l’historique du tiers', () => {
    const state = journal();
    const r = affinerTiers(state, 'SWICA KRANKENVERSICHERUNG', 'Santé', 'Primes LAMal');
    expect(r).toMatchObject({ kind: 'affine', touchees: 3, regle: true });
    expect(state.tx.filter((t) => t.cat === 'Primes LAMal')).toHaveLength(3);
    expect(resteAAffiner(state).ecritures).toBe(1);
  });

  it('ne touche pas une catégorie fine déjà posée', () => {
    const state = journal();
    // Une ligne du même tiers a déjà été classée finement, à la main.
    const id = ecriture(state, { label: 'SWICA KRANKENVERSICHERUNG', date: '2026-04-05', cents: -43_935, cat: 'Dentiste' });
    affinerTiers(state, 'SWICA KRANKENVERSICHERUNG', 'Santé', 'Primes LAMal');
    expect(state.tx.find((t) => t.id === id).cat).toBe('Dentiste');
  });

  it('refuse une racine comme cible : affiner, c’est descendre', () => {
    const state = journal();
    expect(affinerTiers(state, 'SWICA KRANKENVERSICHERUNG', 'Santé', 'Assurances').kind)
      .toBe('pas-une-feuille');
    expect(state.tx[0].cat).toBe('Santé');
  });

  it('retient le choix pour les imports suivants', () => {
    const state = journal();
    affinerTiers(state, 'SWICA KRANKENVERSICHERUNG', 'Santé', 'Primes LAMal');

    // Une écriture qui arriverait au prochain import, sans catégorie : la
    // règle de tiers la prend avant que la banque ne pose sa racine.
    const id = ecriture(state, { label: 'SWICA KRANKENVERSICHERUNG 04/26', date: '2026-05-05', cents: -43_935 });
    applyRules(state, state.tx.filter((t) => !t.cat));
    expect(state.tx.find((t) => t.id === id).cat).toBe('Primes LAMal');
  });

  it('corrige la règle plutôt que d’en empiler une seconde', () => {
    const state = journal();
    affinerTiers(state, 'SWICA KRANKENVERSICHERUNG', 'Santé', 'Primes LAMal');
    // On se ravise : c'est une complémentaire.
    state.tx.filter((t) => t.cat === 'Primes LAMal').forEach((t) => { t.cat = 'Santé'; });
    const r = affinerTiers(state, 'SWICA KRANKENVERSICHERUNG', 'Santé', 'Assurance complémentaire (LCA)');
    expect(r.regle).toBe(false);
    expect(state.rules.filter((x) => x.pattern === 'SWICA KRANKENVERSICHERUNG')).toHaveLength(1);
    expect(state.rules[0].cat).toBe('Assurance complémentaire (LCA)');
  });

  it('peut affiner sans rien retenir, si on le demande', () => {
    const state = journal();
    const r = affinerTiers(state, 'MIGROL SERVICE', 'Transport', 'Carburant', { poserRegle: false });
    expect(r.touchees).toBe(1);
    expect(state.rules).toHaveLength(0);
  });
});

describe('enjeu fiscal', () => {
  it('nomme les postes qu’une racine alimenterait', () => {
    expect(enjeuFiscal('Santé')).toContain('Primes d’assurance maladie');
    expect(enjeuFiscal('Santé')).toContain('Frais médicaux à votre charge');
    expect(enjeuFiscal('Logement')).toContain('Intérêts de dettes');
  });

  it('ne prête pas d’enjeu à une racine qui n’en a pas', () => {
    // Le contrôle n'aurait aucune valeur si tout revenait non vide.
    expect(enjeuFiscal('Loisirs')).toEqual([]);
    expect(enjeuFiscal('Alimentation')).toEqual([]);
    expect(enjeuFiscal('racine inventée')).toEqual([]);
  });

  it('porte l’enjeu sur chaque groupe de la file', () => {
    const groupes = aAffiner(journal());
    const sante = groupes.find((g) => g.racine === 'Santé');
    expect(sante.postes.length).toBeGreaterThan(0);
  });
});

describe('où s’arrêter', () => {
  /** Un tiers lourd, puis une traîne de petits : la forme réelle d'un journal. */
  function traine() {
    const state = emptyState();
    ecriture(state, { label: 'LOURD', cents: -80_000, cat: 'Santé' });
    // Des libellés distincts sans chiffres : `payeeKey` retire les nombres du
    // libellé (numéros de carte, références), et « PETIT 1 » / « PETIT 2 »
    // seraient regroupés en un seul tiers.
    for (let i = 0; i < 20; i += 1) {
      ecriture(state, { label: `PETIT ${String.fromCharCode(65 + i)}`, cents: -1_000, cat: 'Loisirs' });
    }
    return state;
  }

  it('dit combien de tiers couvrent la part visée', () => {
    const c = concentration(aAffiner(traine()));
    // 80'000 sur 100'000 : le premier tiers suffit à couvrir 80 %.
    expect(c.tiers).toBe(21);
    expect(c.seuil).toBe(1);
    expect(c.seuilCents).toBe(80_000);
  });

  it('suit la part demandée, et pas une constante cachée', () => {
    const groupes = aAffiner(traine());
    // À 90 %, un seul tiers ne suffit plus : il en faut onze.
    expect(concentration(groupes, 0.9).seuil).toBe(11);
    expect(concentration(groupes, 0.5).seuil).toBe(1);
  });

  it('compte les tiers vus une seule fois, qui sont le gros de la file', () => {
    const c = concentration(aAffiner(traine()));
    expect(c.uniques).toBe(21);
    expect(c.uniquesCents).toBe(100_000);
  });

  it('ne divise pas par zéro sur une file vide', () => {
    const c = concentration([]);
    expect(c).toMatchObject({ totalCents: 0, tiers: 0, seuil: 0, uniques: 0 });
  });
});
