/**
 * Soldes saisis à la main sur un relevé.
 *
 * Le rapprochement — ouverture + mouvements = clôture — est le contrôle qui
 * prouve qu'un relevé est complet. Un export qui ne porte pas de solde le rend
 * impossible : c'est le cas de l'export CSV d'UBS, qui n'a qu'une date, un
 * compte, un libellé, un sens, un montant, une devise et une catégorie.
 *
 * La saisie rend le contrôle possible sans rien inventer : les deux soldes
 * viennent de l'e-banking, l'application se contente de vérifier qu'ils
 * s'accordent avec les mouvements qu'elle a lus.
 */

import type { Db } from '../db/connection.js';

export interface StatementBalances {
  openingCents: number | null;
  closingCents: number | null;
}

export type BalanceOutcome =
  | { kind: 'enregistre'; status: 'ok' | 'ko' | 'absent'; gapCents: number | null }
  | { kind: 'introuvable' }
  | { kind: 'lot-valide' };

interface StatementRow {
  id: number;
  batch_id: number;
  account_id: number | null;
  opening_date: string | null;
  movements_cents: number;
  batch_status: string;
}

function readStatement(db: Db, statementId: number): StatementRow | undefined {
  return db
    .prepare(
      `SELECT s.id, s.batch_id, s.account_id, s.opening_date, s.movements_cents,
              b.status AS batch_status
         FROM import_statements s
         JOIN import_batches b ON b.id = s.batch_id
        WHERE s.id = ?`,
    )
    .get(statementId) as StatementRow | undefined;
}

/**
 * Enregistre les soldes saisis et rejoue le contrôle.
 *
 * Un seul des deux soldes ne suffit pas : le relevé reste « sans solde à
 * rapprocher », et la raison est affichée plutôt que passée sous silence.
 */
export function setStatementBalances(
  db: Db,
  statementId: number,
  balances: StatementBalances,
): BalanceOutcome {
  const statement = readStatement(db, statementId);
  if (statement === undefined) return { kind: 'introuvable' };
  // Un lot déjà validé est de la comptabilité : ses soldes ne se réécrivent pas.
  if (statement.batch_status === 'valide') return { kind: 'lot-valide' };

  const { openingCents, closingCents } = balances;
  const reconciled = openingCents !== null && closingCents !== null;
  const gap = reconciled ? closingCents - (openingCents + statement.movements_cents) : null;
  const status = gap === null ? 'absent' : gap === 0 ? 'ok' : 'ko';

  db.prepare(
    `UPDATE import_statements
        SET opening_balance_cents = ?, closing_balance_cents = ?,
            gap_cents = ?, status = ?, balance_source = 'saisi'
      WHERE id = ?`,
  ).run(openingCents, closingCents, gap, status, statementId);

  return { kind: 'enregistre', status, gapCents: gap };
}

/**
 * Solde à nouveau : dernière clôture connue du compte, antérieure à la période
 * du relevé.
 *
 * La condition de date n'est pas un détail. Une clôture datée *à l'intérieur*
 * de la période du nouveau relevé décrit un état que les mouvements de ce
 * relevé ont déjà, en partie, produit : la reprendre comme ouverture compterait
 * deux fois les écritures de l'intervalle.
 */
export function suggestedOpening(db: Db, statementId: number): number | null {
  const statement = readStatement(db, statementId);
  if (statement === undefined || statement.account_id === null) return null;

  const row = db
    .prepare(
      `SELECT s.closing_balance_cents AS cents
         FROM import_statements s
         JOIN import_batches b ON b.id = s.batch_id
        WHERE s.account_id = ?
          AND s.id <> ?
          AND s.closing_balance_cents IS NOT NULL
          AND s.closing_date IS NOT NULL
          AND (? IS NULL OR s.closing_date < ?)
          AND b.status = 'valide'
        ORDER BY s.closing_date DESC, s.id DESC
        LIMIT 1`,
    )
    .get(
      statement.account_id,
      statementId,
      statement.opening_date,
      statement.opening_date,
    ) as { cents: number } | undefined;

  return row?.cents ?? null;
}

/** Raison pour laquelle un relevé n'est pas rapproché, à afficher telle quelle. */
export function missingBalanceReason(statement: {
  opening_balance_cents: number | null;
  closing_balance_cents: number | null;
}): string | null {
  const hasOpening = statement.opening_balance_cents !== null;
  const hasClosing = statement.closing_balance_cents !== null;
  if (hasOpening && hasClosing) return null;
  if (!hasOpening && !hasClosing) {
    return 'Sans solde à rapprocher : le fichier n’en porte pas. Saisissez-les depuis l’e-banking pour que le contrôle s’exécute.';
  }
  return hasOpening
    ? 'Sans solde à rapprocher : le solde de clôture manque.'
    : 'Sans solde à rapprocher : le solde d’ouverture manque.';
}
