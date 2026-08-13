/**
 * Lecture du patrimoine : d'où vient ce qu'on a, et ce qu'il tiendra.
 *
 * L'écran patrimoine sait déjà dire **combien**. Ce module dit **pourquoi** :
 *
 *  - la **décomposition de la variation** — ce qui vient de l'épargne du
 *    ménage, ce qui vient de la valorisation des placements. C'est la seule
 *    distinction qui réponde à « est-ce que je m'enrichis, ou est-ce que le
 *    marché travaille pour moi ? » ; un patrimoine qui monte de 20'000 parce
 *    que la bourse a monté ne se pilote pas comme un patrimoine qui monte de
 *    20'000 parce qu'on a mis de côté ;
 *  - l'**allocation par classe d'actifs** et son écart à une cible ;
 *  - l'**hypothèque** et la charge théorique au taux de calcul de 5 %, qui est
 *    la seule qui compte quand la banque revoit le dossier ;
 *  - le **taux d'épargne** constaté et sa projection.
 *
 * Tout est en centimes entiers, et rien n'est deviné : un paramètre absent
 * rend `null` et l'écran le dit, plutôt que d'afficher un chiffre plausible.
 */

import { monthBounds, shiftMonth } from './dates.js';
import { kindOf } from './categories.js';
import { ledger } from './ledger.js';
import { ASSET_KINDS, netWorthSeries, positionsAt } from './networth.js';

/* ------------------------------------------------- décomposition mensuelle */

/**
 * Épargne du mois, au sens comptable : **revenus moins consommation**.
 *
 * Les mouvements d'épargne (versement 3a, achat d'ETF, virement sur le compte
 * d'épargne) sont volontairement exclus du calcul : ils ne consomment rien, ils
 * déplacent de l'argent d'une poche du patrimoine à une autre. Les compter
 * comme des dépenses ferait apparaître le ménage comme dépensier le mois où il
 * épargne le plus.
 *
 * C'est donc une notion plus large que « ce que j'ai viré sur le compte
 * épargne » : c'est tout ce que le revenu n'a pas consommé, y compris ce qui
 * dort sur le compte courant.
 */
export function epargneDuMois(state, period) {
  const bornes = monthBounds(period);
  if (!bornes) return null;

  let revenus = 0;
  let depenses = 0;
  let reallocations = 0;

  for (const tx of ledger(state, bornes.start, bornes.end)) {
    const kind = kindOf(tx.cat, tx.cents);
    if (kind === 'revenu') revenus += tx.cents;
    else if (kind === 'depense') depenses += -tx.cents;
    else reallocations += -tx.cents;
  }

  return { period, revenus, depenses, reallocations, epargne: revenus - depenses };
}

/**
 * Série du patrimoine net, décomposée mois par mois.
 *
 * Pour chaque mois : `variation = épargne + valorisation`. L'épargne se mesure
 * au journal ; la valorisation est le **reste** — ce que la variation du
 * patrimoine ne s'explique pas par les flux du ménage.
 *
 * Ce résidu porte donc aussi les erreurs de saisie : un mois où une position
 * n'a pas été relevée, la valorisation sort à zéro et le mois suivant encaisse
 * deux mois de marché. Les points le disent (`reporte`, `fiable`) au lieu de
 * laisser croire à une mesure propre.
 */
