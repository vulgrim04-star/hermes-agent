import { beforeEach, describe, expect, it } from 'vitest';

import { openDatabase } from '../db/connection.js';
import type { Db } from '../db/connection.js';
import { normalizeLabel } from './fingerprint.js';
import {
  bankBalanceAt,
  clearValuation,
  netWorthAt,
  netWorthSeries,
  positionsAt,
  setValuation,
  valueFromQuantity,
} from './networth.js';
import { pillar3aStatus, setPillar3aCeiling } from './pillar3a.js';
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

function asset(label: string, extra: Record<string, unknown> = {}): number {
  const columns = { label, kind: 'autre', is_liability: 0, account_id: null, owner: 'commun', ...extra };
  return Number(
    db
      .prepare(
        `INSERT INTO assets (label, kind, is_liability, account_id, owner)
         VALUES (@label, @kind, @is_liability, @account_id, @owner)`,
      )
      .run(columns).lastInsertRowid,
  );
}

function movement(valueDate: string, amountCents: number, category?: string, owner = 'commun'): number {
  sequence += 1;
  return Number(
    db
      .prepare(
        `INSERT INTO transactions
           (account_id, value_date, amount_cents, label, label_normalized, category_id, owner,
            source, fingerprint, soft_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'csv', ?, ?)`,
      )
      .run(
        accountId,
        valueDate,
        amountCents,
        `Mouvement ${sequence}`,
        normalizeLabel(`Mouvement ${sequence}`),
        category === undefined ? null : categoryId(category),
        owner,
        `fp${sequence}`,
        `sk${sequence}`,
      ).lastInsertRowid,
  );
}

