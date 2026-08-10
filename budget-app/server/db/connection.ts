import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';

import { migrate } from './migrate.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Emplacement du fichier de base — c'est ce fichier unique que l'on sauvegarde. */
export const DATABASE_FILE = process.env.BUDGET_DB ?? resolve(projectRoot, 'data', 'budget.db');

export type Db = Database.Database;

/**
 * Ouvre une base et applique les migrations.
 *
 * `better-sqlite3` est synchrone : un import s'exécute d'un bloc, dans une seule
 * transaction, sans entrelacement possible avec une autre requête. Sur une
 * application mono-utilisateur, c'est exactement la propriété recherchée.
 */
export function openDatabase(file: string = DATABASE_FILE): Db {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });

  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

let singleton: Db | null = null;

/** Connexion partagée du serveur. */
export function getDatabase(): Db {
  singleton ??= openDatabase();
  return singleton;
}
