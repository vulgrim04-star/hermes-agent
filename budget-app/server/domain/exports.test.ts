import { beforeEach, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';

import { openDatabase } from '../db/connection.js';
import type { Db } from '../db/connection.js';
import { exportRows, positionsToXlsx, toCsv, toXlsx } from './exports.js';
import { normalizeLabel } from './fingerprint.js';
import { replaceSplits } from './splits.js';

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

function add(valueDate: string, amountCents: number, label: string, category?: string): number {
  sequence += 1;
  return Number(
    db
      .prepare(
        `INSERT INTO transactions
           (account_id, value_date, amount_cents, label, label_normalized, category_id,
            external_category, source, fingerprint, soft_key)
         VALUES (?, ?, ?, ?, ?, ?, 'Alimentation', 'csv', ?, ?)`,
      )
      .run(
        accountId,
        valueDate,
        amountCents,
        label,
        normalizeLabel(label),
        category === undefined ? null : categoryId(category),
        `fp${sequence}`,
        `sk${sequence}`,
      ).lastInsertRowid,
  );
}

function csvText(): string {
  return toCsv(exportRows(db)).toString('utf8');
}

/**
 * Relit un classeur produit par `toXlsx`. `exceljs` déclare son paramètre comme
 * un `ArrayBuffer` et non comme un `Buffer` Node : on lui rend la mémoire nue.
 */
async function reload(bytes: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(new Uint8Array(bytes).buffer);
  return workbook;
}

describe('export CSV', () => {
  it('commence par un BOM UTF-8, sans quoi Excel casse les accents', () => {
    add('2026-01-08', -4560, 'Coop Genève');
    const buffer = toCsv(exportRows(db));
    expect([buffer[0], buffer[1], buffer[2]]).toEqual([0xef, 0xbb, 0xbf]);
    expect(buffer.toString('utf8')).toContain('Genève');
  });

  it('sépare au point-virgule et rend les dates au format suisse', () => {
    add('2026-01-08', -4560, 'Coop', 'Courses');
    const lines = csvText().replace('﻿', '').split('\r\n');
    expect(lines[0]!.split(';')[0]).toBe('Date de valeur');
    expect(lines[1]).toContain('08.01.2026');
    expect(lines[1]).toContain('Compte courant');
  });

  it('protège un libellé contenant un point-virgule ou des guillemets', () => {
    add('2026-01-08', -4560, 'Coop; caisse 3 "self"');
    const line = csvText().split('\r\n')[1]!;
    expect(line).toContain('"Coop; caisse 3 ""self"""');
    // Le champ protégé ne doit pas ajouter de colonne.
    expect(line.split(';').length).toBeGreaterThan(10);
  });

  it('rend le montant en nombre brut, lisible comme tel par un tableur', () => {
    add('2026-01-08', -123456, 'Achat');
    expect(csvText()).toContain('-1234.56');
  });

  it('sort une écriture ventilée en autant de lignes que de découpes', () => {
    const transaction = add('2026-01-08', -12995, 'Achat mixte');
    replaceSplits(db, transaction, [
      { categoryId: categoryId('Électronique'), amountCents: -9995, owner: null, note: null },
      { categoryId: categoryId('Équipement du ménage'), amountCents: -3000, owner: null, note: null },
    ]);

    const rows = exportRows(db);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.amount_cents).sort((a, b) => a - b)).toEqual([-9995, -3000]);
    expect(rows.map((row) => row.category_name)).toContain('Électronique');
  });

  it('conserve la catégorie livrée par la banque', () => {
    add('2026-01-08', -4560, 'Coop');
    expect(csvText()).toContain('Alimentation');
  });

  it('range la racine et la feuille dans deux colonnes distinctes', () => {
    add('2026-01-08', -4560, 'Coop', 'Courses');
    const cells = csvText().replace('﻿', '').split('\r\n')[1]!.split(';');
    expect(cells[5]).toBe('Alimentation');
    expect(cells[6]).toBe('Courses');
  });
});

describe('filtres', () => {
  beforeEach(() => {
    add('2026-01-08', -4560, 'Janvier', 'Courses');
    add('2026-03-08', -6000, 'Mars', 'Courses');
    add('2026-03-09', -2000, 'Mars loisirs', 'Hobbies');
  });

  it('restreint à une période', () => {
    expect(exportRows(db, { from: '2026-03-01', to: '2026-03-31' })).toHaveLength(2);
  });

  it('restreint à une catégorie, sous-catégories comprises', () => {
    expect(exportRows(db, { categoryId: categoryId('Alimentation') })).toHaveLength(2);
    expect(exportRows(db, { categoryId: categoryId('Hobbies') })).toHaveLength(1);
  });

  it('restreint à un compte', () => {
    expect(exportRows(db, { accountId })).toHaveLength(3);
    expect(exportRows(db, { accountId: 999 })).toHaveLength(0);
  });
});

