import { beforeEach, describe, expect, it } from 'vitest';

import { openDatabase } from '../db/connection.js';
import type { Db } from '../db/connection.js';
import { normalizeLabel } from './fingerprint.js';
import { getSplits, replaceSplits } from './splits.js';

let db: Db;
let transactionId: number;
let electronique: number;
let equipement: number;

function categoryId(name: string): number {
  return (db.prepare('SELECT id FROM categories WHERE name = ?').get(name) as { id: number }).id;
}

beforeEach(() => {
  db = openDatabase(':memory:');
  const accountId = Number(
    db.prepare("INSERT INTO accounts (account_key, label) VALUES ('CH1', 'Courant')").run()
      .lastInsertRowid,
  );
  transactionId = Number(
    db
      .prepare(
        `INSERT INTO transactions
           (account_id, value_date, amount_cents, label, label_normalized, source, fingerprint, soft_key)
         VALUES (?, '2025-01-08', -12995, ?, ?, 'manuel', 'fp1', 'sk1')`,
      )
      .run(accountId, 'Achat en ligne Digitec', normalizeLabel('Achat en ligne Digitec'))
      .lastInsertRowid,
  );
  electronique = categoryId('Électronique');
  equipement = categoryId('Équipement du ménage');
});

function split(categoryIdValue: number, amountCents: number) {
  return { categoryId: categoryIdValue, amountCents, owner: null, note: null };
}

describe('ventilation d’une écriture', () => {
  it('enregistre une ventilation qui boucle', () => {
    expect(
      replaceSplits(db, transactionId, [split(electronique, -9995), split(equipement, -3000)]),
    ).toEqual({ kind: 'enregistre', count: 2 });
    expect(getSplits(db, transactionId)).toHaveLength(2);
  });

  it('refuse une ventilation qui ne boucle pas, en chiffrant le reliquat', () => {
    expect(
      replaceSplits(db, transactionId, [split(electronique, -9995), split(equipement, -2000)]),
    ).toMatchObject({ kind: 'refuse', gapCents: -1000 });
    expect(getSplits(db, transactionId)).toHaveLength(0);
  });

  it('refuse une découpe à zéro', () => {
    expect(
      replaceSplits(db, transactionId, [split(electronique, -12995), split(equipement, 0)]),
    ).toMatchObject({ kind: 'refuse' });
  });

  it('retire la catégorie propre de l’écriture une fois ventilée', () => {
    db.prepare('UPDATE transactions SET category_id = ? WHERE id = ?').run(
      electronique,
      transactionId,
    );
    replaceSplits(db, transactionId, [split(electronique, -9995), split(equipement, -3000)]);

    expect(db.prepare('SELECT category_id FROM transactions WHERE id = ?').get(transactionId)).toEqual(
      { category_id: null },
    );
  });

  it('remplace intégralement la ventilation précédente', () => {
    replaceSplits(db, transactionId, [split(electronique, -9995), split(equipement, -3000)]);
    expect(replaceSplits(db, transactionId, [split(electronique, -12995)])).toEqual({
      kind: 'enregistre',
      count: 1,
    });
    expect(getSplits(db, transactionId)).toHaveLength(1);
  });

  it('rend l’écriture entière quand la ventilation est vidée', () => {
    replaceSplits(db, transactionId, [split(electronique, -9995), split(equipement, -3000)]);
    expect(replaceSplits(db, transactionId, [])).toEqual({ kind: 'enregistre', count: 0 });
    expect(getSplits(db, transactionId)).toHaveLength(0);
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM transaction_lines WHERE transaction_id = ?').get(
        transactionId,
      ),
    ).toEqual({ n: 1 });
  });

  it('signale une écriture introuvable', () => {
    expect(replaceSplits(db, 9999, [split(electronique, -100)])).toEqual({ kind: 'introuvable' });
  });

  it('disparaît avec l’écriture qu’elle ventile', () => {
    replaceSplits(db, transactionId, [split(electronique, -9995), split(equipement, -3000)]);
    db.prepare('DELETE FROM transactions WHERE id = ?').run(transactionId);
    expect(db.prepare('SELECT COUNT(*) AS n FROM transaction_splits').get()).toEqual({ n: 0 });
  });
});
