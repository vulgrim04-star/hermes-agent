/**
 * Patrimoine : décomposition, allocation, hypothèque, projection.
 *
 * Ce qui est éprouvé ici n'est pas l'arithmétique mais les **conventions
 * suisses** et les **refus** : le taux de calcul de 5 % qui n'est pas le taux
 * payé, l'amortissement du 2e rang sur quinze ans, le ratio d'un tiers du
 * revenu — et le fait qu'aucun de ces chiffres ne sorte quand la donnée qui le
 * fonde manque.
 */

import { describe, expect, it } from 'vitest';

import {
  CHARGE_MAX_BP, allocation, arbitrage3aDirect, chargeTheorique, epargneDuMois, evolution,
  projection, setCible, simulerAmortissement, tauxEpargne,
} from './patrimoine.js';
import { emptyState, normLabel } from './ledger.js';
import { addAsset, setValuation } from './networth.js';

let compteur = 0;
function ecriture(state, { date, cents, cat = null, label = 'X', transfer = 0 }) {
  compteur += 1;
  state.tx.push({
    id: compteur, acc: 'CH00', date, cents, label,
    norm: normLabel(label), cp: null, ext: null, cat, transfer,
  });
}

/** Un mois ordinaire : un salaire, un loyer, un versement d'épargne. */
function moisOrdinaire(state, period, { salaire = 800_000, loyer = -180_000, epargne = -100_000 } = {}) {
  ecriture(state, { date: `${period}-25`, cents: salaire, cat: 'Salaire' });
  ecriture(state, { date: `${period}-01`, cents: loyer, cat: 'Loyer' });
  if (epargne) ecriture(state, { date: `${period}-26`, cents: epargne, cat: "Virement d'épargne" });
}

describe('épargne du mois', () => {
  it('ne compte pas un versement d’épargne comme une dépense', () => {
    const state = emptyState();
    moisOrdinaire(state, '2026-03');
    const m = epargneDuMois(state, '2026-03');
    expect(m.revenus).toBe(800_000);
    expect(m.depenses).toBe(180_000);
    // 8'000 − 1'800 : le virement de 1'000 déplace, il ne consomme pas.
    expect(m.epargne).toBe(620_000);
    expect(m.reallocations).toBe(100_000);
  });

  it('classe une écriture sans catégorie par son signe plutôt que de l’ignorer', () => {
    const state = emptyState();
    ecriture(state, { date: '2026-03-04', cents: -5_000 });
    expect(epargneDuMois(state, '2026-03').depenses).toBe(5_000);
  });

  it('laisse les transferts internes hors du calcul', () => {
    const state = emptyState();
    ecriture(state, { date: '2026-03-04', cents: -50_000, transfer: 1 });
    expect(epargneDuMois(state, '2026-03').depenses).toBe(0);
  });

  it('refuse un mois qui n’existe pas', () => {
    expect(epargneDuMois(emptyState(), '2026-13')).toBeNull();
  });
});

