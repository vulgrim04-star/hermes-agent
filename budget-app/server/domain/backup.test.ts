import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openDatabase } from '../db/connection.js';
import type { Db } from '../db/connection.js';
import { backupDirectory, backupPath, createBackup, listBackups, restoreBackup } from './backup.js';

let root: string;
let databaseFile: string;
let db: Db;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'budget-backup-'));
  databaseFile = join(root, 'data', 'budget.db');
  db = openDatabase(databaseFile);
});

afterEach(() => {
  try {
    db.close();
  } catch {
    // Déjà fermée par une restauration : rien à faire.
  }
  rmSync(root, { recursive: true, force: true });
});

function addAccount(label: string): void {
  db.prepare('INSERT INTO accounts (account_key, label) VALUES (?, ?)').run(label, label);
}

function accountLabels(database: Db): string[] {
  return (
    database.prepare('SELECT label FROM accounts ORDER BY label').all() as { label: string }[]
  ).map((row) => row.label);
}

describe('sauvegarde', () => {
  it('produit une base valide, relisible', async () => {
    addAccount('Compte courant');
    const backup = await createBackup(db, databaseFile);

    expect(backup.name).toMatch(/^budget-\d{4}-\d{2}-\d{2}-\d{4}\.db$/);
    expect(backup.sizeBytes).toBeGreaterThan(0);

    const copy = openDatabase(backup.path);
    expect(accountLabels(copy)).toEqual(['Compte courant']);
    copy.close();
  });

  it('se range dans un dossier « sauvegardes » à côté des données', () => {
    expect(backupDirectory(databaseFile)).toBe(join(root, 'sauvegardes'));
  });

  it('se laisse lister, de la plus récente à la plus ancienne', async () => {
    await createBackup(db, databaseFile);
    const listed = listBackups(databaseFile);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.name).toMatch(/\.db$/);
  });

  it('n’écrase pas une sauvegarde prise dans la même minute', async () => {
    const first = await createBackup(db, databaseFile);
    const second = await createBackup(db, databaseFile);
    expect(second.name).not.toBe(first.name);
    expect(listBackups(databaseFile)).toHaveLength(2);
  });

  it('refuse un nom qui tenterait de sortir du dossier', () => {
    expect(backupPath(databaseFile, '../../etc/passwd')).toBeNull();
    expect(backupPath(databaseFile, 'budget-2026-01-01-1200.db')).toBeNull(); // inexistante
  });
});

describe('restauration', () => {
  it('rétablit l’état sauvegardé', async () => {
    addAccount('Avant sauvegarde');
    const backup = await createBackup(db, databaseFile);

    addAccount('Après sauvegarde');
    expect(accountLabels(db)).toHaveLength(2);

    const outcome = await restoreBackup(db, databaseFile, backup.name, () => db.close());
    expect(outcome.kind).toBe('restaure');

    db = openDatabase(databaseFile);
    expect(accountLabels(db)).toEqual(['Avant sauvegarde']);
  });

  it('sauvegarde d’abord la base en place, pour que rien ne soit sans retour', async () => {
    addAccount('Avant sauvegarde');
    const backup = await createBackup(db, databaseFile);
    addAccount('Après sauvegarde');

    const outcome = await restoreBackup(db, databaseFile, backup.name, () => db.close());
    if (outcome.kind !== 'restaure') throw new Error('restauration échouée');

    expect(outcome.safety.name).toContain('-securite');
    const safety = openDatabase(outcome.safety.path);
    expect(accountLabels(safety)).toEqual(['Après sauvegarde', 'Avant sauvegarde']);
    safety.close();

    db = openDatabase(databaseFile);
  });

  it('signale une sauvegarde introuvable sans rien toucher', async () => {
    addAccount('Intacte');
    const outcome = await restoreBackup(db, databaseFile, 'budget-2000-01-01-0000.db', () => {});
    expect(outcome).toEqual({ kind: 'introuvable' });
    expect(accountLabels(db)).toEqual(['Intacte']);
  });

  it('refuse un nom fabriqué sans fermer la connexion', async () => {
    addAccount('Intacte');
    const outcome = await restoreBackup(db, databaseFile, '../../../etc/passwd', () => {
      throw new Error('la connexion ne doit pas être fermée');
    });
    expect(outcome).toEqual({ kind: 'introuvable' });
  });
});
