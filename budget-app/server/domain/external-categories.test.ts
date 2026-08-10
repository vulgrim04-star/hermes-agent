import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it } from 'vitest';

import { openDatabase } from '../db/connection.js';
import type { Db } from '../db/connection.js';
import { prepareImport, validateBatch } from '../import/pipeline.js';
import {
  applyExternalCategories,
  listExternalCategories,
  saveExternalCategory,
} from './external-categories.js';
import { normalizeLabel } from './fingerprint.js';
import { replaceSplits } from './splits.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures');

let db: Db;
let accountId: number;
let sequence = 0;

beforeEach(() => {
  db = openDatabase(':memory:');
  sequence = 0;
  accountId = Number(
    db.prepare("INSERT INTO accounts (account_key, label) VALUES ('CH1', 'Compte courant')").run()
      .lastInsertRowid,
  );
});

function categoryId(name: string): number {
  return (db.prepare('SELECT id FROM categories WHERE name = ? LIMIT 1').get(name) as { id: number })
    .id;
}

function add(label: string, externalCategory: string | null, amountCents = -4560): number {
  sequence += 1;
  return Number(
    db
      .prepare(
        `INSERT INTO transactions
           (account_id, value_date, amount_cents, label, label_normalized, external_category,
            source, fingerprint, soft_key)
         VALUES (?, '2026-03-08', ?, ?, ?, ?, 'csv', ?, ?)`,
      )
      .run(
        accountId,
        amountCents,
        label,
        normalizeLabel(label),
        externalCategory,
        `fp${sequence}`,
        `sk${sequence}`,
      ).lastInsertRowid,
  );
}

function categoryOf(transactionId: number): string | null {
  const row = db
    .prepare(
      `SELECT c.name FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
        WHERE t.id = ?`,
    )
    .get(transactionId) as { name: string | null };
  return row.name;
}

describe('table de correspondance livrée', () => {
  it('connaît les vingt libellés d’un export UBS', () => {
    const seeded = listExternalCategories(db).filter((row) => row.id !== null);
    expect(seeded).toHaveLength(20);
  });

  it('rapproche les libellés évidents et laisse les ambigus vides', () => {
    const rows = new Map(listExternalCategories(db).map((row) => [row.external_label, row]));
    expect(rows.get('Alimentation')?.category_name).toBe('Courses');
    expect(rows.get('Restaurants et bars')?.category_name).toBe('Restaurants & take-away');
    expect(rows.get('Salaire et rentes')?.category_name).toBe('Salaire');
    // Sans équivalent dans le plan du ménage : à décider, donc laissé vide.
    expect(rows.get('Autres transactions')?.category_id).toBeNull();
    expect(rows.get('Formation')?.category_id).toBeNull();
  });

  it('traite les règlements de carte comme des transferts, pas des dépenses', () => {
    const rows = new Map(listExternalCategories(db).map((row) => [row.external_label, row]));
    expect(rows.get('Factures de carte de crédit')?.treat_as).toBe('transfert-interne');
    expect(rows.get('Transferts entre comptes')?.treat_as).toBe('transfert-interne');
  });
});

describe('application', () => {
  it('classe une écriture d’après la catégorie de la banque', () => {
    const id = add('COOP PRONTO', 'Alimentation');
    expect(applyExternalCategories(db)).toMatchObject({ categorised: 1 });
    expect(categoryOf(id)).toBe('Courses');
  });

  it('retrouve le libellé quels que soient accents et ponctuation', () => {
    const id = add('PHARMACIE', 'SANTE, SPORT ET BEAUTE');
    applyExternalCategories(db);
    expect(categoryOf(id)).toBe('Santé');
  });

  it('ne touche pas une catégorie déjà posée', () => {
    const id = add('COOP', 'Alimentation');
    db.prepare('UPDATE transactions SET category_id = ? WHERE id = ?').run(
      categoryId('Hobbies'),
      id,
    );
    expect(applyExternalCategories(db)).toMatchObject({ categorised: 0 });
    expect(categoryOf(id)).toBe('Hobbies');
  });

  it('ne touche pas une écriture ventilée', () => {
    const id = add('ACHAT MIXTE', 'Alimentation', -10000);
    replaceSplits(db, id, [
      { categoryId: categoryId('Courses'), amountCents: -6000, owner: null, note: null },
      { categoryId: categoryId('Électronique'), amountCents: -4000, owner: null, note: null },
    ]);
    expect(applyExternalCategories(db)).toMatchObject({ categorised: 0 });
  });

  it('ne classe rien sur un libellé laissé sans correspondance', () => {
    const id = add('VIREMENT DIVERS', 'Autres transactions');
    expect(applyExternalCategories(db)).toMatchObject({ categorised: 0 });
    // L'écriture reste sans catégorie, donc visible dans la file de révision.
    expect(categoryOf(id)).toBeNull();
  });

  it('laisse un règlement de carte sans catégorie et le compte à part', () => {
    const id = add('REGLEMENT CARTE', 'Factures de carte de crédit');
    expect(applyExternalCategories(db)).toMatchObject({
      categorised: 0,
      flaggedAsTransfer: 1,
    });
    expect(categoryOf(id)).toBeNull();
  });

  it('se restreint aux écritures désignées', () => {
    const first = add('COOP', 'Alimentation');
    const second = add('MIGROS', 'Alimentation');
    applyExternalCategories(db, [first]);
    expect(categoryOf(first)).toBe('Courses');
    expect(categoryOf(second)).toBeNull();
  });
});