/** Un relevé validé, avec son solde de clôture rapproché. */
function statement(closingDate: string, closingCents: number): void {
  const batchId = Number(
    db
      .prepare(
        `INSERT INTO import_batches (filename, format, file_sha256, file_size, status)
         VALUES ('releve.csv', 'csv', 'sha', 1, 'valide')`,
      )
      .run().lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO import_statements
       (batch_id, account_id, closing_balance_cents, closing_date, status)
     VALUES (?, ?, ?, ?, 'ok')`,
  ).run(batchId, accountId, closingCents, closingDate);
}

describe('valorisation en quantité et cours', () => {
  it('calcule en arithmétique entière, sans flottant', () => {
    // 0,5 BTC à 58'432.15 → 29'216.075 → arrondi au centime.
    expect(valueFromQuantity(50_000_000, 5_843_215)).toBe(2_921_608);
  });

  it('tient la précision du satoshi', () => {
    // 0,42815 BTC à 58'432.15 CHF.
    expect(valueFromQuantity(42_815_000, 5_843_215)).toBe(2_501_773);
  });

  it('enregistre la valeur calculée à partir de la quantité', () => {
    const id = asset('Bitcoin', { kind: 'crypto', tracks_quantity: 1 });
    const outcome = setValuation(db, {
      assetId: id,
      period: '2026-03',
      quantityE8: 42_815_000,
      unitPriceCents: 5_843_215,
    });
    expect(outcome).toEqual({ kind: 'enregistre', valueCents: 2_501_773 });

    const position = positionsAt(db, '2026-03').find((entry) => entry.assetId === id);
    expect(position?.valueCents).toBe(2_501_773);
    expect(position?.quantityE8).toBe(42_815_000);
  });

  it('refuse un mois mal formé', () => {
    const id = asset('ETF');
    expect(setValuation(db, { assetId: id, period: '2026-13', valueCents: 100 })).toEqual({
      kind: 'mois-invalide',
    });
  });
});

describe('solde bancaire déduit des relevés', () => {
  beforeEach(() => {
    statement('2026-03-31', 1_000_000);
  });

  it('reprend le solde de clôture du relevé', () => {
    expect(bankBalanceAt(db, accountId, '2026-03')).toBe(1_000_000);
  });

  it('y ajoute les mouvements postérieurs', () => {
    movement('2026-04-10', -150_000);
    movement('2026-04-25', 600_000);
    expect(bankBalanceAt(db, accountId, '2026-04')).toBe(1_450_000);
  });

  it('remonte le temps depuis un relevé postérieur', () => {
    // Février précède le seul relevé soldé : sans marche arrière, le compte
    // afficherait zéro, ce qui n'est pas « rien » mais « inconnu ».
    movement('2026-03-15', -200_000);
    expect(bankBalanceAt(db, accountId, '2026-02')).toBe(1_200_000);
  });

  it('ne rend rien quand le compte n’a aucun relevé soldé', () => {
    const other = Number(
      db.prepare("INSERT INTO accounts (account_key, label) VALUES ('CH2', 'Épargne')").run()
        .lastInsertRowid,
    );
    expect(bankBalanceAt(db, other, '2026-03')).toBeNull();
  });

  it('alimente la position rattachée au compte', () => {
    const id = asset('Compte courant', { kind: 'compte', account_id: accountId });
    const position = positionsAt(db, '2026-03').find((entry) => entry.assetId === id);
    expect(position).toMatchObject({ valueCents: 1_000_000, origin: 'releve' });
  });

  it('laisse une saisie manuelle l’emporter sur le relevé', () => {
    const id = asset('Compte courant', { kind: 'compte', account_id: accountId });
    setValuation(db, { assetId: id, period: '2026-03', valueCents: 999_999 });
    const position = positionsAt(db, '2026-03').find((entry) => entry.assetId === id);
    expect(position).toMatchObject({ valueCents: 999_999, origin: 'saisi' });
  });
});

describe('report d’un mois non saisi', () => {
  it('reporte la dernière valeur connue, en le signalant', () => {
    const id = asset('ETF', { kind: 'titres' });
    setValuation(db, { assetId: id, period: '2026-01', valueCents: 5_000_000 });

    const position = positionsAt(db, '2026-05').find((entry) => entry.assetId === id);
    expect(position).toMatchObject({
      valueCents: 5_000_000,
      origin: 'report',
      reportedFrom: '2026-01',
    });
  });

  it('ne reporte pas une valeur postérieure au mois demandé', () => {
    const id = asset('ETF', { kind: 'titres' });
    setValuation(db, { assetId: id, period: '2026-05', valueCents: 5_000_000 });
    const position = positionsAt(db, '2026-01').find((entry) => entry.assetId === id);
    expect(position).toMatchObject({ valueCents: null, origin: 'inconnu' });
  });

  it('rend la main au report quand la saisie du mois est effacée', () => {
    const id = asset('ETF', { kind: 'titres' });
    setValuation(db, { assetId: id, period: '2026-01', valueCents: 5_000_000 });
    setValuation(db, { assetId: id, period: '2026-02', valueCents: 5_200_000 });

    expect(clearValuation(db, id, '2026-02')).toBe(true);
    const position = positionsAt(db, '2026-02').find((entry) => entry.assetId === id);
    expect(position).toMatchObject({ valueCents: 5_000_000, origin: 'report' });
  });
});

describe('patrimoine net', () => {
  it('soustrait les dettes des actifs', () => {
    const etf = asset('ETF', { kind: 'titres' });
    const dette = asset('Prêt véhicule', { kind: 'dette', is_liability: 1 });
    setValuation(db, { assetId: etf, period: '2026-03', valueCents: 5_000_000 });
    setValuation(db, { assetId: dette, period: '2026-03', valueCents: 1_200_000 });

    expect(netWorthAt(db, '2026-03')).toMatchObject({
      assetsCents: 5_000_000,
      liabilitiesCents: 1_200_000,
      netCents: 3_800_000,
    });
  });

  it('compte les positions reportées et les inconnues', () => {
    const etf = asset('ETF', { kind: 'titres' });
    asset('Immeuble', { kind: 'immobilier' });
    setValuation(db, { assetId: etf, period: '2026-01', valueCents: 5_000_000 });

    expect(netWorthAt(db, '2026-03')).toMatchObject({ carriedCount: 1, unknownCount: 1 });
  });

  it('rend une série mensuelle continue, report compris', () => {
    const etf = asset('ETF', { kind: 'titres' });
    setValuation(db, { assetId: etf, period: '2026-01', valueCents: 1_000_000 });
    setValuation(db, { assetId: etf, period: '2026-03', valueCents: 1_500_000 });

    const series = netWorthSeries(db, '2026-01', '2026-04');
    expect(series.map((point) => point.netCents)).toEqual([1_000_000, 1_000_000, 1_500_000, 1_500_000]);
    expect(series[1]!.carriedCount).toBe(1);
  });

  it('enjambe correctement le changement d’année', () => {
    const series = netWorthSeries(db, '2025-11', '2026-02');
    expect(series.map((point) => point.period)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });

  it('rend une série vide sur une plage inversée', () => {
    expect(netWorthSeries(db, '2026-05', '2026-01')).toEqual([]);
  });
});

describe('Pilier 3a', () => {
  beforeEach(() => {
    movement('2026-02-15', -350_000, 'Pilier 3a', 'p1');
    movement('2026-06-15', -200_000, 'Pilier 3a', 'p2');
  });

  it('réclame le plafond de l’année tant qu’il n’est pas renseigné', () => {
    const status = pillar3aStatus(db, 2026, new Date('2026-08-10T00:00:00Z'));
    expect(status.ceilingCents).toBeNull();
    expect(status.message).toContain('plafond 3a 2026');
    expect(status.perPerson.every((person) => person.remainingCents === null)).toBe(true);
  });

  it('livre 2025 pré-rempli', () => {
    expect(pillar3aStatus(db, 2025).ceilingCents).toBe(725_800);
  });

  it('chiffre le reste à verser par personne', () => {
    setPillar3aCeiling(db, 2026, 725_800);
    const status = pillar3aStatus(db, 2026, new Date('2026-08-10T00:00:00Z'));

    const moi = status.perPerson.find((person) => person.owner === 'p1');
    const conjoint = status.perPerson.find((person) => person.owner === 'p2');
    expect(moi).toMatchObject({ paidCents: 350_000, remainingCents: 375_800 });
    expect(conjoint).toMatchObject({ paidCents: 200_000, remainingCents: 525_800 });
    expect(status.paidCents).toBe(550_000);
  });

  it('ne descend pas sous zéro quand le plafond est dépassé', () => {
    setPillar3aCeiling(db, 2026, 300_000);
    const moi = pillar3aStatus(db, 2026).perPerson.find((person) => person.owner === 'p1');
    expect(moi?.remainingCents).toBe(0);
  });

  it('ne retient que les versements de l’année demandée', () => {
    movement('2025-02-15', -700_000, 'Pilier 3a', 'p1');
    expect(pillar3aStatus(db, 2026).paidCents).toBe(550_000);
  });

  it('compte la part 3a d’une écriture ventilée', () => {
    const id = movement('2026-09-01', -500_000, undefined, 'p1');
    replaceSplits(db, id, [
      { categoryId: categoryId('Pilier 3a'), amountCents: -300_000, owner: 'p1', note: null },
      { categoryId: categoryId('ETF'), amountCents: -200_000, owner: 'p1', note: null },
    ]);
    expect(pillar3aStatus(db, 2026).paidCents).toBe(850_000);
  });

  it('compte les jours restants avant le 31 décembre', () => {
    expect(pillar3aStatus(db, 2026, new Date('2026-12-01T00:00:00Z')).daysLeft).toBe(30);
    expect(pillar3aStatus(db, 2026, new Date('2027-01-05T00:00:00Z')).daysLeft).toBe(0);
  });
});
