import { Hono } from 'hono';

import { getDatabase } from '../db/connection.js';
import { confirmTransfer, detectTransfers, pendingTransfers, rejectTransfer } from '../domain/transfers.js';

export const review = new Hono();

/**
 * File d'attente de fin de mois : ce qui reste à trancher.
 *
 * Une écriture découpée n'y figure pas — sa ventilation vaut classement, même
 * si elle ne porte pas de catégorie propre.
 */
review.get('/', (context) => {
  const db = getDatabase();

  const transactions = db
    .prepare(
      `SELECT t.id, t.value_date, t.booking_date, t.amount_cents, t.currency, t.label,
              t.counterparty, t.owner, t.source, a.label AS account_label
         FROM transactions t
         JOIN accounts a ON a.id = t.account_id
        WHERE t.category_id IS NULL
          AND t.is_internal_transfer = 0
          AND NOT EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id = t.id)
        ORDER BY t.value_date DESC, t.id DESC`,
    )
    .all();

  // Les catégories les plus utilisées alimentent les raccourcis clavier :
  // la fin de mois se joue sur une poignée de catégories récurrentes.
  const frequent = db
    .prepare(
      `SELECT c.id, c.name, p.name AS parent_name, COUNT(t.id) AS uses
         FROM categories c
         LEFT JOIN categories p ON p.id = c.parent_id
         LEFT JOIN transactions t ON t.category_id = c.id
        WHERE c.parent_id IS NOT NULL
        GROUP BY c.id
        ORDER BY uses DESC, c.sort_order, c.name
        LIMIT 9`,
    )
    .all();

  return context.json({ transactions, frequent, transfers: pendingTransfers(db) });
});

/** Relance la détection des transferts, par exemple après une saisie manuelle. */
review.post('/transferts/detecter', (context) =>
  context.json({ proposed: detectTransfers(getDatabase()).length }),
);

review.post('/transferts/:id/confirmer', (context) => {
  const done = confirmTransfer(getDatabase(), Number(context.req.param('id')));
  return done
    ? context.json({ ok: true })
    : context.json({ message: 'Paire introuvable ou déjà confirmée.' }, 404);
});

review.post('/transferts/:id/rejeter', (context) => {
  const done = rejectTransfer(getDatabase(), Number(context.req.param('id')));
  return done ? context.json({ ok: true }) : context.json({ message: 'Paire introuvable.' }, 404);
});
