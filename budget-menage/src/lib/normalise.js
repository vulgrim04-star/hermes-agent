/**
 * Normalisation d'un libellé bancaire.
 *
 * Extrait du journal pour une raison de dépendances : `ledger.js` a besoin de
 * `payeeKey` pour appliquer une règle de tiers, et `tiers.js` a besoin de
 * `normLabel`. Laisser les deux modules s'importer l'un l'autre fonctionnerait
 * — les appels sont différés — mais un cycle d'imports est une fragilité qu'on
 * paie tôt ou tard, au premier import statique évalué à contretemps.
 *
 * Majuscules, accents retirés, tout ce qui n'est pas alphanumérique ramené à
 * une espace : deux libellés qui ne diffèrent que par leur ponctuation doivent
 * se comparer comme un seul.
 */
export function normLabel(label) {
  return String(label)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}