describe('édition de la table', () => {
  it('enregistre une correspondance et l’applique rétroactivement', () => {
    const id = add('COURS DU SOIR', 'Formation');
    expect(applyExternalCategories(db)).toMatchObject({ categorised: 0 });

    saveExternalCategory(db, {
      externalLabel: 'Formation',
      categoryId: categoryId('Hobbies'),
      treatAs: 'categorie',
    });
    expect(applyExternalCategories(db)).toMatchObject({ categorised: 1 });
    expect(categoryOf(id)).toBe('Hobbies');
  });

  it('fait apparaître un libellé rencontré que la table ne connaît pas', () => {
    add('CADEAU', 'Bons et cadeaux');
    const row = listExternalCategories(db).find((entry) => entry.external_label === 'Bons et cadeaux');
    expect(row).toMatchObject({ id: null, transaction_count: 1, uncategorised_count: 1 });
  });

  it('compte ce que chaque libellé pèse encore', () => {
    add('COOP', 'Alimentation');
    add('MIGROS', 'Alimentation');
    applyExternalCategories(db);
    const row = listExternalCategories(db).find((entry) => entry.external_label === 'Alimentation');
    expect(row).toMatchObject({ transaction_count: 2, uncategorised_count: 0 });
  });
});

describe('ordre de priorité à l’import', () => {
  it('laisse la règle de l’utilisateur l’emporter sur la banque', () => {
    // La banque range ce libellé en « Alimentation » ; la règle du ménage, elle,
    // le veut en « Restaurants & take-away ». C'est la règle qui doit gagner.
    db.prepare(
      `INSERT INTO category_rules (pattern, match_type, category_id, priority)
       VALUES ('COOP PRONTO', 'contient', ?, 10)`,
    ).run(categoryId('Restaurants & take-away'));

    const outcome = prepareImport(
      db,
      Buffer.from(
        '"Date de transaction","Numéro de compte ou de carte","Description","Revenu ou dépense","Montant","Monnaie","Catégorie"\r\n' +
          '"08.03.2026","CH56 0483 5012 3456 7800 9","COOP PRONTO GENÈVE","Dépense","-38.45","CHF","Alimentation"\r\n',
        'utf8',
      ),
      { filename: 'regle.csv' },
    );
    if (outcome.kind !== 'pret') throw new Error('import non abouti');

    const validated = validateBatch(db, outcome.batchId, true);
    expect(validated).toMatchObject({ kind: 'valide', categorised: 1, categorisedByBank: 0 });

    const row = db
      .prepare(
        `SELECT c.name FROM transactions t JOIN categories c ON c.id = t.category_id
          WHERE t.label LIKE 'COOP%'`,
      )
      .get() as { name: string };
    expect(row.name).toBe('Restaurants & take-away');
  });

  it('classe le reste par la correspondance de la banque', () => {
    const outcome = prepareImport(
      db,
      readFileSync(join(fixtures, 'ubs-export-multi-comptes.csv')),
      { filename: 'ubs-export-multi-comptes.csv' },
    );
    if (outcome.kind !== 'pret') throw new Error('import non abouti');

    const validated = validateBatch(db, outcome.batchId, true);
    if (validated.kind !== 'valide') throw new Error('validation refusée');
    expect(validated.categorised).toBe(0);
    expect(validated.categorisedByBank).toBeGreaterThan(10);

    const salaire = db
      .prepare(
        `SELECT c.name FROM transactions t JOIN categories c ON c.id = t.category_id
          WHERE t.label = 'SALAIRE MARS'`,
      )
      .get() as { name: string };
    expect(salaire.name).toBe('Salaire');
  });

  it('conserve le libellé de la banque sur l’écriture, même sans correspondance', () => {
    const outcome = prepareImport(
      db,
      readFileSync(join(fixtures, 'ubs-export-multi-comptes.csv')),
      { filename: 'ubs-export-multi-comptes.csv' },
    );
    if (outcome.kind !== 'pret') throw new Error('import non abouti');
    validateBatch(db, outcome.batchId, true);

    const row = db
      .prepare("SELECT external_category FROM transactions WHERE label LIKE 'BULLETIN%' LIMIT 1")
      .get() as { external_category: string };
    expect(row.external_category).toBe('Autres transactions');
  });
});
