/**
 * Patrimoine net : ce que le ménage possède, moins ce qu'il doit.
 *
 * Deux sources cohabitent, volontairement :
 *
 *  - **Les comptes suivis se déduisent** du journal. Un solde n'est jamais
 *    inventé : il part d'un solde de clôture rapproché — le seul chiffre dont
 *    on sache qu'il est exact — auquel s'ajoutent les mouvements postérieurs.
 *  - **Les positions saisies** (ETF, Bitcoin, 3a, immobilier, dettes) se
 *    relèvent à la main, un chiffre par mois.
 *
 * Une saisie manuelle l'emporte toujours sur la déduction : si l'utilisateur
 * corrige un solde, c'est qu'il a une raison que l'application ignore.
 */

import { monthBounds } from './dates.js';
import { kindOf } from './categories.js';

/** Les quantités sont des entiers à 10⁻⁸ : 0,42815 BTC vaut 42 815 000. */
export const QUANTITY_SCALE = 100_000_000;

export const ASSET_KINDS = [
  ['compte', 'Compte bancaire'],
  ['titres', 'Titres (ETF, actions)'],
  ['crypto', 'Cryptomonnaie'],
  ['prevoyance', 'Prévoyance (3a, LPP)'],
  ['immobilier', 'Immobilier'],
  ['vehicule', 'Véhicule'],
  ['dette', 'Dette'],
  ['autre', 'Autre'],
];

export const ORIGIN_LABELS = {
  saisi: 'saisi',
  releve: 'déduit du relevé',
  report: 'reporté',
  inconnu: 'non renseigné',
};

/**
 * Valeur d'une position exprimée en quantité.
 *
 * Le calcul reste entier de bout en bout : `quantité × cours / 10⁸`, arrondi au
 * centime une seule fois. Un flottant sur 0,42815 BTC laisserait une traîne qui
 * se verrait au bout de trois additions.
 */
export function valueFromQuantity(quantityE8, unitPriceCents) {
  return Math.round((quantityE8 * unitPriceCents) / QUANTITY_SCALE);
}

/**
 * Solde d'un compte à la fin d'un mois, déduit des relevés importés.
 *
 * On cherche le point d'appui le plus proche, puis on marche jusqu'au mois :
 *
 *  - point d'appui **antérieur** : solde + mouvements postérieurs ;
 *  - à défaut, point d'appui **postérieur** : solde − mouvements depuis. Sans
 *    cette marche arrière, un compte afficherait zéro sur tous les mois qui
 *    précèdent le premier relevé soldé — ce qui n'est pas « rien » mais
 *    « inconnu » ;
 *  - aucun relevé soldé : `null`, et l'écran le dit.
 */
export function bankBalanceAt(state, accountKey, period) {
  const bounds = monthBounds(period);
  if (!bounds) return null;

  const soldes = state.statements
    .filter((s) => s.acc === accountKey && s.closing !== null && s.to)
    .sort((a, b) => (a.to < b.to ? -1 : a.to > b.to ? 1 : 0));
  if (!soldes.length) return null;

  const movements = (from, to) =>
    state.tx
      .filter((t) => t.acc === accountKey && t.date >= from && t.date <= to)
      .reduce((sum, t) => sum + t.cents, 0);

  const earlier = [...soldes].reverse().find((s) => s.to <= bounds.end);
  if (earlier) return earlier.closing + movements(nextDay(earlier.to), bounds.end);

  const later = soldes.find((s) => s.to > bounds.end);
  if (later) return later.closing - movements(nextDay(bounds.end), later.to);

  return null;
}

