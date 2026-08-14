/**
 * Budgets et prévision de trésorerie.
 *
 * Deux fonctions qui parlent de l'avenir, donc deux fonctions qu'il faut
 * empêcher d'inventer. Ce qui est verrouillé ici, ce sont surtout les refus :
 * ne pas projeter sans solde établi, ne pas provisionner une charge éteinte,
 * ne pas crier au dépassement le 3 du mois.
 */

import { describe, expect, it } from 'vitest';

import { budgetFor, budgetStatus, progressionDuMois, proposerBudgets, setBudget } from './budgets.js';
import { forecast } from './forecast.js';
import { commitStatements, emptyState, normLabel } from './ledger.js';

let compteur = 0;
function ecriture(state, { label, date, cents, cat = null, acc = 'CH00', transfer = 0 }) {
  compteur += 1;
  state.tx.push({
    id: compteur, acc, date, cents, label,
    norm: normLabel(label), cp: null, ext: null, cat, transfer,
  });
}

function mensuel(state, label, cents, mois, jour = '05') {
  for (let i = 1; i <= mois; i += 1) {
    ecriture(state, { label, date: `2026-${String(i).padStart(2, '0')}-${jour}`, cents });
  }
}

/** Un compte avec un relevé rapproché : sans lui, aucune projection. */
function avecSolde(state, closing = 1_000_000, to = '2026-08-31') {
  state.accounts.CH00 = { key: 'CH00', label: 'Compte courant' };
  state.statements.push({ acc: 'CH00', from: '2026-08-01', to, opening: 0, closing, movements: 0 });
}

describe('budgets', () => {
  it('retient un montant par défaut, et le rend pour n’importe quel mois', () => {
    const state = emptyState();
    setBudget(state, 'Courses', null, 60000);
    expect(budgetFor(state, 'Courses', '2026-03')).toBe(60000);
    expect(budgetFor(state, 'Courses', '2026-11')).toBe(60000);
  });

  it('laisse la surcharge d’un mois l’emporter sur le défaut', () => {
    const state = emptyState();
    setBudget(state, 'Courses', null, 60000);
    setBudget(state, 'Courses', '2026-12', 90000);
    expect(budgetFor(state, 'Courses', '2026-12')).toBe(90000);
    expect(budgetFor(state, 'Courses', '2026-11')).toBe(60000);
  });

  it('accepte zéro comme surcharge : « ce mois-ci, rien » n’est pas « rien de saisi »', () => {
    const state = emptyState();
    setBudget(state, 'Voyages', null, 50000);
    setBudget(state, 'Voyages', '2026-02', 0);
    expect(budgetFor(state, 'Voyages', '2026-02')).toBe(0);
  });

  it('retire une surcharge et rend la main au défaut', () => {
    const state = emptyState();
    setBudget(state, 'Courses', null, 60000);
    setBudget(state, 'Courses', '2026-12', 90000);
    setBudget(state, 'Courses', '2026-12', null);
    expect(budgetFor(state, 'Courses', '2026-12')).toBe(60000);
  });

  it('se saisit en grandeur positive, quel que soit le signe donné', () => {
    const state = emptyState();
    setBudget(state, 'Courses', null, -60000);
    expect(budgetFor(state, 'Courses', '2026-03')).toBe(60000);
  });

  it('ne rend rien pour une catégorie sans budget', () => {
    expect(budgetFor(emptyState(), 'Loisirs', '2026-03')).toBeNull();
  });
});

describe('progressionDuMois', () => {
  it('vaut la part du mois écoulée en cours de mois', () => {
    expect(progressionDuMois('2026-04', '2026-04-15')).toBeCloseTo(0.5, 2);
  });

  it('vaut 1 pour un mois révolu et 0 pour un mois à venir', () => {
    expect(progressionDuMois('2026-04', '2026-06-01')).toBe(1);
    expect(progressionDuMois('2026-09', '2026-08-07')).toBe(0);
  });
});

