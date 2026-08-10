import { beforeEach, describe, expect, it } from 'vitest';

import { openDatabase } from '../db/connection.js';
import type { Db } from '../db/connection.js';
import { normalizeLabel } from './fingerprint.js';
import { confirmTransfer, detectTransfers, pendingTransfers, rejectTransfer } from './transfers.js';

let db: Db;
let courant: number;
let epargne: number;
let sequence = 0;

beforeEach(() => {
  db = openDatabase(':memory:');
  sequence = 0;
  courant = addAccount('CH93 0076 2011 6238 5295 7', 'Compte courant');
  epargne = addAccount('CH56 0483 5012 3456 7800 9', 'Compte épargne');
});

function addAccount(key: string, label: string): number {
  return Number(
    db
      .prepare('INSERT INTO accounts (account_key, label) VALUES (?, ?)')
      .run(key.replace(/\s/g, ''), label).lastInsertRowid,
  );
}

function addTransaction(accountId: number, valueDate: string, amountCents: number, label: string): number {
  sequence += 1;
  return Number(
    db
      .prepare(
        `INSERT INTO transactions
           (account_id, value_date, amount_cents, label, label_normalized, source, fingerprint, soft_key)
         VALUES (?, ?, ?, ?, ?, 'manuel', ?, ?)`,
      )
      .run(accountId, valueDate, amountCents, label, normalizeLabel(label), `fp${sequence}`, `sk${sequence}`)
      .lastInsertRowid,
  );
}

function isTransfer(id: number): number {
  return (
    db.prepare('SELECT is_internal_transfer FROM transactions WHERE id = ?').get(id) as {
      is_internal_transfer: number;
    }
  ).is_internal_transfer;
}

describe('détection', () => {
  it('apparie un débit et le crédit correspondant sur un autre compte', () => {
    addTransaction(courant, '2025-01-05', -100000, "Virement d'épargne");
    addTransaction(epargne, '2025-01-06', 100000, 'Versement reçu');

    const pairs = detectTransfers(db);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ day_gap: 1, status: 'propose' });
  });

  it('n’apparie pas deux mouvements du même compte', () => {
    addTransaction(courant, '2025-01-05', -100000, 'Retrait');
    addTransaction(courant, '2025-01-06', 100000, 'Dépôt');

    expect(detectTransfers(db)).toEqual([]);
  });

  it('respecte la fenêtre de jours', () => {
    addTransaction(courant, '2025-01-01', -50000, "Virement d'épargne");
    addTransaction(epargne, '2025-01-20', 50000, 'Versement reçu');

    expect(detectTransfers(db)).toEqual([]);
  });

  it('suit la fenêtre configurée dans les réglages', () => {
    db.prepare("UPDATE settings SET value = '30' WHERE key = 'transfer_max_days'").run();
    addTransaction(courant, '2025-01-01', -50000, "Virement d'épargne");
    addTransaction(epargne, '2025-01-20', 50000, 'Versement reçu');

    expect(detectTransfers(db)).toHaveLength(1);
  });

  it('n’apparie pas des montants différents', () => {
    addTransaction(courant, '2025-01-05', -100000, "Virement d'épargne");
    addTransaction(epargne, '2025-01-06', 99000, 'Versement reçu');

    expect(detectTransfers(db)).toEqual([]);
  });

  it('retient la contrepartie la plus proche en date', () => {
    const out = addTransaction(courant, '2025-01-05', -100000, "Virement d'épargne");
    const loin = addTransaction(epargne, '2025-01-09', 100000, 'Versement du 9');
    const proche = addTransaction(epargne, '2025-01-05', 100000, 'Versement du 5');

    const pairs = detectTransfers(db);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ out_transaction_id: out, in_transaction_id: proche });
    expect(pairs[0]!.in_transaction_id).not.toBe(loin);
  });

  it('apparie deux virements distincts sans les mélanger', () => {
    addTransaction(courant, '2025-01-05', -100000, 'Virement 1');
    addTransaction(epargne, '2025-01-05', 100000, 'Réception 1');
    addTransaction(courant, '2025-02-05', -100000, 'Virement 2');
    addTransaction(epargne, '2025-02-05', 100000, 'Réception 2');

    const pairs = detectTransfers(db);
    expect(pairs).toHaveLength(2);
    const engaged = pairs.flatMap((pair) => [pair.out_transaction_id, pair.in_transaction_id]);
    expect(new Set(engaged).size).toBe(4);
  });

  it('ne repropose pas une paire déjà soumise', () => {
    addTransaction(courant, '2025-01-05', -100000, "Virement d'épargne");
    addTransaction(epargne, '2025-01-06', 100000, 'Versement reçu');

    expect(detectTransfers(db)).toHaveLength(1);
    expect(detectTransfers(db)).toEqual([]);
  });
});

describe('arbitrage', () => {
  function proposePair(): number {
    addTransaction(courant, '2025-01-05', -100000, "Virement d'épargne");
    addTransaction(epargne, '2025-01-06', 100000, 'Versement reçu');
    return detectTransfers(db)[0]!.id;
  }

  it('sort les deux écritures des totaux à la confirmation', () => {
    const pairId = proposePair();
    const pair = db.prepare('SELECT * FROM internal_transfers WHERE id = ?').get(pairId) as {
      out_transaction_id: number;
      in_transaction_id: number;
    };

    expect(confirmTransfer(db, pairId)).toBe(true);
    expect(isTransfer(pair.out_transaction_id)).toBe(1);
    expect(isTransfer(pair.in_transaction_id)).toBe(1);
    expect(pendingTransfers(db)).toEqual([]);
  });

  it('ne repropose pas une paire rejetée', () => {
    const pairId = proposePair();
    expect(rejectTransfer(db, pairId)).toBe(true);
    expect(detectTransfers(db)).toEqual([]);
    expect(pendingTransfers(db)).toEqual([]);
  });

  it('rend les écritures aux totaux si la confirmation est annulée', () => {
    const pairId = proposePair();
    const pair = db.prepare('SELECT * FROM internal_transfers WHERE id = ?').get(pairId) as {
      out_transaction_id: number;
    };

    confirmTransfer(db, pairId);
    rejectTransfer(db, pairId);
    expect(isTransfer(pair.out_transaction_id)).toBe(0);
  });

  it('n’apparie pas une écriture déjà engagée dans une paire confirmée', () => {
    const pairId = proposePair();
    confirmTransfer(db, pairId);

    // Un troisième mouvement du même montant arrive sur un autre compte.
    const troisieme = addAccount('CH76 0900 0000 1234 5678 9', 'Compte tiers');
    addTransaction(troisieme, '2025-01-06', 100000, 'Autre versement');

    expect(detectTransfers(db)).toEqual([]);
  });

  it('affiche les deux côtés de la paire proposée', () => {
    proposePair();
    expect(pendingTransfers(db)[0]).toMatchObject({
      out_account: 'Compte courant',
      in_account: 'Compte épargne',
      out_amount: -100000,
      in_amount: 100000,
      day_gap: 1,
    });
  });
});
