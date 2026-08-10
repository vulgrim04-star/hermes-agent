import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Database } from 'better-sqlite3';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

/**
 * Migrations numérotées, jouées dans l'ordre, chacune dans sa transaction, et
 * suivies par `PRAGMA user_version`. Pas d'ORM : le schéma d'une application
 * comptable se lit mieux en SQL qu'à travers une couche d'abstraction.
 */
export function migrate(db: Database): void {
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  const current = db.pragma('user_version', { simple: true }) as number;

  for (const file of files) {
    const version = Number(file.slice(0, 3));
    if (!Number.isInteger(version) || version <= 0) {
      throw new Error(`Migration mal nommée : ${file} (attendu 001_nom.sql)`);
    }
    if (version <= current) continue;

    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${version}`);
    })();
  }
}
