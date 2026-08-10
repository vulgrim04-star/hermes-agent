/**
 * Pipeline d'import : du fichier déposé au lot validé.
 *
 * Déroulé en deux temps, volontairement :
 *
 *  1. `prepareImport` analyse le fichier et écrit un lot **brouillon**. Rien
 *     n'entre encore en comptabilité — les écritures attendent dans
 *     `pending_transactions`, avec leur qualification de doublon et le résultat
 *     du rapprochement.
 *  2. `validateBatch` bascule le brouillon en écritures réelles, et refuse de le
 *     faire tant qu'un contrôle est en échec, sauf forçage explicitement tracé.
 *
 * Le brouillon vit en base plutôt qu'en mémoire : l'écran de diagnostic survit à
 * un rechargement de page, et le contrôle de solde est recalculé côté serveur au
 * moment de valider, pas seulement au moment d'afficher.
 */

import { createHash } from 'node:crypto';

import { formatCents } from '../../shared/money.js';
import type { Db } from '../db/connection.js';
import {
  assignOccurrences,
  normalizeLabel,
  softKey,
  strictFingerprint,
} from '../domain/fingerprint.js';
import { parseCsv } from './csv/parse.js';
import type { CsvParseOptions } from './csv/parse.js';
import { detectFormat } from './detect.js';
import { formatIban } from '../../shared/iban.js';
import { parseMt940 } from './mt940/parse.js';
import type { ColumnMapping, MappingRequired, ParseIssue, ParsedStatement } from './types.js';

export interface PrepareOptions {
  filename: string;
  /** Mapping fourni par l'écran de mapping manuel, ou issu d'un profil mémorisé. */
  mapping?: ColumnMapping;
  headerLine?: number;
  delimiter?: string;
  decimalSeparator?: '.' | ',' | 'auto';
  /** Compte imposé quand le fichier ne porte pas d'IBAN. */
  accountId?: number;
}

export type PrepareOutcome =
  | { kind: 'pret'; batchId: number }
  | { kind: 'mapping-requis'; details: MappingRequired }
  | { kind: 'compte-requis'; message: string };

interface AccountRow {
  id: number;
  account_key: string;
  label: string;
  currency: string;
  default_owner: string;
}

