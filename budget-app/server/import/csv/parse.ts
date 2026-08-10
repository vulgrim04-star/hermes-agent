/**
 * Parseur CSV.
 *
 * Enchaînement : décodage → séparateur → ligne d'en-tête → mapping des colonnes
 * → écritures → contrôle du solde glissant. Chaque étape peut échouer sans faire
 * échouer les suivantes ; ce qui n'a pas pu être lu ressort dans `issues`, avec
 * son numéro de ligne et son contenu brut.
 */

import Papa from 'papaparse';

import { parseSwissDate } from '../../../shared/dates.js';
import { parseAmountToCents } from '../../../shared/money.js';
import { findIban } from '../../../shared/iban.js';
import type {
  ColumnMapping,
  ColumnSample,
  CsvOutcome,
  ParseIssue,
  ParsedTransaction,
} from '../types.js';
import { decodeBuffer, splitLines } from './decode.js';
import { detectDelimiter } from './delimiter.js';
import { findHeaderLine, guessMapping, missingRequirements, signatureOf } from './header.js';

export interface CsvParseOptions {
  /** Mapping imposé (profil mémorisé ou écran de mapping manuel). */
  mapping?: ColumnMapping;
  /** Ligne d'en-tête imposée, index 0. */
  headerLine?: number;
  /** Séparateur imposé. */
  delimiter?: string;
  /** Séparateur décimal imposé ; `auto` par défaut. */
  decimalSeparator?: '.' | ',' | 'auto';
  /** Devise par défaut quand le fichier n'en porte pas. */
  defaultCurrency?: string;
}

function cellAt(row: readonly string[], index: number | undefined): string {
  if (index === undefined) return '';
  return (row[index] ?? '').trim();
}

