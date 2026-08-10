import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseCsv } from './parse.js';
import type { CsvOutcome, ParseResult } from '../types.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'fixtures');

function load(name: string): Uint8Array {
  return readFileSync(join(fixtures, name));
}

function analysed(outcome: CsvOutcome): ParseResult {
  if (outcome.kind !== 'analyse') {
    throw new Error(`Mapping requis alors qu'une analyse était attendue : ${outcome.missing.join(', ')}`);
  }
  return outcome.result;
}

describe('export UBS français, point-virgule, UTF-8 avec BOM', () => {
  const result = analysed(parseCsv(load('ubs-fr-point-virgule.csv')));
  const statement = result.statements[0]!;

  it('reconnaît encodage, séparateur et ligne d’en-tête sous le préambule', () => {
    expect(result.csv).toMatchObject({
      encoding: 'utf-8-bom',
      delimiter: ';',
      headerLine: 5,
      reversed: false,
    });
  });

  it('associe les colonnes sans intervention', () => {
    expect(result.csv?.mapping).toMatchObject({
      valueDate: 0,
      bookingDate: 1,
      label: 2,
      labelExtra: [3],
      debit: 4,
      credit: 5,
      balance: 6,
    });
  });

  it('retrouve l’IBAN dans le préambule', () => {
    expect(statement.accountKey).toBe('CH9300762011623852957');
  });

  it('lit les huit écritures, débits en négatif', () => {
    expect(statement.transactions).toHaveLength(8);
    expect(result.rowsRead).toBe(8);
    expect(statement.transactions.map((t) => t.amountCents)).toEqual([
      -4560, -189000, 625000, -12995, -450, -450, -1250, -74280,
    ]);
  });

  it('concatène les colonnes de description et conserve les accents', () => {
    expect(statement.transactions[0]!.label).toBe('Paiement carte COOP PRONTO GENÈVE');
    expect(statement.transactions[3]!.label).toBe('Achat en ligne Digitec Galaxus, Zürich');
  });

  it('distingue date de valeur et date comptable', () => {
    expect(statement.transactions[7]).toMatchObject({
      valueDate: '2025-01-20',
      bookingDate: '2025-01-21',
    });
    expect(statement.transactions[0]!.bookingDate).toBeNull();
  });

  it('déduit les soldes d’ouverture et de clôture de la colonne solde', () => {
    expect(statement.openingBalanceCents).toBe(1245000);
    expect(statement.closingBalanceCents).toBe(1587015);
  });

  it('boucle le rapprochement : ouverture + mouvements = clôture', () => {
    const movements = statement.transactions.reduce((total, t) => total + t.amountCents, 0);
    expect(statement.openingBalanceCents! + movements).toBe(statement.closingBalanceCents);
  });

  it('signale le pied de tableau et le crédit négatif, sans erreur de lecture', () => {
    expect(result.issues.filter((i) => i.severity === 'erreur')).toHaveLength(0);
    const warnings = result.issues.map((i) => i.message);
    expect(warnings.some((m) => m.includes('une seule cellule'))).toBe(true);
    expect(warnings.some((m) => m.includes('extourne'))).toBe(true);
  });

  it('conserve les deux achats identiques du même jour', () => {
    const coop = statement.transactions.filter((t) => t.label.includes('COOP PRONTO'));
    expect(coop).toHaveLength(3);
    expect(coop.filter((t) => t.amountCents === -450)).toHaveLength(2);
  });
});

