/**
 * Transferts internes au ménage.
 *
 * Un virement du compte courant vers le compte d'épargne apparaît deux fois
 * quand les deux comptes sont importés : en débit d'un côté, en crédit de
 * l'autre. Sans appariement, il gonfle simultanément les dépenses et les
 * revenus du mois — et le taux d'épargne devient une fiction.
 *
 * L'appariement est **proposé, jamais imposé** : deux mouvements opposés de
 * même montant peuvent parfaitement être un remboursement entre le ménage et un
 * tiers. La confirmation reste humaine ; le refus est mémorisé pour ne pas
 * revenir à chaque détection.
 */

import type { Db } from '../db/connection.js';

/** Fenêtre par défaut, en jours, entre les deux dates de valeur. */
const DEFAULT_MAX_DAYS = 5;

export interface TransferPair {
  id: number;
  out_transaction_id: number;
  in_transaction_id: number;
  day_gap: number;
  status: 'propose' | 'confirme' | 'rejete';
}

function maxDays(db: Db): number {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'transfer_max_days'").get() as
    | { value: string }
    | undefined;
  const parsed = Number(row?.value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_MAX_DAYS;
}

/**
 * Cherche les paires débit / crédit à apparier.
 *
 * Conditions : montants strictement opposés, **comptes différents**, écart de
 * dates dans la fenêtre, et aucune des deux écritures déjà engagée dans une
 * paire confirmée. Les paires déjà proposées ou rejetées ne sont pas recréées.
 *
 * Chaque écriture n'est appariée qu'une fois par passe, avec la contrepartie la
 * plus proche en date : deux virements du même montant le même mois ne se
 * mélangent pas.
 */
export function detectTransfers(db: Db): TransferPair[] {
  const window = maxDays(db);

  const candidates = db
    .prepare(
      `SELECT o.id  AS out_id,
              i.id  AS in_id,
              CAST(ABS(julianday(i.value_date) - julianday(o.value_date)) AS INTEGER) AS day_gap
         FROM transactions o
         JOIN transactions i
           ON i.amount_cents = -o.amount_cents
          AND i.account_id <> o.account_id
          AND ABS(julianday(i.value_date) - julianday(o.value_date)) <= ?
        WHERE o.amount_cents < 0
          AND o.is_internal_transfer = 0
          AND i.is_internal_transfer = 0
          AND NOT EXISTS (
                SELECT 1 FROM internal_transfers t
                 WHERE t.out_transaction_id = o.id OR t.in_transaction_id = o.id
                    OR t.out_transaction_id = i.id OR t.in_transaction_id = i.id
              )
        ORDER BY day_gap, o.value_date, o.id, i.id`,
    )
    .all(window) as { out_id: number; in_id: number; day_gap: number }[];

  const used = new Set<number>();
  const insert = db.prepare(
    'INSERT INTO internal_transfers (out_transaction_id, in_transaction_id, day_gap) VALUES (?, ?, ?)',
  );

  const created: number[] = [];
  db.transaction(() => {
    for (const pair of candidates) {
      if (used.has(pair.out_id) || used.has(pair.in_id)) continue;
      used.add(pair.out_id);
      used.add(pair.in_id);
      created.push(Number(insert.run(pair.out_id, pair.in_id, pair.day_gap).lastInsertRowid));
    }
  })();

  if (created.length === 0) return [];
  return db
    .prepare(
      `SELECT * FROM internal_transfers WHERE id IN (${created.map(() => '?').join(',')})`,
    )
    .all(...created) as TransferPair[];
}

/** Paires en attente d'arbitrage, avec les deux écritures pour les afficher. */
export function pendingTransfers(db: Db): unknown[] {
  return db
    .prepare(
      `SELECT t.id, t.day_gap,
              o.id AS out_id, o.value_date AS out_date, o.label AS out_label,
              o.amount_cents AS out_amount, ao.label AS out_account,
              i.id AS in_id, i.value_date AS in_date, i.label AS in_label,
              i.amount_cents AS in_amount, ai.label AS in_account
         FROM internal_transfers t
         JOIN transactions o ON o.id = t.out_transaction_id
         JOIN transactions i ON i.id = t.in_transaction_id
         JOIN accounts ao ON ao.id = o.account_id
         JOIN accounts ai ON ai.id = i.account_id
        WHERE t.status = 'propose'
        ORDER BY o.value_date DESC, t.id`,
    )
    .all();
}

/**
 * Confirme une paire : les deux écritures sortent des revenus et des dépenses
 * sans disparaître du journal — le mouvement a bien eu lieu, il n'est
 * simplement ni un gain ni une charge pour le ménage.
 */
export function confirmTransfer(db: Db, transferId: number): boolean {
  const pair = db.prepare("SELECT * FROM internal_transfers WHERE id = ?").get(transferId) as
    | TransferPair
    | undefined;
  if (pair === undefined || pair.status === 'confirme') return false;

  db.transaction(() => {
    db.prepare(
      "UPDATE internal_transfers SET status = 'confirme', decided_at = datetime('now') WHERE id = ?",
    ).run(transferId);
    db.prepare('UPDATE transactions SET is_internal_transfer = 1 WHERE id IN (?, ?)').run(
      pair.out_transaction_id,
      pair.in_transaction_id,
    );
  })();
  return true;
}

/** Écarte une paire. Le refus est conservé pour qu'elle ne soit pas reproposée. */
export function rejectTransfer(db: Db, transferId: number): boolean {
  const pair = db.prepare('SELECT * FROM internal_transfers WHERE id = ?').get(transferId) as
    | TransferPair
    | undefined;
  if (pair === undefined) return false;

  db.transaction(() => {
    db.prepare(
      "UPDATE internal_transfers SET status = 'rejete', decided_at = datetime('now') WHERE id = ?",
    ).run(transferId);
    // Une paire confirmée puis écartée doit rendre ses écritures aux totaux.
    db.prepare('UPDATE transactions SET is_internal_transfer = 0 WHERE id IN (?, ?)').run(
      pair.out_transaction_id,
      pair.in_transaction_id,
    );
  })();
  return true;
}
