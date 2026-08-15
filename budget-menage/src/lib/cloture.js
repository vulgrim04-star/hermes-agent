/**
 * La clôture du mois : ce qui reste à faire, en un endroit.
 *
 * Tout ce que l'application sait signaler existe déjà — les écritures à
 * trancher, celles à affiner, les paires à confirmer, les comptes sans solde,
 * les écarts de rapprochement, les charges qui ont dérivé, les enveloppes
 * dépassées, les positions non relevées. Le problème n'est pas qu'elle se
 * taise : c'est que **chaque signal vit sur son écran**, et qu'un ménage qui
 * ouvre l'application dix minutes par mois n'ira pas les chercher un par un.
 *
 * Cette liste ne calcule rien de neuf. Elle rassemble, elle ordonne par
 * gravité, et elle ne montre **que ce qui est en attente** : une liste qui
 * contient toujours les mêmes huit lignes, dont six vertes, cesse d'être lue
 * au troisième mois.
 */

import { resteAAffiner } from './affiner.js';
import { budgetStatus } from './budgets.js';
import { accountBalances, controleSoldes, pendingCount } from './ledger.js';
import { positionsAt } from './networth.js';
import { detectRecurring } from './recurrences.js';

const GRAVITES = { alerte: 0, attention: 1, info: 2 };

/**
 * `period` est le mois qu'on clôt, `aujourdhui` la date du jour — passée plutôt
 * que lue de l'horloge, pour que la liste se relise à l'identique.
 */
export function etatCloture(state, period, aujourdhui = null) {
  const taches = [];
  const pousser = (t) => { if (t.compte > 0) taches.push(t); };

  const pending = pendingCount(state);
  pousser({
    cle: 'trancher',
    titre: 'Écritures sans catégorie',
    detail: 'Elles restent dans les totaux, comptées à part.',
    compte: pending.toClassify,
    vers: '/revision',
    gravite: 'attention',
  });

  pousser({
    cle: 'apparier',
    titre: 'Transferts internes à confirmer',
    detail: 'Tant qu’ils ne le sont pas, ils comptent double dans les revenus et les dépenses.',
    compte: pending.toPair,
    vers: '/revision',
    gravite: 'attention',
  });

  const affiner = resteAAffiner(state);
  pousser({
    cle: 'affiner',
    titre: 'Catégories de la banque à préciser',
    detail: 'Trop larges pour une déclaration ou un budget.',
    compte: affiner.ecritures,
    montantCents: affiner.montantCents,
    vers: '/revision',
    gravite: 'info',
  });

  const soldes = accountBalances(state, period);
  pousser({
    cle: 'soldes',
    titre: 'Comptes sans solde établi',
    detail: 'Sans point de départ, ni la trésorerie ni le patrimoine ne peuvent conclure.',
    compte: soldes.inconnus,
    vers: '/comptes',
    gravite: 'attention',
  });

  const controle = controleSoldes(state);
  pousser({
    cle: 'ecarts',
    titre: 'Intervalles qui ne bouclent pas',
    detail: 'Entre deux soldes connus, les mouvements ne rendent pas la différence : il manque des écritures.',
    compte: controle.ecarts,
    vers: '/comptes',
    gravite: 'alerte',
  });

  const derives = detectRecurring(state).filter((r) => r.derive && !r.dormante);
  pousser({
    cle: 'derives',
    titre: 'Charges récurrentes qui ont changé de montant',
    detail: 'Une prime qui augmente sans qu’on l’ait vue est exactement ce qu’un budget doit signaler.',
    compte: derives.length,
    vers: '/tiers',
    gravite: 'attention',
  });

  const budgets = budgetStatus(state, period, aujourdhui);
  pousser({
    cle: 'budgets',
    titre: 'Enveloppes dépassées',
    detail: 'Le mois est consommé au-delà de ce qui était prévu.',
    compte: budgets ? budgets.depassees : 0,
    vers: '/',
    gravite: 'alerte',
  });

  // Le patrimoine se relève une fois par mois : une valeur reportée du mois
  // dernier n'est pas une valeur relevée ce mois-ci, et la décomposition de la
  // variation le paie immédiatement.
  const positions = positionsAt(state, period);
  pousser({
    cle: 'patrimoine',
    titre: 'Positions non relevées ce mois-ci',
    detail: 'Leur valeur est reportée ou inconnue : la variation du patrimoine s’en trouve faussée.',
    compte: positions.filter((p) => p.origin === 'report' || p.valueCents === null).length,
    vers: '/patrimoine',
    gravite: 'info',
  });

  taches.sort((a, b) => GRAVITES[a.gravite] - GRAVITES[b.gravite] || b.compte - a.compte);

  return {
    period,
    taches,
    reste: taches.length,
    alertes: taches.filter((t) => t.gravite === 'alerte').length,
  };
}