describe('décomposition de la variation', () => {
  it('sépare ce qui vient de l’épargne de ce qui vient du marché', () => {
    const state = emptyState();
    const etf = addAsset(state, { label: 'ETF monde', kind: 'titres', account: null });
    setValuation(state, { assetId: etf, period: '2026-02', valueCents: 5_000_000 });
    // Le patrimoine gagne 8'000 : 6'200 d'épargne, donc 1'800 de marché.
    setValuation(state, { assetId: etf, period: '2026-03', valueCents: 5_800_000 });
    moisOrdinaire(state, '2026-03');

    const bilan = evolution(state, '2026-02', '2026-03');
    const mars = bilan.points[1];
    expect(mars.variation).toBe(800_000);
    expect(mars.epargne).toBe(620_000);
    expect(mars.valorisation).toBe(180_000);
    expect(mars.fiable).toBe(true);
    expect(bilan.mesurable).toBe(true);
  });

  it('somme la décomposition sur toute la plage', () => {
    const state = emptyState();
    const etf = addAsset(state, { label: 'ETF', kind: 'titres', account: null });
    setValuation(state, { assetId: etf, period: '2026-01', valueCents: 1_000_000 });
    setValuation(state, { assetId: etf, period: '2026-02', valueCents: 1_700_000 });
    setValuation(state, { assetId: etf, period: '2026-03', valueCents: 2_500_000 });
    moisOrdinaire(state, '2026-02');
    moisOrdinaire(state, '2026-03');

    const bilan = evolution(state, '2026-01', '2026-03');
    expect(bilan.variation).toBe(1_500_000);
    expect(bilan.epargne + bilan.valorisation).toBe(bilan.variation);
    expect(bilan.mois).toBe(2);
  });

  it('marque comme non fiable un mois où une position n’est pas renseignée', () => {
    const state = emptyState();
    const etf = addAsset(state, { label: 'ETF', kind: 'titres', account: null });
    setValuation(state, { assetId: etf, period: '2026-02', valueCents: 1_000_000 });
    setValuation(state, { assetId: etf, period: '2026-03', valueCents: 1_100_000 });
    // L'appartement n'a jamais été valorisé : la variation le manque, et donc
    // la décomposition aussi.
    addAsset(state, { label: 'Appartement', kind: 'immobilier', account: null });
    moisOrdinaire(state, '2026-03');

    const bilan = evolution(state, '2026-02', '2026-03');
    expect(bilan.points[1].fiable).toBe(false);
    expect(bilan.incertains).toBe(1);
    expect(bilan.mesurable).toBe(true);
  });

  it('marque le mois où une valeur a seulement été reportée', () => {
    const state = emptyState();
    const etf = addAsset(state, { label: 'ETF', kind: 'titres', account: null });
    setValuation(state, { assetId: etf, period: '2026-02', valueCents: 1_000_000 });
    const bilan = evolution(state, '2026-02', '2026-03');
    expect(bilan.points[0].reporte).toBe(false);
    expect(bilan.points[1].reporte).toBe(true);
    // Rien n'a été relevé : la valorisation du mois est nulle, pas inconnue.
    expect(bilan.points[1].valorisation).toBe(0);
  });

  it('n’ouvre pas la série avant la première valorisation connue', () => {
    const state = emptyState();
    const dette = addAsset(state, { label: 'Hypothèque', kind: 'dette', account: null });
    setValuation(state, { assetId: dette, period: '2026-07', valueCents: 40_000_000 });
    setValuation(state, { assetId: dette, period: '2026-08', valueCents: 39_800_000 });

    // Fenêtre de deux ans : les mois d'avant ne valent pas zéro, ils sont
    // inconnus. Les compter ferait sortir une « valorisation » de −400'000.
    const bilan = evolution(state, '2024-09', '2026-08');
    expect(bilan.points[0].period).toBe('2026-07');
    expect(bilan.mois).toBe(1);
    expect(bilan.variation).toBe(200_000);
    expect(bilan.valorisation).toBe(200_000);
  });

  it('ne mesure rien quand aucune position n’est valorisée', () => {
    const state = emptyState();
    addAsset(state, { label: 'Appartement', kind: 'immobilier', account: null });
    expect(evolution(state, '2026-01', '2026-08').mesurable).toBe(false);
  });

  it('rend une plage vide sans se plaindre', () => {
    expect(evolution(emptyState(), '2026-05', '2026-01')).toEqual({ points: [], mesurable: false });
  });
});

describe('allocation par classe', () => {
  function portefeuille() {
    const state = emptyState();
    setValuation(state, {
      assetId: addAsset(state, { label: 'ETF', kind: 'titres', account: null }),
      period: '2026-03', valueCents: 6_000_000,
    });
    setValuation(state, {
      assetId: addAsset(state, { label: 'Bitcoin', kind: 'crypto', account: null }),
      period: '2026-03', valueCents: 2_000_000,
    });
    setValuation(state, {
      assetId: addAsset(state, { label: 'Épargne', kind: 'compte', account: null }),
      period: '2026-03', valueCents: 2_000_000,
    });
    setValuation(state, {
      assetId: addAsset(state, { label: 'Hypothèque', kind: 'dette', account: null }),
      period: '2026-03', valueCents: 4_000_000,
    });
    return state;
  }

  it('tient les dettes hors de la répartition', () => {
    const a = allocation(portefeuille(), '2026-03');
    expect(a.total).toBe(10_000_000);
    expect(a.dettes).toBe(4_000_000);
    expect(a.net).toBe(6_000_000);
    expect(a.lignes.map((l) => l.kind)).toEqual(['titres', 'crypto', 'compte']);
    expect(a.lignes[0].part).toBeCloseTo(0.6, 5);
  });

  it('chiffre l’écart à la cible en francs et en points', () => {
    const state = portefeuille();
    setCible(state, 'titres', 7000);
    setCible(state, 'crypto', 1000);
    setCible(state, 'compte', 2000);

    const a = allocation(state, '2026-03');
    expect(a.ciblesCompletes).toBe(true);
    const titres = a.lignes.find((l) => l.kind === 'titres');
    // 60 % pour une cible de 70 % : 1'000'000 de retard.
    expect(titres.ecartCents).toBe(-1_000_000);
    expect(titres.ecartBp).toBe(-1000);
    const crypto = a.lignes.find((l) => l.kind === 'crypto');
    expect(crypto.ecartCents).toBe(1_000_000);
  });

  it('dit quand les cibles ne font pas cent pour cent', () => {
    const state = portefeuille();
    setCible(state, 'titres', 7000);
    expect(allocation(state, '2026-03').ciblesCompletes).toBe(false);
  });

  it('garde visible une classe visée mais vide', () => {
    const state = portefeuille();
    setCible(state, 'prevoyance', 1500);
    const ligne = allocation(state, '2026-03').lignes.find((l) => l.kind === 'prevoyance');
    expect(ligne.valeur).toBe(0);
    expect(ligne.ecartCents).toBe(-1_500_000);
  });

  it('borne une cible aberrante au lieu de la propager', () => {
    const state = emptyState();
    expect(setCible(state, 'titres', 12_000)).toBe(10_000);
    expect(setCible(state, 'titres', -5)).toBe(0);
    setCible(state, 'titres', null);
    expect(allocation(state, '2026-03').cibleTotalBp).toBe(0);
  });

  it('compte les positions non renseignées sans les valoriser à zéro', () => {
    const state = portefeuille();
    addAsset(state, { label: 'Voiture', kind: 'vehicule', account: null });
    const a = allocation(state, '2026-03');
    expect(a.inconnues).toBe(1);
    expect(a.total).toBe(10_000_000);
  });
});

