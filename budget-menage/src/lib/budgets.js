/**
 * Budgets prévisionnels par catégorie.
 *
 * Un budget qu'on ne consulte qu'à la fin du mois ne sert qu'à constater. Ce
 * qui permet de corriger, c'est le **rythme** : savoir au 12 du mois qu'on a
 * déjà consommé 68 % de l'enveloppe courses laisse dix-huit jours pour agir.
 *
 * Deux niveaux, comme dans l'application locale : un montant par défaut qui
 * vaut pour tous les mois, et une surcharge pour un mois particulier — le mois
 * des impôts ou celui des vacances n'ont pas à déformer les onze autres.
 *
 * Les montants se saisissent **en grandeur positive**, comme les totaux du
 * journal. Le sens vient de la catégorie, pas d'un signe à retenir.
 */

import { monthBounds, shiftMonth } from './dates.js';
import { kindOf } from './categories.js';
import { ledger } from './ledger.js';

/** `state.budgets` peut ne pas exister : un état d'avant cette fonction. */
function table(state) {
  return state.budgets || {};
}

/**
 * Montant prévu pour une catégorie ce mois-là.
 *
 * La surcharge du mois l'emporte sur le défaut ; `0` est une valeur légitime —
 * « ce mois-ci, rien » — et ne doit donc pas retomber sur le défaut.
 */
export function budgetFor(state, cat, period) {
  const ligne = table(state)[cat];
  if (!ligne) return null;
  if (period && Object.prototype.hasOwnProperty.call(ligne, period)) return ligne[period];
  return ligne.defaut ?? null;
}

/**
 * Pose ou retire un budget. `cents === null` retire la ligne : c'est ainsi
 * qu'on annule une surcharge sans avoir à retenir le défaut qu'elle masquait.
 */
export function setBudget(state, cat, period, cents) {
  if (!state.budgets) state.budgets = {};
  const cle = period || 'defaut';
  const ligne = state.budgets[cat] || (state.budgets[cat] = {});

  if (cents === null || cents === undefined) delete ligne[cle];
  else ligne[cle] = Math.abs(Math.round(cents));

  if (!Object.keys(ligne).length) delete state.budgets[cat];
  return budgetFor(state, cat, period);
}

/**
 * Budgets proposés d'après l'historique.
 *
 * Poser vingt enveloppes à la main demande vingt chiffres qu'on n'a pas en
 * tête, et c'est la raison pour laquelle un budget reste vide. Le journal, lui,
 * les connaît : il suffit de les lire.
 *
 * Deux traitements, parce que deux natures de dépense :
 *
 *  - une catégorie **régulière** — présente au moins un mois sur deux — est
 *    proposée à la **médiane** de ses mois. La médiane, pas la moyenne : un
 *    mois de vacances ne doit pas gonfler l'enveloppe courses des onze autres ;
 *  - une catégorie **irrégulière** — le dentiste, l'entretien de la voiture —
 *    est proposée **lissée**, total divisé par la période. Sa médiane
 *    mensuelle n'aurait aucun sens, et une enveloppe à zéro non plus.
 *
 * Le mois en cours est écarté : arrêté au 7, il porterait une semaine de
 * dépenses et ferait proposer des enveloppes deux fois trop petites.
 */