describe('classeur Excel', () => {
  it('porte des dates et des montants typés, pas du texte', async () => {
    add('2026-01-08', -123456, 'Achat', 'Courses');

    const workbook = await reload(await toXlsx(exportRows(db)));
    const sheet = workbook.worksheets[0]!;

    expect(sheet.getRow(1).getCell(1).value).toBe('Date de valeur');
    const row = sheet.getRow(2);
    expect(row.getCell(1).value).toBeInstanceOf(Date);
    expect((row.getCell(1).value as Date).toISOString().slice(0, 10)).toBe('2026-01-08');
    expect(row.getCell(10).value).toBeCloseTo(-1234.56, 10);
    expect(typeof row.getCell(10).value).toBe('number');
  });

  it('fige la ligne d’en-tête', async () => {
    add('2026-01-08', -4560, 'Achat');
    const workbook = await reload(await toXlsx(exportRows(db)));
    expect(workbook.worksheets[0]!.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
  });

  it('produit un classeur vide mais valide quand rien ne correspond', async () => {
    const workbook = await reload(await toXlsx([]));
    expect(workbook.worksheets[0]!.rowCount).toBe(1);
  });
});

describe('état des positions', () => {
  function asset(label: string, extra: Record<string, unknown> = {}): number {
    const columns = { label, kind: 'autre', is_liability: 0, owner: 'commun', ...extra };
    return Number(
      db
        .prepare(
          `INSERT INTO assets (label, kind, is_liability, owner)
           VALUES (@label, @kind, @is_liability, @owner)`,
        )
        .run(columns).lastInsertRowid,
    );
  }

  function valuate(assetId: number, period: string, valueCents: number, quantityE8?: number): void {
    db.prepare(
      `INSERT INTO asset_valuations (asset_id, period, value_cents, quantity_e8, unit_price_cents)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(assetId, period, valueCents, quantityE8 ?? null, quantityE8 === undefined ? null : 5_843_215);
  }

  it('rend une ligne par position, valeurs typées en nombres', async () => {
    const etf = asset('ETF Monde', { kind: 'titres' });
    valuate(etf, '2025-12', 5_000_000);

    const sheet = (await reload(await positionsToXlsx(db, '2025-12'))).worksheets[0]!;
    expect(sheet.getRow(1).getCell(1).value).toBe('Position');

    const row = sheet.getRow(2);
    expect(row.getCell(1).value).toBe('ETF Monde');
    expect(row.getCell(6).value).toBe(50000);
    expect(typeof row.getCell(6).value).toBe('number');
  });

  it('sort une dette en négatif, pour que la somme soit la fortune nette', async () => {
    const dette = asset('Prêt véhicule', { kind: 'dette', is_liability: 1 });
    valuate(dette, '2025-12', 1_200_000);

    const sheet = (await reload(await positionsToXlsx(db, '2025-12'))).worksheets[0]!;
    expect(sheet.getRow(2).getCell(6).value).toBe(-12000);
  });

  it('porte la quantité et le cours d’une position suivie en quantité', async () => {
    const btc = asset('Bitcoin', { kind: 'crypto', tracks_quantity: 1 });
    valuate(btc, '2025-12', 2_501_773, 42_815_000);

    const row = (await reload(await positionsToXlsx(db, '2025-12'))).worksheets[0]!.getRow(2);
    expect(row.getCell(4).value).toBeCloseTo(0.42815, 10);
    expect(row.getCell(5).value).toBeCloseTo(58432.15, 10);
  });

  it('annonce l’origine du chiffre, report compris', async () => {
    const etf = asset('ETF Monde', { kind: 'titres' });
    valuate(etf, '2025-06', 5_000_000);

    const sheet = (await reload(await positionsToXlsx(db, '2025-12'))).worksheets[0]!;
    // Aucune saisie en décembre : la valeur de juin est reportée, et le dit.
    expect(sheet.getRow(2).getCell(7).value).toBe('report');
  });

  it('laisse une position non renseignée sans valeur plutôt qu’à zéro', async () => {
    asset('Immeuble', { kind: 'immobilier' });
    const row = (await reload(await positionsToXlsx(db, '2025-12'))).worksheets[0]!.getRow(2);
    expect(row.getCell(6).value).toBeNull();
  });
});
