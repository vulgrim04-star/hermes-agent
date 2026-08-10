import { Hono } from 'hono';

import { getDatabase } from '../db/connection.js';
import { setStatementBalances, suggestedOpening } from '../domain/statement-balances.js';
import {
  aggregateReconciliation,
  deleteBatch,
  getBatchReport,
  prepareImport,
  setPendingInclusion,
  validateBatch,
} from '../import/pipeline.js';
import type { ColumnMapping } from '../import/types.js';

export const imports = new Hono();

/** Historique des lots, brouillons compris. */
imports.get('/', (context) => {
  const rows = getDatabase()
    .prepare(
      `SELECT b.*,
              (SELECT COUNT(*) FROM transactions t WHERE t.batch_id = b.id) AS transaction_count,
              (SELECT GROUP_CONCAT(DISTINCT a.label)
                 FROM import_statements s
                 JOIN accounts a ON a.id = s.account_id
                WHERE s.batch_id = b.id) AS accounts
         FROM import_batches b
        ORDER BY b.created_at DESC, b.id DESC`,
    )
    .all();
  return context.json(rows);
});

/**
 * Dépôt d'un fichier. Rien n'est comptabilisé ici : l'analyse produit un lot
 * brouillon dont l'écran de diagnostic rend compte, et que l'utilisateur valide
 * ou abandonne.
 */
imports.post('/', async (context) => {
  const body = await context.req.parseBody();
  const file = body.file;
  if (!(file instanceof File)) {
    return context.json({ message: 'Aucun fichier reçu.' }, 400);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const mappingRaw = typeof body.mapping === 'string' ? body.mapping : null;

  let mapping: ColumnMapping | undefined;
  if (mappingRaw !== null && mappingRaw !== '') {
    try {
      mapping = JSON.parse(mappingRaw) as ColumnMapping;
    } catch {
      return context.json({ message: 'Mapping de colonnes illisible.' }, 400);
    }
  }

  const outcome = prepareImport(getDatabase(), bytes, {
    filename: file.name,
    mapping,
    headerLine: numberOrUndefined(body.headerLine),
    delimiter: typeof body.delimiter === 'string' && body.delimiter !== '' ? body.delimiter : undefined,
    decimalSeparator: decimalSeparatorOf(body.decimalSeparator),
    accountId: numberOrUndefined(body.accountId),
  });

  if (outcome.kind === 'mapping-requis') return context.json(outcome, 422);
  if (outcome.kind === 'compte-requis') return context.json(outcome, 409);

  return context.json({ kind: 'pret', batchId: outcome.batchId, ...getBatchReport(getDatabase(), outcome.batchId) }, 201);
});

imports.get('/:id', (context) => {
  const report = getBatchReport(getDatabase(), Number(context.req.param('id')));
  return report === null ? context.json({ message: 'Lot introuvable.' }, 404) : context.json(report);
});

imports.post('/:id/validate', async (context) => {
  const body = (await context.req.json().catch(() => ({}))) as { force?: boolean };
  const outcome = validateBatch(getDatabase(), Number(context.req.param('id')), body.force === true);
  return outcome.kind === 'bloque' ? context.json(outcome, 409) : context.json(outcome);
});

/**
 * Saisie des soldes d'un relevé que le fichier ne portait pas.
 *
 * Le lot est réévalué dans la foulée : renseigner les deux soldes peut faire
 * passer un lot de « sans solde à rapprocher » à bloquant, ce qui est
 * exactement l'effet recherché.
 */
imports.patch('/statements/:statementId', async (context) => {
  const body = (await context.req.json().catch(() => ({}))) as {
    openingCents?: number | null;
    closingCents?: number | null;
  };

  const db = getDatabase();
  const statementId = Number(context.req.param('statementId'));
  const outcome = setStatementBalances(db, statementId, {
    openingCents: centsOrNull(body.openingCents),
    closingCents: centsOrNull(body.closingCents),
  });

  if (outcome.kind === 'introuvable') return context.json({ message: 'Relevé introuvable.' }, 404);
  if (outcome.kind === 'lot-valide') {
    return context.json({ message: 'Ce lot est déjà validé : ses soldes ne se modifient plus.' }, 409);
  }

  const batchId = (
    db.prepare('SELECT batch_id FROM import_statements WHERE id = ?').get(statementId) as {
      batch_id: number;
    }
  ).batch_id;
  const [status, gap] = aggregateReconciliation(db, batchId);
  db.prepare(
    'UPDATE import_batches SET reconciliation_status = ?, reconciliation_gap_cents = ? WHERE id = ?',
  ).run(status, gap, batchId);

  return context.json({ ...outcome, report: getBatchReport(db, batchId) });
});

/** Solde d'ouverture proposé : dernière clôture connue du compte. */
imports.get('/statements/:statementId/ouverture-proposee', (context) => {
  const cents = suggestedOpening(getDatabase(), Number(context.req.param('statementId')));
  return context.json({ openingCents: cents });
});

imports.patch('/pending/:pendingId', async (context) => {
  const body = (await context.req.json()) as { include?: boolean };
  const updated = setPendingInclusion(
    getDatabase(),
    Number(context.req.param('pendingId')),
    body.include === true,
  );
  return updated
    ? context.json({ ok: true })
    : context.json({ message: 'Ligne introuvable ou lot déjà validé.' }, 404);
});

imports.delete('/:id', (context) => {
  const deleted = deleteBatch(getDatabase(), Number(context.req.param('id')));
  return deleted ? context.json({ ok: true }) : context.json({ message: 'Lot introuvable.' }, 404);
});

function numberOrUndefined(value: unknown): number | undefined {
  if (typeof value !== 'string' || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Un solde absent est `null`, pas 0 : la nuance est tout le sujet. */
function centsOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null;
}

function decimalSeparatorOf(value: unknown): '.' | ',' | 'auto' | undefined {
  return value === '.' || value === ',' || value === 'auto' ? value : undefined;
}
