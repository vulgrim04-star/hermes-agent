/**
 * Tiers et récurrences.
 *
 * Ce qui est éprouvé ici, ce n'est pas l'arithmétique — elle est triviale —
 * mais le **jugement** : ce que l'application accepte d'appeler une charge
 * récurrente, et ce qu'elle refuse. Un faux positif gonfle le socle engagé et
 * fait croire à un reste à vivre plus faible qu'il n'est ; c'est donc le cas
 * qu'il faut le plus verrouiller.
 */

import { describe, expect, it } from 'vitest';

import { categoriseTiers, groupByPayee, payeeKey } from './tiers.js';
import { detectRecurring, fixedVsDiscretionary } from './recurrences.js';
import { applyRules, emptyState, normLabel } from './ledger.js';
import { accepterRegle, proposerRegle, rejouerRegles } from './apprentissage.js';

let compteur = 0;
function ecriture(state, { label, date, cents, cat = null, cp = null, transfer = 0 }) {
  compteur += 1;
  state.tx.push({
    id: compteur, acc: 'CH00', date, cents, label,
    norm: normLabel(label), cp, ext: null, cat, transfer,
  });
}

/** Une charge mensuelle stable, sur `mois` mois consécutifs de 2026. */
function mensuel(state, label, cents, mois, jour = '05') {
  for (let i = 1; i <= mois; i += 1) {
    ecriture(state, { label, date: `2026-${String(i).padStart(2, '0')}-${jour}`, cents });
  }
}

describe('payeeKey', () => {
  it('retire le numéro de carte masqué, qui ferait autant de tiers que de mois', () => {
    expect(payeeKey('SPOTIFY 5351XXXXXXXX0381 06')).toBe(payeeKey('SPOTIFY 5351XXXXXXXX0381 07'));
    expect(payeeKey('SPOTIFY 5351XXXXXXXX0381 06')).toBe('SPOTIFY');
  });

  it('retire le bruit bancaire et les longues références', () => {
    expect(payeeKey('PAIEMENT CARTE MIGROS NEUCHATEL REF 998877665544')).toBe('MIGROS NEUCHATEL');
  });

  it('préfère la contrepartie livrée par la banque au libellé deviné', () => {
    expect(payeeKey('VIREMENT 4471', 'EMPLOYEUR SA')).toBe('EMPLOYEUR SA');
  });

  it('ne rend jamais de clé vide, qui regrouperait n’importe quoi', () => {
    expect(payeeKey('PAIEMENT CARTE 4471')).not.toBe('');
    expect(payeeKey('')).toBe('SANS LIBELLE');
  });
});

describe('groupByPayee', () => {
  it('regroupe les occurrences d’un même commerçant et cumule ses dépenses', () => {
    const state = emptyState();
    mensuel(state, 'MIGROL SERVICE 5351XXXXXXXX0381', -4500, 3);
    const [tiers] = groupByPayee(state);
    expect(tiers.key).toBe('MIGROL SERVICE');
    expect(tiers.occurrences).toBe(3);
    expect(tiers.mois).toBe(3);
    expect(tiers.depenses).toBe(-13500);
  });

  it('écarte les transferts internes confirmés', () => {
    const state = emptyState();
    ecriture(state, { label: 'REGLEMENT CARTE', date: '2026-01-20', cents: -12465, transfer: 1 });
    ecriture(state, { label: 'COOP FRIBOURG', date: '2026-01-08', cents: -8740 });
    const tiers = groupByPayee(state);
    expect(tiers).toHaveLength(1);
    expect(tiers[0].key).toBe('COOP FRIBOURG');
  });

  it('remonte la catégorie dominante et compte ce qui reste à classer', () => {
    const state = emptyState();
    ecriture(state, { label: 'COOP', date: '2026-01-08', cents: -1000, cat: 'Courses' });
    ecriture(state, { label: 'COOP', date: '2026-02-08', cents: -1200, cat: 'Courses' });
    ecriture(state, { label: 'COOP', date: '2026-03-08', cents: -900 });
    const [tiers] = groupByPayee(state);
    expect(tiers.cat).toBe('Courses');
    expect(tiers.catUnanime).toBe(true);
    expect(tiers.aClasser).toBe(1);
  });

  it('classe les tiers par poids de dépense : le plus coûteux d’abord', () => {
    const state = emptyState();
    mensuel(state, 'PETIT', -1000, 3);
    mensuel(state, 'GROS', -50000, 3);
    expect(groupByPayee(state).map((t) => t.key)).toEqual(['GROS', 'PETIT']);
  });
});

