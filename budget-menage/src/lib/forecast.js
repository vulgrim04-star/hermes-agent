/**
 * Prévision de trésorerie.
 *
 * Ce qui transforme un budget en outil de pilotage : savoir non pas ce qui
 * s'est passé, mais **quand le compte descendra**, et à combien.
 *
 * Deux règles de prudence, tenues fermement, parce qu'une projection fausse
 * est pire qu'aucune projection :
 *
 *  1. **On ne projette que ce qui est adossé à une récurrence observée.** Les
 *     dépenses arbitrables ne sont pas extrapolées — on ne sait pas ce que le
 *     ménage choisira de dépenser, et le prétendre donnerait un faux confort.
 *     La projection est donc structurellement optimiste, et le dit.
 *  2. **On ne part que d'un solde établi.** Sans relevé rapproché, il n'y a
 *     pas de point de départ, et la projection n'est pas rendue. Partir de la
 *     somme des mouvements importés donnerait une courbe juste dans sa forme
 *     et fausse de plusieurs dizaines de milliers de francs dans son niveau.
 */

import { monthBounds, shiftMonth } from './dates.js';
import { accountBalances } from './ledger.js';
import { detectRecurring } from './recurrences.js';

/** Même jour, `n` mois plus tard, ramené au dernier jour du mois si besoin. */
function decaler(date, n) {
  const periode = shiftMonth(date.slice(0, 7), n);
  if (!periode) return null;
  const dernier = Number(monthBounds(periode).end.slice(8, 10));
  return `${periode}-${String(Math.min(Number(date.slice(8, 10)), dernier)).padStart(2, '0')}`;
}

/**
 * Projette le solde sur `mois` mois.
 *
 * Rend `null` quand aucun solde n'est établi — c'est un refus, pas un zéro.
 *
 * `seuilCents` déclenche l'alerte : la première date où le solde projeté
 * passerait en dessous. Zéro par défaut, mais un ménage qui tient un matelas
 * de sécurité le règle plus haut.
 */
export function forecast(state, { mois = 3, seuilCents = 0, depuis = null } = {}) {
  const soldes = accountBalances(state);
  if (!soldes.etablis) return null;

  const horizon = depuis || state.tx.reduce((max, t) => (t.date > max ? t.date : max), '');
  if (!horizon) return null;
  const fin = decaler(horizon, mois);

  // Les récurrences vivantes, et elles seules : une charge interrompue ne
  // reviendra pas, et l'annoncer ferait provisionner une dépense éteinte.
  const vivantes = detectRecurring(state).filter((r) => !r.dormante && r.prochaine);

  const echeances = [];
  for (const r of vivantes) {
    for (let n = 0; n <= mois; n += 1) {
      const date = decaler(r.prochaine, n);
      if (!date || date > fin) break;
      echeances.push({
        date,
        label: r.label,
        cat: r.cat,
        cents: r.sens === 'revenu' ? r.medianeCents : -r.medianeCents,
        sens: r.sens,
      });
    }
  }
  echeances.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  let solde = soldes.total;
  let creux = null;
  const serie = [{ date: horizon, solde, label: 'aujourd’hui' }];

  for (const e of echeances) {
    solde += e.cents;
    serie.push({ date: e.date, solde, label: e.label, cents: e.cents });
    if (creux === null && solde < seuilCents) creux = { date: e.date, solde, label: e.label };
  }

  const entrees = echeances.filter((e) => e.sens === 'revenu').reduce((s, e) => s + e.cents, 0);
  const sorties = echeances.filter((e) => e.sens === 'depense').reduce((s, e) => s + e.cents, 0);

  return {
    depart: soldes.total,
    // Les comptes sans solde établi ne sont pas dans le départ : le dire évite
    // qu'on prenne la projection pour celle du patrimoine entier.
    comptesInconnus: soldes.inconnus,
    horizon,
    fin,
    echeances,
    serie,
    arrivee: solde,
    entrees,
    sorties,
    creux,
    seuilCents,
  };
}
