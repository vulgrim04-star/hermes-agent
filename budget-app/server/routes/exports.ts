import { Hono } from 'hono';

import { isOwner } from '../../shared/model.js';
import { DATABASE_FILE, closeDatabase, getDatabase } from '../db/connection.js';
import { backupPath, createBackup, listBackups, restoreBackup } from '../domain/backup.js';
import { exportRows, positionsToXlsx, toCsv, toXlsx } from '../domain/exports.js';
import type { ExportFilters } from '../domain/exports.js';

export const exports_ = new Hono();

function filtersOf(query: Record<string, string>): ExportFilters {
  return {
    from: query.from || undefined,
    to: query.to || undefined,
    accountId: query.accountId ? Number(query.accountId) : undefined,
    categoryId: query.categoryId ? Number(query.categoryId) : undefined,
    owner: isOwner(query.owner) ? query.owner : undefined,
  };
}

function attachment(name: string): Record<string, string> {
  return { 'Content-Disposition': `attachment; filename="${name}"` };
}

function stampedName(extension: string): string {
  return `ecritures-${new Date().toISOString().slice(0, 10)}.${extension}`;
}

exports_.get('/ecritures.csv', (context) => {
  const rows = exportRows(getDatabase(), filtersOf(context.req.query()));
  return new Response(toCsv(rows), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', ...attachment(stampedName('csv')) },
  });
});

exports_.get('/ecritures.xlsx', async (context) => {
  const rows = exportRows(getDatabase(), filtersOf(context.req.query()));
  return new Response(await toXlsx(rows), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ...attachment(stampedName('xlsx')),
    },
  });
});

exports_.get('/positions.xlsx', async (context) => {
  const period = context.req.query('mois') ?? `${new Date().getUTCFullYear() - 1}-12`;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    return context.json({ message: 'Mois attendu au format AAAA-MM.' }, 400);
  }
  return new Response(await positionsToXlsx(getDatabase(), period), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ...attachment(`positions-${period}.xlsx`),
    },
  });
});

/** Aperçu du volume avant de télécharger. */
exports_.get('/apercu', (context) => {
  const rows = exportRows(getDatabase(), filtersOf(context.req.query()));
  return context.json({
    count: rows.length,
    totalCents: rows.reduce((sum, row) => sum + row.amount_cents, 0),
  });
});

// ------------------------------------------------------------- Sauvegardes

export const backups = new Hono();

backups.get('/', (context) => context.json(listBackups(DATABASE_FILE)));

backups.post('/', async (context) =>
  context.json(await createBackup(getDatabase(), DATABASE_FILE), 201),
);

backups.get('/:name', async (context) => {
  const path = backupPath(DATABASE_FILE, context.req.param('name'));
  if (path === null) return context.json({ message: 'Sauvegarde introuvable.' }, 404);

  const { readFile } = await import('node:fs/promises');
  return new Response(await readFile(path), {
    headers: {
      'Content-Type': 'application/vnd.sqlite3',
      ...attachment(context.req.param('name')),
    },
  });
});

backups.post('/:name/restaurer', async (context) => {
  const outcome = await restoreBackup(
    getDatabase(),
    DATABASE_FILE,
    context.req.param('name'),
    closeDatabase,
  );
  if (outcome.kind === 'introuvable') {
    return context.json({ message: 'Sauvegarde introuvable.' }, 404);
  }
  // La connexion suivante rouvrira le fichier restauré.
  return context.json({ ok: true, safety: outcome.safety });
});