export function evolution(state, from, to) {
  const brute = netWorthSeries(state, from, to);

  // Les mois antérieurs à toute valorisation ne valent pas zéro : ils ne sont
  // pas renseignés. Les garder ferait passer l'arrivée de la première position
  // pour une variation du patrimoine — sur une fenêtre de deux ans ouverte
  // avant le premier relevé, une hypothèque saisie hier sortirait comme une
  // perte de 400'000 francs, imputée à la valorisation.
  const debut = brute.findIndex((p) => p.assets !== 0 || p.liabilities !== 0);
  const serie = debut < 0 ? [] : brute.slice(debut);
  if (!serie.length) return { points: [], mesurable: false };

  const points = serie.map((point, i) => {
    const precedent = i > 0 ? serie[i - 1] : null;
    if (!precedent) {
      return { ...point, variation: null, epargne: null, valorisation: null,
        reporte: point.carried > 0, fiable: point.unknown === 0 };
    }
    const variation = point.net - precedent.net;
    const { epargne } = epargneDuMois(state, point.period) || { epargne: 0 };
    return {
      ...point,
      variation,
      epargne,
      valorisation: variation - epargne,
      reporte: point.carried > 0,
      // Une position non renseignée d'un côté ou de l'autre de l'intervalle
      // fausse la variation, donc les deux termes de la décomposition.
      fiable: point.unknown === 0 && precedent.unknown === 0,
    };
  });

  const mesures = points.filter((p) => p.variation !== null);
  const depart = serie[0];
  const arrivee = serie[serie.length - 1];

  return {
    points,
    // Deux points au moins après l'élagage : en deçà, la décomposition ne
    // mesure rien et l'écran ne doit pas la montrer.
    mesurable: mesures.length > 0,
    depart: depart.net,
    arrivee: arrivee.net,
    variation: arrivee.net - depart.net,
    epargne: mesures.reduce((s, p) => s + p.epargne, 0),
    valorisation: mesures.reduce((s, p) => s + p.valorisation, 0),
    mois: mesures.length,
    incertains: mesures.filter((p) => !p.fiable).length,
  };
}

/* ------------------------------------------------------------- allocation */

const LIBELLE_CLASSE = Object.fromEntries(ASSET_KINDS);

/** Cibles d'allocation, en points de base : 4000 = 40 %. */
function cibles(state) {
  return state.cibles || {};
}

/**
 * Pose une cible d'allocation pour une classe. `bp === null` la retire.
 * Bornée à 0–10'000 : une cible de 120 % ne veut rien dire et sortirait un
 * écart absurde plutôt qu'une erreur visible.
 */
export function setCible(state, kind, bp) {
  if (!state.cibles) state.cibles = {};
  if (bp === null || bp === undefined) delete state.cibles[kind];
  else state.cibles[kind] = Math.max(0, Math.min(10_000, Math.round(bp)));
  return state.cibles[kind] ?? null;
}

/**
 * Répartition des actifs par classe à la fin d'un mois, et écart à la cible.
 *
 * Les dettes sont tenues à part : une allocation se raisonne sur ce qu'on
 * possède. Les mêler ferait apparaître une classe « dette » de −40 % dont
 * personne ne sait quoi faire.
 */
export function allocation(state, period) {
  const positions = positionsAt(state, period);
  const parClasse = new Map();
  let total = 0;
  let dettes = 0;
  let inconnues = 0;

  for (const position of positions) {
    if (position.valueCents === null) { inconnues += 1; continue; }
    if (position.isLiability) { dettes += Math.abs(position.valueCents); continue; }
    const courant = parClasse.get(position.kind) || { valeur: 0, positions: 0 };
    courant.valeur += position.valueCents;
    courant.positions += 1;
    parClasse.set(position.kind, courant);
  }

  for (const { valeur } of parClasse.values()) total += valeur;

  // Une classe avec une cible mais plus aucune position doit rester visible :
  // c'est justement l'écart le plus parlant.
  for (const kind of Object.keys(cibles(state))) {
    if (!parClasse.has(kind)) parClasse.set(kind, { valeur: 0, positions: 0 });
  }

  const lignes = [...parClasse.entries()]
    .map(([kind, { valeur, positions: n }]) => {
      const cibleBp = cibles(state)[kind] ?? null;
      const vise = cibleBp === null ? null : Math.round((total * cibleBp) / 10_000);
      return {
        kind,
        label: LIBELLE_CLASSE[kind] || kind,
        valeur,
        positions: n,
        part: total > 0 ? valeur / total : null,
        cibleBp,
        cibleCents: vise,
        ecartCents: vise === null ? null : valeur - vise,
        ecartBp: cibleBp === null || total === 0
          ? null
          : Math.round((valeur / total) * 10_000) - cibleBp,
      };
    })
    .sort((a, b) => b.valeur - a.valeur);

  const cibleTotalBp = Object.values(cibles(state)).reduce((s, bp) => s + bp, 0);

  return {
    period,
    total,
    dettes,
    net: total - dettes,
    lignes,
    inconnues,
    cibleTotalBp,
    // Des cibles qui ne font pas 100 % ne sont pas fausses — elles sont
    // incomplètes, et l'écart affiché ne vaut alors que classe par classe.
    ciblesCompletes: cibleTotalBp === 10_000,
  };
}

