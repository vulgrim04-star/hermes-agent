import { Hono } from 'hono';

import { parseAmountToCents } from '../../shared/money.js';
import { getDatabase } from '../db/connection.js';

export const budgets = new Hono();

/**
 * Budgets d'un mois : pour chaque catégorie, le montant par défaut et la
 * dérogation éventuelle. Les deux sont rendus séparément pour que l'écran
 * montre lequel s'applique et pourquoi.
 */
budgets.get('/', (context) => {
  const period = context.req.query('mois') ?? null;

  const rows = getDatabase()
    .prepare(
      `SELECT c.id AS category_id, c.name, c.parent_id, c.kind, c.sort_order,
              p.name AS parent_name,
              d.amount_cents AS default_cents,
              o.amount_cents AS override_cents
         FROM categories c
         LEFT JOIN categories p ON p.id = c.parent_id
         LEFT JOIN budgets d ON d.category_id = c.id AND d.period IS NULL
         LEFT JOIN budgets o ON o.category_id = c.id AND o.period = ?
        ORDER BY COALESCE(p.sort_order, c.sort_order), COALESCE(p.name, c.name),
                 c.parent_id IS NOT NULL, c.sort_order, c.name`,
    )
    .all(period);

  return context.json({ period, rows });
});

interface BudgetBody {
  categoryId?: number;
  period?: string | null;
  amount?: string;
  amountCents?: number | null;
}

/**
 * Pose ou remplace un budget. Un montant nul ou vide supprime la ligne : c'est
 * la façon naturelle de retirer une dérogation et de revenir au défaut.
 */
budgets.put('/', async (context) => {
  const body = (await context.req.json()) as BudgetBody;
  if (body.categoryId === undefined) {
    return context.json({ message: 'Catégorie obligatoire.' }, 400);
  }

  const period = body.period === undefined || body.period === '' ? null : body.period;
  if (period !== null && !/^\d{4}-\d{2}$/.test(period)) {
    return context.json({ message: 'Le mois doit être au format AAAA-MM.' }, 400);
  }

  const db = getDatabase();
  const raw = body.amount?.trim() ?? '';
  const amountCents =
    body.amountCents !== undefined ? body.amountCents : raw === '' ? null : parseAmountToCents(raw);

  if (amountCents === null) {
    db.prepare(
      `DELETE FROM budgets WHERE category_id = ?
        AND ((period IS NULL AND ? IS NULL) OR period = ?)`,
    ).run(body.categoryId, period, period);
    return context.json({ ok: true, amountCents: null });
  }

  if (!Number.isSafeInteger(amountCents)) {
    return context.json({ message: 'Montant illisible.' }, 400);
  }

  // Un budget se saisit en grandeur positive ; le sens vient du type de la
  // catégorie, pas du signe tapé.
  const value = Math.abs(amountCents);

  db.prepare(
    `INSERT INTO budgets (category_id, period, amount_cents, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT (category_id, period) WHERE period IS NOT NULL
       DO UPDATE SET amount_cents = excluded.amount_cents, updated_at = datetime('now')
     ON CONFLICT (category_id) WHERE period IS NULL
       DO UPDATE SET amount_cents = excluded.amount_cents, updated_at = datetime('now')`,
  ).run(body.categoryId, period, value);

  return context.json({ ok: true, amountCents: value });
});