describe('categoriseTiers', () => {
  it('classe tout l’historique du tiers d’un seul geste', () => {
    const state = emptyState();
    mensuel(state, 'SWICA KRANKENVERSICHERUNG', -43935, 5);
    expect(categoriseTiers(state, 'SWICA KRANKENVERSICHERUNG', 'Primes LAMal')).toBe(5);
    expect(state.tx.every((t) => t.cat === 'Primes LAMal')).toBe(true);
  });

  it('n’écrase pas une catégorie posée à la main', () => {
    const state = emptyState();
    mensuel(state, 'SWICA', -43935, 3);
    state.tx[1].cat = 'Assurance complémentaire (LCA)';
    categoriseTiers(state, 'SWICA', 'Primes LAMal');
    expect(state.tx[1].cat).toBe('Assurance complémentaire (LCA)');
    expect(state.tx[0].cat).toBe('Primes LAMal');
  });
});

describe('detectRecurring', () => {
  it('reconnaît une charge mensuelle stable et annonce la prochaine échéance', () => {
    const state = emptyState();
    mensuel(state, 'SWICA KRANKENVERSICHERUNG AG', -43935, 8);
    const [r] = detectRecurring(state);
    expect(r.key).toBe('SWICA KRANKENVERSICHERUNG AG');
    expect(r.medianeCents).toBe(43935);
    expect(r.mois).toBe(8);
    expect(r.sens).toBe('depense');
    expect(r.derniere).toBe('2026-08-05');
    expect(r.prochaine).toBe('2026-09-05');
  });

  it('refuse deux mois : trois occurrences ne font pas encore une habitude', () => {
    const state = emptyState();
    mensuel(state, 'QUELQUE CHOSE', -5000, 2);
    expect(detectRecurring(state)).toHaveLength(0);
  });

  it('refuse un commerçant fréquenté plusieurs fois par mois', () => {
    // Trois passages mensuels chez le même commerçant : une habitude, pas un
    // abonnement. Le compter comme engagé fausserait l'arbitrable.
    const state = emptyState();
    for (let m = 1; m <= 4; m += 1) {
      for (const jour of ['03', '13', '23']) {
        ecriture(state, { label: 'BOULANGERIE', date: `2026-0${m}-${jour}`, cents: -650 });
      }
    }
    expect(detectRecurring(state)).toHaveLength(0);
  });

  it('refuse un montant qui varie trop pour être une charge fixe', () => {
    const state = emptyState();
    ecriture(state, { label: 'COOP', date: '2026-01-05', cents: -2000 });
    ecriture(state, { label: 'COOP', date: '2026-02-05', cents: -9000 });
    ecriture(state, { label: 'COOP', date: '2026-03-05', cents: -4000 });
    expect(detectRecurring(state)).toHaveLength(0);
  });

  it('refuse un tiers qui encaisse et débourse tour à tour', () => {
    const state = emptyState();
    ecriture(state, { label: 'CONJOINT', date: '2026-01-05', cents: -50000 });
    ecriture(state, { label: 'CONJOINT', date: '2026-02-05', cents: 50000 });
    ecriture(state, { label: 'CONJOINT', date: '2026-03-05', cents: -50000 });
    expect(detectRecurring(state)).toHaveLength(0);
  });

  it('reconnaît un revenu récurrent et le distingue d’une charge', () => {
    const state = emptyState();
    mensuel(state, 'EMPLOYEUR SA', 650000, 6, '25');
    const [r] = detectRecurring(state);
    expect(r.sens).toBe('revenu');
    expect(r.medianeCents).toBe(650000);
  });

  it('signale une dérive : la prime a augmenté sans qu’on l’ait vue', () => {
    const state = emptyState();
    mensuel(state, 'SWICA', -43935, 7);
    ecriture(state, { label: 'SWICA', date: '2026-08-05', cents: -51200 });

    const [r] = detectRecurring(state, { tolerance: 0.15 });
    expect(r.derive).not.toBeNull();
    expect(r.derive.cents).toBe(51200 - 43935);
    expect(r.derive.tx.date).toBe('2026-08-05');
  });

  it('ne signale pas de dérive quand le montant tient dans la tolérance', () => {
    const state = emptyState();
    mensuel(state, 'ELECTRICITE', -10000, 5);
    ecriture(state, { label: 'ELECTRICITE', date: '2026-06-05', cents: -10500 });
    expect(detectRecurring(state)[0].derive).toBeNull();
  });

  it('ramène une échéance du 31 au dernier jour du mois suivant', () => {
    const state = emptyState();
    for (const date of ['2026-01-31', '2026-03-31', '2026-05-31']) {
      ecriture(state, { label: 'LOYER', date, cents: -145000 });
    }
    // Juin n'a pas de 31 : l'échéance retombe au 30, pas au 1er juillet.
    expect(detectRecurring(state)[0].prochaine).toBe('2026-06-30');
  });
});

