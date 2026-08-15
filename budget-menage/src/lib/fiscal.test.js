/**
 * Récapitulatif fiscal.
 *
 * Ce qui est éprouvé ici : que les montants sortent en grandeur positive et
 * complets — découpages compris —, que rien ne soit rangé dans une case où il
 * n'a pas sa place, et surtout que l'écran sache dire qu'une année est
 * incomplète. Un récapitulatif tiré de six mois de relevés n'est pas un
 * récapitulatif, et rien dans les chiffres eux-mêmes ne le dirait.
 */

import { describe, expect, it } from 'vitest';

import { anneesFiscales, recapFiscal } from './fiscal.js';
import { emptyState, setSplits } from './ledger.js';
import { addAsset, setValuation } from './networth.js';

let compteur = 0;
function ecriture(state, date, cents, cat) {
  compteur += 1;
  state.tx.push({
    id: compteur, acc: 'CH00', date, cents, label: cat || 'X',
    norm: 'X', cp: null, ext: null, cat, note: null, transfer: 0,
  });
  return compteur;
}

/** Une année ordinaire : douze salaires, des primes, un 3a, un don. */
function annee(state = emptyState()) {
  for (let m = 1; m <= 12; m += 1) {
    const p = `2025-${String(m).padStart(2, '0')}`;
    ecriture(state, `${p}-25`, 800_000, 'Salaire');
    ecriture(state, `${p}-05`, -43_935, 'Primes LAMal');
    ecriture(state, `${p}-05`, -95_000, 'Intérêts hypothécaires');
  }
  ecriture(state, '2025-12-20', -725_800, 'Pilier 3a');
  ecriture(state, '2025-06-15', -50_000, 'Dons');
  ecriture(state, '2025-03-10', -18_000, 'Dentiste');
  return state;
}

describe('récapitulatif fiscal', () => {
  it('rend les postes en grandeur positive, prêts à être reportés', () => {
    const r = recapFiscal(annee(), 2025);
    const par = Object.fromEntries(r.postes.map((p) => [p.cle, p.cents]));

    expect(par.primes).toBe(12 * 43_935);
    expect(par.prevoyance).toBe(725_800);
    expect(par.dons).toBe(50_000);
    expect(par['frais-medicaux']).toBe(18_000);
    expect(par.interets).toBe(12 * 95_000);
    expect(r.totalRevenus).toBe(12 * 800_000);
  });

  it('compte une part de découpage dans son poste, pas l’écriture entière', () => {
    const state = emptyState();
    const id = ecriture(state, '2025-04-10', -100_000, 'Charges & chauffage');
    for (let m = 1; m <= 12; m += 1) ecriture(state, `2025-${String(m).padStart(2, '0')}-25`, 800_000, 'Salaire');
    setSplits(state, id, [
      { cat: 'Intérêts hypothécaires', cents: -70_000 },
      { cat: 'Charges & chauffage', cents: -30_000 },
    ]);

    const r = recapFiscal(state, 2025);
    expect(r.postes.find((p) => p.cle === 'interets').cents).toBe(70_000);
  });

  it('ne montre pas les postes vides, et dit lesquels ils sont', () => {
    const r = recapFiscal(annee(), 2025);
    expect(r.postes.map((p) => p.cle)).not.toContain('deplacement');
    expect(r.postesVides).toContain('Frais de déplacement');
  });

  it('signale une année incomplète, que les chiffres seuls ne trahiraient pas', () => {
    const state = emptyState();
    for (let m = 1; m <= 6; m += 1) {
      ecriture(state, `2025-${String(m).padStart(2, '0')}-25`, 800_000, 'Salaire');
    }
    const r = recapFiscal(state, 2025);
    expect(r.moisMouvementes).toBe(6);
    expect(r.complet).toBe(false);
    // Les chiffres, eux, sortent quand même : ils sont justes sur ce qui est là.
    expect(r.totalRevenus).toBe(6 * 800_000);
  });

  it('arrête la fortune au 31 décembre, dettes déduites', () => {
    const state = annee();
    const etf = addAsset(state, { label: 'ETF', kind: 'titres', account: null });
    const dette = addAsset(state, { label: 'Hypothèque', kind: 'dette', account: null });
    setValuation(state, { assetId: etf, period: '2025-12', valueCents: 5_000_000 });
    setValuation(state, { assetId: dette, period: '2025-12', valueCents: 40_000_000 });

    const { fortune } = recapFiscal(state, 2025);
    expect(fortune.date).toBe('2025-12-31');
    expect(fortune.actifsCents).toBe(5_000_000);
    expect(fortune.dettesCents).toBe(40_000_000);
    expect(fortune.netCents).toBe(-35_000_000);
  });

  it('reprend le plafond 3a de l’année, sans le deviner', () => {
    const r = recapFiscal(annee(), 2025);
    // 2025 est le seul pré-rempli dans l'état initial.
    expect(r.pilier3a.ceilingCents).toBe(725_800);
    expect(r.pilier3a.paidCents).toBe(725_800);
    expect(r.pilier3a.remainingCents).toBe(0);

    const vide = recapFiscal(annee(emptyState()), 2024);
    expect(vide.pilier3a.ceilingCents).toBeNull();
    expect(vide.pilier3a.message).toMatch(/plafond 3a 2024/);
  });

  it('ne mélange pas deux années', () => {
    const state = annee();
    ecriture(state, '2024-06-01', -999_999, 'Dons');
    expect(recapFiscal(state, 2025).postes.find((p) => p.cle === 'dons').cents).toBe(50_000);
  });

  it('liste les années du journal, la plus récente d’abord', () => {
    const state = annee();
    ecriture(state, '2026-01-05', -1_000, 'Dons');
    expect(anneesFiscales(state)).toEqual([2026, 2025]);
    expect(anneesFiscales(emptyState())).toEqual([]);
  });
});
