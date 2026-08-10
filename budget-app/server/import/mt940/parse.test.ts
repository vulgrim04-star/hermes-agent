import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseMt940 } from './parse.js';
import { parseEntryLine, parseNarrative } from './fields.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'fixtures');

function load(name: string): Uint8Array {
  return readFileSync(join(fixtures, name));
}

/** Le contrôle que l'on exige d'un relevé : ouverture + mouvements = clôture. */
function reconciliationGap(statement: {
  openingBalanceCents: number | null;
  closingBalanceCents: number | null;
  transactions: { amountCents: number }[];
}): number | null {
  if (statement.openingBalanceCents === null || statement.closingBalanceCents === null) return null;
  const movements = statement.transactions.reduce((total, t) => total + t.amountCents, 0);
  return statement.closingBalanceCents - (statement.openingBalanceCents + movements);
}

describe('relevé MT940 simple', () => {
  const result = parseMt940(load('mt940-simple.sta'));
  const statement = result.statements[0]!;

  it('lit un seul relevé et ses sept opérations', () => {
    expect(result.statements).toHaveLength(1);
    expect(result.rowsRead).toBe(7);
    expect(statement.transactions).toHaveLength(7);
  });

  it('extrait référence, compte, devise et soldes', () => {
    expect(statement).toMatchObject({
      statementReference: 'REL-2025-01',
      accountKey: 'CH9300762011623852957',
      currency: 'CHF',
      openingBalanceCents: 1245000,
      closingBalanceCents: 1600010,
      openingDate: '2025-01-01',
      closingDate: '2025-01-31',
    });
  });

  it('boucle le rapprochement au centime', () => {
    expect(reconciliationGap(statement)).toBe(0);
  });

  it('donne le bon sens à chaque mouvement, extourne comprise', () => {
    expect(statement.transactions.map((t) => t.amountCents)).toEqual([
      -4560, -189000, 625000, -450, -450, -1250, -74280,
    ]);
  });

  it('rattache le libellé multi-lignes à l’opération qui le précède', () => {
    expect(statement.transactions[0]!.label).toBe(
      'PAIEMENT CARTE COOP PRONTO GENEVE CARTE 1234 DU 02.01.2025',
    );
    expect(statement.transactions[2]!.label).toBe('VIREMENT SALAIRE JANVIER EMPLOYEUR SA');
  });

  it('sépare date de valeur et date comptable', () => {
    expect(statement.transactions[6]).toMatchObject({
      valueDate: '2025-01-20',
      bookingDate: '2025-01-21',
    });
    expect(statement.transactions[0]!.bookingDate).toBeNull();
  });

  it('conserve la référence bancaire', () => {
    expect(statement.transactions[0]!.bankReference).toBe('BKREF001');
  });

  it('ne signale aucune anomalie', () => {
    expect(result.issues).toEqual([]);
  });
});

describe('fins de ligne', () => {
  it('lit un fichier en CRLF exactement comme en LF', () => {
    const lf = readFileSync(join(fixtures, 'mt940-simple.sta'), 'utf8');
    const crlf = new TextEncoder().encode(lf.replace(/\n/g, '\r\n'));
    expect(parseMt940(crlf)).toEqual(parseMt940(load('mt940-simple.sta')));
  });
});

describe('fichier multi-relevés sous enveloppe SWIFT', () => {
  const result = parseMt940(load('mt940-multi.sta'));

  it('ouvre un relevé à chaque :20:', () => {
    expect(result.statements).toHaveLength(2);
    expect(result.statements.map((s) => s.statementReference)).toEqual([
      'REL-2024-12',
      'REL-2025-01',
    ]);
  });

  it('ignore l’enveloppe {1:}{2:}{4: et le marqueur de fin -}', () => {
    expect(result.issues.filter((i) => i.severity === 'erreur')).toEqual([]);
  });

  it('rapproche chaque relevé séparément', () => {
    expect(result.statements.map(reconciliationGap)).toEqual([0, 0]);
  });

  it('date correctement une écriture comptabilisée l’année précédente', () => {
    expect(result.statements[1]!.transactions[0]).toMatchObject({
      valueDate: '2025-01-02',
      bookingDate: '2024-12-31',
    });
  });

  it('déplie le libellé structuré ?20 / ?32', () => {
    expect(result.statements[1]!.transactions[0]).toMatchObject({
      label: 'REMBOURSEMENT FRAIS DECEMBRE',
      counterparty: 'PARTENAIRE SA',
    });
  });

  it('traite RD comme une extourne de débit, donc une entrée', () => {
    expect(result.statements[1]!.transactions[1]!.amountCents).toBe(5000);
  });
});