describe('fixedVsDiscretionary', () => {
  it('sépare le socle engagé de ce qui reste arbitrable', () => {
    const state = emptyState();
    mensuel(state, 'SWICA', -43935, 4);           // récurrent → engagé
    mensuel(state, 'PARKING DES ALPES', -14595, 4); // récurrent → engagé
    ecriture(state, { label: 'RESTAURANT DU PONT', date: '2026-04-12', cents: -8500 });
    ecriture(state, { label: 'FNAC', date: '2026-04-18', cents: -12000 });

    const avril = fixedVsDiscretionary(state, '2026-04');
    expect(avril.engage).toBe(43935 + 14595);
    expect(avril.arbitrable).toBe(8500 + 12000);
    expect(avril.total).toBe(43935 + 14595 + 8500 + 12000);
    expect(avril.part).toBeCloseTo(0.74, 2);
  });

  it('compte la charge comme engagée même si son montant a bougé', () => {
    // C'est la charge qui est inévitable, pas son montant exact.
    const state = emptyState();
    mensuel(state, 'SWICA', -43935, 5);
    ecriture(state, { label: 'SWICA', date: '2026-06-05', cents: -47000 });
    expect(fixedVsDiscretionary(state, '2026-06').engage).toBe(47000);
  });

  it('ignore les revenus et les transferts internes', () => {
    const state = emptyState();
    mensuel(state, 'EMPLOYEUR SA', 650000, 4, '25');
    ecriture(state, { label: 'REGLEMENT CARTE', date: '2026-04-20', cents: -12465, transfer: 1 });
    ecriture(state, { label: 'COOP', date: '2026-04-08', cents: -8740 });

    const avril = fixedVsDiscretionary(state, '2026-04');
    expect(avril.engage).toBe(0);
    expect(avril.arbitrable).toBe(8740);
  });

  it('refuse un mois qui n’existe pas plutôt que de rendre des zéros', () => {
    expect(fixedVsDiscretionary(emptyState(), '2026-13')).toBeNull();
  });
});

describe('récurrences interrompues', () => {
  it('n’annonce pas d’échéance pour une charge qui s’est arrêtée', () => {
    const state = emptyState();
    // Abonnement résilié en mars ; le journal va jusqu'en août.
    mensuel(state, 'IONOS SARL', -150, 3);
    ecriture(state, { label: 'COOP', date: '2026-08-07', cents: -8740 });

    const [r] = detectRecurring(state);
    expect(r.key).toBe('IONOS SARL');
    expect(r.dormante).toBe(true);
    // Annoncer « prochaine échéance : 12 avril » un 7 août ruinerait la
    // confiance dans tout l'écran.
    expect(r.prochaine).toBeNull();
  });

  it('garde l’échéance tant que la charge est encore vivante', () => {
    const state = emptyState();
    mensuel(state, 'SPOTIFY', -2695, 8);
    const [r] = detectRecurring(state);
    expect(r.dormante).toBe(false);
    expect(r.prochaine).toBe('2026-09-05');
  });

  it('sort une charge interrompue du socle engagé', () => {
    const state = emptyState();
    mensuel(state, 'ANCIEN ABONNEMENT', -5000, 3);   // janvier → mars
    ecriture(state, { label: 'RESTAURANT', date: '2026-08-12', cents: -6000 });

    const aout = fixedVsDiscretionary(state, '2026-08');
    expect(aout.engage).toBe(0);
    expect(aout.arbitrable).toBe(6000);
  });

  it('tolère un retard d’un mois sans déclarer la charge morte', () => {
    const state = emptyState();
    mensuel(state, 'PARKING', -14595, 6);            // janvier → juin
    ecriture(state, { label: 'COOP', date: '2026-07-20', cents: -4000 });
    expect(detectRecurring(state)[0].dormante).toBe(false);
  });
});