describe('export UBS allemand, virgule, Windows-1252', () => {
  const result = analysed(parseCsv(load('ubs-de-virgule-1252.csv')));
  const statement = result.statements[0]!;

  it('retombe sur Windows-1252 quand l’UTF-8 strict échoue', () => {
    expect(result.csv?.encoding).toBe('windows-1252');
    expect(result.csv?.delimiter).toBe(',');
  });

  it('restitue les caractères accentués et les trémas', () => {
    expect(statement.transactions[0]!.label).toBe('Kartenzahlung Café Größe Zürich');
    expect(statement.transactions[1]!.label).toContain('Genève');
  });

  it('reconnaît les en-têtes allemands', () => {
    expect(result.csv?.mapping).toMatchObject({
      bookingDate: 0,
      valueDate: 1,
      label: 2,
      debit: 3,
      credit: 4,
      balance: 5,
      currency: 6,
    });
    expect(statement.transactions.map((t) => t.amountCents)).toEqual([-2550, 120000, -8900]);
  });

  it('ne trouve pas de compte quand le fichier n’en porte pas', () => {
    expect(statement.accountKey).toBeNull();
  });
});

describe('export tabulé UTF-16LE, colonne de montant signée', () => {
  const result = analysed(parseCsv(load('ubs-tab-utf16.csv')));
  const statement = result.statements[0]!;

  it('décode l’UTF-16LE et détecte la tabulation', () => {
    expect(result.csv?.encoding).toBe('utf-16le');
    expect(result.csv?.delimiter).toBe('\t');
  });

  it('lit une colonne de montant unique, apostrophes et espaces compris', () => {
    expect(statement.transactions.map((t) => t.amountCents)).toEqual([-20000, 125035, -18500]);
  });

  it('marque le rapprochement absent faute de colonne de solde', () => {
    expect(statement.openingBalanceCents).toBeNull();
    expect(statement.closingBalanceCents).toBeNull();
  });
});

describe('format non reconnu', () => {
  const outcome = parseCsv(load('format-inconnu.csv'));

  it('demande un mapping manuel plutôt que de deviner', () => {
    expect(outcome.kind).toBe('mapping-requis');
    if (outcome.kind !== 'mapping-requis') return;
    expect(outcome.missing.length).toBeGreaterThan(0);
    expect(outcome.headers).toEqual(['Colonne A', 'Colonne B', 'Colonne C', 'Colonne D']);
  });

  it('fournit des échantillons de chaque colonne pour guider le mapping', () => {
    if (outcome.kind !== 'mapping-requis') return;
    expect(outcome.columns[0]!.samples).toEqual(['20250405', '20250406']);
  });

  it('lit le fichier une fois le mapping fourni', () => {
    const result = analysed(
      parseCsv(load('format-inconnu.csv'), {
        mapping: { valueDate: 0, label: 1, amount: 2 },
        headerLine: 0,
        delimiter: '|',
      }),
    );
    const transactions = result.statements[0]!.transactions;
    expect(transactions).toHaveLength(2);
    expect(transactions[0]).toMatchObject({
      valueDate: '2025-04-05',
      label: 'VIREMENT SEPA 001',
      amountCents: -4560,
    });
    expect(result.issues.filter((i) => i.severity === 'erreur')).toHaveLength(0);
  });
});

describe('contrôle du solde glissant', () => {
  it('désigne la ligne dont le solde ne suit pas', () => {
    const result = analysed(parseCsv(load('ubs-solde-rompu.csv')));
    const breaks = result.issues.filter((i) => i.message.includes('Solde incohérent'));
    expect(breaks).toHaveLength(1);
    expect(breaks[0]!.lineNumber).toBe(4);
  });

  it('remet un export décroissant dans l’ordre chronologique', () => {
    const result = analysed(parseCsv(load('ubs-ordre-decroissant.csv')));
    const statement = result.statements[0]!;
    expect(result.csv?.reversed).toBe(true);
    expect(statement.transactions.map((t) => t.valueDate)).toEqual([
      '2025-01-02',
      '2025-01-03',
      '2025-01-06',
      '2025-01-08',
    ]);
    expect(result.issues.filter((i) => i.message.includes('Solde incohérent'))).toHaveLength(0);
    expect(statement.openingBalanceCents).toBe(1245000);
    expect(statement.closingBalanceCents).toBe(1663445);
  });
});
