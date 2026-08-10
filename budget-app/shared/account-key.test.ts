import { describe, expect, it } from 'vitest';

import { normalizeAccountKey } from './account-key.js';

describe('identité de compte', () => {
  it('normalise un IBAN et le rend lisible', () => {
    expect(normalizeAccountKey('CH93 0076 2011 6238 5295 7')).toEqual({
      key: 'CH9300762011623852957',
      kind: 'iban',
      label: 'CH93 0076 2011 6238 5295 7',
    });
  });

  it('rend la même clé quel que soit l’espacement de l’IBAN', () => {
    const spaced = normalizeAccountKey('CH93 0076 2011 6238 5295 7');
    const compact = normalizeAccountKey('ch9300762011623852957');
    expect(compact?.key).toBe(spaced?.key);
  });

  it('réduit une carte masquée à ses quatre chiffres', () => {
    expect(normalizeAccountKey('****7648')).toEqual({
      key: 'CARTE-7648',
      kind: 'carte',
      label: 'Carte ****7648',
    });
  });

  it('ignore le nombre d’astérisques, qui varie d’un export à l’autre', () => {
    expect(normalizeAccountKey('******7648')?.key).toBe('CARTE-7648');
    expect(normalizeAccountKey('xxxx 7648')?.key).toBe('CARTE-7648');
  });

  it('ne prend pas un IBAN faux pour un IBAN', () => {
    const identity = normalizeAccountKey('CH93 0076 2011 6238 5295 8');
    expect(identity?.kind).toBe('autre');
  });

  it('conserve une référence quelconque en la compactant', () => {
    expect(normalizeAccountKey('80-2-2 / épargne')).toEqual({
      key: '8022EPARGNE',
      kind: 'autre',
      label: '80-2-2 / épargne',
    });
  });

  it('ne rend rien pour une cellule vide', () => {
    expect(normalizeAccountKey('   ')).toBeNull();
    expect(normalizeAccountKey('—')).toBeNull();
  });
});
