import { Hono } from 'hono';

import { parseSwissDate } from '../../shared/dates.js';
import { parseAmountToCents } from '../../shared/money.js';
import { getDatabase } from '../db/connection.js';
import { normalizeLabel, softKey, strictFingerprint } from '../domain/fingerprint.js';

export const transactions = new Hono();

interface TransactionBody {
  accountId?: number;
  valueDate?: string;
  bookingDate?: string | null;
  amount?: string;
  amountCents?: number;
  currency?: string;
  label?: string;
  counterparty?: string | null;
  categoryId?: number | null;
  owner?: string;
  notes?: string | null;
}

/**
 * Liste filtrée. Les dates étant stockées en ISO, les bornes de période se
 * comparent directement en SQL, sans conversion ni fuseau horaire.
 */
transactions.get('/', (context) => {
  const query = context.req.query();
  const conditions: string[] = [];
  const parameters: unknown[] = [];

  if (query.from) {
    conditions.push('t.value_date >= ?');
    parameters.push(query.from);
  }
  if (query.to) {
    conditions.push('t.value_date <= ?');
    parameters.push(query.to);
  }
  if (query.accountId) {
    conditions.push('t.account_id = ?');
    parameters.push(Number(query.accountId));
  }
  if (query.owner) {
    conditions.push('t.owner = ?');
    parameters.push(query.owner);
  }
  if (query.categoryId === 'none') {
    conditions.push('t.category_id IS NULL');
  } else if (query.categoryId) {
    conditions.push('(t.category_id = ? OR c.parent_id = ?)');
    parameters.push(Number(query.categoryId), Number(query.categoryId));
  }
  if (query.search) {
    conditions.push('t.label_normalized LIKE ?');
    parameters.push(`%${normalizeLabel(query.search)}%`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(Number(query.limit ?? 500), 5000);

  const rows = getDatabase()
    .prepare(
      `SELECT t.*, a.label AS account_label, c.name AS category_name, p.name AS category_parent_name
         FROM transactions t
         JOIN accounts a ON a.id = t.account_id
         LEFT JOIN categories c ON c.id = t.category_id
         LEFT JOIN categories p ON p.id = c.parent_id
         ${where}
        ORDER BY t.value_date DESC, t.id DESC
        LIMIT ?`,
    )
    .all(...parameters, limit);

  const totals = getDatabase()
    .prepare(
      `SELECT
         COUNT(*) AS count,
         COALESCE(SUM(CASE WHEN t.amount_cents > 0 THEN t.amount_cents ELSE 0 END), 0) AS income_cents,
         COALESCE(SUM(CASE WHEN t.amount_cents < 0 THEN t.amount_cents ELSE 0 END), 0) AS expense_cents
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
         ${where}`,
    )
    .get(...parameters);

  return context.json({ rows, totals });
});

transactions.post('/', async (context) => {
  const body = (await context.req.json()) as TransactionBody;
  const db = getDatabase();

  const valueDate = parseSwissDate(body.valueDate ?? '');
  if (valueDate === null) return context.json({ message: 'Date de valeur invalide.' }, 400);

  const amountCents =
    body.amountCents ?? (body.amount === undefined ? null : parseAmountToCents(body.amount));
  if (amountCents === null) return context.json({ message: 'Montant invalide.' }, 400);

  const label = (body.label ?? '').trim();
  if (label === '') return context.json({ message: 'Le libellé est obligatoire.' }, 400);
  if (body.accountId === undefined) return context.json({ message: 'Compte obligatoire.' }, 400);

  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(body.accountId) as
    | { id: number; account_key: string; currency: string; default_owner: string }
    | undefined;
  if (account === undefined) return context.json({ message: 'Compte introuvable.' }, 404);

  // Une saisie manuelle reçoit la même empreinte qu'une écriture importée :
  // si le relevé arrive plus tard, le doublon est vu.
  const occurrence = Number(
    (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM transactions
            WHERE account_id = ? AND value_date = ? AND amount_cents = ? AND label_normalized = ?`,
        )
        .get(account.id, valueDate, amountCents, normalizeLabel(label)) as { n: number }
    ).n,
  );

  const identity = {
    accountKey: account.account_key,
    valueDate,
    amountCents,
    label,
    occurrence,
  };

  try {
    const info = db
      .prepare(
        `INSERT INTO transactions
           (account_id, value_date, booking_date, amount_cents, currency, label, label_normalized,
            counterparty, category_id, owner, notes, source, fingerprint, soft_key, occurrence)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manuel', ?, ?, ?)`,
      )
      .run(
        account.id,
        valueDate,
        body.bookingDate ? parseSwissDate(body.bookingDate) : null,
        amountCents,
        body.currency ?? account.currency,
        label,
        normalizeLabel(label),
        body.counterparty ?? null,
        body.categoryId ?? null,
        body.owner ?? account.default_owner,
        body.notes ?? null,
        strictFingerprint(identity),
        softKey({ accountKey: account.account_key, valueDate, amountCents, occurrence }),
        occurrence,
      );
    return context.json({ id: Number(info.lastInsertRowid) }, 201);
  } catch (error) {
    return context.json({ message: (error as Error).message }, 400);
  }
});

transactions.patch('/:id', async (context) => {
  const body = (await context.req.json()) as TransactionBody;
  const db = getDatabase();
  const id = Number(context.req.param('id'));

  const existing = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id) as
    | { label: string }
    | undefined;
  if (existing === undefined) return context.json({ message: 'Écriture introuvable.' }, 404);

  const label = body.label?.trim();
  const amountCents =
    body.amountCents ?? (body.amount === undefined ? null : parseAmountToCents(body.amount));
  if (body.amount !== undefined && amountCents === null) {
    return context.json({ message: 'Montant invalide.' }, 400);
  }

  db.prepare(
    `UPDATE transactions
        SET label = COALESCE(?, label),
            label_normalized = COALESCE(?, label_normalized),
            amount_cents = COALESCE(?, amount_cents),
            value_date = COALESCE(?, value_date),
            category_id = CASE WHEN ? THEN ? ELSE category_id END,
            owner = COALESCE(?, owner),
            notes = COALESCE(?, notes),
            counterparty = COALESCE(?, counterparty),
            updated_at = datetime('now')
      WHERE id = ?`,
  ).run(
    label ?? null,
    label === undefined ? null : normalizeLabel(label),
    amountCents,
    body.valueDate ? parseSwissDate(body.valueDate) : null,
    body.categoryId === undefined ? 0 : 1,
    body.categoryId ?? null,
    body.owner ?? null,
    body.notes ?? null,
    body.counterparty ?? null,
    id,
  );

  return context.json({ ok: true });
});

transactions.delete('/:id', (context) => {
  const changes = getDatabase()
    .prepare('DELETE FROM transactions WHERE id = ?')
    .run(Number(context.req.param('id'))).changes;
  return changes > 0
    ? context.json({ ok: true })
    : context.json({ message: 'Écriture introuvable.' }, 404);
});
