/**
 * Charges récurrentes — ce qui est engagé, ce qui reste arbitrable.
 *
 * Un budget qui ne distingue pas les deux ne sert pas à décider. La prime
 * maladie, le loyer, le parking et les abonnements tombent quoi qu'il arrive :
 * les mettre dans le même sac que les courses et les restaurants laisse croire
 * que tout est négociable, alors que l'essentiel ne l'est pas.
 *
 * Trois choses en sortent :
 *
 *  - le **socle engagé** du mois, et donc l'arbitrable par différence ;
 *  - les **prochaines échéances**, qui alimenteront la prévision de trésorerie ;
 *  - les **dérives** — une charge qui s'écarte de son montant habituel. Une
 *    prime qui passe de 439.35 à 512.00 sans qu'on l'ait vue est exactement ce
 *    qu'un budget doit signaler.
 *
 * Rien n'est deviné en silence : une récurrence est une **observation** du
 * passé, pas une promesse, et l'écran la présente comme telle.
 */

import { monthBounds, shiftMonth } from './dates.js';
import { groupByPayee, payeeKey } from './tiers.js';

/** Médiane des montants absolus : insensible à une occurrence aberrante. */
function mediane(valeurs) {
  const triees = [...valeurs].sort((a, b) => a - b);
  const milieu = Math.floor(triees.length / 2);
  return triees.length % 2 ? triees[milieu] : Math.round((triees[milieu - 1] + triees[milieu]) / 2);
}

/**
 * Même jour du mois suivant, ramené au dernier jour quand il n'existe pas —
 * une charge du 31 janvier retombe au 28 ou 29 février, pas au 3 mars.
 */
function memeJourMoisSuivant(date) {
  const [annee, mois, jour] = date.split('-');
  const suivant = shiftMonth(`${annee}-${mois}`, 1);
  if (!suivant) return null;
  const bornes = monthBounds(suivant);
  const dernier = Number(bornes.end.slice(8, 10));
  return `${suivant}-${String(Math.min(Number(jour), dernier)).padStart(2, '0')}`;
}

/**
 * Repère les charges (et les revenus) qui reviennent chaque mois.
 *
 * Les critères sont volontairement stricts. Un faux positif coûte plus cher
 * qu'un oubli : une dépense ponctuelle classée « engagée » gonflerait le socle
 * et ferait croire à un reste à vivre plus faible qu'il n'est.
 *
 *  - au moins `minMonths` mois **distincts** — trois achats le même mois ne
 *    font pas une récurrence ;
 *  - montant stable à `tolerance` près, en médiane ;
 *  - à peu près une occurrence par mois : un commerçant fréquenté trois fois
 *    par mois est une habitude, pas un abonnement.
 */
export function detectRecurring(state, { minMonths = 3, tolerance = 0.15, dormanceMois = 2 } = {}) {
  const recurrences = [];

  /*
   * L'horizon du journal — la dernière écriture importée — sert de présent.
   *
   * Sans lui, une charge résiliée en mai continuait d'annoncer une « prochaine
   * échéance » au 12 mai alors qu'on est en août. Une date d'échéance passée
   * ruine la confiance dans tout l'écran, et c'est le genre de chose qu'un
   * comptable repère à la seconde.
   */
  const horizon = state.tx.reduce((max, t) => (t.date > max ? t.date : max), '');
  const indexMois = (periode) => Number(periode.slice(0, 4)) * 12 + Number(periode.slice(5, 7));

  for (const tiers of groupByPayee(state)) {
    // Un tiers qui encaisse et débourse tour à tour n'est pas une charge fixe.
    const signe = Math.sign(tiers.tx[0].cents);
    if (!signe || tiers.tx.some((t) => Math.sign(t.cents) !== signe)) continue;

    const mois = new Set(tiers.tx.map((t) => t.date.slice(0, 7)));
    if (mois.size < minMonths) continue;
    if (tiers.occurrences / mois.size > 1.5) continue;

    const montants = tiers.tx.map((t) => Math.abs(t.cents));
    const med = mediane(montants);
    if (!med) continue;

    /*
     * La stabilité se juge sur la **majorité** des occurrences, pas sur l'écart
     * entre les deux extrêmes.
     *
     * Comparer min et max paraissait plus simple, mais rendait la détection de
     * dérive impossible : une prime passée de 439.35 à 512.00 faisait sortir
     * l'écart de la tolérance, le tiers était rejeté comme non récurrent, et
     * l'augmentation qu'on voulait précisément signaler passait inaperçue.
     * Le défaut exact que ce module existe pour éviter.
     */
    const dansLaNorme = montants.filter((m) => Math.abs(m - med) / med <= tolerance).length;
    if (dansLaNorme / montants.length < 0.7) continue;

    const min = Math.min(...montants);
    const max = Math.max(...montants);

    // La dernière occurrence, comparée à l'habitude : c'est là que se voit une
    // augmentation qu'on n'a pas remarquée.
    const derniere = tiers.tx.reduce((a, b) => (a.date > b.date ? a : b));
    const ecart = Math.abs(derniere.cents) - med;
    const derive = Math.abs(ecart) / med > tolerance ? { cents: ecart, tx: derniere } : null;

    // Une charge dont la dernière occurrence remonte à plus de `dormanceMois`
    // est tenue pour interrompue : elle a été résiliée, ou le relevé qui la
    // porte n'est pas encore importé. Dans les deux cas, en annoncer la
    // prochaine échéance serait mentir.
    const dormante = indexMois(horizon) - indexMois(derniere.date) > dormanceMois;

    recurrences.push({
      key: tiers.key,
      label: tiers.label,
      cat: tiers.cat,
      sens: signe > 0 ? 'revenu' : 'depense',
      medianeCents: med,
      minCents: min,
      maxCents: max,
      mois: mois.size,
      occurrences: tiers.occurrences,
      derniere: derniere.date,
      prochaine: dormante ? null : memeJourMoisSuivant(derniere.date),
      dormante,
      derive,
      tx: tiers.tx,
    });
  }

  recurrences.sort((a, b) => b.medianeCents - a.medianeCents);
  return recurrences;
}

/**
 * Partage les dépenses d'un mois entre socle engagé et arbitrable.
 *
 * L'appartenance se juge sur le tiers, pas sur l'écriture : dès qu'un tiers est
 * reconnu récurrent, ce qu'il a prélevé ce mois-là est engagé — y compris si le
 * montant a bougé, puisque c'est la charge qui est inévitable, pas son montant
 * exact.
 */
export function fixedVsDiscretionary(state, period, options) {
  const bornes = monthBounds(period);
  if (!bornes) return null;

  const engages = new Set(
    detectRecurring(state, options).filter((r) => r.sens === 'depense' && !r.dormante).map((r) => r.key),
  );

  const parTiers = new Map();
  for (const tiers of groupByPayee(state)) parTiers.set(tiers.key, engages.has(tiers.key));

  let engage = 0;
  let arbitrable = 0;
  const lignes = { engage: [], arbitrable: [] };

  for (const tx of state.tx) {
    if (tx.transfer || tx.cents >= 0) continue;
    if (tx.date < bornes.start || tx.date > bornes.end) continue;

    const fixe = parTiers.get(payeeKey(tx.label, tx.cp)) === true;
    if (fixe) { engage -= tx.cents; lignes.engage.push(tx); }
    else { arbitrable -= tx.cents; lignes.arbitrable.push(tx); }
  }

  return {
    engage,
    arbitrable,
    total: engage + arbitrable,
    part: engage + arbitrable > 0 ? engage / (engage + arbitrable) : null,
    lignes,
  };
}
