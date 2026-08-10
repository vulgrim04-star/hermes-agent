import { describe, expect, it } from 'vitest';

import { formatCents, formatMoney, parseAmountToCents } from './money.js';

describe('lecture d’un montant', () => {
  it('lit les écritures suisses courantes', () => {
    expect(parseAmountToCents('12.50')).toBe(1250);
    expect(parseAmountToCents("12'450.80")).toBe(1245080);
    expect(parseAmountToCents("1'234'567.05")).toBe(123456705);
    expect(parseAmountToCents('1 234.56')).toBe(123456);
    expect(parseAmountToCents('1 234.56')).toBe(123456);
    expect(parseAmountToCents('1’234.56')).toBe(123456);
  });

  it('lit la virgule décimale du MT940 et le format allemand', () => {
    expect(parseAmountToCents('1234,56')).toBe(123456);
    expect(parseAmountToCents('1.234,56')).toBe(123456);
    expect(parseAmountToCents('1,234.56')).toBe(123456);
  });

  it('accepte les trois écritures du signe négatif', () => {
    expect(parseAmountToCents('-12.50')).toBe(-1250);
    expect(parseAmountToCents('12.50-')).toBe(-1250);
    expect(parseAmountToCents('(12.50)')).toBe(-1250);
    expect(parseAmountToCents('-0.05')).toBe(-5);
  });

  it('retire la devise collée au montant', () => {
    expect(parseAmountToCents('CHF 1’250.00')).toBe(125000);
    expect(parseAmountToCents('1250.00 CHF')).toBe(125000);
  });

  it('respecte le séparateur décimal imposé', () => {
    expect(parseAmountToCents('1.234', { decimalSeparator: ',' })).toBe(123400);
    expect(parseAmountToCents('1,234', { decimalSeparator: ',' })).toBe(123);
    expect(parseAmountToCents('1,234', { decimalSeparator: '.' })).toBe(123400);
  });

  it('arrondit la troisième décimale au lieu de la tronquer', () => {
    expect(parseAmountToCents('1234.567')).toBe(123457);
    expect(parseAmountToCents('1234.564')).toBe(123456);
    expect(parseAmountToCents('1.005', { decimalSeparator: '.' })).toBe(101);
  });

  it('tranche l’ambiguïté des trois chiffres en faveur du groupe de milliers', () => {
    // « 1.005 » sans indication : un relevé bancaire porte deux décimales, pas
    // trois — c'est donc mille cinq, pas un franc et demi-centime. Le séparateur
    // décimal imposé par un profil d'import lève l'ambiguïté quand elle compte.
    expect(parseAmountToCents('1.005')).toBe(100500);
    expect(parseAmountToCents('1,005')).toBe(100500);
    expect(parseAmountToCents('1.50')).toBe(150);
  });

  it('rend null — jamais zéro — sur une chaîne qui n’est pas un montant', () => {
    expect(parseAmountToCents('')).toBeNull();
    expect(parseAmountToCents('   ')).toBeNull();
    expect(parseAmountToCents('n/a')).toBeNull();
    expect(parseAmountToCents('12.34.56')).toBeNull();
    expect(parseAmountToCents('1.2,3.4')).toBeNull();
    expect(parseAmountToCents('0.00')).toBe(0);
  });

  it('ne rend jamais de zéro négatif, qui piégerait les comparaisons', () => {
    expect(Object.is(parseAmountToCents('-0.00'), 0)).toBe(true);
  });
});

describe('écriture d’un montant', () => {
  it('groupe les milliers par apostrophe droite et impose deux décimales', () => {
    expect(formatCents(1245080)).toBe("12'450.80");
    expect(formatCents(123456705)).toBe("1'234'567.05");
    expect(formatCents(5)).toBe('0.05');
    expect(formatCents(-1250)).toBe('-12.50');
    expect(formatCents(0)).toBe('0.00');
  });

  it('n’utilise pas l’apostrophe typographique d’Intl', () => {
    expect(formatCents(1245080)).not.toContain('’');
  });

  it('affiche le signe positif à la demande', () => {
    expect(formatCents(1250, { signDisplay: 'always' })).toBe('+12.50');
    expect(formatCents(0, { signDisplay: 'always' })).toBe('0.00');
  });

  it('préfixe la devise', () => {
    expect(formatMoney(1245080)).toBe("CHF 12'450.80");
    expect(formatMoney(1000, 'EUR')).toBe('EUR 10.00');
  });
});

describe('aller-retour', () => {
  it('restitue le montant d’origine', () => {
    for (const cents of [0, 5, -5, 1250, -1250, 1245080, 123456705, -99999999]) {
      expect(parseAmountToCents(formatCents(cents))).toBe(cents);
    }
  });
});
