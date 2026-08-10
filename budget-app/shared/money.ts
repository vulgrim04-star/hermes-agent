/**
 * Montants : représentation interne en **centimes entiers**.
 *
 * Aucun montant ne transite jamais par un flottant. `0.1 + 0.2 !== 0.3` est
 * anecdotique en informatique et inacceptable en comptabilité : un écart d'un
 * centime sur un rapprochement de solde invalide le contrôle tout entier.
 *
 * Le parsing accepte les écritures rencontrées dans les exports bancaires :
 *   12'450.80   1 234.56   1234,56   1.234,56   -12.50   12.50-   (12.50)
 */

/**
 * Séparateurs de milliers tolérés : apostrophe droite, apostrophe typographique
 * (U+2019), accent aigu, espace, espace insécable, espace fine insécable.
 */
const THOUSANDS_MARKS = /['’´    ]/g;

/** Codes et symboles de devise que l'on retire avant analyse. */
const CURRENCY_NOISE = /\b(?:CHF|EUR|USD|GBP|JPY|SFr|Fr)\b\.?|[€$£]/gi;

/** Un groupe de milliers complet : 1'234, 12'345'678 — mais pas 1'23 ni 1'2345. */
function isThousandsGrouping(digitsAndSep: string, separator: string): boolean {
  const escaped = separator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^\\d{1,3}(${escaped}\\d{3})+$`).test(digitsAndSep);
}

export interface ParseAmountOptions {
  /**
   * Séparateur décimal imposé. Le MT940 impose la virgule ; un CSV dont on a
   * appris le format peut imposer le point. `'auto'` (défaut) déduit le
   * séparateur de la forme du nombre.
   */
  decimalSeparator?: '.' | ',' | 'auto';
}

/**
 * Convertit un montant textuel en centimes entiers.
 * Renvoie `null` si la chaîne n'est pas un montant exploitable — jamais 0,
 * qui serait indiscernable d'un montant nul légitime.
 */
export function parseAmountToCents(raw: string, options: ParseAmountOptions = {}): number | null {
  if (typeof raw !== 'string') return null;

  let text = raw.trim();
  if (text === '') return null;

  text = text.replace(CURRENCY_NOISE, '').trim();
  if (text === '') return null;

  // Signe : préfixé, suffixé (convention de certains exports) ou entre parenthèses.
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1).trim();
  }
  if (text.startsWith('-') || text.startsWith('−')) {
    negative = true;
    text = text.slice(1).trim();
  } else if (text.startsWith('+')) {
    text = text.slice(1).trim();
  }
  if (text.endsWith('-')) {
    negative = true;
    text = text.slice(0, -1).trim();
  } else if (text.endsWith('+')) {
    text = text.slice(0, -1).trim();
  }

  text = text.replace(THOUSANDS_MARKS, '');
  if (text === '') return null;
  if (!/^[\d.,]+$/.test(text)) return null;

  const forced = options.decimalSeparator ?? 'auto';
  const hasDot = text.includes('.');
  const hasComma = text.includes(',');

  let decimalMark: '.' | ',' | null = null;

  if (forced !== 'auto') {
    const other = forced === '.' ? ',' : '.';
    text = text.split(other).join('');
    if (text.includes(forced)) {
      // Le séparateur décimal imposé ne peut apparaître qu'une fois.
      if (text.split(forced).length > 2) return null;
      decimalMark = forced;
    }
  } else if (hasDot && hasComma) {
    // Les deux sont présents : le dernier rencontré porte les décimales.
    decimalMark = text.lastIndexOf('.') > text.lastIndexOf(',') ? '.' : ',';
    const other = decimalMark === '.' ? ',' : '.';
    text = text.split(other).join('');
    if (text.split(decimalMark).length > 2) return null;
  } else if (hasDot || hasComma) {
    const mark = hasDot ? '.' : ',';
    const occurrences = text.split(mark).length - 1;
    if (occurrences > 1) {
      // 1.234.567 : forcément des groupes de milliers.
      if (!isThousandsGrouping(text, mark)) return null;
      text = text.split(mark).join('');
    } else if (isThousandsGrouping(text, mark)) {
      // 1'234 écrit 1.234 ou 1,234 : groupe de milliers, pas de décimales.
      text = text.split(mark).join('');
    } else {
      decimalMark = mark;
    }
  }

  let integerPart = text;
  let fractionPart = '';
  if (decimalMark !== null) {
    const index = text.indexOf(decimalMark);
    integerPart = text.slice(0, index);
    fractionPart = text.slice(index + 1);
  }

  if (integerPart === '') integerPart = '0';
  if (!/^\d+$/.test(integerPart)) return null;
  if (fractionPart !== '' && !/^\d+$/.test(fractionPart)) return null;

  // Arrondi commercial sur la 3e décimale, en arithmétique entière.
  let cents = Number(integerPart) * 100 + Number((fractionPart + '00').slice(0, 2));
  const third = fractionPart.charAt(2);
  if (third !== '' && Number(third) >= 5) cents += 1;

  if (!Number.isSafeInteger(cents)) return null;
  if (cents === 0) return 0; // évite un -0 qui piège les comparaisons
  return negative ? -cents : cents;
}

/**
 * Formate des centimes à la suisse : apostrophe droite pour les milliers,
 * point décimal, deux décimales toujours affichées — `12'450.80`.
 *
 * `Intl.NumberFormat('de-CH')` n'est pas utilisable ici : il produit
 * l'apostrophe typographique U+2019, qui n'est pas la forme attendue.
 */
export function formatCents(
  cents: number,
  options: { signDisplay?: 'auto' | 'always' } = {},
): string {
  if (!Number.isFinite(cents)) return '—';
  const rounded = Math.round(cents);
  const negative = rounded < 0;
  const absolute = Math.abs(rounded);

  const units = Math.floor(absolute / 100).toString();
  const fraction = (absolute % 100).toString().padStart(2, '0');

  let grouped = '';
  for (let i = 0; i < units.length; i += 1) {
    if (i > 0 && (units.length - i) % 3 === 0) grouped += "'";
    grouped += units.charAt(i);
  }

  const sign = negative ? '-' : options.signDisplay === 'always' && rounded > 0 ? '+' : '';
  return `${sign}${grouped}.${fraction}`;
}

/** `CHF 12'450.80` — devise en préfixe, convention suisse. */
export function formatMoney(cents: number, currency = 'CHF'): string {
  return `${currency} ${formatCents(cents)}`;
}
