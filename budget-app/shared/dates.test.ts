import { describe, expect, it } from 'vitest';

import {
  formatSwissDate,
  isValidIsoDate,
  monthBounds,
  parseMt940Date,
  parseMt940EntryDate,
  parseSwissDate,
} from './dates.js';

describe('lecture d’une date d’export', () => {
  it('accepte les séparateurs rencontrés dans les exports', () => {
    expect(parseSwissDate('31.12.2025')).toBe('2025-12-31');
    expect(parseSwissDate('31/12/2025')).toBe('2025-12-31');
    expect(parseSwissDate('31-12-2025')).toBe('2025-12-31');
    expect(parseSwissDate('1.2.2025')).toBe('2025-02-01');
    expect(parseSwissDate('2025-12-31')).toBe('2025-12-31');
    expect(parseSwissDate('20251231')).toBe('2025-12-31');
  });

  it('rejette une date qui n’existe pas au calendrier', () => {
    expect(parseSwissDate('31.02.2025')).toBeNull();
    expect(parseSwissDate('29.02.2025')).toBeNull();
    expect(parseSwissDate('29.02.2024')).toBe('2024-02-29');
    expect(parseSwissDate('00.01.2025')).toBeNull();
    expect(parseSwissDate('01.13.2025')).toBeNull();
  });

  it('rejette ce qui n’est pas une date', () => {
    expect(parseSwissDate('')).toBeNull();
    expect(parseSwissDate('Solde reporté')).toBeNull();
    expect(parseSwissDate('31.12')).toBeNull();
  });

  it('rend la date au format suisse', () => {
    expect(formatSwissDate('2025-12-31')).toBe('31.12.2025');
    expect(isValidIsoDate('2025-02-30')).toBe(false);
  });
});

describe('dates MT940', () => {
  it('développe l’année sur deux chiffres', () => {
    expect(parseMt940Date('250102')).toBe('2025-01-02');
    expect(parseMt940Date('991231', 2025)).toBe('1999-12-31');
    expect(parseMt940Date('991231', 2099)).toBe('2099-12-31');
  });

  it('refuse une date MT940 mal formée', () => {
    expect(parseMt940Date('2501')).toBeNull();
    expect(parseMt940Date('250230')).toBeNull();
  });

  it('déduit l’année de la date comptable de celle de la date de valeur', () => {
    expect(parseMt940EntryDate('0102', '2025-01-02')).toBe('2025-01-02');
    expect(parseMt940EntryDate('1231', '2025-01-02')).toBe('2024-12-31');
    expect(parseMt940EntryDate('0102', '2024-12-31')).toBe('2025-01-02');
  });
});

describe('bornes d’un mois', () => {
  it('donne le premier et le dernier jour', () => {
    expect(monthBounds('2025-02')).toEqual({ start: '2025-02-01', end: '2025-02-28' });
    expect(monthBounds('2024-02')).toEqual({ start: '2024-02-01', end: '2024-02-29' });
    expect(monthBounds('2025-12')).toEqual({ start: '2025-12-01', end: '2025-12-31' });
    expect(monthBounds('2025-13')).toBeNull();
  });
});