describe('budgetStatus', () => {
  function septEcritures() {
    const state = emptyState();
    setBudget(state, 'Courses', null, 60000);
    ecriture(state, { label: 'COOP', date: '2026-04-03', cents: -20000, cat: 'Courses' });
    ecriture(state, { label: 'MIGROS', date: '2026-04-09', cents: -21000, cat: 'Courses' });
    return state;
  }

  it('rend prévu, consommé et reste', () => {
    const [ligne] = budgetStatus(septEcritures(), '2026-04', '2026-04-30').lignes;
    expect(ligne).toMatchObject({ cat: 'Courses', prevu: 60000, consomme: 41000, reste: 19000 });
  });

  it('signale une consommation en avance sur le rythme du mois', () => {
    // 41'000 consommés au 10 avril, quand le rythme n'en attendrait que 20'000.
    const [ligne] = budgetStatus(septEcritures(), '2026-04', '2026-04-10').lignes;
    expect(ligne.attendu).toBe(20000);
    expect(ligne.avance).toBe(21000);
    expect(ligne.alerte).toBe(true);
    expect(ligne.depasse).toBe(false);
  });

  it('ne crie pas au dépassement pour une avance modérée', () => {
    const state = emptyState();
    setBudget(state, 'Courses', null, 60000);
    ecriture(state, { label: 'COOP', date: '2026-04-15', cents: -32000, cat: 'Courses' });
    expect(budgetStatus(state, '2026-04', '2026-04-15').lignes[0].alerte).toBe(false);
  });

  it('ne parle plus de rythme sur un mois révolu', () => {
    // Au 30 avril, un budget consommé à 100 % est consommé, pas « en avance ».
    const state = emptyState();
    setBudget(state, 'Courses', null, 60000);
    ecriture(state, { label: 'COOP', date: '2026-04-15', cents: -60000, cat: 'Courses' });
    const [ligne] = budgetStatus(state, '2026-06', '2026-06-30').lignes;
    expect(ligne.consomme).toBe(0);
    expect(ligne.alerte).toBe(false);
  });

  it('marque le dépassement et compte les enveloppes crevées', () => {
    const state = septEcritures();
    ecriture(state, { label: 'COOP', date: '2026-04-28', cents: -30000, cat: 'Courses' });
    const etat = budgetStatus(state, '2026-04', '2026-04-30');
    expect(etat.lignes[0].depasse).toBe(true);
    expect(etat.depassees).toBe(1);
  });

  it('ignore les revenus : un budget est une enveloppe de dépense', () => {
    const state = emptyState();
    setBudget(state, 'Salaire', null, 500000);
    ecriture(state, { label: 'EMPLOYEUR', date: '2026-04-25', cents: 650000, cat: 'Salaire' });
    expect(budgetStatus(state, '2026-04', '2026-04-30').lignes[0].consomme).toBe(0);
  });

  it('refuse un mois qui n’existe pas', () => {
    expect(budgetStatus(emptyState(), '2026-13', '2026-04-30')).toBeNull();
  });
});

describe('forecast', () => {
  function menage() {
    const state = emptyState();
    avecSolde(state, 1_000_000);
    mensuel(state, 'SWICA', -43935, 8);
    mensuel(state, 'EMPLOYEUR SA', 650000, 8, '25');
    return state;
  }

  it('refuse de projeter sans solde établi', () => {
    // Partir de la somme des mouvements importés donnerait une courbe juste
    // dans sa forme et fausse de plusieurs dizaines de milliers dans son niveau.
    const state = emptyState();
    mensuel(state, 'SWICA', -43935, 8);
    expect(forecast(state)).toBeNull();
  });

  it('part du solde rapproché et applique les échéances à venir', () => {
    const f = forecast(menage(), { mois: 3 });
    expect(f.depart).toBe(1_000_000);
    // Trois mois de salaire moins trois mois de prime.
    expect(f.entrees).toBe(650000 * 3);
    expect(f.sorties).toBe(-43935 * 3);
    expect(f.arrivee).toBe(1_000_000 + 650000 * 3 - 43935 * 3);
  });

  it('ne provisionne pas une charge interrompue', () => {
    const state = menage();
    mensuel(state, 'ANCIEN ABONNEMENT', -20000, 3);   // arrêté en mars
    const f = forecast(state, { mois: 3 });
    expect(f.echeances.some((e) => e.label.includes('ANCIEN'))).toBe(false);
  });

  it('annonce la date où le solde passerait sous le seuil', () => {
    const state = emptyState();
    avecSolde(state, 50000);                 // 500.00 en caisse
    mensuel(state, 'LOYER', -145000, 4);     // 1'450.00 par mois
    const f = forecast(state, { mois: 3, seuilCents: 0 });
    expect(f.creux).not.toBeNull();
    expect(f.creux.solde).toBeLessThan(0);
    expect(f.creux.date.slice(0, 7)).toBe('2026-05');
  });

  it('respecte un seuil de sécurité fixé au-dessus de zéro', () => {
    const state = emptyState();
    avecSolde(state, 300000);
    mensuel(state, 'LOYER', -145000, 4);
    // Sans matelas, aucun creux ; avec 200'000 de matelas, il y en a un.
    expect(forecast(state, { mois: 1, seuilCents: 0 }).creux).toBeNull();
    expect(forecast(state, { mois: 1, seuilCents: 200000 }).creux).not.toBeNull();
  });

  it('signale les comptes dont le solde n’est pas établi', () => {
    const state = menage();
    state.accounts.CARTE = { key: 'CARTE', label: 'Carte' };
    ecriture(state, { label: 'COOP', date: '2026-08-01', cents: -5000, acc: 'CARTE' });
    expect(forecast(state).comptesInconnus).toBe(1);
  });

  it('rend une série qui commence à aujourd’hui et finit à l’horizon', () => {
    const f = forecast(menage(), { mois: 2 });
    expect(f.serie[0].solde).toBe(1_000_000);
    expect(f.serie[f.serie.length - 1].solde).toBe(f.arrivee);
    expect(f.echeances.every((e) => e.date <= f.fin)).toBe(true);
  });
});

