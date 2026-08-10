/**
 * Analyse des champs MT940 pris un par un.
 *
 * Chaque fonction rend `null` plutôt que de deviner : une ligne mal formée
 * remonte en anomalie datée et numérotée, jamais en écriture approximative.
 */

import { parseAmountToCents } from '../../../shared/money.js';
import { parseMt940Date, parseMt940EntryDate } from '../../../shared/dates.js';

/**
 * `:61:` — ligne d'opération.
 *
 * `6!n[4!n]2a[1!a]15d1!a3!c16x[//16x]`
 *  date de valeur AAMMJJ · date comptable MMJJ · sens · code fonds · montant ·
 *  code opération (`N` + 3) · référence client · `//` référence banque.
 */
const ENTRY_LINE = /^(\d{6})(\d{4})?(RC|RD|CR|DR|C|D)([A-Z])?([\d,.]+)([A-Z][A-Z0-9]{3})(.*)$/;

export interface Mt940Entry {
  valueDate: string;
  bookingDate: string | null;
  amountCents: number;
  transactionType: string;
  customerReference: string | null;
  bankReference: string | null;
  supplementary: string | null;
}

/**
 * Sens de l'opération. `RC` et `RD` sont des extournes : elles inversent le
 * mouvement qu'elles annulent, une extourne de crédit sort donc de l'argent.
 */
function signOf(mark: string): -1 | 1 {
  switch (mark) {
    case 'C':
    case 'CR':
    case 'RD':
      return 1;
    default:
      return -1;
  }
}

export function parseEntryLine(value: string): Mt940Entry | null {
  const match = ENTRY_LINE.exec(value.trim());
  if (match === null) return null;

  const [, rawValueDate, rawBookingDate, mark, , rawAmount, transactionType, rest] = match;

  const valueDate = parseMt940Date(rawValueDate as string);
  if (valueDate === null) return null;

  const magnitude = parseAmountToCents(rawAmount as string, { decimalSeparator: ',' });
  if (magnitude === null) return null;

  const bookingDate =
    rawBookingDate === undefined ? null : parseMt940EntryDate(rawBookingDate, valueDate);

  const remainder = (rest ?? '').trim();
  const separator = remainder.indexOf('//');
  const customerReference = (separator < 0 ? remainder : remainder.slice(0, separator)).trim();
  const afterSeparator = separator < 0 ? '' : remainder.slice(separator + 2).trim();

  return {
    valueDate,
    bookingDate: bookingDate === valueDate ? null : bookingDate,
    amountCents: signOf(mark as string) * Math.abs(magnitude),
    transactionType: transactionType as string,
    customerReference: customerReference === '' || customerReference === 'NONREF' ? null : customerReference,
    bankReference: afterSeparator === '' ? null : afterSeparator.slice(0, 16),
    supplementary: afterSeparator.length > 16 ? afterSeparator.slice(16) : null,
  };
}

export interface Mt940Balance {
  /** `F` solde final, `M` solde intermédiaire d'un relevé fractionné. */
  kind: string;
  date: string;
  currency: string;
  amountCents: number;
}

/** `:60F:` / `:62F:` / `:64:` — `1!a6!n3!a15d`, le sens portant sur le solde. */
export function parseBalanceLine(value: string, kind: string): Mt940Balance | null {
  const match = /^([CD])(\d{6})([A-Z]{3})([\d,.]+)$/.exec(value.trim());
  if (match === null) return null;

  const [, sign, rawDate, currency, rawAmount] = match;
  const date = parseMt940Date(rawDate as string);
  const magnitude = parseAmountToCents(rawAmount as string, { decimalSeparator: ',' });
  if (date === null || magnitude === null) return null;

  return {
    kind,
    date,
    currency: currency as string,
    amountCents: (sign === 'D' ? -1 : 1) * Math.abs(magnitude),
  };
}

export interface Mt940Narrative {
  label: string;
  counterparty: string | null;
}

/** Sous-champs structurés `?nn` : libellé en 20-29, contrepartie en 32-33. */
const STRUCTURED = /\?(\d{2})([^?]*)/g;

/**
 * `:86:` — libellé détaillé. Deux formes coexistent : le texte libre (usage
 * courant en Suisse) et la forme structurée en sous-champs `?20?21…`. On
 * reconnaît la seconde à la présence de ces marqueurs et on la déplie ;
 * sinon les lignes sont simplement recollées.
 */
export function parseNarrative(lines: readonly string[]): Mt940Narrative {
  const joined = lines.join('\n');

  if (/\?\d{2}/.test(joined)) {
    const purpose: string[] = [];
    const counterparty: string[] = [];
    for (const [, code, content] of joined.replace(/\n/g, '').matchAll(STRUCTURED)) {
      const key = Number(code);
      const text = (content ?? '').trim();
      if (text === '') continue;
      if (key >= 20 && key <= 29) purpose.push(text);
      else if (key === 32 || key === 33) counterparty.push(text);
      else if (key === 0) purpose.unshift(text);
    }
    return {
      label: collapse(purpose.join(' ')),
      counterparty: counterparty.length > 0 ? collapse(counterparty.join(' ')) : null,
    };
  }

  return { label: collapse(lines.join(' ')), counterparty: null };
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