export function prepareImport(db: Db, input: Uint8Array, options: PrepareOptions): PrepareOutcome {
  const detection = detectFormat(input, options.filename);
  const fileSha256 = createHash('sha256').update(input).digest('hex');

  const issues: ParseIssue[] = [];
  let statements: ParsedStatement[];
  let rowsRead: number;
  let encoding: string | null = null;
  let delimiter: string | null = null;
  let profileId: number | null = null;

  if (detection.format === 'mt940') {
    const parsed = parseMt940(input);
    statements = parsed.statements;
    rowsRead = parsed.rowsRead;
    issues.push(...parsed.issues);
  } else {
    const profile = options.mapping === undefined ? findProfile(db, input, options) : null;
    const csvOptions: CsvParseOptions = {
      mapping: options.mapping ?? profile?.mapping,
      headerLine: options.headerLine ?? profile?.headerLine,
      delimiter: options.delimiter ?? profile?.delimiter,
      decimalSeparator: options.decimalSeparator ?? profile?.decimalSeparator,
    };
    const outcome = parseCsv(input, csvOptions);
    if (outcome.kind === 'mapping-requis') return { kind: 'mapping-requis', details: outcome };

    statements = outcome.result.statements;
    rowsRead = outcome.result.rowsRead;
    issues.push(...outcome.result.issues);
    encoding = outcome.result.csv?.encoding ?? null;
    delimiter = outcome.result.csv?.delimiter ?? null;
    profileId = profile?.id ?? null;

    if (outcome.result.csv !== undefined && options.mapping !== undefined) {
      profileId = rememberProfile(db, {
        signature: outcome.result.csv.signature,
        label: options.filename,
        delimiter: outcome.result.csv.delimiter,
        encoding: outcome.result.csv.encoding,
        headerLine: outcome.result.csv.headerLine,
        decimalSeparator: options.decimalSeparator ?? 'auto',
        mapping: outcome.result.csv.mapping,
      });
    }
  }

  // Un fichier sans IBAN ne peut pas être rattaché tout seul : plutôt que de
  // choisir un compte au hasard, on rend la main.
  const needsAccount = statements.some((statement) => statement.accountKey === null);
  if (needsAccount && options.accountId === undefined) {
    return {
      kind: 'compte-requis',
      message:
        "Le fichier ne porte pas d'IBAN exploitable. Indiquez le compte auquel rattacher ces écritures.",
    };
  }

  return db.transaction((): PrepareOutcome => {
    const batchId = Number(
      db
        .prepare(
          `INSERT INTO import_batches (filename, format, file_sha256, file_size, encoding, delimiter, profile_id, rows_read)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          options.filename,
          detection.format,
          fileSha256,
          input.byteLength,
          encoding,
          delimiter,
          profileId,
          rowsRead,
        ).lastInsertRowid,
    );

    let duplicates = 0;
    let softDuplicates = 0;
    const batchFingerprints = new Set<string>();

    statements.forEach((statement, statementIndex) => {
      const account =
        statement.accountKey === null
          ? requireAccount(db, options.accountId as number)
          : resolveAccount(db, statement.accountKey, statement.currency);

      const movements = statement.transactions.reduce((total, t) => total + t.amountCents, 0);
      const reconciled =
        statement.openingBalanceCents !== null && statement.closingBalanceCents !== null;
      const gap = reconciled
        ? statement.closingBalanceCents! - (statement.openingBalanceCents! + movements)
        : null;

      const statementId = Number(
        db
          .prepare(
            `INSERT INTO import_statements
               (batch_id, account_id, sort_index, reference, currency, opening_balance_cents,
                closing_balance_cents, opening_date, closing_date, movements_cents, gap_cents, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            batchId,
            account.id,
            statementIndex,
            statement.statementReference,
            statement.currency,
            statement.openingBalanceCents,
            statement.closingBalanceCents,
            statement.openingDate,
            statement.closingDate,
            movements,
            gap,
            gap === null ? 'absent' : gap === 0 ? 'ok' : 'ko',
          ).lastInsertRowid,
      );

      // Le rang d'occurrence se calcule au sein du relevé : c'est ce qui rend
      // l'empreinte reproductible d'un import à l'autre du même fichier.
      const strictRanks = assignOccurrences(
        statement.transactions,
        (t) => `${account.account_key}|${t.valueDate}|${t.amountCents}|${normalizeLabel(t.label)}`,
      );
      const softRanks = assignOccurrences(
        statement.transactions,
        (t) => `${account.account_key}|${t.valueDate}|${t.amountCents}`,
      );

      const insertPending = db.prepare(
        `INSERT INTO pending_transactions
           (batch_id, statement_id, sort_index, line_number, value_date, booking_date, amount_cents,
            currency, label, counterparty, bank_reference, fingerprint, soft_key, occurrence,
            duplicate_kind, include)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const existingFingerprint = db.prepare('SELECT 1 FROM transactions WHERE fingerprint = ?');
      const existingSoftKey = db.prepare('SELECT 1 FROM transactions WHERE soft_key = ?');

      statement.transactions.forEach((transaction, index) => {
        const fingerprint = strictFingerprint({
          accountKey: account.account_key,
          valueDate: transaction.valueDate,
          amountCents: transaction.amountCents,
          label: transaction.label,
          occurrence: strictRanks[index]!,
        });
        const soft = softKey({
          accountKey: account.account_key,
          valueDate: transaction.valueDate,
          amountCents: transaction.amountCents,
          occurrence: softRanks[index]!,
        });

        // Doublon strict : déjà en comptabilité, ou déjà présent plus haut dans
        // le même fichier (deux relevés qui se chevauchent).
        const isStrict =
          existingFingerprint.get(fingerprint) !== undefined || batchFingerprints.has(fingerprint);
        const isSoft = !isStrict && existingSoftKey.get(soft) !== undefined;
        batchFingerprints.add(fingerprint);

        if (isStrict) duplicates += 1;
        if (isSoft) softDuplicates += 1;

        insertPending.run(
          batchId,
          statementId,
          index,
          transaction.lineNumber,
          transaction.valueDate,
          transaction.bookingDate,
          transaction.amountCents,
          transaction.currency,
          transaction.label,
          transaction.counterparty,
          transaction.bankReference,
          fingerprint,
          soft,
          strictRanks[index]!,
          isStrict ? 'strict' : isSoft ? 'probable' : 'aucun',
          // Un doublon strict ne s'importe pas ; un doublon probable attend un
          // arbitrage, et par défaut ne s'importe pas non plus.
          isStrict || isSoft ? 0 : 1,
        );
      });
    });

    const insertIssue = db.prepare(
      'INSERT INTO import_issues (batch_id, line_number, severity, message, raw) VALUES (?, ?, ?, ?, ?)',
    );
    for (const issue of issues) {
      insertIssue.run(batchId, issue.lineNumber, issue.severity, issue.message, issue.raw);
    }

    const errors = issues.filter((issue) => issue.severity === 'erreur').length;
    db.prepare(
      `UPDATE import_batches
          SET rows_duplicate = ?, rows_soft_duplicate = ?, rows_error = ?,
              reconciliation_status = ?, reconciliation_gap_cents = ?
        WHERE id = ?`,
    ).run(
      duplicates,
      softDuplicates,
      errors,
      ...aggregateReconciliation(db, batchId),
      batchId,
    );

    return { kind: 'pret', batchId };
  })();
}

/** Synthèse des relevés d'un lot : un seul écart suffit à mettre le lot en échec. */
function aggregateReconciliation(db: Db, batchId: number): ['ok' | 'ko' | 'absent', number | null] {
  const rows = db
    .prepare('SELECT status, gap_cents FROM import_statements WHERE batch_id = ?')
    .all(batchId) as { status: string; gap_cents: number | null }[];

  if (rows.length === 0) return ['absent', null];
  const gap = rows.reduce((total, row) => total + (row.gap_cents ?? 0), 0);
  if (rows.some((row) => row.status === 'ko')) return ['ko', gap];
  if (rows.some((row) => row.status === 'absent')) return ['absent', null];
  return ['ok', gap];
}

function requireAccount(db: Db, accountId: number): AccountRow {
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId) as
    | AccountRow
    | undefined;
  if (account === undefined) throw new Error(`Compte introuvable : ${accountId}`);
  return account;
}

/** Retrouve le compte par son IBAN, ou le crée pour que l'import ne bloque pas. */
function resolveAccount(db: Db, accountKey: string, currency: string): AccountRow {
  const existing = db.prepare('SELECT * FROM accounts WHERE account_key = ?').get(accountKey) as
    | AccountRow
    | undefined;
  if (existing !== undefined) return existing;

  const id = Number(
    db
      .prepare('INSERT INTO accounts (account_key, label, currency) VALUES (?, ?, ?)')
      .run(accountKey, formatIban(accountKey), currency).lastInsertRowid,
  );
  return requireAccount(db, id);
}

interface StoredProfile {
  id: number;
  mapping: ColumnMapping;
  delimiter: string;
  headerLine: number;
  decimalSeparator: '.' | ',' | 'auto';
}

/**
 * Retrouve le profil de mapping mémorisé pour ce format d'export. La signature
 * est calculée en relisant le fichier « à blanc » : si le format n'est pas
 * reconnu, `parseCsv` la rend justement dans son verdict de mapping requis.
 */
function findProfile(db: Db, input: Uint8Array, options: PrepareOptions): StoredProfile | null {
  const probe = parseCsv(input, {
    headerLine: options.headerLine,
    delimiter: options.delimiter,
  });
  const signature =
    probe.kind === 'mapping-requis' ? probe.signature : (probe.result.csv?.signature ?? null);
  if (signature === null) return null;

  const row = db.prepare('SELECT * FROM import_profiles WHERE signature = ?').get(signature) as
    | {
        id: number;
        mapping_json: string;
        delimiter: string;
        header_line: number;
        decimal_separator: string;
      }
    | undefined;
  if (row === undefined) return null;

  db.prepare("UPDATE import_profiles SET used_at = datetime('now') WHERE id = ?").run(row.id);
  return {
    id: row.id,
    mapping: JSON.parse(row.mapping_json) as ColumnMapping,
    delimiter: row.delimiter,
    headerLine: row.header_line,
    decimalSeparator: row.decimal_separator as '.' | ',' | 'auto',
  };
}

interface ProfileInput {
  signature: string;
  label: string;
  delimiter: string;
  encoding: string;
  headerLine: number;
  decimalSeparator: '.' | ',' | 'auto';
  mapping: ColumnMapping;
}

function rememberProfile(db: Db, profile: ProfileInput): number {
  db.prepare(
    `INSERT INTO import_profiles
       (signature, label, delimiter, encoding, header_line, decimal_separator, mapping_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (signature) DO UPDATE SET
       label = excluded.label,
       delimiter = excluded.delimiter,
       encoding = excluded.encoding,
       header_line = excluded.header_line,
       decimal_separator = excluded.decimal_separator,
       mapping_json = excluded.mapping_json,
       used_at = datetime('now')`,
  ).run(
    profile.signature,
    profile.label,
    profile.delimiter,
    profile.encoding,
    profile.headerLine,
    profile.decimalSeparator,
    JSON.stringify(profile.mapping),
  );

  return Number(
    (db.prepare('SELECT id FROM import_profiles WHERE signature = ?').get(profile.signature) as {
      id: number;
    }).id,
  );
}

export interface ValidationRefusal {
  kind: 'bloque';
  reasons: string[];
}

export type ValidationOutcome = { kind: 'valide'; imported: number } | ValidationRefusal;

/**
 * Bascule un brouillon en écritures réelles.
 *
 * Le rapprochement est recalculé ici, pas repris de l'affichage : ce qui est
 * validé est ce qui a été contrôlé. Une ligne illisible bloque au même titre
 * qu'un écart de solde — on ne peut pas prouver qu'un relevé est complet quand
 * une de ses lignes n'a pas été lue.
 */
export function validateBatch(db: Db, batchId: number, force = false): ValidationOutcome {
  const batch = db.prepare('SELECT * FROM import_batches WHERE id = ?').get(batchId) as
    | {
        id: number;
        format: string;
        status: string;
        rows_error: number;
      }
    | undefined;
  if (batch === undefined) throw new Error(`Lot introuvable : ${batchId}`);
  if (batch.status === 'valide') return { kind: 'valide', imported: 0 };

  const [status, gap] = aggregateReconciliation(db, batchId);
  const reasons: string[] = [];
  if (status === 'ko') {
    reasons.push(`Le rapprochement ne boucle pas : écart de CHF ${formatCents(gap ?? 0)}.`);
  }
  if (batch.rows_error > 0) {
    reasons.push(`${batch.rows_error} ligne(s) n'ont pas pu être lues.`);
  }
  if (reasons.length > 0 && !force) return { kind: 'bloque', reasons };

  return db.transaction((): ValidationOutcome => {
    const pendings = db
      .prepare(
        `SELECT p.*, s.account_id
           FROM pending_transactions p
           JOIN import_statements s ON s.id = p.statement_id
          WHERE p.batch_id = ? AND p.include = 1
          ORDER BY p.statement_id, p.sort_index`,
      )
      .all(batchId) as {
      account_id: number;
      value_date: string;
      booking_date: string | null;
      amount_cents: number;
      currency: string;
      label: string;
      counterparty: string | null;
      bank_reference: string | null;
      fingerprint: string;
      soft_key: string;
      occurrence: number;
    }[];

    const insert = db.prepare(
      `INSERT INTO transactions
         (batch_id, account_id, value_date, booking_date, amount_cents, currency, label,
          label_normalized, counterparty, bank_reference, owner, source, fingerprint, soft_key, occurrence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               (SELECT default_owner FROM accounts WHERE id = ?), ?, ?, ?, ?)`,
    );

    let imported = 0;
    for (const pending of pendings) {
      insert.run(
        batchId,
        pending.account_id,
        pending.value_date,
        pending.booking_date,
        pending.amount_cents,
        pending.currency,
        pending.label,
        normalizeLabel(pending.label),
        pending.counterparty,
        pending.bank_reference,
        pending.account_id,
        batch.format,
        pending.fingerprint,
        pending.soft_key,
        pending.occurrence,
      );
      imported += 1;
    }

    db.prepare(
      `UPDATE import_batches
          SET status = 'valide', validated_at = datetime('now'), rows_imported = ?,
              reconciliation_status = ?, reconciliation_gap_cents = ?, forced = ?
        WHERE id = ?`,
    ).run(imported, status, gap, reasons.length > 0 ? 1 : 0, batchId);

    db.prepare('DELETE FROM pending_transactions WHERE batch_id = ?').run(batchId);

    return { kind: 'valide', imported };
  })();
}

/** Supprime un lot et, en cascade, les écritures qu'il a produites. */
export function deleteBatch(db: Db, batchId: number): boolean {
  return db.prepare('DELETE FROM import_batches WHERE id = ?').run(batchId).changes > 0;
}

/** Inclut ou écarte une ligne d'un brouillon, avant validation. */
export function setPendingInclusion(db: Db, pendingId: number, include: boolean): boolean {
  return (
    db
      .prepare(
        `UPDATE pending_transactions SET include = ?
          WHERE id = ? AND batch_id IN (SELECT id FROM import_batches WHERE status = 'brouillon')`,
      )
      .run(include ? 1 : 0, pendingId).changes > 0
  );
}

/**
 * Rapport d'import : tout ce que l'écran de diagnostic doit montrer avant que
 * l'utilisateur ne valide — y compris ce qui l'empêchera de valider.
 */
export function getBatchReport(db: Db, batchId: number): Record<string, unknown> | null {
  const batch = db.prepare('SELECT * FROM import_batches WHERE id = ?').get(batchId) as
    | Record<string, unknown>
    | undefined;
  if (batch === undefined) return null;

  const statements = db
    .prepare(
      `SELECT s.*, a.label AS account_label, a.account_key
         FROM import_statements s
         LEFT JOIN accounts a ON a.id = s.account_id
        WHERE s.batch_id = ? ORDER BY s.sort_index`,
    )
    .all(batchId);

  const rows = db
    .prepare(
      `SELECT * FROM pending_transactions WHERE batch_id = ? ORDER BY statement_id, sort_index`,
    )
    .all(batchId);

  const issues = db
    .prepare('SELECT * FROM import_issues WHERE batch_id = ? ORDER BY line_number')
    .all(batchId);

  const [status, gap] = aggregateReconciliation(db, batchId);
  const blocking: string[] = [];
  if (status === 'ko') {
    blocking.push(`Le rapprochement ne boucle pas : écart de CHF ${formatCents(gap ?? 0)}.`);
  }
  if (Number(batch.rows_error) > 0) {
    blocking.push(`${String(batch.rows_error)} ligne(s) n'ont pas pu être lues.`);
  }

  return { batch, statements, rows, issues, blocking };
}