describe('budgets proposés', () => {
  function journal(state, period, lignes) {
    lignes.forEach(([cat, cents], i) => {
      state.tx.push({
        id: Number(period.replace('-', '')) * 100 + i,
        acc: 'CH00', date: `${period}-12`, cents: -cents, label: cat,
        norm: cat.toUpperCase(), cat, note: null, transfer: 0,
      });
    });
  }

  /** Six mois : le loyer tous les mois, les courses variables, un dentiste. */
  function menage() {
    const state = emptyState();
    const courses = [62_000, 58_000, 71_000, 59_000, 60_500, 88_000];
    ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'].forEach((p, i) => {
      journal(state, p, [['Loyer', 180_000], ['Courses', courses[i]]]);
    });
    journal(state, '2026-03', [['Dentiste', 42_000]]);
    return state;
  }

  it('propose la médiane pour une catégorie régulière, pas la moyenne', () => {
    const p = proposerBudgets(menage(), { mois: 6, fin: '2026-06-30' });
    const courses = p.find((l) => l.cat === 'Courses');
    // Médiane de 58/59/60,5/62/71/88 = 61,25 ; la moyenne, elle, serait tirée
    // vers le haut par le mois à 880.
    expect(courses.medianeCents).toBe(61_250);
    expect(courses.proposeCents).toBe(61_250);
    expect(courses.regulier).toBe(true);
    expect(courses.maxCents).toBe(88_000);
  });

  it('lisse une catégorie irrégulière au lieu de proposer un mois type', () => {
    const p = proposerBudgets(menage(), { mois: 6, fin: '2026-06-30' });
    const dentiste = p.find((l) => l.cat === 'Dentiste');
    expect(dentiste.regulier).toBe(false);
    expect(dentiste.moisObserves).toBe(1);
    // 420 une fois en six mois : 70 par mois, pas 420.
    expect(dentiste.proposeCents).toBe(7_000);
  });

  it('classe la plus grosse enveloppe en tête et rappelle le budget en place', () => {
    const state = menage();
    setBudget(state, 'Loyer', null, 180_000);
    const p = proposerBudgets(state, { mois: 6, fin: '2026-06-30' });
    expect(p[0].cat).toBe('Loyer');
    expect(p[0].proposeCents).toBe(180_000);
    expect(p[0].actuelCents).toBe(180_000);
    expect(p.find((l) => l.cat === 'Courses').actuelCents).toBeNull();
  });

  it('écarte le mois en cours, qui ferait proposer des enveloppes trop petites', () => {
    const state = menage();
    // Juillet s'arrête au 3 : une seule semaine de courses.
    journal(state, '2026-07', [['Courses', 12_000]]);
    state.tx[state.tx.length - 1].date = '2026-07-03';
    const p = proposerBudgets(state, { mois: 6 });
    expect(p.find((l) => l.cat === 'Courses').proposeCents).toBe(61_250);
  });

  it('ne dilue pas les moyennes avec des mois jamais importés', () => {
    const state = emptyState();
    journal(state, '2026-05', [['Courses', 60_000]]);
    journal(state, '2026-06', [['Courses', 60_000]]);
    // Douze mois demandés, deux mois de journal : la période retenue est deux.
    const p = proposerBudgets(state, { mois: 12, fin: '2026-06-30' });
    expect(p[0].moisPeriode).toBe(2);
    expect(p[0].proposeCents).toBe(60_000);
  });

  it('ne propose rien sur un journal vide', () => {
    expect(proposerBudgets(emptyState())).toEqual([]);
  });

  it('ignore les revenus et l’épargne : une enveloppe est une dépense', () => {
    const state = menage();
    state.tx.push({ id: 9001, acc: 'CH00', date: '2026-05-25', cents: 800_000,
      label: 'Salaire', norm: 'SALAIRE', cat: 'Salaire', note: null, transfer: 0 });
    state.tx.push({ id: 9002, acc: 'CH00', date: '2026-05-26', cents: -100_000,
      label: '3a', norm: '3A', cat: 'Pilier 3a', note: null, transfer: 0 });
    const cats = proposerBudgets(state, { mois: 6, fin: '2026-06-30' }).map((l) => l.cat);
    expect(cats).not.toContain('Salaire');
    expect(cats).not.toContain('Pilier 3a');
  });
});
