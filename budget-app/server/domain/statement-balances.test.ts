import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it } from 'vitest';

import { openDatabase } from '../db/connection.js';
import type { Db } from '../db/connection.js';
import { prepareImport, validateBatch } from '../import/pipeline.js';
import { missingBalanceReason, setStatementBalances, suggestedOpening } from './statement-balances.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures');

let db: Db;
let batchId: number;

beforeEach(() => {
  db = openDatabase(':memory:');
  const outcome = prepareImport(db, readFileSync(join(fixtures, 'ubs-export-multi-comptes.csv')), {
    filename: 'ubs-export-multi-comptes.csv',
  });
  if (outcome.kind !== 'pret') throw new Error(`Import non abouti : ${outcome.kind}`);
  batchId = outcome.batchId;
});

interface StatementRow {
  id: number;
  movements_cents: number;
  gap_cents: number | null;
  status: string;
  balance_source: string;
  opening_balance_cents: number | null;
  closing_balance_cents: number | null;
}

function statements(): StatementRow[] {
  return db
    .prepare('SELECT * FROM import_statements WHERE batch_id = ? ORDER BY sort_index')
    .all(batchId) as StatementRow[];
}

describe('relevé sans solde dans le fichier', () => {
  it('reste « absent » et le dit', () => {
    const statement = statements()[0]!;
    expect(statement.status).toBe('absent');
    expect(statement.balance_source).toBe('fichier');
    expect(missingBalanceReason(statement)).toContain('Sans solde à rapprocher');
  });

  it('n’est pas bloquant en soi, mais figure dans les avis du lot', () => {
    const outcome = validateBatch(db, batchId);
    expect(outcome.kind).toBe('valide');
  });
});

describe('saisie des deux soldes', () => {
  it('exécute le contrôle et le fait tomber juste', () => {
    const statement = statements()[0]!;
    const outcome = setStatementBalances(db, statement.id, {
      openingCents: 1000000,
      closingCents: 1000000 + statement.movements_cents,
    });
    expect(outcome).toEqual({ kind: 'enregistre', status: 'ok', gapCents: 0 });
    expect(statements()[0]!.balance_source).toBe('saisi');
  });

  it('bloque la validation quand le compte ne tombe pas', () => {
    const statement = statements()[0]!;
    setStatementBalances(db, statement.id, {
      openingCents: 1000000,
      closingCents: 1000000 + statement.movements_cents + 5000,
    });

    const outcome = validateBatch(db, batchId);
    expect(outcome.kind).toBe('bloque');
    if (outcome.kind !== 'bloque') return;
    expect(outcome.reasons[0]).toContain('50.00');
  });

  it('laisse le forçage possible, en le traçant', () => {
    const statement = statements()[0]!;
    setStatementBalances(db, statement.id, {
      openingCents: 0,
      closingCents: statement.movements_cents + 1,
    });

    expect(validateBatch(db, batchId, true).kind).toBe('valide');
    const batch = db.prepare('SELECT forced, reconciliation_gap_cents AS gap FROM import_batches WHERE id = ?').get(batchId) as {
      forced: number;
      gap: number;
    };
    expect(batch.forced).toBe(1);
    expect(batch.gap).toBe(1);
  });
});

describe('un seul des deux soldes', () => {
  it('ne déclenche pas le contrôle et annonce ce qui manque', () => {
    const statement = statements()[0]!;
    const outcome = setStatementBalances(db, statement.id, {
      openingCents: 1000000,
      closingCents: null,
    });
    expect(outcome).toEqual({ kind: 'enregistre', status: 'absent', gapCents: null });
    expect(missingBalanceReason(statements()[0]!)).toContain('solde de clôture manque');
  });
});

describe('solde à nouveau', () => {
  it('ne propose rien à la première importation d’un compte', () => {
    expect(suggestedOpening(db, statements()[0]!.id)).toBeNull();
  });

  it('reprend la clôture du relevé précédent du même compte', () => {
    const first = statements()[0]!;
    setStatementBalances(db, first.id, {
      openingCents: 1000000,
      closingCents: 1000000 + first.movements_cents,
    });
    validateBatch(db, batchId, true);

    // Un second lot, sur une période postérieure : l'ouverture se reporte.
    const second = prepareImport(db, Buffer.from(laterStatement(), 'utf8'), {
      filename: 'suite.csv',
    });
    if (second.kind !== 'pret') throw new Error('second import non abouti');
    const statement = db
      .prepare('SELECT id FROM import_statements WHERE batch_id = ?')
      .get(second.batchId) as { id: number };

    expect(suggestedOpening(db, statement.id)).toBe(1000000 + first.movements_cents);
  });

  it('ne reporte pas une clôture datée dans la période du nouveau relevé', () => {
    const first = statements()[0]!;
    setStatementBalances(db, first.id, {
      openingCents: 1000000,
      closingCents: 1000000 + first.movements_cents,
    });
    validateBatch(db, batchId, true);

    // Ce relevé couvre mars, comme le précédent : sa clôture décrit un état que
    // les mouvements du nouveau relevé ont déjà produit en partie.
    const overlapping = prepareImport(db, Buffer.from(overlappingStatement(), 'utf8'), {
      filename: 'chevauchement.csv',
    });
    if (overlapping.kind !== 'pret') throw new Error('import non abouti');
    const statement = db
      .prepare('SELECT id FROM import_statements WHERE batch_id = ?')
      .get(overlapping.batchId) as { id: number };

    expect(suggestedOpening(db, statement.id)).toBeNull();
  });
});

const HEADER =
  '"Date de transaction","Numéro de compte ou de carte","Description","Revenu ou dépense","Montant","Monnaie","Catégorie"\r\n';

function laterStatement(): string {
  return (
    HEADER +
    '"12.04.2026","CH56 0483 5012 3456 7800 9","LOYER MAI","Dépense","-1\'890.00","CHF","Ménage"\r\n'
  );
}

function overlappingStatement(): string {
  return (
    HEADER +
    '"10.03.2026","CH56 0483 5012 3456 7800 9","ACHAT DIVERS","Dépense","-25.00","CHF","Achats"\r\n'
  );
}
