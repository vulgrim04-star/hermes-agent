import { beforeEach, describe, expect, it } from 'vitest';

import { openDatabase } from '../db/connection.js';
import type { Db } from '../db/connection.js';
import { annualSummary, availableYears } from './annual.js';
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

function add(valueDate: string, amountCents: number, category?: string): number {
  sequence += 1;
  return Number(
    db
      .prepare(
        `INSERT INTO transactions
           (account_id, value_date, amount_cents, label, label_normalized, category_id,
            source, fingerprint, soft_key)
         VALUES (?, ?, ?, ?, ?, ?, 'csv', ?, ?)`,
      )
      .run(
        accountId,
        valueDate,
        amountCents,
        `Écriture ${sequence}`,
        normalizeLabel(`Écriture ${sequence}`),
        category === undefined ? null : categoryId(category),
        `fp${sequence}`,
        `sk${sequence}`,
      ).lastInsertRowid,
  );
}

describe('douze mois en colonnes', () => {
  it('rend toujours douze colonnes, même sur une base vide', () => {
    const summary = annualSummary(db, 2026);
    expect(summary.months).toHaveLength(12);
    expect(summary.months[0]!.month).toBe('2026-01');
    expect(summary.months[11]!.month).toBe('2026-12');
  });

  it('met un mois sans écriture à zéro, sans le confondre avec un mois vécu', () => {
    add('2026-03-10', 500000, 'Salaire');
    const summary = annualSummary(db, 2026);

    expect(summary.months[0]!.totals).toMatchObject({
      incomeCents: 0,
      expenseCents: 0,
      remainingCents: 0,
    });
    expect(summary.months[2]!.totals.incomeCents).toBe(500000);
    expect(summary.monthsWithEntries).toBe(1);
  });

  it('ne retient que les écritures de l’année demandée', () => {
    add('2025-12-31', 100000, 'Salaire');
    add('2026-01-01', 200000, 'Salaire');
    add('2027-01-01', 400000, 'Salaire');
    expect(annualSummary(db, 2026).totals.incomeCents).toBe(200000);
  });
});

describe('totaux et moyennes', () => {
  beforeEach(() => {
    for (let month = 1; month <= 12; month += 1) {
      const stamp = String(month).padStart(2, '0');
      add(`2026-${stamp}-25`, 600000, 'Salaire');
      add(`2026-${stamp}-05`, -180000, 'Loyer');
      add(`2026-${stamp}-28`, -50000, "Virement d'épargne");
    }
  });

  it('applique la même définition du reste à vivre que le mensuel', () => {
    const summary = annualSummary(db, 2026);
    expect(summary.totals).toMatchObject({
      incomeCents: 7200000,
      expenseCents: 2160000,
      savingsCents: 600000,
      remainingCents: 4440000,
    });
  });

  it('rapporte la moyenne aux douze mois, pas aux mois mouvementés', () => {
    const summary = annualSummary(db, 2026);
    expect(summary.averages.incomeCents).toBe(600000);
    expect(summary.averages.remainingCents).toBe(370000);
  });

  it('fait peser un mois vide sur la moyenne', () => {
    const db2 = openDatabase(':memory:');
    db2.prepare("INSERT INTO accounts (account_key, label) VALUES ('CH2', 'Autre')").run();
    db2
      .prepare(
        `INSERT INTO transactions
           (account_id, value_date, amount_cents, label, label_normalized, category_id, source, fingerprint, soft_key)
         VALUES (1, '2026-01-25', 1200000, 'Salaire', 'SALAIRE',
                 (SELECT id FROM categories WHERE name = 'Salaire'), 'csv', 'f', 's')`,
      )
      .run();
    // Un seul mois porteur : la moyenne annuelle vaut le douzième, pas le tout.
    expect(annualSummary(db2, 2026).averages.incomeCents).toBe(100000);
    db2.close();
  });

  it('chiffre le taux d’épargne sur l’année entière', () => {
    expect(annualSummary(db, 2026).totals.savingsRate).toBeCloseTo(600000 / 7200000, 10);
  });
});

describe('détail par catégorie', () => {
  it('donne douze valeurs par catégorie mouvementée', () => {
    add('2026-02-05', -180000, 'Loyer');
    add('2026-08-05', -180000, 'Loyer');

    const loyer = annualSummary(db, 2026).categories.find((line) => line.name === 'Loyer');
    expect(loyer?.monthlyCents).toHaveLength(12);
    expect(loyer?.monthlyCents[1]).toBe(180000);
    expect(loyer?.monthlyCents[7]).toBe(180000);
    expect(loyer?.monthlyCents[0]).toBe(0);
    expect(loyer?.totalCents).toBe(360000);
    expect(loyer?.averageCents).toBe(30000);
  });

  it('remonte le total d’une racine sur ses sous-catégories', () => {
    add('2026-02-05', -180000, 'Loyer');
    add('2026-02-06', -22000, 'Charges & chauffage');

    const logement = annualSummary(db, 2026).categories.find((line) => line.name === 'Logement');
    expect(logement?.monthlyCents[1]).toBe(202000);
  });

  it('ignore les catégories que l’année n’a jamais touchées', () => {
    add('2026-02-05', -180000, 'Loyer');
    const names = annualSummary(db, 2026).categories.map((line) => line.name);
    expect(names).toContain('Loyer');
    expect(names).not.toContain('Voyages');
  });

  it('compte une écriture ventilée dans chacune de ses catégories', () => {
    const id = add('2026-04-10', -10000);
    replaceSplits(db, id, [
      { categoryId: categoryId('Courses'), amountCents: -6000, owner: null, note: null },
      { categoryId: categoryId('Électronique'), amountCents: -4000, owner: null, note: null },
    ]);

    const summary = annualSummary(db, 2026);
    const courses = summary.categories.find((line) => line.name === 'Courses');
    const electro = summary.categories.find((line) => line.name === 'Électronique');
    expect(courses?.monthlyCents[3]).toBe(6000);
    expect(electro?.monthlyCents[3]).toBe(4000);
    // Et une seule fois au total.
    expect(summary.totals.expenseCents).toBe(10000);
  });
});

describe('année précédente', () => {
  it('n’est pas rendue quand elle ne porte aucune écriture', () => {
    add('2026-03-10', 500000, 'Salaire');
    expect(annualSummary(db, 2026).previous).toBeNull();
  });

  it('est rendue avec ses totaux dès qu’elle en porte', () => {
    add('2025-03-10', 400000, 'Salaire');
    add('2026-03-10', 500000, 'Salaire');
    expect(annualSummary(db, 2026).previous).toMatchObject({
      year: 2025,
      totals: { incomeCents: 400000 },
    });
  });
});

describe('non catégorisé', () => {
  it('reste visible et compté à part', () => {
    add('2026-05-05', -12345);
    const summary = annualSummary(db, 2026);
    expect(summary.uncategorised).toEqual({ count: 1, amountCents: -12345 });
    // Classé par son signe, il reste dans les dépenses.
    expect(summary.totals.expenseCents).toBe(12345);
  });
});

describe('années disponibles', () => {
  it('les rend de la plus récente à la plus ancienne', () => {
    add('2024-01-05', -100);
    add('2026-01-05', -100);
    add('2025-01-05', -100);
    expect(availableYears(db)).toEqual([2026, 2025, 2024]);
  });
});
