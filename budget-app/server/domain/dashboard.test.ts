import { beforeEach, describe, expect, it } from 'vitest';

import { openDatabase } from '../db/connection.js';
import type { Db } from '../db/connection.js';
import { availableMonths, monthlySummary } from './dashboard.js';
import { normalizeLabel } from './fingerprint.js';
import { replaceSplits } from './splits.js';
import { confirmTransfer, detectTransfers } from './transfers.js';

let db: Db;
let courant: number;
let sequence = 0;

function categoryId(name: string): number {
  return (db.prepare('SELECT id FROM categories WHERE name = ?').get(name) as { id: number }).id;
}

function addTransaction(
  valueDate: string,
  amountCents: number,
  label: string,
  category?: string,
  accountId = courant,
): number {
  sequence += 1;
  return Number(
    db
      .prepare(
        `INSERT INTO transactions
           (account_id, value_date, amount_cents, label, label_normalized, category_id, source, fingerprint, soft_key)
         VALUES (?, ?, ?, ?, ?, ?, 'manuel', ?, ?)`,
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

function setBudget(category: string, amountCents: number, period: string | null = null): void {
  db.prepare('INSERT INTO budgets (category_id, period, amount_cents) VALUES (?, ?, ?)').run(
    categoryId(category),
    period,
    amountCents,
  );
}

function lineOf(summary: ReturnType<typeof monthlySummary>, name: string) {
  return summary.budgetLines.find((line) => line.name === name);
}

beforeEach(() => {
  db = openDatabase(':memory:');
  sequence = 0;
  courant = Number(
    db.prepare("INSERT INTO accounts (account_key, label) VALUES ('CH1', 'Courant')").run()
      .lastInsertRowid,
  );
});

describe('totaux du mois', () => {
  beforeEach(() => {
    addTransaction('2025-01-06', 625000, 'Salaire janvier', 'Salaire');
    addTransaction('2025-01-03', -189000, 'Loyer janvier', 'Loyer');
    addTransaction('2025-01-08', -45000, 'Courses', 'Courses');
    addTransaction('2025-01-25', -100000, 'Versement 3a', 'Pilier 3a');
  });

  it('sépare revenus, dépenses et épargne', () => {
    expect(monthlySummary(db, '2025-01').totals).toMatchObject({
      incomeCents: 625000,
      expenseCents: 234000,
      savingsCents: 100000,
    });
  });

  it('déduit l’épargne du reste à vivre', () => {
    const totals = monthlySummary(db, '2025-01').totals;
    expect(totals.remainingCents).toBe(625000 - 234000 - 100000);
  });

  it('rapporte l’épargne aux revenus', () => {
    expect(monthlySummary(db, '2025-01').totals.savingsRate).toBeCloseTo(100000 / 625000, 10);
  });

  it('ne divise pas par zéro quand il n’y a pas de revenu', () => {
    const empty = monthlySummary(db, '2025-03');
    expect(empty.totals.savingsRate).toBeNull();
    expect(empty.totals.remainingCents).toBe(0);
  });

  it('ne retient que le mois demandé et rend celui d’avant', () => {
    addTransaction('2024-12-20', 500000, 'Salaire décembre', 'Salaire');
    const summary = monthlySummary(db, '2025-01');
    expect(summary.totals.incomeCents).toBe(625000);
    expect(summary.previous).toMatchObject({ month: '2024-12' });
    expect(summary.previous.totals.incomeCents).toBe(500000);
  });

  it('passe à l’année précédente en janvier', () => {
    expect(monthlySummary(db, '2025-01').previous.month).toBe('2024-12');
  });
});

describe('écritures non catégorisées', () => {
  it('les classe par leur signe sans les faire disparaître des totaux', () => {
    addTransaction('2025-01-10', -12000, 'Achat non classé');
    addTransaction('2025-01-11', 30000, 'Encaissement non classé');

    const summary = monthlySummary(db, '2025-01');
    expect(summary.totals.expenseCents).toBe(12000);
    expect(summary.totals.incomeCents).toBe(30000);
  });

  it('les compte à part, pour que le reste à traiter soit visible', () => {
    addTransaction('2025-01-10', -12000, 'Achat non classé');
    addTransaction('2025-01-11', -8000, 'Autre achat non classé');
    addTransaction('2025-01-12', -5000, 'Courses', 'Courses');

    expect(monthlySummary(db, '2025-01').uncategorised).toEqual({
      count: 2,
      amountCents: -20000,
    });
  });

  it('les fait figurer dans la répartition des dépenses', () => {
    addTransaction('2025-01-10', -12000, 'Achat non classé');
    const breakdown = monthlySummary(db, '2025-01').expenseBreakdown;
    expect(breakdown).toEqual([
      { categoryId: null, name: 'Non catégorisé', amountCents: 12000, share: 1 },
    ]);
  });
});

describe('écriture découpée', () => {
  it('la compte dans chacune de ses catégories, et une seule fois au total', () => {
    const transaction = addTransaction('2025-01-08', -12995, 'Achat en ligne Digitec');
    expect(
      replaceSplits(db, transaction, [
        { categoryId: categoryId('Électronique'), amountCents: -9995, owner: null, note: null },
        { categoryId: categoryId('Équipement du ménage'), amountCents: -3000, owner: null, note: null },
      ]),
    ).toMatchObject({ kind: 'enregistre', count: 2 });

    const summary = monthlySummary(db, '2025-01');
    expect(summary.totals.expenseCents).toBe(12995);
    expect(lineOf(summary, 'Électronique')?.actualCents).toBe(9995);
    expect(lineOf(summary, 'Équipement du ménage')?.actualCents).toBe(3000);
    expect(lineOf(summary, 'Shopping')?.actualCents).toBe(12995);
    expect(summary.uncategorised.count).toBe(0);
  });
});

describe('transferts internes', () => {
  it('les exclut des revenus comme des dépenses une fois confirmés', () => {
    const epargne = Number(
      db.prepare("INSERT INTO accounts (account_key, label) VALUES ('CH2', 'Épargne')").run()
        .lastInsertRowid,
    );
    addTransaction('2025-01-06', 625000, 'Salaire janvier', 'Salaire');
    addTransaction('2025-01-20', -200000, 'Virement épargne');
    addTransaction('2025-01-20', 200000, 'Versement reçu', undefined, epargne);

    const before = monthlySummary(db, '2025-01').totals;
    expect(before).toMatchObject({ incomeCents: 825000, expenseCents: 200000 });

    const pair = detectTransfers(db)[0]!;
    confirmTransfer(db, pair.id);

    expect(monthlySummary(db, '2025-01').totals).toMatchObject({
      incomeCents: 625000,
      expenseCents: 0,
    });
  });
});

describe('budget contre réel', () => {
  it('utilise le budget mensuel par défaut', () => {
    addTransaction('2025-01-08', -45000, 'Courses', 'Courses');
    setBudget('Courses', 60000);

    expect(lineOf(monthlySummary(db, '2025-01'), 'Courses')).toMatchObject({
      actualCents: 45000,
      budgetCents: 60000,
      gapCents: 15000,
    });
  });

  it('laisse la dérogation du mois l’emporter sur le défaut', () => {
    addTransaction('2025-01-08', -45000, 'Courses', 'Courses');
    setBudget('Courses', 60000);
    setBudget('Courses', 90000, '2025-01');

    expect(lineOf(monthlySummary(db, '2025-01'), 'Courses')?.budgetCents).toBe(90000);
    expect(lineOf(monthlySummary(db, '2025-02'), 'Courses')?.budgetCents).toBe(60000);
  });

  it('signale le dépassement par un écart négatif', () => {
    addTransaction('2025-01-08', -75000, 'Courses', 'Courses');
    setBudget('Courses', 60000);

    const line = lineOf(monthlySummary(db, '2025-01'), 'Courses');
    expect(line?.gapCents).toBe(-15000);
    expect(line?.ratio).toBeCloseTo(1.25, 10);
  });

  it('agrège les sous-catégories sur leur racine', () => {
    addTransaction('2025-01-08', -45000, 'Courses', 'Courses');
    addTransaction('2025-01-09', -6000, 'Restaurant', 'Restaurants & take-away');
    setBudget('Courses', 60000);
    setBudget('Restaurants & take-away', 20000);

    expect(lineOf(monthlySummary(db, '2025-01'), 'Alimentation')).toMatchObject({
      actualCents: 51000,
      budgetCents: 80000,
    });
  });

  it('n’affiche que les catégories mouvementées ou budgétées', () => {
    addTransaction('2025-01-08', -45000, 'Courses', 'Courses');
    const summary = monthlySummary(db, '2025-01');
    expect(lineOf(summary, 'Courses')).toBeDefined();
    expect(lineOf(summary, 'Alimentation')).toBeDefined();
    expect(lineOf(summary, 'Voyages')).toBeUndefined();
  });
});

describe('répartition et plus grosses dépenses', () => {
  beforeEach(() => {
    addTransaction('2025-01-03', -189000, 'Loyer janvier', 'Loyer');
    addTransaction('2025-01-08', -45000, 'Courses', 'Courses');
    addTransaction('2025-01-09', -6000, 'Restaurant', 'Restaurants & take-away');
    addTransaction('2025-01-06', 625000, 'Salaire', 'Salaire');
  });

  it('répartit les dépenses par catégorie racine, de la plus lourde à la plus légère', () => {
    const breakdown = monthlySummary(db, '2025-01').expenseBreakdown;
    expect(breakdown.map((entry) => entry.name)).toEqual(['Logement', 'Alimentation']);
    expect(breakdown[0]).toMatchObject({ amountCents: 189000 });
    expect(breakdown[1]).toMatchObject({ amountCents: 51000 });
    expect(breakdown.reduce((sum, entry) => sum + entry.share, 0)).toBeCloseTo(1, 10);
  });

  it('classe les plus grosses dépenses sans y mêler les revenus', () => {
    const top = monthlySummary(db, '2025-01').topExpenses;
    expect(top.map((entry) => entry.amountCents)).toEqual([-189000, -45000, -6000]);
    expect(top[0]).toMatchObject({ label: 'Loyer janvier', categoryName: 'Loyer' });
  });
});

describe('mois disponibles', () => {
  it('rend les mois mouvementés, du plus récent au plus ancien', () => {
    addTransaction('2025-01-08', -45000, 'Courses', 'Courses');
    addTransaction('2024-12-08', -45000, 'Courses', 'Courses');
    addTransaction('2025-03-08', -45000, 'Courses', 'Courses');

    expect(availableMonths(db)).toEqual(['2025-03', '2025-01', '2024-12']);
  });
});
