/**
 * Découpage d'une écriture en plusieurs catégories.
 *
 * Un passage en grande surface mêle alimentation et produits ménagers ; une
 * seule ligne bancaire porte alors deux natures de charge. Le découpage les
 * sépare, et la vue `transaction_lines` fait le reste : tout agrégat voit les
 * découpes à la place de l'écriture.
 *
 * Une ventilation qui ne boucle pas n'est pas une ventilation : la somme des
 * découpes doit égaler le montant de l'écriture, au centime.
 */

import type { Owner } from '../../shared/model.js';
import type { Db } from '../db/connection.js';

export interface SplitInput {
  categoryId: number | null;
  amountCents: number;
  owner: Owner | null;
  note: string | null;
}

export type SplitOutcome =
  | { kind: 'enregistre'; count: number }
  | { kind: 'introuvable' }
  | { kind: 'refuse'; message: string; gapCents?: number };

export function getSplits(db: Db, transactionId: number): unknown[] {
  return db
    .prepare(
      `SELECT s.*, c.name AS category_name, p.name AS category_parent_name
         FROM transaction_splits s
         LEFT JOIN categories c ON c.id = s.category_id
         LEFT JOIN categories p ON p.id = c.parent_id
        WHERE s.transaction_id = ?
        ORDER BY s.id`,
    )
    .all(transactionId);
}

/**
 * Remplace intégralement les découpes d'une écriture.
 * Une liste vide les supprime : l'écriture redevient entière, avec sa propre
 * catégorie.
 */
export function replaceSplits(
  db: Db,
  transactionId: number,
  splits: readonly SplitInput[],
): SplitOutcome {
  const transaction = db.prepare('SELECT amount_cents FROM transactions WHERE id = ?').get(
    transactionId,
  ) as { amount_cents: number } | undefined;
  if (transaction === undefined) return { kind: 'introuvable' };

  if (splits.length > 0) {
    if (splits.some((split) => !Number.isSafeInteger(split.amountCents))) {
      return { kind: 'refuse', message: 'Chaque découpe doit porter un montant en centimes.' };
    }
    if (splits.some((split) => split.amountCents === 0)) {
      return { kind: 'refuse', message: 'Une découpe à zéro n’a pas de sens ; supprimez la ligne.' };
    }

    const total = splits.reduce((sum, split) => sum + split.amountCents, 0);
    if (total !== transaction.amount_cents) {
      return {
        kind: 'refuse',
        message: 'La somme des découpes ne correspond pas au montant de l’écriture.',
        gapCents: transaction.amount_cents - total,
      };
    }
  }

  db.transaction(() => {
    db.prepare('DELETE FROM transaction_splits WHERE transaction_id = ?').run(transactionId);
    const insert = db.prepare(
      'INSERT INTO transaction_splits (transaction_id, category_id, amount_cents, owner, note) VALUES (?, ?, ?, ?, ?)',
    );
    for (const split of splits) {
      insert.run(transactionId, split.categoryId, split.amountCents, split.owner, split.note);
    }
    // Une écriture découpée ne porte plus de catégorie propre : la ventilation
    // fait foi, et laisser l'ancienne catégorie en place induirait en erreur.
    if (splits.length > 0) {
      db.prepare(
        "UPDATE transactions SET category_id = NULL, updated_at = datetime('now') WHERE id = ?",
      ).run(transactionId);
    }
  })();

  return { kind: 'enregistre', count: splits.length };
}