describe('charge théorique', () => {
  /** 800'000 de bien, 600'000 de dette, 150'000 de revenu, 1,2 % payé. */
  const dossier = {
    valeurCents: 80_000_000,
    detteCents: 60_000_000,
    revenuAnnuelCents: 15_000_000,
    tauxHypothecaireBp: 120,
  };

  it('teste au taux de calcul, pas au taux payé', () => {
    const c = chargeTheorique(dossier);
    expect(c.interetsTheoriquesCents).toBe(3_000_000); // 5 % de 600'000
    expect(c.interetsReelsCents).toBe(720_000); // 1,2 % réellement payés
  });

  it('amortit le 2e rang sur quinze ans', () => {
    const c = chargeTheorique(dossier);
    // 600'000 − 66,67 % de 800'000 = 66'640, sur quinze ans.
    expect(c.deuxiemeRangCents).toBe(6_664_000);
    expect(c.amortissementRequisCents).toBe(444_267);
  });

  it('conclut sur le tiers du revenu brut', () => {
    const c = chargeTheorique(dossier);
    expect(c.totalCents).toBe(3_000_000 + 800_000 + 444_267);
    expect(c.ratioBp).toBe(2830);
    expect(c.tenable).toBe(true);
    expect(c.nantissementBp).toBe(7500);
    expect(c.fondsPropresSuffisants).toBe(true);
  });

  it('refuse de conclure sans revenu saisi', () => {
    const c = chargeTheorique({ ...dossier, revenuAnnuelCents: null });
    expect(c.ratioBp).toBeNull();
    expect(c.tenable).toBeNull();
    // Le chiffre utile reste : le revenu qu'il faudrait pour tenir.
    expect(c.revenuMinimalCents).toBeGreaterThan(0);
  });

  it('signale un dossier qui ne tient pas', () => {
    const c = chargeTheorique({ ...dossier, revenuAnnuelCents: 9_000_000 });
    expect(c.ratioBp).toBeGreaterThan(CHARGE_MAX_BP);
    expect(c.tenable).toBe(false);
  });

  it('retient l’amortissement volontaire quand il dépasse le requis', () => {
    const c = chargeTheorique({ ...dossier, amortissementAnnuelCents: 1_000_000 });
    expect(c.amortissementCents).toBe(1_000_000);
    expect(c.totalCents).toBe(3_000_000 + 800_000 + 1_000_000);
  });

  it('n’exige plus d’amortissement sous les deux tiers', () => {
    const c = chargeTheorique({ ...dossier, detteCents: 50_000_000 });
    expect(c.deuxiemeRangCents).toBe(0);
    expect(c.amortissementRequisCents).toBe(0);
  });
});

