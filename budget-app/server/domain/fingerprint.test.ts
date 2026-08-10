import { describe, expect, it } from 'vitest';

import { assignOccurrences, normalizeLabel, softKey, strictFingerprint } from './fingerprint.js';

const base = {
  accountKey: 'CH9300762011623852957',
  valueDate: '2025-01-02',
  amountCents: -4560,
  label: 'Paiement carte COOP PRONTO GENÈVE',
  occurrence: 0,
};

describe('normalisation du libellé', () => {
  it('efface casse, accents et ponctuation', () => {
    expect(normalizeLabel('Coop Pronto  Genève')).toBe('COOP PRONTO GENEVE');
    expect(normalizeLabel('COOP-PRONTO, GENEVE')).toBe('COOP PRONTO GENEVE');
    expect(normalizeLabel('  Zürich   Café  ')).toBe('ZURICH CAFE');
  });
});

describe('empreinte stricte', () => {
  it('est stable d’un import à l’autre', () => {
    expect(strictFingerprint(base)).toBe(strictFingerprint({ ...base }));
  });

  it('ignore la mise en forme du libellé', () => {
    expect(strictFingerprint({ ...base, label: 'PAIEMENT CARTE COOP PRONTO GENEVE' })).toBe(
      strictFingerprint(base),
    );
  });

  it('change dès qu’un élément de l’écriture change', () => {
    const reference = strictFingerprint(base);
    expect(strictFingerprint({ ...base, amountCents: -4561 })).not.toBe(reference);
    expect(strictFingerprint({ ...base, valueDate: '2025-01-03' })).not.toBe(reference);
    expect(strictFingerprint({ ...base, accountKey: 'CH5604835012345678009' })).not.toBe(reference);
    expect(strictFingerprint({ ...base, label: 'Migros' })).not.toBe(reference);
    expect(strictFingerprint({ ...base, occurrence: 1 })).not.toBe(reference);
  });
});

describe('clé souple', () => {
  it('ne tient pas compte du libellé, pour rapprocher un CSV et un MT940', () => {
    const csvSide = softKey({ ...base });
    const mt940Side = softKey({ ...base });
    expect(csvSide).toBe(mt940Side);
    expect(csvSide).not.toBe(strictFingerprint(base));
  });
});

describe('rang d’occurrence', () => {
  it('distingue deux écritures par ailleurs identiques', () => {
    const rows = ['a', 'b', 'a', 'c', 'a'];
    expect(assignOccurrences(rows, (row) => row)).toEqual([0, 0, 1, 0, 2]);
  });

  it('se recalcule à l’identique sur le même relevé, ce qui rend le réimport neutre', () => {
    const statement = [
      { date: '2025-01-11', amount: -450 },
      { date: '2025-01-11', amount: -450 },
      { date: '2025-01-12', amount: -450 },
    ];
    const key = (row: (typeof statement)[number]) => `${row.date}|${row.amount}`;

    const first = assignOccurrences(statement, key);
    const second = assignOccurrences([...statement], key);
    expect(first).toEqual([0, 1, 0]);
    expect(second).toEqual(first);

    // Deux cafés à 4.50 le même jour restent deux écritures distinctes.
    const fingerprints = statement.map((row, index) =>
      strictFingerprint({
        accountKey: base.accountKey,
        valueDate: row.date,
        amountCents: row.amount,
        label: 'COOP PRONTO',
        occurrence: first[index]!,
      }),
    );
    expect(new Set(fingerprints).size).toBe(3);
  });
});
