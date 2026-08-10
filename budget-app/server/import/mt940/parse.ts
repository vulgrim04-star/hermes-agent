/**
 * Parseur MT940.
 *
 * Un relevé s'ouvre sur `:20:` et se referme sur `:62F:`. Entre les deux, chaque
 * `:61:` porte un mouvement et le `:86:` qui la suit en donne le libellé. Le
 * contrôle de rapprochement — `:60F:` + somme des mouvements = `:62F:` — est
 * calculé ici par relevé, en centimes entiers : il tombe juste ou il ne tombe
 * pas, il n'y a pas de tolérance à accorder.
 */

import { decodeBuffer } from '../csv/decode.js';
import { findIban } from '../../../shared/iban.js';
import type { ParseIssue, ParseResult, ParsedStatement, ParsedTransaction } from '../types.js';
import { parseBalanceLine, parseEntryLine, parseNarrative } from './fields.js';
import type { Mt940Balance, Mt940Entry } from './fields.js';
import { tokenize } from './tokenize.js';
import type { Mt940Field } from './tokenize.js';

/** Tags connus ; tout autre tag est signalé sans interrompre la lecture. */
const KNOWN_TAGS = new Set(['20', '21', '25', '28', '28C', '60F', '60M', '61', '86', '62F', '62M', '64', '65', '86S']);

export function parseMt940(input: Uint8Array): ParseResult {
  const { text } = decodeBuffer(input);
  const { blocks, strayLines } = tokenize(text);

  const issues: ParseIssue[] = strayLines.map((stray) => ({
    lineNumber: stray.lineNumber,
    severity: 'avertissement',
    message: 'Ligne hors champ, ignorée.',
    raw: stray.lines.join(' '),
  }));

  const statements: ParsedStatement[] = [];
  let rowsRead = 0;

  for (const block of blocks) {
    const statement = readStatement(block.fields, issues);
    if (statement === null) continue;
    rowsRead += statement.rowsRead;
    statements.push(statement.parsed);
  }

  if (statements.length === 0) {
    issues.push({
      lineNumber: null,
      severity: 'erreur',
      message: "Aucun relevé exploitable : le fichier ne contient pas de champ :20: suivi d'écritures.",
      raw: null,
    });
  }

  return { format: 'mt940', rowsRead, statements, issues };
}

interface StatementRead {
  parsed: ParsedStatement;
  rowsRead: number;
}

function readStatement(fields: readonly Mt940Field[], issues: ParseIssue[]): StatementRead | null {
  let statementReference: string | null = null;
  let accountRaw: string | null = null;
  let opening: Mt940Balance | null = null;
  let closing: Mt940Balance | null = null;
  let currency: string | null = null;

  const transactions: ParsedTransaction[] = [];
  // Une opération illisible laisse tout de même sa place dans la liste : le
  // `:86:` qui la suit s'y rattache et disparaît avec elle, au lieu d'aller
  // grossir le libellé de l'écriture précédente.
  const entries: { entry: Mt940Entry | null; lineNumber: number; narrative: string[] }[] = [];
  let rowsRead = 0;

  for (const field of fields) {
    const value = field.lines.join(' ').trim();

    switch (field.tag) {
      case '20':
        statementReference = value === '' ? null : value;
        break;

      case '25':
        accountRaw = value;
        break;

      case '60F':
      case '60M': {
        const balance = parseBalanceLine(value, field.tag.slice(2));
        if (balance === null) {
          issues.push(invalid(field, 'Solde d’ouverture illisible.'));
          break;
        }
        // Un relevé fractionné répète le solde intermédiaire : seul le premier
        // solde rencontré fait foi comme ouverture.
        opening ??= balance;
        currency ??= balance.currency;
        break;
      }

      case '62F':
      case '62M': {
        const balance = parseBalanceLine(value, field.tag.slice(2));
        if (balance === null) {
          issues.push(invalid(field, 'Solde de clôture illisible.'));
          break;
        }
        closing = balance;
        currency ??= balance.currency;
        break;
      }

      case '61': {
        rowsRead += 1;
        const entry = parseEntryLine(field.lines[0] ?? '');
        if (entry === null) issues.push(invalid(field, 'Ligne d’opération :61: illisible.'));
        // Les lignes de continuation d'un :61: portent des détails libres.
        const extra = field.lines.slice(1).join(' ').trim();
        entries.push({
          entry,
          lineNumber: field.lineNumber,
          narrative: extra === '' ? [] : [extra],
        });
        break;
      }

      case '86': {
        const target = entries.at(-1);
        if (target === undefined) {
          issues.push(invalid(field, 'Libellé :86: sans opération :61: qui le précède.', 'avertissement'));
          break;
        }
        target.narrative.push(...field.lines);
        break;
      }

      default:
        if (!KNOWN_TAGS.has(field.tag)) {
          issues.push(invalid(field, `Champ :${field.tag}: non reconnu, ignoré.`, 'avertissement'));
        }
    }
  }

  if (statementReference === null && entries.length === 0) return null;

  const statementCurrency = currency ?? 'CHF';

  for (const { entry, lineNumber, narrative } of entries) {
    if (entry === null) continue;
    const parsedNarrative = parseNarrative(narrative);
    transactions.push({
      lineNumber,
      valueDate: entry.valueDate,
      bookingDate: entry.bookingDate,
      amountCents: entry.amountCents,
      currency: statementCurrency,
      label: parsedNarrative.label === '' ? entry.transactionType : parsedNarrative.label,
      counterparty: parsedNarrative.counterparty,
      bankReference: entry.bankReference ?? entry.customerReference,
      runningBalanceCents: null,
    });
  }

  if (opening === null) {
    issues.push({
      lineNumber: null,
      severity: 'avertissement',
      message: `Relevé ${statementReference ?? '(sans référence)'} : solde d’ouverture absent, le rapprochement ne peut pas être établi.`,
      raw: null,
    });
  }
  if (closing === null) {
    issues.push({
      lineNumber: null,
      severity: 'avertissement',
      message: `Relevé ${statementReference ?? '(sans référence)'} : solde de clôture absent, le rapprochement ne peut pas être établi.`,
      raw: null,
    });
  }

  const accountKey = accountRaw === null ? null : (findIban(accountRaw) ?? accountRaw.trim());

  return {
    rowsRead,
    parsed: {
      accountKey,
      currency: statementCurrency,
      statementReference,
      openingBalanceCents: opening?.amountCents ?? null,
      closingBalanceCents: closing?.amountCents ?? null,
      openingDate: opening?.date ?? null,
      closingDate: closing?.date ?? null,
      transactions,
    },
  };
}

function invalid(
  field: Mt940Field,
  message: string,
  severity: ParseIssue['severity'] = 'erreur',
): ParseIssue {
  return {
    lineNumber: field.lineNumber,
    severity,
    message,
    raw: `:${field.tag}:${field.lines.join(' | ')}`,
  };
}
