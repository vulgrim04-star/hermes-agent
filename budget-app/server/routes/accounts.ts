import { Hono } from 'hono';

import { getDatabase } from '../db/connection.js';

export const accounts = new Hono();

accounts.get('/', (context) => {
  const rows = getDatabase()
    .prepare(
      `SELECT a.*, (SELECT COUNT(*) FROM transactions t WHERE t.account_id = a.id) AS transaction_count
         FROM accounts a ORDER BY a.label`,
    )
    .all();
  return context.json(rows);
});

accounts.post('/', async (context) => {
  const body = (await context.req.json()) as {
    accountKey?: string;
    label?: string;
    currency?: string;
    defaultOwner?: string;
  };
  if (!body.accountKey || !body.label) {
    return context.json({ message: 'Le numéro de compte et le libellé sont obligatoires.' }, 400);
  }

  const info = getDatabase()
    .prepare(
      'INSERT INTO accounts (account_key, label, currency, default_owner) VALUES (?, ?, ?, ?)',
    )
    .run(
      body.accountKey.replace(/\s/g, '').toUpperCase(),
      body.label,
      body.currency ?? 'CHF',
      body.defaultOwner ?? 'commun',
    );
  return context.json({ id: Number(info.lastInsertRowid) }, 201);
});

accounts.patch('/:id', async (context) => {
  const body = (await context.req.json()) as {
    label?: string;
    defaultOwner?: string;
    currency?: string;
    isActive?: boolean;
  };
  const changes = getDatabase()
    .prepare(
      `UPDATE accounts
          SET label = COALESCE(?, label),
              default_owner = COALESCE(?, default_owner),
              currency = COALESCE(?, currency),
              is_active = COALESCE(?, is_active)
        WHERE id = ?`,
    )
    .run(
      body.label ?? null,
      body.defaultOwner ?? null,
      body.currency ?? null,
      body.isActive === undefined ? null : body.isActive ? 1 : 0,
      context.req.param('id'),
    ).changes;

  return changes > 0
    ? context.json({ ok: true })
    : context.json({ message: 'Compte introuvable.' }, 404);
});
