/**
 * Montants : centimes entiers, jamais de flottant.
 *
 * `0.1 + 0.2 !== 0.3` est anecdotique en informatique et inacceptable en
 * comptabilité : un écart d'un centime sur un rapprochement invalide le
 * contrôle tout entier.
 *
 * Le parsing accepte ce que les exports bancaires écrivent réellement :
 *   12'450.80   1 234.56   1234,56   1.234,56   -12.50   12.50-   (12.50)
 */

/** Apostrophe droite, typographique, accent aigu, espaces fines et insécables. */
const THOUSANDS = /['’´   ]/g;
const CURRENCY = /\b(?:CHF|EUR|USD|GBP|SFr|Fr)\b\.?|[€$£]/gi;

function isGrouping(text, sep) {
  const esc = sep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('^\\d{1,3}(' + esc + '\\d{3})+$').test(text);
}

/**
 * Convertit un montant textuel en centimes. Rend `null` si la chaîne n'est pas
 * exploitable — jamais 0, qui serait indiscernable d'un montant nul légitime.
 */
export function parseAmount(raw, forced) {
  if (typeof raw !== 'string') return null;
  let t = raw.trim();
  if (!t) return null;
  t = t.replace(CURRENCY, '').trim();
  if (!t) return null;

  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1).trim(); }
  if (t[0] === '-' || t[0] === '−') { neg = true; t = t.slice(1).trim(); }
  else if (t[0] === '+') t = t.slice(1).trim();
  if (t.endsWith('-')) { neg = true; t = t.slice(0, -1).trim(); }
  else if (t.endsWith('+')) t = t.slice(0, -1).trim();

  t = t.replace(THOUSANDS, '');
  if (!t || !/^[\d.,]+$/.test(t)) return null;

  const mode = forced || 'auto';
  const dot = t.includes('.');
  const comma = t.includes(',');
  let mark = null;

  if (mode !== 'auto') {
    const other = mode === '.' ? ',' : '.';
    t = t.split(other).join('');
    if (t.includes(mode)) {
      if (t.split(mode).length > 2) return null;
      mark = mode;
    }
  } else if (dot && comma) {
    // Les deux présents : le dernier rencontré porte les décimales.
    mark = t.lastIndexOf('.') > t.lastIndexOf(',') ? '.' : ',';
    t = t.split(mark === '.' ? ',' : '.').join('');
    if (t.split(mark).length > 2) return null;
  } else if (dot || comma) {
    const m = dot ? '.' : ',';
    const n = t.split(m).length - 1;
    if (n > 1) {
      if (!isGrouping(t, m)) return null;
      t = t.split(m).join('');
    } else if (isGrouping(t, m)) {
      // 1'234 écrit 1.234 : groupe de milliers, pas des décimales.
      t = t.split(m).join('');
    } else mark = m;
  }

  let ip = t;
  let fp = '';
  if (mark) {
    const i = t.indexOf(mark);
    ip = t.slice(0, i);
    fp = t.slice(i + 1);
  }
  if (!ip) ip = '0';
  if (!/^\d+$/.test(ip)) return null;
  if (fp && !/^\d+$/.test(fp)) return null;

  // Arrondi commercial sur la 3e décimale, en arithmétique entière.
  let cents = Number(ip) * 100 + Number((fp + '00').slice(0, 2));
  const third = fp.charAt(2);
  if (third && Number(third) >= 5) cents += 1;
  if (!Number.isSafeInteger(cents)) return null;
  return cents === 0 ? 0 : neg ? -cents : cents;
}

/**
 * Un taux saisi en pour-cent, en points de base : `1.25` → 125.
 *
 * L'échelle est celle des centimes — un pour-cent à deux décimales et un franc
 * à deux décimales se lisent avec le même analyseur, et un taux reste donc un
 * entier, comme un montant.
 */
export function parseRate(raw) {
  return parseAmount(raw);
}

/** `125` → `1.25 %`, `500` → `5 %` : les décimales inutiles n'apportent rien. */
export function fmtRate(bp) {
  if (!Number.isFinite(bp)) return '—';
  const value = Math.round(bp) / 100;
  return `${value.toFixed(2).replace(/\.?0+$/, '')} %`;
}

/**
 * Formatage suisse : apostrophe droite, point décimal, deux décimales.
 * `Intl.NumberFormat('de-CH')` produit l'apostrophe typographique U+2019, qui
 * n'est pas la forme attendue sur un relevé — d'où ce formatage à la main.
 */
export function fmt(cents) {
  if (!Number.isFinite(cents)) return '—';
  const r = Math.round(cents);
  const neg = r < 0;
  const abs = Math.abs(r);
  const units = String(Math.floor(abs / 100));
  const frac = String(abs % 100).padStart(2, '0');
  let out = '';
  for (let i = 0; i < units.length; i += 1) {
    if (i > 0 && (units.length - i) % 3 === 0) out += "'";
    out += units[i];
  }
  return (neg ? '-' : '') + out + '.' + frac;
}