/** Les dates sont comparées comme du texte ISO ; le lendemain suffit à exclure la borne. */
function nextDay(iso) {
  const date = new Date(iso + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/**
 * Positions à la fin d'un mois. Ordre de priorité, le même pour toutes :
 * saisie du mois, puis solde déduit des relevés, puis report de la dernière
 * valeur connue — marqué comme tel, parce qu'une valeur reportée n'est pas une
 * valeur relevée.
 */
export function positionsAt(state, period) {
  const exact = new Map();
  const latest = new Map();
  for (const v of [...state.valuations].sort((a, b) => (a.period < b.period ? 1 : -1))) {
    if (v.period > period) continue;
    if (v.period === period && !exact.has(v.assetId)) exact.set(v.assetId, v);
    if (!latest.has(v.assetId)) latest.set(v.assetId, v);
  }

  return state.assets.map((asset) => {
    const base = {
      assetId: asset.id,
      label: asset.label,
      kind: asset.kind,
      isLiability: asset.kind === 'dette',
      account: asset.account || null,
    };

    const saisie = exact.get(asset.id);
    if (saisie) {
      return { ...base, valueCents: saisie.value, quantityE8: saisie.quantity ?? null,
        unitPriceCents: saisie.price ?? null, origin: 'saisi', reportedFrom: null };
    }

    if (asset.account) {
      const balance = bankBalanceAt(state, asset.account, period);
      if (balance !== null) {
        return { ...base, valueCents: balance, quantityE8: null, unitPriceCents: null,
          origin: 'releve', reportedFrom: null };
      }
    }

    const carried = latest.get(asset.id);
    if (carried) {
      return { ...base, valueCents: carried.value, quantityE8: carried.quantity ?? null,
        unitPriceCents: carried.price ?? null, origin: 'report', reportedFrom: carried.period };
    }

    return { ...base, valueCents: null, quantityE8: null, unitPriceCents: null,
      origin: 'inconnu', reportedFrom: null };
  });
}

export function netWorthAt(state, period) {
  const positions = positionsAt(state, period);
  let assets = 0;
  let liabilities = 0;
  let carried = 0;
  let unknown = 0;

  for (const position of positions) {
    if (position.origin === 'report') carried += 1;
    if (position.valueCents === null) { unknown += 1; continue; }
    // Une dette est saisie positivement et soustraite ici : le signe ne se
    // retient pas de tête, il est porté par la nature de la position.
    if (position.isLiability) liabilities += Math.abs(position.valueCents);
    else assets += position.valueCents;
  }

  return { period, assets, liabilities, net: assets - liabilities, carried, unknown };
}

export function netWorthSeries(state, from, to) {
  const points = [];
  if (!monthBounds(from) || !monthBounds(to) || from > to) return points;
  let cursor = from;
  while (cursor <= to) {
    points.push(netWorthAt(state, cursor));
    cursor = nextMonth(cursor);
  }
  return points;
}

export function nextMonth(period) {
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
}

export function shiftMonth(period, delta) {
  const total = Number(period.slice(0, 4)) * 12 + (Number(period.slice(5, 7)) - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/**
 * Enregistre la valorisation d'un mois. Quand la quantité et le cours sont
 * donnés, la valeur en est déduite ; sinon la valeur saisie fait foi. Dans les
 * deux cas c'est la valeur qui est stockée et reprise dans les totaux — un
 * cours arrondi ne doit pas faire bouger un patrimoine déjà arrêté.
 */
export function setValuation(state, { assetId, period, valueCents, quantityE8, unitPriceCents }) {
  if (!monthBounds(period)) return { kind: 'mois-invalide' };

  const computed =
    quantityE8 != null && unitPriceCents != null ? valueFromQuantity(quantityE8, unitPriceCents) : null;
  const value = computed ?? valueCents ?? null;
  if (value === null) return { kind: 'valeur-manquante' };

  const existing = state.valuations.find((v) => v.assetId === assetId && v.period === period);
  const row = { assetId, period, value, quantity: quantityE8 ?? null, price: unitPriceCents ?? null };
  if (existing) Object.assign(existing, row);
  else state.valuations.push(row);

  return { kind: 'enregistre', valueCents: value };
}

export function clearValuation(state, assetId, period) {
  const index = state.valuations.findIndex((v) => v.assetId === assetId && v.period === period);
  if (index < 0) return false;
  state.valuations.splice(index, 1);
  return true;
}

export function addAsset(state, asset) {
  const id = state.assets.reduce((max, a) => Math.max(max, a.id), 0) + 1;
  state.assets.push({ id, ...asset });
  return id;
}

export function removeAsset(state, id) {
  state.assets = state.assets.filter((a) => a.id !== id);
  state.valuations = state.valuations.filter((v) => v.assetId !== id);
}

/* ---------------------------------------------------------------- 3e pilier */

/**
 * Pilier 3a : versements de l'année et reste à verser.
 *
 * Le plafond change chaque année et n'est publié qu'en fin d'année précédente.
 * Il **ne se devine pas** : tant qu'il n'est pas saisi, l'état le dit et aucun
 * reste à verser n'est affiché. Un chiffre inventé sur une déduction fiscale ne
 * vaut pas mieux que pas de chiffre du tout.
 */
export function pillar3aStatus(state, year, today = new Date()) {
  const ceiling = state.tax && state.tax[year] != null ? state.tax[year] : null;

  const paid = state.tx
    .filter((t) => !t.transfer && t.cat === 'Pilier 3a' && t.date.startsWith(String(year)))
    .reduce((sum, t) => sum + -t.cents, 0);

  const end = Date.UTC(year, 11, 31);
  const now = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());

  return {
    year,
    ceilingCents: ceiling,
    paidCents: paid,
    remainingCents: ceiling === null ? null : Math.max(0, ceiling - paid),
    daysLeft: Math.max(0, Math.round((end - now) / 86_400_000)),
    message:
      ceiling === null
        ? `Le plafond 3a ${year} n’est pas renseigné : le reste à verser ne peut pas être calculé.`
        : null,
  };
}

/** Épargne de l'année, toutes catégories d'épargne confondues. */
export function savingsOfYear(state, year) {
  return state.tx
    .filter((t) => !t.transfer && t.date.startsWith(String(year)) && kindOf(t.cat, t.cents) === 'epargne')
    .reduce((sum, t) => sum + -t.cents, 0);
}