/* ------------------------------------------------- immobilier et hypothèque */

/** Le taux auquel la banque teste le dossier, quel que soit le taux payé. */
export const TAUX_CALCUL_BP = 500;
/** Entretien et frais accessoires, par convention 1 % de la valeur du bien. */
export const CHARGES_BP = 100;
/** Le 2e rang s'amortit jusqu'à deux tiers de la valeur, en quinze ans. */
export const PREMIER_RANG_BP = 6667;
export const AMORTISSEMENT_ANNEES = 15;
/** La charge théorique doit tenir sous un tiers du revenu brut. */
export const CHARGE_MAX_BP = 3333;

/**
 * Charge théorique d'un bien immobilier, à la suisse.
 *
 * Le calcul que fait la banque, et le seul qui décide d'un refinancement :
 * intérêts au **taux de calcul de 5 %** — pas au taux payé —, plus 1 % de la
 * valeur pour l'entretien, plus l'amortissement du 2e rang. Le tout doit tenir
 * sous un tiers du revenu brut.
 *
 * Un ménage qui paie 1,2 % aujourd'hui et tient à peine les 33 % au taux de
 * calcul n'a pas un problème dans quinze ans : il en a un au prochain
 * renouvellement.
 *
 * Sans revenu saisi, le ratio rend `null` : c'est le chiffre qui décide, il ne
 * se devine pas.
 */
export function chargeTheorique({
  valeurCents = 0,
  detteCents = 0,
  revenuAnnuelCents = null,
  tauxHypothecaireBp = null,
  amortissementAnnuelCents = 0,
  tauxCalculBp = TAUX_CALCUL_BP,
  chargesBp = CHARGES_BP,
} = {}) {
  const valeur = Math.max(0, Math.round(valeurCents));
  const dette = Math.max(0, Math.round(detteCents));

  const interets = Math.round((dette * tauxCalculBp) / 10_000);
  const entretien = Math.round((valeur * chargesBp) / 10_000);

  const premierRang = Math.round((valeur * PREMIER_RANG_BP) / 10_000);
  const deuxiemeRang = Math.max(0, dette - premierRang);
  const amortissementRequis = Math.round(deuxiemeRang / AMORTISSEMENT_ANNEES);
  // L'amortissement volontaire au-delà du requis compte aussi dans la charge :
  // c'est de l'argent qui sort tous les ans.
  const amortissement = Math.max(amortissementRequis, Math.max(0, Math.round(amortissementAnnuelCents)));

  const total = interets + entretien + amortissement;
  const ratioBp = revenuAnnuelCents ? Math.round((total / revenuAnnuelCents) * 10_000) : null;

  return {
    valeurCents: valeur,
    detteCents: dette,
    fondsPropresCents: valeur - dette,
    nantissementBp: valeur > 0 ? Math.round((dette / valeur) * 10_000) : null,
    interetsTheoriquesCents: interets,
    // Ce qui sort vraiment du compte cette année, au taux effectivement payé.
    interetsReelsCents:
      tauxHypothecaireBp === null ? null : Math.round((dette * tauxHypothecaireBp) / 10_000),
    entretienCents: entretien,
    deuxiemeRangCents: deuxiemeRang,
    amortissementRequisCents: amortissementRequis,
    amortissementCents: amortissement,
    totalCents: total,
    mensuelCents: Math.round(total / 12),
    ratioBp,
    tenable: ratioBp === null ? null : ratioBp <= CHARGE_MAX_BP,
    // 20 % de fonds propres au minimum, dont la moitié hors 2e pilier.
    fondsPropresSuffisants: valeur > 0 ? valeur - dette >= Math.round(valeur * 0.2) : null,
    revenuMinimalCents: Math.round((total * 10_000) / CHARGE_MAX_BP),
  };
}

