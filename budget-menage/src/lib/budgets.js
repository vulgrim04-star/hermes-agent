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

import { monthBounds } from './dates.js';
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