function buildLabel(row: readonly string[], mapping: ColumnMapping): string {
  const parts = [cellAt(row, mapping.label), ...(mapping.labelExtra ?? []).map((i) => cellAt(row, i))];
  return parts
    .filter((part) => part !== '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseCsv(input: Uint8Array, options: CsvParseOptions = {}): CsvOutcome {
  const { text, encoding } = decodeBuffer(input);
  const lines = splitLines(text);
  const delimiter = options.delimiter ?? detectDelimiter(lines).delimiter;

  // Papaparse fait l'analyse réelle : guillemets, échappements, retours à la
  // ligne à l'intérieur d'un champ. La détection ci-dessus ne sert qu'à choisir.
  const grid = Papa.parse<string[]>(text, {
    delimiter,
    skipEmptyLines: false,
    newline: undefined,
  }).data.map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? '')) : []));

  const headerLine = options.headerLine ?? findHeaderLine(grid);
  const effectiveHeaderLine = headerLine >= 0 ? headerLine : firstNonEmptyRow(grid);
  const headers = (grid[effectiveHeaderLine] ?? []).map((cell) => cell.trim());
  const signature = signatureOf(headers, delimiter);

  const guess = guessMapping(headers);
  const mapping = options.mapping ?? guess.mapping;
  const missing = missingRequirements(mapping);

  if (missing.length > 0) {
    return {
      kind: 'mapping-requis',
      encoding,
      delimiter,
      headerLine: effectiveHeaderLine,
      headers,
      signature,
      columns: sampleColumns(grid, headers, effectiveHeaderLine, guess.suggestions),
      suggestion: guess.mapping,
      missing,
    };
  }

  const issues: ParseIssue[] = [];
  const transactions: ParsedTransaction[] = [];
  const defaultCurrency = options.defaultCurrency ?? 'CHF';
  let rowsRead = 0;

  for (let index = effectiveHeaderLine + 1; index < grid.length; index += 1) {
    const row = grid[index] ?? [];
    const lineNumber = index + 1;
    const filled = row.filter((cell) => cell.trim() !== '');

    if (filled.length === 0) continue; // ligne vide, y compris en fin de fichier
    rowsRead += 1;

    if (filled.length < 2) {
      // Ligne de pied de tableau ou reliquat d'export : signalée, jamais importée.
      issues.push({
        lineNumber,
        severity: 'avertissement',
        message: 'Ligne ignorée : une seule cellule renseignée.',
        raw: row.join(delimiter),
      });
      rowsRead -= 1;
      continue;
    }

    const rawDate = cellAt(row, mapping.valueDate) || cellAt(row, mapping.bookingDate);
    const valueDate = parseSwissDate(rawDate);
    if (valueDate === null) {
      issues.push({
        lineNumber,
        severity: 'erreur',
        message: `Date illisible : « ${rawDate} ».`,
        raw: row.join(delimiter),
      });
      continue;
    }

    const bookingRaw = cellAt(row, mapping.bookingDate);
    const bookingDate = bookingRaw === '' ? null : parseSwissDate(bookingRaw);

    const amount = readAmount(row, mapping, options.decimalSeparator ?? 'auto');
    if (amount.error !== null) {
      issues.push({
        lineNumber,
        severity: 'erreur',
        message: amount.error,
        raw: row.join(delimiter),
      });
      continue;
    }
    if (amount.warning !== null) {
      issues.push({
        lineNumber,
        severity: 'avertissement',
        message: amount.warning,
        raw: row.join(delimiter),
      });
    }

    const label = buildLabel(row, mapping);
    if (label === '') {
      issues.push({
        lineNumber,
        severity: 'avertissement',
        message: 'Écriture sans libellé.',
        raw: row.join(delimiter),
      });
    }

    const balanceRaw = cellAt(row, mapping.balance);
    const currency = cellAt(row, mapping.currency).toUpperCase();
    const reference = cellAt(row, mapping.reference);
    const counterparty = cellAt(row, mapping.counterparty);

    transactions.push({
      lineNumber,
      valueDate,
      bookingDate: bookingDate === valueDate ? null : bookingDate,
      amountCents: amount.cents,
      currency: currency === '' ? defaultCurrency : currency,
      label: label === '' ? '(sans libellé)' : label,
      counterparty: counterparty === '' ? null : counterparty,
      bankReference: reference === '' ? null : reference,
      runningBalanceCents:
        balanceRaw === ''
          ? null
          : parseAmountToCents(balanceRaw, { decimalSeparator: options.decimalSeparator ?? 'auto' }),
    });
  }

  const chain = reconcileRunningBalance(transactions, issues);

  return {
    kind: 'analyse',
    result: {
      format: 'csv',
      rowsRead,
      issues,
      statements: [
        {
          accountKey: findIban(text),
          currency: transactions[0]?.currency ?? defaultCurrency,
          statementReference: null,
          openingBalanceCents: chain.openingCents,
          closingBalanceCents: chain.closingCents,
          openingDate: chain.transactions[0]?.valueDate ?? null,
          closingDate: chain.transactions.at(-1)?.valueDate ?? null,
          transactions: chain.transactions,
        },
      ],
      csv: {
        encoding,
        delimiter,
        headerLine: effectiveHeaderLine,
        headers,
        signature,
        mapping,
        reversed: chain.reversed,
      },
    },
  };
}

function firstNonEmptyRow(grid: readonly (readonly string[])[]): number {
  const index = grid.findIndex((row) => row.some((cell) => cell.trim() !== ''));
  return index < 0 ? 0 : index;
}

function sampleColumns(
  grid: readonly (readonly string[])[],
  headers: readonly string[],
  headerLine: number,
  suggestions: readonly (ColumnSample['suggested'] | null)[],
): ColumnSample[] {
  const dataRows = grid.slice(headerLine + 1).filter((row) => row.some((cell) => cell.trim() !== ''));
  return headers.map((header, index) => ({
    index,
    header,
    samples: dataRows
      .slice(0, 5)
      .map((row) => (row[index] ?? '').trim())
      .filter((value) => value !== ''),
    suggested: suggestions[index] ?? null,
  }));
}

interface AmountRead {
  cents: number;
  error: string | null;
  warning: string | null;
}

/**
 * Deux conventions coexistent dans les exports : une colonne de montant signé,
 * ou un couple débit / crédit. Les deux sont acceptées ; une ligne qui remplit
 * à la fois le débit et le crédit est une anomalie, pas une somme algébrique.
 *
 * Une colonne débit désigne toujours une sortie : `45.60` et `-45.60` y valent
 * la même chose, `-|montant|`. Une colonne crédit conserve son signe, un crédit
 * négatif étant une extourne — le cas est rare, donc signalé.
 */