describe('apprendre des corrections', () => {
  it('propose de classer les autres écritures du même tiers', () => {
    const state = emptyState();
    mensuel(state, 'MIGROL SERVICE 5351XXXXXXXX0381', -4500, 4);
    state.tx[0].cat = 'Carburant';                       // corrigée à la main

    const p = proposerRegle(state, state.tx[0], 'Carburant');
    expect(p).toMatchObject({ kind: 'tiers', pattern: 'MIGROL SERVICE', cat: 'Carburant' });
    expect(p.restantes).toBe(3);
  });

  it('ne propose rien quand il n’y a rien d’autre à classer', () => {
    // Une proposition sans effet à chaque clic ferait ignorer les utiles.
    const state = emptyState();
    ecriture(state, { label: 'FNAC', date: '2026-03-02', cents: -12000, cat: 'Shopping' });
    expect(proposerRegle(state, state.tx[0], 'Shopping')).toBeNull();
  });

  it('accepte la règle, classe l’historique, et la conserve pour l’avenir', () => {
    const state = emptyState();
    mensuel(state, 'SPOTIFY 5351XXXXXXXX0381 06', -2695, 5);
    state.tx[0].cat = 'Abonnements numériques';

    const p = proposerRegle(state, state.tx[0], 'Abonnements numériques');
    expect(accepterRegle(state, p, applyRules)).toBe(4);
    expect(state.tx.every((t) => t.cat === 'Abonnements numériques')).toBe(true);
    // Conservée : le prochain relevé n'aura pas à être reclassé.
    expect(state.rules).toEqual([
      { kind: 'tiers', pattern: 'SPOTIFY', cat: 'Abonnements numériques' },
    ]);
  });

  it('ne crée pas deux fois la même règle', () => {
    const state = emptyState();
    mensuel(state, 'COOP', -4000, 4);
    const p = proposerRegle(state, state.tx[0], 'Courses');
    accepterRegle(state, p, applyRules);
    accepterRegle(state, p, applyRules);
    expect(state.rules).toHaveLength(1);
  });

  it('une règle de tiers vaut pour les libellés que le motif manquerait', () => {
    // Deux rédactions différentes du même commerçant : un motif fondé sur le
    // libellé complet en raterait une, le tiers les prend toutes les deux.
    const state = emptyState();
    ecriture(state, { label: 'MIGROL SERVICE 5351XXXXXXXX0381 06', date: '2026-01-05', cents: -4500 });
    ecriture(state, { label: 'MIGROL SERVICE 9911XXXXXXXX4402 11', date: '2026-02-05', cents: -5200 });
    state.rules.push({ kind: 'tiers', pattern: 'MIGROL SERVICE', cat: 'Carburant' });
    expect(applyRules(state, state.tx)).toBe(2);
  });

  it('les anciennes règles sans « kind » restent des motifs et fonctionnent', () => {
    const state = emptyState();
    ecriture(state, { label: 'ACHAT COOP PRONTO FRIBOURG', date: '2026-01-05', cents: -1500 });
    state.rules.push({ pattern: 'COOP PRONTO', cat: 'Courses' });   // forme historique
    expect(applyRules(state, state.tx)).toBe(1);
    expect(state.tx[0].cat).toBe('Courses');
  });

  it('simule un rejeu sans toucher au journal', () => {
    const state = emptyState();
    mensuel(state, 'COOP', -4000, 3);
    state.rules.push({ kind: 'tiers', pattern: 'COOP', cat: 'Courses' });

    expect(rejouerRegles(state, applyRules, { simuler: true })).toBe(3);
    expect(state.tx.every((t) => t.cat === null)).toBe(true);   // rien n'a bougé
    expect(rejouerRegles(state, applyRules)).toBe(3);
    expect(state.tx.every((t) => t.cat === 'Courses')).toBe(true);
  });
});