export function proposerBudgets(state, { mois = 6, fin = null } = {}) {
  const dernier = fin || state.tx.reduce((max, t) => (t.date > max ? t.date : max), '');
  if (!dernier) return [];

  const bornes = monthBounds(dernier.slice(0, 7));
  if (!bornes) return [];
  const complet = dernier >= bornes.end;
  const derniereMois = complet ? dernier.slice(0, 7) : shiftMonth(dernier.slice(0, 7), -1);
  if (!derniereMois) return [];

  const periodes = [];
  for (let i = mois - 1; i >= 0; i -= 1) {
    const p = shiftMonth(derniereMois, -i);
    if (p) periodes.push(p);
  }

  // Un mois sans la moindre écriture n'est pas un mois à zéro : c'est un mois
  // qu'on n'a pas importé, et il ne doit pas diluer les moyennes.
  const vivants = periodes.filter((p) => {
    const b = monthBounds(p);
    return ledger(state, b.start, b.end).length > 0;
  });
  if (!vivants.length) return [];

  const parCategorie = new Map();
  for (const period of vivants) {
    const b = monthBounds(period);
    const duMois = new Map();
    for (const tx of ledger(state, b.start, b.end)) {
      if (!tx.cat || kindOf(tx.cat, tx.cents) !== 'depense') continue;
      duMois.set(tx.cat, (duMois.get(tx.cat) || 0) - tx.cents);
    }
    for (const [cat, cents] of duMois) {
      if (cents <= 0) continue;
      const liste = parCategorie.get(cat) || [];
      liste.push(cents);
      parCategorie.set(cat, liste);
    }
  }

  const seuil = Math.max(2, Math.ceil(vivants.length / 2));
  const propositions = [];

  for (const [cat, montants] of parCategorie) {
    const total = montants.reduce((s, c) => s + c, 0);
    const regulier = montants.length >= seuil;
    propositions.push({
      cat,
      moisObserves: montants.length,
      moisPeriode: vivants.length,
      regulier,
      medianeCents: mediane(montants),
      lisseCents: Math.round(total / vivants.length),
      proposeCents: regulier ? mediane(montants) : Math.round(total / vivants.length),
      minCents: Math.min(...montants),
      maxCents: Math.max(...montants),
      totalCents: total,
      actuelCents: budgetFor(state, cat, null),
    });
  }

  propositions.sort((a, b) => b.proposeCents - a.proposeCents);
  return propositions;
}

/** Médiane, insensible à un mois aberrant — c'est tout l'intérêt ici. */
function mediane(valeurs) {
  const triees = [...valeurs].sort((a, b) => a - b);
  const milieu = Math.floor(triees.length / 2);
  return triees.length % 2 ? triees[milieu] : Math.round((triees[milieu - 1] + triees[milieu]) / 2);
}

/**
 * Part du mois écoulée à la date `aujourdhui`.
 *
 * Rend 1 pour un mois révolu et 0 pour un mois à venir : comparer une
 * consommation à un rythme n'a de sens que sur le mois en cours.
 */
export function progressionDuMois(period, aujourdhui) {
  const bornes = monthBounds(period);
  if (!bornes) return null;
  if (aujourdhui > bornes.end) return 1;
  if (aujourdhui < bornes.start) return 0;
  const jours = Number(bornes.end.slice(8, 10));
  return Number(aujourdhui.slice(8, 10)) / jours;
}

/**
 * État des budgets d'un mois : prévu, consommé, reste, et rythme.
 *
 * `aujourdhui` est passé plutôt que lu de l'horloge — une fonction qui dépend
 * de l'heure qu'il est ne se teste pas, et un budget doit pouvoir se relire à
 * l'identique six mois plus tard.
 */
export function budgetStatus(state, period, aujourdhui) {
  const bornes = monthBounds(period);
  if (!bornes) return null;

  const rows = ledger(state, bornes.start, bornes.end);
  const consomme = new Map();
  for (const tx of rows) {
    if (!tx.cat) continue;
    const kind = kindOf(tx.cat, tx.cents);
    if (kind === 'revenu') continue;
    consomme.set(tx.cat, (consomme.get(tx.cat) || 0) - tx.cents);
  }

  const part = progressionDuMois(period, aujourdhui || bornes.end);
  const lignes = [];

  for (const cat of Object.keys(table(state))) {
    const prevu = budgetFor(state, cat, period);
    if (prevu === null) continue;
    const depense = consomme.get(cat) || 0;
    const attendu = Math.round(prevu * part);

    lignes.push({
      cat,
      prevu,
      consomme: depense,
      reste: prevu - depense,
      // Ce que le rythme du mois laisserait attendre à cette date.
      attendu,
      avance: depense - attendu,
      part: prevu > 0 ? depense / prevu : null,
      depasse: depense > prevu,
      // « En avance » n'est un signal qu'en cours de mois : au 31, tout
      // budget consommé est simplement consommé.
      alerte: depense > prevu || (part < 1 && depense > attendu * 1.25 && depense > 0),
    });
  }

  lignes.sort((a, b) => b.consomme / (b.prevu || 1) - a.consomme / (a.prevu || 1));

  return {
    lignes,
    progression: part,
    prevu: lignes.reduce((s, l) => s + l.prevu, 0),
    consomme: lignes.reduce((s, l) => s + l.consomme, 0),
    depassees: lignes.filter((l) => l.depasse).length,
  };
}
