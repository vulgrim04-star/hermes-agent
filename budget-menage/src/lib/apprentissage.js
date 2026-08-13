/**
 * Apprendre des corrections.
 *
 * Sur l'export réel, 154 écritures sur 783 restaient sans catégorie après les
 * règles et la table de la banque. Les classer une par une est un travail de
 * copiste : la plupart appartiennent à une poignée de tiers, et le geste utile
 * n'est pas « classer cette ligne » mais « classer ce tiers ».
 *
 * D'où ce module : après chaque catégorisation manuelle, il calcule ce que la
 * même décision classerait ailleurs, et l'application le propose. Rien n'est
 * appliqué sans un geste — c'est une proposition chiffrée, pas une déduction
 * silencieuse.
 */

import { ruleScope } from './ledger.js';
import { payeeKey } from './tiers.js';

/**
 * Ce qu'on peut proposer après avoir classé `tx` en `cat`.
 *
 * Rend `null` quand la proposition n'apporte rien — un tiers qui n'a pas
 * d'autre écriture en attente. Proposer dans ce cas ferait du bruit à chaque
 * clic, et le bruit finit par faire ignorer les propositions utiles.
 */
export function proposerRegle(state, tx, cat) {
  if (!tx || !cat) return null;

  const key = payeeKey(tx.label, tx.cp);
  const restantes = ruleScope(state, key, 'tiers');
  if (restantes < 1) return null;

  return {
    kind: 'tiers',
    pattern: key,
    cat,
    // `tx` vient d'être classée : elle ne compte plus parmi les restantes.
    restantes,
    exemple: tx.label,
  };
}

/**
 * Enregistre la règle et l'applique à l'historique.
 *
 * La règle est **conservée**, pas seulement appliquée : c'est ce qui la fait
 * valoir aussi pour les imports à venir. Sans cela, chaque relevé ramènerait
 * les mêmes écritures à classer.
 */
export function accepterRegle(state, proposition, applyRules) {
  const existe = state.rules.some(
    (r) => r.pattern === proposition.pattern && (r.kind || 'motif') === proposition.kind,
  );
  if (!existe) {
    state.rules.push({ kind: proposition.kind, pattern: proposition.pattern, cat: proposition.cat });
  }
  return applyRules(state, state.tx.filter((t) => !t.cat && !t.transfer));
}

/**
 * Rejoue toutes les règles sur l'historique, et dit ce que ça donnerait.
 *
 * Deux usages : après avoir corrigé une règle, et après un import ancien qu'on
 * n'avait pas encore de quoi classer. `simuler` permet de montrer le résultat
 * avant de l'appliquer — on ne touche pas à huit cents écritures sans dire
 * combien vont bouger.
 */
export function rejouerRegles(state, applyRules, { simuler = false } = {}) {
  const candidates = state.tx.filter((t) => !t.cat && !t.transfer);
  if (!simuler) return applyRules(state, candidates);

  // Simulation : on compte sur une copie, l'état réel n'est pas touché.
  const copies = candidates.map((t) => ({ ...t }));
  return applyRules({ ...state, tx: copies }, copies);
}
