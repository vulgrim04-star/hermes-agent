/**
 * Tiers — regroupement des écritures par contrepartie.
 *
 * Sur un export réel de 783 écritures, 61 tiers en regroupent 523 : les deux
 * tiers du journal tiennent dans une soixantaine de contreparties. C'est ce qui
 * rend le tiers plus intéressant que l'écriture pour classer — poser une
 * catégorie sur un tiers vaut pour tout son historique **et** tout son avenir,
 * là où une règle de libellé ne vaut que pour ce qu'elle attrape.
 *
 * **Un tiers ne se stocke pas.** Il se recalcule du journal à chaque fois.
 * Rien à migrer, rien à synchroniser, et surtout rien qui puisse diverger des
 * écritures dont il est tiré — un tiers périmé serait pire qu'aucun tiers.
 */

import { normLabel } from './normalise.js';

/*
 * Ce qu'il faut retirer d'un libellé pour retrouver le commerçant.
 *
 * Le bruit bancaire d'abord (repris de `suggestPattern`), puis deux formes qui
 * lui sont propres et qui empêchent tout regroupement si on les garde : les
 * numéros de carte masqués — `5351XXXXXXXX0381` — et les longues références
 * numériques. Sans ce nettoyage, « SPOTIFY 5351XXXXXXXX0381 06 » et
 * « SPOTIFY 5351XXXXXXXX0381 07 » seraient deux tiers différents.
 */
const BRUIT = /\b(PAIEMENT|CARTE|ACHAT|DEBIT|CREDIT|VIREMENT|ORDRE|TWINT|BANCOMAT|RETRAIT|E BANKING|LSV|REF|NO|DU|LE|DATE)\b/g;
const MASQUE = /\b[0-9X]*X{3,}[0-9X]*\b/g;
const LONG_NOMBRE = /\b\d{4,}\b/g;

/**
 * Clé de regroupement d'une écriture.
 *
 * La contrepartie livrée par la banque fait foi quand elle existe — un MT940
 * structuré la donne explicitement, et elle vaut mieux que ce qu'on devinerait
 * d'un libellé.
 */
export function payeeKey(label, counterparty) {
  const source = counterparty && String(counterparty).trim() ? counterparty : label;
  const mots = normLabel(source)
    .replace(MASQUE, ' ')
    .replace(LONG_NOMBRE, ' ')
    .replace(BRUIT, ' ')
    .replace(/\b\d+\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

  // Un libellé entièrement fait de bruit et de chiffres existe : on retombe
  // alors sur le libellé normalisé, faute de mieux, plutôt que sur une clé vide
  // qui regrouperait n'importe quoi avec n'importe quoi.
  if (!mots.length) return normLabel(source).slice(0, 40) || 'SANS LIBELLE';
  return mots.slice(0, 3).join(' ');
}

/** La catégorie la plus fréquente parmi les écritures classées du tiers. */
function categorieDominante(list) {
  const compte = new Map();
  for (const t of list) {
    if (!t.cat) continue;
    compte.set(t.cat, (compte.get(t.cat) || 0) + 1);
  }
  let meilleure = null;
  let max = 0;
  for (const [cat, n] of compte) if (n > max) { meilleure = cat; max = n; }
  return { cat: meilleure, unanime: meilleure !== null && max === list.filter((t) => t.cat).length };
}

/**
 * Regroupe le journal par tiers.
 *
 * Les transferts internes confirmés sont écartés : un règlement de carte n'est
 * pas un commerçant, et sur l'export réel les deux jambes d'un même virement
 * arrivaient en tête du classement, ce qui n'apprend rien.
 *
 * `minOccurrences` ne filtre pas les tiers d'une seule écriture par défaut :
 * ils comptent pour le total annuel, et l'écran les range simplement plus bas.
 */
export function groupByPayee(state, { minOccurrences = 1 } = {}) {
  const groupes = new Map();

  for (const tx of state.tx) {
    if (tx.transfer) continue;
    const key = payeeKey(tx.label, tx.cp);
    if (!groupes.has(key)) groupes.set(key, []);
    groupes.get(key).push(tx);
  }

  const tiers = [];
  for (const [key, list] of groupes) {
    if (list.length < minOccurrences) continue;
    const mois = new Set(list.map((t) => t.date.slice(0, 7)));
    const dates = list.map((t) => t.date).sort();
    const { cat, unanime } = categorieDominante(list);

    tiers.push({
      key,
      // Le libellé le plus court du groupe : c'est presque toujours le plus
      // lisible, les autres portant des références en plus.
      label: list.map((t) => t.label).sort((a, b) => a.length - b.length)[0],
      tx: list,
      occurrences: list.length,
      mois: mois.size,
      premiere: dates[0],
      derniere: dates[dates.length - 1],
      total: list.reduce((somme, t) => somme + t.cents, 0),
      depenses: list.filter((t) => t.cents < 0).reduce((somme, t) => somme + t.cents, 0),
      cat,
      catUnanime: unanime,
      aClasser: list.filter((t) => !t.cat).length,
    });
  }

  // Par poids de dépense : ce qui coûte le plus se traite en premier.
  tiers.sort((a, b) => a.depenses - b.depenses || b.occurrences - a.occurrences);
  return tiers;
}

/**
 * Pose une catégorie sur toutes les écritures d'un tiers.
 *
 * `seulementVides` par défaut : une catégorie posée à la main sur une écriture
 * précise n'est jamais écrasée par un classement de masse — c'est la même règle
 * que suivent `applyRules` et `applyBank`, et elle vaut d'autant plus ici que
 * le geste porte sur des dizaines de lignes d'un coup.
 */
export function categoriseTiers(state, key, cat, { seulementVides = true } = {}) {
  let touchees = 0;
  for (const tx of state.tx) {
    if (tx.transfer) continue;
    if (payeeKey(tx.label, tx.cp) !== key) continue;
    if (seulementVides && tx.cat) continue;
    tx.cat = cat;
    touchees += 1;
  }
  return touchees;
}