/**
 * Effet d'un amortissement extraordinaire.
 *
 * Deux chiffres qui ne disent pas la même chose : ce que la banque calculerait
 * après coup, et ce que le ménage cesserait vraiment de payer.
 */
export function simulerAmortissement(params, montantCents) {
  const montant = Math.max(0, Math.round(montantCents || 0));
  const avant = chargeTheorique(params);
  const apres = chargeTheorique({ ...params, detteCents: Math.max(0, avant.detteCents - montant) });

  return {
    montantCents: montant,
    avant,
    apres,
    gainChargeAnnuelleCents: avant.totalCents - apres.totalCents,
    gainRatioBp: avant.ratioBp === null ? null : avant.ratioBp - apres.ratioBp,
    economieInteretsCents:
      avant.interetsReelsCents === null ? null : avant.interetsReelsCents - apres.interetsReelsCents,
    // Franchir les deux tiers supprime l'obligation d'amortir : c'est le seuil
    // qui change la nature du dossier, pas seulement son montant.
    sortDuDeuxiemeRang: avant.deuxiemeRangCents > 0 && apres.deuxiemeRangCents === 0,
  };
}

/**
 * Amortir directement, ou indirectement par le 3a ?
 *
 * Le même versement annuel, deux chemins, sur `annees` années :
 *
 *  - **direct** : la dette baisse chaque année. On économise des intérêts —
 *    mais on perd la déduction fiscale de ces intérêts, donc l'économie ne
 *    vaut que `1 − taux marginal` ;
 *  - **indirect** : le versement va sur un 3a nanti. La dette ne bouge pas,
 *    les intérêts restent déductibles, le versement l'est aussi, et le capital
 *    travaille au rendement saisi — puis subit l'impôt de retrait.
 *
 * Aucun paramètre n'est deviné : taux marginal, rendement et impôt de retrait
 * dépendent de la commune et du barème, et se saisissent. Le résultat est une
 * différence de patrimoine à l'échéance, sous hypothèses affichées.
 */
export function arbitrage3aDirect({
  versementAnnuelCents = 0,
  annees = 10,
  tauxHypothecaireBp = 0,
  tauxMarginalBp = 0,
  rendement3aBp = 0,
  impotRetraitBp = 0,
} = {}) {
  const versement = Math.max(0, Math.round(versementAnnuelCents));
  const n = Math.max(1, Math.round(annees));
  if (!versement) return null;

  // Direct : au bout de k années, la dette a baissé de k × versement, et les
  // intérêts épargnés cette année-là valent (k × versement) × taux.
  let interetsEpargnes = 0;
  for (let k = 1; k <= n; k += 1) {
    interetsEpargnes += Math.round((k * versement * tauxHypothecaireBp) / 10_000);
  }
  const interetsEpargnesNets = Math.round((interetsEpargnes * (10_000 - tauxMarginalBp)) / 10_000);
  const dettePayeeCents = versement * n;

  // Indirect : versement en début d'année, capitalisé au rendement saisi.
  let capital3a = 0;
  for (let k = 1; k <= n; k += 1) {
    capital3a = Math.round((capital3a + versement) * (1 + rendement3aBp / 10_000));
  }
  const impotRetrait = Math.round((capital3a * impotRetraitBp) / 10_000);
  const economieImpot = Math.round((versement * n * tauxMarginalBp) / 10_000);

  const direct = dettePayeeCents + interetsEpargnesNets;
  const indirect = capital3a - impotRetrait + economieImpot;

  return {
    annees: n,
    versementAnnuelCents: versement,
    verseCents: versement * n,
    direct: {
      totalCents: direct,
      dettePayeeCents,
      interetsEpargnesCents: interetsEpargnes,
      interetsEpargnesNetsCents: interetsEpargnesNets,
    },
    indirect: {
      totalCents: indirect,
      capital3aCents: capital3a,
      impotRetraitCents: impotRetrait,
      economieImpotCents: economieImpot,
      // Le nantissement laisse la dette entière : la charge théorique ne baisse
      // pas, et c'est le prix de l'avantage fiscal.
      detteInchangee: true,
    },
    ecartCents: indirect - direct,
    favori: indirect === direct ? null : indirect > direct ? 'indirect' : 'direct',
  };
}

