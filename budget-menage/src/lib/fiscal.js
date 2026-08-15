/**
 * Récapitulatif fiscal de l'année.
 *
 * Ce que l'application fait ici, et ce qu'elle ne fait pas — la distinction
 * compte plus que le reste :
 *
 *  - elle **rassemble ce que le journal contient**, poste par poste, sur une
 *    année civile : les primes payées, les versements 3a, les dons, les
 *    intérêts de dettes, les acomptes versés, la fortune au 31 décembre ;
 *  - elle **ne calcule aucune déduction**. Les plafonds, les seuils et les
 *    barèmes dépendent du canton, de la commune, de l'état civil et du revenu
 *    net déterminant. Un montant déductible calculé de travers ne se voit pas
 *    dans une déclaration : il se voit dans la taxation, un an plus tard.
 *
 * C'est exactement le partage qui convient à quelqu'un qui sait remplir une
 * déclaration : ce qui lui manque, ce ne sont pas les règles, ce sont les
 * totaux tirés de ses relevés.
 */

import { monthBounds } from './dates.js';
import { kindOf } from './categories.js';
import { ledger } from './ledger.js';
import { pillar3aStatus, positionsAt } from './networth.js';

/**
 * Les postes qu'une déclaration suisse réclame, et les catégories du ménage
 * qui les alimentent. Une catégorie peut n'appartenir à aucun poste : elle est
 * alors simplement absente du récapitulatif, ce qui vaut mieux que rangée dans
 * une case où elle n'a rien à faire.
 */
export const POSTES_FISCAUX = [
  {
    cle: 'prevoyance',
    titre: 'Prévoyance liée',
    cats: ['Pilier 3a', 'Rachat LPP (2e pilier)'],
    note: 'Déductible dans la limite du plafond annuel, qui dépend de votre affiliation à une caisse de pension.',
  },
  {
    cle: 'primes',
    titre: 'Primes d’assurance maladie',
    cats: ['Primes LAMal', 'Assurance complémentaire (LCA)'],
    note: 'La déduction est forfaitaire et plafonnée : le montant payé n’est pas le montant déductible.',
  },
  {
    cle: 'frais-medicaux',
    titre: 'Frais médicaux à votre charge',
    cats: ['Franchise & quote-part', 'Dentiste', 'Pharmacie & optique'],
    note: 'Déductibles seulement au-delà d’une part du revenu net (5 % au fédéral ; le canton peut différer).',
  },
  {
    cle: 'interets',
    titre: 'Intérêts de dettes',
    cats: ['Intérêts hypothécaires'],
    note: 'Les intérêts se déduisent ; l’amortissement, non — c’est du capital, il est suivi à part.',
  },
  {
    cle: 'amortissement',
    titre: 'Amortissement de dettes',
    cats: ['Amortissement hypothécaire'],
    note: 'Non déductible : il réduit la dette, donc augmente la fortune imposable.',
  },
  {
    cle: 'dons',
    titre: 'Dons',
    cats: ['Dons'],
    note: 'Déductibles au-delà d’un minimum et dans une limite du revenu net, pour les organisations reconnues.',
  },
  {
    cle: 'deplacement',
    titre: 'Frais de déplacement',
    cats: ['Abonnement CFF', 'Billets & transports publics'],
    note: 'Déduction plafonnée, et seulement pour le trajet domicile-travail.',
  },
  {
    cle: 'impots',
    titre: 'Impôts versés',
    cats: ['Acomptes ICC (cantonal et communal)', 'Acomptes IFD (fédéral direct)', 'Solde d’impôt'],
    note: 'Non déductibles : utiles au bouclement, et à comparer avec la taxation reçue.',
  },
];

/**
 * Récapitulatif d'une année civile.
 *
 * L'année est prise **complète** : du 1er janvier au 31 décembre. Les mois
 * mouvementés sont comptés et rendus, parce qu'un récapitulatif tiré de six
 * mois de relevés n'est pas un récapitulatif — et que rien, dans les chiffres
 * eux-mêmes, ne le dirait.
 */
export function recapFiscal(state, annee) {
  const rows = ledger(state, `${annee}-01-01`, `${annee}-12-31`);

  const revenus = new Map();
  for (const tx of rows) {
    if (!tx.cat || kindOf(tx.cat, tx.cents) !== 'revenu') continue;
    revenus.set(tx.cat, (revenus.get(tx.cat) || 0) + tx.cents);
  }

  const postes = POSTES_FISCAUX.map((poste) => {
    const detail = [];
    let total = 0;
    for (const cat of poste.cats) {
      // Les montants sont rendus en grandeur positive : une prime payée se
      // reporte 3'600, pas −3'600.
      const cents = rows
        .filter((tx) => tx.cat === cat)
        .reduce((somme, tx) => somme + Math.abs(tx.cents), 0);
      if (cents) detail.push({ cat, cents });
      total += cents;
    }
    return { ...poste, detail, cents: total };
  });

  const moisMouvementes = new Set(
    rows.map((tx) => tx.date.slice(0, 7)),
  ).size;

  // Fortune au 31 décembre : la date que retient la déclaration.
  const positions = positionsAt(state, `${annee}-12`).filter((p) => p.valueCents !== null);
  const actifs = positions.filter((p) => !p.isLiability).reduce((s, p) => s + p.valueCents, 0);
  const dettes = positions.filter((p) => p.isLiability).reduce((s, p) => s + Math.abs(p.valueCents), 0);

  return {
    annee,
    revenus: [...revenus.entries()].map(([cat, cents]) => ({ cat, cents }))
      .sort((a, b) => b.cents - a.cents),
    totalRevenus: [...revenus.values()].reduce((s, c) => s + c, 0),
    postes: postes.filter((p) => p.cents > 0),
    postesVides: postes.filter((p) => p.cents === 0).map((p) => p.titre),
    pilier3a: pillar3aStatus(state, annee, new Date(`${annee}-12-31T00:00:00Z`)),
    fortune: {
      date: monthBounds(`${annee}-12`).end,
      positions,
      actifsCents: actifs,
      dettesCents: dettes,
      netCents: actifs - dettes,
    },
    ecritures: rows.length,
    moisMouvementes,
    // Douze mois mouvementés ne prouvent pas que tout est là, mais moins de
    // douze prouve que non.
    complet: moisMouvementes === 12,
  };
}

/** Les années pour lesquelles un récapitulatif a un sens : celles du journal. */
export function anneesFiscales(state) {
  return [...new Set(state.tx.map((t) => t.date.slice(0, 4)))]
    .map(Number)
    .sort((a, b) => b - a);
}