describe('amortissement extraordinaire', () => {
  const dossier = {
    valeurCents: 80_000_000, detteCents: 60_000_000,
    revenuAnnuelCents: 15_000_000, tauxHypothecaireBp: 120,
  };

  it('chiffre séparément la charge théorique et ce qu’on cesse de payer', () => {
    const s = simulerAmortissement(dossier, 5_000_000);
    // 5 % théoriques sur 50'000 remboursés, plus l'amortissement qui tombe.
    expect(s.gainChargeAnnuelleCents).toBe(250_000 + (s.avant.amortissementCents - s.apres.amortissementCents));
    expect(s.economieInteretsCents).toBe(60_000); // 1,2 % de 50'000
    expect(s.gainRatioBp).toBeGreaterThan(0);
  });

  it('signale le passage sous les deux tiers, qui supprime l’obligation', () => {
    expect(simulerAmortissement(dossier, 6_664_000).sortDuDeuxiemeRang).toBe(true);
    expect(simulerAmortissement(dossier, 1_000_000).sortDuDeuxiemeRang).toBe(false);
  });

  it('ne fait pas descendre la dette sous zéro', () => {
    expect(simulerAmortissement(dossier, 99_000_000).apres.detteCents).toBe(0);
  });
});

describe('amortissement direct ou indirect', () => {
  const base = {
    versementAnnuelCents: 700_000, annees: 10,
    tauxHypothecaireBp: 120, tauxMarginalBp: 2500, rendement3aBp: 200, impotRetraitBp: 500,
  };

  it('compte les deux chemins et désigne le meilleur', () => {
    const a = arbitrage3aDirect(base);
    expect(a.verseCents).toBe(7_000_000);
    expect(a.direct.dettePayeeCents).toBe(7_000_000);
    expect(a.indirect.capital3aCents).toBeGreaterThan(7_000_000);
    expect(a.ecartCents).toBe(a.indirect.totalCents - a.direct.totalCents);
    expect(['direct', 'indirect']).toContain(a.favori);
  });

  it('rend l’amortissement direct meilleur quand la dette coûte cher et le 3a ne rend rien', () => {
    const a = arbitrage3aDirect({ ...base, tauxHypothecaireBp: 400, rendement3aBp: 0, tauxMarginalBp: 0 });
    expect(a.favori).toBe('direct');
  });

  it('amputte le 3a de l’impôt de retrait plutôt que de l’oublier', () => {
    const avec = arbitrage3aDirect(base);
    const sans = arbitrage3aDirect({ ...base, impotRetraitBp: 0 });
    expect(avec.indirect.totalCents).toBeLessThan(sans.indirect.totalCents);
    expect(avec.indirect.impotRetraitCents).toBeGreaterThan(0);
  });

  it('ne conclut rien sans versement', () => {
    expect(arbitrage3aDirect({ ...base, versementAnnuelCents: 0 })).toBeNull();
  });
});

describe('taux d’épargne', () => {
  it('écarte un mois en cours, qui gonflerait le taux', () => {
    const state = emptyState();
    moisOrdinaire(state, '2026-01');
    moisOrdinaire(state, '2026-02');
    // Mars s'arrête au 3 : le salaire n'est pas tombé, le loyer si.
    ecriture(state, { date: '2026-03-01', cents: -180_000, cat: 'Loyer' });

    const t = tauxEpargne(state, { mois: 12 });
    expect(t.moisIgnore).toBe('2026-03');
    expect(t.mois).toBe(2);
    expect(t.taux).toBeCloseTo(620_000 / 800_000, 5);
    expect(t.epargneMensuelleCents).toBe(620_000);
  });

  it('garde le dernier mois quand il est complet', () => {
    const state = emptyState();
    moisOrdinaire(state, '2026-01');
    ecriture(state, { date: '2026-01-31', cents: -10_000, cat: 'Courses' });
    const t = tauxEpargne(state, { mois: 12 });
    expect(t.moisIgnore).toBeNull();
    expect(t.mois).toBe(1);
  });

  it('rend null sur un journal vide', () => {
    expect(tauxEpargne(emptyState())).toBeNull();
  });
});

describe('projection', () => {
  it('sépare ce qui est versé de ce que le rendement produit', () => {
    const p = projection({ departCents: 10_000_000, epargneMensuelleCents: 100_000, rendementBp: 400, annees: 10 });
    expect(p.points).toHaveLength(11);
    expect(p.verseCents).toBe(12_000_000);
    expect(p.rendementCents).toBeGreaterThan(0);
    expect(p.finCents).toBe(10_000_000 + p.verseCents + p.rendementCents);
  });

  it('ne produit aucun rendement quand aucun n’est saisi', () => {
    const p = projection({ departCents: 5_000_000, epargneMensuelleCents: 50_000, annees: 5 });
    expect(p.rendementCents).toBe(0);
    expect(p.finCents).toBe(5_000_000 + 60 * 50_000);
  });

  it('garde le capital de départ intact à l’année zéro', () => {
    const p = projection({ departCents: 1_234_500, epargneMensuelleCents: 0, rendementBp: 500, annees: 1 });
    expect(p.points[0]).toEqual({ annee: 0, capitalCents: 1_234_500, verseCents: 0, rendementCents: 0 });
  });
});
