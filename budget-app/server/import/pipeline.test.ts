import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it } from 'vitest';

import { openDatabase } from '../db/connection.js';
import type { Db } from '../db/connection.js';
import {
  deleteBatch,
  getBatchReport,
  prepareImport,
  setPendingInclusion,
  validateBatch,
} from './pipeline.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures');

function load(name: string): Uint8Array {
  return readFileSync(join(fixtures, name));
}

let db: Db;
beforeEach(() => {
  db = openDatabase(':memory:');
});

/** Prépare un lot en exigeant qu'il soit exploitable, et rend son identifiant. */
function prepare(name: string, options: Record<string, unknown> = {}): number {
  const outcome = prepareImport(db, load(name), { filename: name, ...options });
  if (outcome.kind !== 'pret') throw new Error(`Import non abouti : ${outcome.kind}`);
  return outcome.batchId;
}

function batchRow(batchId: number): Record<string, number | string | null> {
  return db.prepare('SELECT * FROM import_batches WHERE id = ?').get(batchId) as never;
}

function transactionCount(): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM transactions').get() as { n: number }).n;
}

describe('import d’un CSV puis validation', () => {
  it('crée le compte à partir de l’IBAN du fichier', () => {
    prepare('ubs-fr-point-virgule.csv');
    const account = db.prepare('SELECT * FROM accounts').get() as {
      account_key: string;
      label: string;
      default_owner: string;
    };
    expect(account.account_key).toBe('CH9300762011623852957');
    expect(account.label).toBe('CH93 0076 2011 6238 5295 7');
    expect(account.default_owner).toBe('commun');
  });

  it('laisse les écritures en brouillon tant que rien n’est validé', () => {
    const batchId = prepare('ubs-fr-point-virgule.csv');
    expect(batchRow(batchId).status).toBe('brouillon');
    expect(transactionCount()).toBe(0);
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM pending_transactions').get() as { n: number }).n,
    ).toBe(8);
  });

  it('prouve le rapprochement avant de laisser valider', () => {
    const batchId = prepare('ubs-fr-point-virgule.csv');
    expect(batchRow(batchId)).toMatchObject({
      reconciliation_status: 'ok',
      reconciliation_gap_cents: 0,
      rows_read: 8,
      rows_error: 0,
    });
    expect(getBatchReport(db, batchId)!.blocking).toEqual([]);
  });

  it('bascule les écritures en comptabilité à la validation', () => {
    const batchId = prepare('ubs-fr-point-virgule.csv');
    expect(validateBatch(db, batchId)).toMatchObject({ kind: 'valide', imported: 8 });
    expect(transactionCount()).toBe(8);
    expect(batchRow(batchId)).toMatchObject({ status: 'valide', rows_imported: 8, forced: 0 });
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM pending_transactions').get() as { n: number }).n,
    ).toBe(0);
  });

  it('reprend l’attribution par défaut du compte', () => {
    // Le compte est créé par l'import ; l'attribution se règle ensuite dans
    // l'écran des comptes, et vaut pour les validations suivantes.
    const batchId = prepare('ubs-fr-point-virgule.csv');
    db.prepare('UPDATE accounts SET default_owner = ?').run('p1');
    validateBatch(db, batchId);
    const owners = db.prepare('SELECT DISTINCT owner FROM transactions').all();
    expect(owners).toEqual([{ owner: 'p1' }]);
  });
});

describe('réimport du même fichier', () => {
  it('n’insère rien et signale chaque ligne comme doublon', () => {
    validateBatch(db, prepare('ubs-fr-point-virgule.csv'));
    expect(transactionCount()).toBe(8);

    const secondBatch = prepare('ubs-fr-point-virgule.csv');
    expect(batchRow(secondBatch)).toMatchObject({ rows_read: 8, rows_duplicate: 8 });

    expect(validateBatch(db, secondBatch)).toMatchObject({ kind: 'valide', imported: 0 });
    expect(transactionCount()).toBe(8);
  });

  it('conserve les deux achats identiques du même jour', () => {
    validateBatch(db, prepare('ubs-fr-point-virgule.csv'));
    const coop = db
      .prepare("SELECT COUNT(*) AS n FROM transactions WHERE amount_cents = -450")
      .get() as { n: number };
    expect(coop.n).toBe(2);
  });
});

describe('même période importée en CSV puis en MT940', () => {
  it('signale les doublons probables sans les supprimer d’office', () => {
    validateBatch(db, prepare('ubs-fr-point-virgule.csv'));

    const mt940Batch = prepare('mt940-simple.sta');
    const report = getBatchReport(db, mt940Batch)!;
    const rows = report.rows as { duplicate_kind: string; include: number }[];

    expect(rows).toHaveLength(7);
    expect(rows.every((row) => row.duplicate_kind !== 'aucun')).toBe(true);
    expect(rows.every((row) => row.include === 0)).toBe(true);

    // Le libellé MT940 est plus bavard que celui du CSV : l'empreinte stricte
    // diffère, seule la clé souple rapproche les deux lectures.
    expect(rows.filter((row) => row.duplicate_kind === 'probable').length).toBeGreaterThan(0);

    expect(validateBatch(db, mt940Batch)).toMatchObject({ kind: 'valide', imported: 0 });
    expect(transactionCount()).toBe(8);
  });

  it('laisse l’utilisateur réintégrer une ligne écartée à tort', () => {
    validateBatch(db, prepare('ubs-fr-point-virgule.csv'));
    const mt940Batch = prepare('mt940-simple.sta');

    const first = (
      getBatchReport(db, mt940Batch)!.rows as { id: number; duplicate_kind: string }[]
    ).find((row) => row.duplicate_kind === 'probable')!;
    expect(setPendingInclusion(db, first.id, true)).toBe(true);

    expect(validateBatch(db, mt940Batch)).toMatchObject({ kind: 'valide', imported: 1 });
    expect(transactionCount()).toBe(9);
  });
});

