/**
 * Sauvegarde et restauration de la base.
 *
 * `db.backup()` de better-sqlite3 copie une base **en ligne** de façon
 * cohérente, mode WAL compris. Copier le fichier à la main pendant que
 * l'application tourne donnerait une base tronquée — et rien ne le signalerait
 * avant le jour où on en aurait besoin.
 *
 * Une restauration commence toujours par sauvegarder la base en place. Un
 * chemin sans retour n'a pas sa place dans un outil comptable.
 */

import { existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

import type { Db } from '../db/connection.js';

export interface BackupFile {
  name: string;
  path: string;
  sizeBytes: number;
  createdAt: string;
}

const FILE_PATTERN = /^budget-\d{4}-\d{2}-\d{2}-\d{4}(-securite)?\.db$/;

/** Dossier des sauvegardes, à côté de `data/` plutôt que dedans. */
export function backupDirectory(databaseFile: string): string {
  return resolve(dirname(databaseFile), '..', 'sauvegardes');
}

function stamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

/** Copie cohérente de la base vers un fichier daté. */
export async function createBackup(db: Db, databaseFile: string, suffix = ''): Promise<BackupFile> {
  const directory = backupDirectory(databaseFile);
  mkdirSync(directory, { recursive: true });

  let name = `budget-${stamp()}${suffix}.db`;
  // Deux sauvegardes dans la même minute ne doivent pas s'écraser l'une l'autre.
  for (let attempt = 1; existsSync(join(directory, name)); attempt += 1) {
    name = `budget-${stamp(new Date(Date.now() + attempt * 60_000))}${suffix}.db`;
  }

  const path = join(directory, name);
  await db.backup(path);

  const info = statSync(path);
  return { name, path, sizeBytes: info.size, createdAt: info.mtime.toISOString() };
}

export function listBackups(databaseFile: string): BackupFile[] {
  const directory = backupDirectory(databaseFile);
  if (!existsSync(directory)) return [];

  return readdirSync(directory)
    .filter((name) => FILE_PATTERN.test(name))
    .map((name) => {
      const path = join(directory, name);
      const info = statSync(path);
      return { name, path, sizeBytes: info.size, createdAt: info.mtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.name.localeCompare(a.name));
}

/**
 * Chemin d'une sauvegarde existante, `null` sinon.
 *
 * Le nom est vérifié contre le motif **et** rapporté au dossier : un nom
 * fabriqué (`../../etc/passwd`) ne doit pas pouvoir sortir du dossier, même sur
 * une application qui n'écoute que sur la machine.
 */
export function backupPath(databaseFile: string, name: string): string | null {
  if (!FILE_PATTERN.test(name) || basename(name) !== name) return null;

  const directory = backupDirectory(databaseFile);
  const path = join(directory, name);
  if (resolve(path) !== join(directory, basename(name))) return null;
  return existsSync(path) ? path : null;
}

export type RestoreOutcome =
  | { kind: 'restaure'; safety: BackupFile }
  | { kind: 'introuvable' };

/**
 * Remplace la base en place par une sauvegarde.
 *
 * L'ordre compte : on sauvegarde d'abord l'état actuel, **puis** on ferme la
 * connexion, **puis** on remplace le fichier. Les journaux WAL sont écartés
 * avec lui, sans quoi la base restaurée serait rejouée par-dessus.
 *
 * `closeConnection` est passé par l'appelant : le domaine n'a pas à connaître
 * la connexion partagée du serveur.
 */
export async function restoreBackup(
  db: Db,
  databaseFile: string,
  name: string,
  closeConnection: () => void,
): Promise<RestoreOutcome> {
  const source = backupPath(databaseFile, name);
  if (source === null) return { kind: 'introuvable' };

  const safety = await createBackup(db, databaseFile, '-securite');
  closeConnection();

  for (const journal of [`${databaseFile}-wal`, `${databaseFile}-shm`]) {
    if (existsSync(journal)) unlinkSync(journal);
  }

  // Copie puis renommage : un remplacement direct laisserait la base absente
  // si la copie échouait en cours de route.
  const staging = `${databaseFile}.restauration`;
  const { copyFileSync } = await import('node:fs');
  copyFileSync(source, staging);
  renameSync(staging, databaseFile);

  return { kind: 'restaure', safety };
}