describe('relevé dont le solde de clôture ne tombe pas juste', () => {
  const result = parseMt940(load('mt940-solde-faux.sta'));

  it('rend un écart chiffré plutôt qu’un rapprochement supposé', () => {
    expect(reconciliationGap(result.statements[0]!)).toBe(2000);
  });
});

describe('relevé comportant une ligne corrompue', () => {
  const result = parseMt940(load('mt940-ligne-corrompue.sta'));
  const statement = result.statements[0]!;

  it('compte la ligne lue mais ne l’importe pas', () => {
    expect(result.rowsRead).toBe(3);
    expect(statement.transactions).toHaveLength(2);
  });

  it('signale la ligne fautive avec son numéro et son contenu brut', () => {
    const errors = result.issues.filter((i) => i.severity === 'erreur');
    expect(errors).toHaveLength(1);
    expect(errors[0]!.lineNumber).toBe(7);
    expect(errors[0]!.raw).toContain('CETTE LIGNE EST ILLISIBLE');
  });

  it('n’attribue pas le libellé orphelin à l’écriture précédente', () => {
    expect(statement.transactions[0]!.label).toBe('PREMIERE ECRITURE VALIDE');
    expect(statement.transactions.map((t) => t.label)).not.toContain(
      'LIBELLE ORPHELIN RATTACHE A LA PREMIERE',
    );
  });

  it('signale le champ inconnu sans interrompre la lecture', () => {
    expect(result.issues.some((i) => i.message.includes(':99:'))).toBe(true);
    expect(statement.transactions[1]!.label).toBe('DERNIERE ECRITURE VALIDE');
  });
});

describe('analyse d’une ligne :61: isolée', () => {
  it('lit une opération sans date comptable ni référence bancaire', () => {
    expect(parseEntryLine('250102D45,60NMSCNONREF')).toMatchObject({
      valueDate: '2025-01-02',
      bookingDate: null,
      amountCents: -4560,
      transactionType: 'NMSC',
      customerReference: null,
      bankReference: null,
    });
  });

  it('gère un code fonds entre le sens et le montant', () => {
    expect(parseEntryLine('250102C1234,56NTRFREF1//BANK1')).toMatchObject({ amountCents: 123456 });
  });

  it('traite RC comme une sortie', () => {
    expect(parseEntryLine('250102RC10,00NCHGNONREF')!.amountCents).toBe(-1000);
  });

  it('refuse une ligne qui n’a pas la forme attendue', () => {
    expect(parseEntryLine('pas une ligne 61')).toBeNull();
    expect(parseEntryLine('250102X45,60NMSCNONREF')).toBeNull();
  });
});

describe('analyse du libellé :86:', () => {
  it('recolle les lignes libres', () => {
    expect(parseNarrative(['PAIEMENT   CARTE', 'COOP GENEVE'])).toEqual({
      label: 'PAIEMENT CARTE COOP GENEVE',
      counterparty: null,
    });
  });

  it('déplie les sous-champs structurés répartis sur plusieurs lignes', () => {
    expect(parseNarrative(['?00VIREMENT?20SALAIRE', '?21JANVIER?32EMPLOYEUR SA'])).toEqual({
      label: 'VIREMENT SALAIRE JANVIER',
      counterparty: 'EMPLOYEUR SA',
    });
  });
});