describe('contrôles bloquants', () => {
  it('refuse de valider un relevé dont le solde ne boucle pas', () => {
    const batchId = prepare('mt940-solde-faux.sta');
    expect(batchRow(batchId)).toMatchObject({
      reconciliation_status: 'ko',
      reconciliation_gap_cents: 2000,
    });

    const refusal = validateBatch(db, batchId);
    expect(refusal.kind).toBe('bloque');
    if (refusal.kind !== 'bloque') return;
    expect(refusal.reasons[0]).toContain('CHF 20.00');
    expect(transactionCount()).toBe(0);
  });

  it('garde la trace du forçage et l’écart constaté', () => {
    const batchId = prepare('mt940-solde-faux.sta');
    expect(validateBatch(db, batchId, true)).toMatchObject({ kind: 'valide', imported: 2 });
    expect(batchRow(batchId)).toMatchObject({
      status: 'valide',
      forced: 1,
      reconciliation_status: 'ko',
      reconciliation_gap_cents: 2000,
    });
  });

  it('refuse de valider un relevé dont une ligne n’a pas pu être lue', () => {
    const batchId = prepare('mt940-ligne-corrompue.sta');
    const outcome = validateBatch(db, batchId);
    expect(outcome.kind).toBe('bloque');
    if (outcome.kind !== 'bloque') return;
    expect(outcome.reasons.some((reason) => reason.includes("n'ont pas pu être lues"))).toBe(true);
  });
});

describe('fichier sans IBAN', () => {
  it('demande à quel compte rattacher les écritures', () => {
    const outcome = prepareImport(db, load('ubs-de-virgule-1252.csv'), {
      filename: 'ubs-de-virgule-1252.csv',
    });
    expect(outcome.kind).toBe('compte-requis');
  });

  it('accepte le compte désigné par l’utilisateur', () => {
    const accountId = Number(
      db
        .prepare('INSERT INTO accounts (account_key, label, default_owner) VALUES (?, ?, ?)')
        .run('CH5604835012345678009', 'Compte commun', 'commun').lastInsertRowid,
    );

    const batchId = prepare('ubs-de-virgule-1252.csv', { accountId });
    expect(validateBatch(db, batchId)).toMatchObject({ kind: 'valide', imported: 3 });
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM transactions WHERE account_id = ?').get(accountId) as {
        n: number;
      }).n,
    ).toBe(3);
  });
});

describe('mapping manuel et profil mémorisé', () => {
  const mapping = { valueDate: 0, label: 1, amount: 2 };

  it('réclame un mapping quand les en-têtes ne sont reconnus', () => {
    const outcome = prepareImport(db, load('format-inconnu.csv'), {
      filename: 'format-inconnu.csv',
    });
    expect(outcome.kind).toBe('mapping-requis');
  });

  it('mémorise le mapping et l’applique au fichier suivant du même format', () => {
    const accountId = Number(
      db
        .prepare('INSERT INTO accounts (account_key, label) VALUES (?, ?)')
        .run('CH5604835012345678009', 'Compte commun').lastInsertRowid,
    );

    const first = prepare('format-inconnu.csv', { accountId, mapping, headerLine: 0, delimiter: '|' });
    expect(validateBatch(db, first)).toMatchObject({ kind: 'valide', imported: 2 });

    // Deuxième passage sans mapping ni séparateur : le profil doit suffire.
    const second = prepare('format-inconnu.csv', { accountId });
    const report = getBatchReport(db, second)!;
    expect((report.rows as unknown[]).length).toBe(2);
    expect(batchRow(second).rows_duplicate).toBe(2);
  });
});

describe('suppression d’un lot', () => {
  it('emporte les écritures qu’il avait produites, et rien d’autre', () => {
    const accountId = Number(
      db
        .prepare('INSERT INTO accounts (account_key, label) VALUES (?, ?)')
        .run('CH5604835012345678009', 'Compte commun').lastInsertRowid,
    );
    validateBatch(db, prepare('ubs-fr-point-virgule.csv'));
    const second = prepare('ubs-de-virgule-1252.csv', { accountId });
    validateBatch(db, second);
    expect(transactionCount()).toBe(11);

    expect(deleteBatch(db, second)).toBe(true);
    expect(transactionCount()).toBe(8);
    expect(db.prepare('SELECT COUNT(*) AS n FROM import_batches').get()).toEqual({ n: 1 });
  });

  it('permet de réimporter le fichier après suppression du lot', () => {
    const batchId = prepare('ubs-fr-point-virgule.csv');
    validateBatch(db, batchId);
    deleteBatch(db, batchId);
    expect(transactionCount()).toBe(0);

    const again = prepare('ubs-fr-point-virgule.csv');
    expect(batchRow(again).rows_duplicate).toBe(0);
    expect(validateBatch(db, again)).toMatchObject({ kind: 'valide', imported: 8 });
  });
});