/* ------------------------------------------------- taux d'épargne, projection */

/**
 * Taux d'épargne constaté sur les `mois` derniers mois du journal.
 *
 * Le dernier mois est écarté quand il est incomplet — un mois arrêté au 7 août
 * porte une semaine de dépenses et un salaire entier, et sortirait un taux
 * d'épargne flatteur qui n'existe pas.
 */
export function tauxEpargne(state, { mois = 12, fin = null } = {}) {
  const dernier = fin || state.tx.reduce((max, t) => (t.date > max ? t.date : max), '');
  if (!dernier) return null;

  const bornes = monthBounds(dernier.slice(0, 7));
  if (!bornes) return null;
  const complet = dernier >= bornes.end;
  const derniereMois = complet ? dernier.slice(0, 7) : shiftMonth(dernier.slice(0, 7), -1);
  if (!derniereMois) return null;

  const points = [];
  for (let i = mois - 1; i >= 0; i -= 1) {
    const period = shiftMonth(derniereMois, -i);
    if (!period) continue;
    const m = epargneDuMois(state, period);
    if (m && (m.revenus > 0 || m.depenses > 0)) points.push(m);
  }
  if (!points.length) return null;

  const revenus = points.reduce((s, p) => s + p.revenus, 0);
  const depenses = points.reduce((s, p) => s + p.depenses, 0);
  const epargne = revenus - depenses;

  return {
    points,
    mois: points.length,
    moisIgnore: complet ? null : dernier.slice(0, 7),
    revenus,
    depenses,
    epargne,
    epargneMensuelleCents: Math.round(epargne / points.length),
    taux: revenus > 0 ? epargne / revenus : null,
  };
}

/**
 * Projection du patrimoine à `annees` années.
 *
 * Capitalisation mensuelle du rendement saisi sur le capital de départ et sur
 * l'épargne mensuelle. Aucun rendement par défaut : c'est une hypothèse de
 * l'utilisateur, pas une prévision de l'application — et les points portent
 * séparément ce qui a été versé et ce que le rendement a produit, pour qu'on
 * voie tout de suite lequel des deux porte le résultat.
 */
export function projection({ departCents = 0, epargneMensuelleCents = 0, rendementBp = 0, annees = 10 } = {}) {
  const n = Math.max(1, Math.round(annees));
  const taux = rendementBp / 10_000 / 12;
  let capital = Math.round(departCents);
  let verse = 0;

  const points = [{ annee: 0, capitalCents: capital, verseCents: 0, rendementCents: 0 }];
  for (let annee = 1; annee <= n; annee += 1) {
    for (let m = 0; m < 12; m += 1) {
      capital = Math.round(capital * (1 + taux)) + Math.round(epargneMensuelleCents);
      verse += Math.round(epargneMensuelleCents);
    }
    points.push({
      annee,
      capitalCents: capital,
      verseCents: verse,
      rendementCents: capital - Math.round(departCents) - verse,
    });
  }

  return { points, finCents: capital, verseCents: verse, rendementCents: capital - Math.round(departCents) - verse };
}