function readAmount(
  row: readonly string[],
  mapping: ColumnMapping,
  decimalSeparator: '.' | ',' | 'auto',
): AmountRead {
  const debitRaw = cellAt(row, mapping.debit);
  const creditRaw = cellAt(row, mapping.credit);

  if (debitRaw !== '' && creditRaw !== '') {
    return {
      cents: 0,
      error: `Débit (${debitRaw}) et crédit (${creditRaw}) renseignés sur la même ligne.`,
      warning: null,
    };
  }

  if (debitRaw !== '') {
    const parsed = parseAmountToCents(debitRaw, { decimalSeparator });
    if (parsed === null) {
      return { cents: 0, error: `Montant illisible : « ${debitRaw} ».`, warning: null };
    }
    return { cents: -Math.abs(parsed), error: null, warning: null };
  }

  if (creditRaw !== '') {
    const parsed = parseAmountToCents(creditRaw, { decimalSeparator });
    if (parsed === null) {
      return { cents: 0, error: `Montant illisible : « ${creditRaw} ».`, warning: null };
    }
    return {
      cents: parsed,
      error: null,
      warning: parsed < 0 ? `Crédit négatif (${creditRaw}) traité comme une extourne.` : null,
    };
  }

  const amountRaw = cellAt(row, mapping.amount);
  if (amountRaw === '') return { cents: 0, error: 'Ligne sans montant.', warning: null };
  const parsed = parseAmountToCents(amountRaw, { decimalSeparator });
  if (parsed === null) {
    return { cents: 0, error: `Montant illisible : « ${amountRaw} ».`, warning: null };
  }
  return { cents: parsed, error: null, warning: null };
}

interface ChainResult {
  transactions: ParsedTransaction[];
  openingCents: number | null;
  closingCents: number | null;
  reversed: boolean;
}

/**
 * Contrôle du solde glissant.
 *
 * Quand le fichier porte une colonne de solde, on vérifie que chaque ligne
 * explique l'écart avec la précédente. C'est plus exigeant qu'un simple
 * « ouverture + somme = clôture » : le contrôle global peut tomber juste alors
 * que deux erreurs se compensent, celui-ci désigne la ligne fautive.
 *
 * L'export peut être en ordre décroissant ; on essaie les deux sens et on
 * retient celui qui se tient.
 */
function reconcileRunningBalance(
  transactions: ParsedTransaction[],
  issues: ParseIssue[],
): ChainResult {
  const usable = transactions.length > 0 && transactions.every((t) => t.runningBalanceCents !== null);
  if (!usable) {
    return { transactions, openingCents: null, closingCents: null, reversed: false };
  }

  const forwardBreaks = chainBreaks(transactions);
  const reversedRows = [...transactions].reverse();
  const reverseBreaks = chainBreaks(reversedRows);

  const useReversed = reverseBreaks.length < forwardBreaks.length;
  const ordered = useReversed ? reversedRows : transactions;
  const breaks = useReversed ? reverseBreaks : forwardBreaks;

  for (const broken of breaks) {
    issues.push({
      lineNumber: broken.lineNumber,
      severity: 'erreur',
      message: `Solde incohérent : l'écart avec la ligne précédente est de ${broken.gapCents} centimes.`,
      raw: null,
    });
  }

  const first = ordered[0];
  const last = ordered.at(-1);
  return {
    transactions: ordered,
    openingCents: first === undefined ? null : (first.runningBalanceCents ?? 0) - first.amountCents,
    closingCents: last?.runningBalanceCents ?? null,
    reversed: useReversed,
  };
}

function chainBreaks(rows: readonly ParsedTransaction[]): { lineNumber: number | null; gapCents: number }[] {
  const breaks: { lineNumber: number | null; gapCents: number }[] = [];
  for (let i = 1; i < rows.length; i += 1) {
    const previous = rows[i - 1];
    const current = rows[i];
    if (previous === undefined || current === undefined) continue;
    const expected = (previous.runningBalanceCents ?? 0) + current.amountCents;
    const actual = current.runningBalanceCents ?? 0;
    if (expected !== actual) breaks.push({ lineNumber: current.lineNumber, gapCents: actual - expected });
  }
  return breaks;
}
