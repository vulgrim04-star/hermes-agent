/**
 * Comptes et annotations.
 *
 * Deux ajouts qui touchent au journal lui-même, donc deux endroits où une
 * erreur se paierait cher : une clé de compte qui bougerait détacherait les
 * écritures de leur compte, et un solde saisi qui se dupliquerait ferait deux
 * vérités pour une même date.
 */

import { describe, expect, it } from 'vitest';

import {
  accountBalances, addAccount, clearAccountBalance, emptyState, renameAccount,
  setAccountBalance, setNote,
} from './ledger.js';
import { bankBalanceAt } from './networth.js';

function avecCompte() {
  const state = emptyState();
  state.accounts.CH00 = { key: 'CH00', label: 'CH00 0000 …' };
  state.tx.push(
    { id: 1, acc: 'CH00', date: '2026-03-05', cents: -12_000, label: 'Coop', norm: 'COOP', cat: null, note: null, transfer: 0 },
    { id: 2, acc: 'CH00', date: '2026-03-20', cents: 500_000, label: 'Salaire', norm: 'SALAIRE', cat: null, note: null, transfer: 0 },
  );
  return state;
}

describe('note sur une écriture', () => {
  it('enregistre une note et la retire quand elle est vidée', () => {
    const state = avecCompte();
    expect(setNote(state, 1, '  remboursé par Marie  ')).toBe('remboursé par Marie');
    expect(state.tx[0].note).toBe('remboursé par Marie');
    // Vider une note doit la retirer, pas laisser une chaîne vide : les deux
    // se ressemblent à la lecture et se comptent différemment.
    expect(setNote(state, 1, '   ')).toBeNull();
    expect(state.tx[0].note).toBeNull();
  });

  it('ne lève pas sur une écriture qui n’existe pas', () => {
    expect(setNote(avecCompte(), 999, 'quelque chose')).toBeNull();
  });
});

describe('comptes', () => {
  it('renomme un compte sans toucher à sa clé, qui rattache les écritures', () => {
    const state = avecCompte();
    expect(renameAccount(state, 'CH00', '  Compte courant  ')).toBe(true);
    expect(state.accounts.CH00.label).toBe('Compte courant');
    expect(state.accounts.CH00.key).toBe('CH00');
    expect(state.tx.every((t) => t.acc === 'CH00')).toBe(true);
  });

  it('retombe sur la clé plutôt que sur un libellé vide', () => {
    const state = avecCompte();
    renameAccount(state, 'CH00', '   ');
    expect(state.accounts.CH00.label).toBe('CH00');
  });

  it('refuse de renommer un compte absent', () => {
    expect(renameAccount(emptyState(), 'INCONNU', 'X')).toBe(false);
  });

  it('crée un compte manuel avec une clé qu’on ne confondra pas avec un IBAN', () => {
    const state = emptyState();
    expect(addAccount(state, 'Caisse en espèces')).toBe('MANUEL-1');
    expect(addAccount(state, 'Compte à l’étranger')).toBe('MANUEL-2');
    expect(state.accounts['MANUEL-1'].label).toBe('Caisse en espèces');
    expect(addAccount(state, '  ')).toBeNull();
  });
});

describe('solde saisi', () => {
  it('donne un point de départ à un compte dont l’export ne porte aucun solde', () => {
    const state = avecCompte();
    expect(bankBalanceAt(state, 'CH00', '2026-03')).toBeNull();

    setAccountBalance(state, 'CH00', '2026-03-31', 1_000_000);
    expect(bankBalanceAt(state, 'CH00', '2026-03')).toBe(1_000_000);

    const { comptes, total, etablis } = accountBalances(state, '2026-03');
    expect(comptes[0].solde).toBe(1_000_000);
    expect(comptes[0].appui).toEqual({ date: '2026-03-31', saisi: true });
    expect(total).toBe(1_000_000);
    expect(etablis).toBe(1);
  });

  it('reporte les mouvements postérieurs sur le solde saisi', () => {
    const state = avecCompte();
    setAccountBalance(state, 'CH00', '2026-03-10', 1_000_000);
    // Le salaire du 20 mars tombe après le point d'appui : il s'y ajoute.
    expect(bankBalanceAt(state, 'CH00', '2026-03')).toBe(1_500_000);
  });

  it('remplace une saisie à la même date au lieu d’en empiler une seconde', () => {
    const state = avecCompte();
    setAccountBalance(state, 'CH00', '2026-03-31', 1_000_000);
    setAccountBalance(state, 'CH00', '2026-03-31', 1_234_500);
    expect(state.statements).toHaveLength(1);
    expect(bankBalanceAt(state, 'CH00', '2026-03')).toBe(1_234_500);
  });

  it('refuse une date impossible, un compte inconnu, un montant illisible', () => {
    const state = avecCompte();
    expect(setAccountBalance(state, 'CH00', '2026-02-30', 100)).toBe(false);
    expect(setAccountBalance(state, 'AUTRE', '2026-03-31', 100)).toBe(false);
    expect(setAccountBalance(state, 'CH00', '2026-03-31', NaN)).toBe(false);
    expect(state.statements).toHaveLength(0);
  });

  it('se retire, et le solde redevient inconnu', () => {
    const state = avecCompte();
    setAccountBalance(state, 'CH00', '2026-03-31', 1_000_000);
    expect(clearAccountBalance(state, 'CH00', '2026-03-31')).toBe(true);
    expect(clearAccountBalance(state, 'CH00', '2026-03-31')).toBe(false);
    expect(bankBalanceAt(state, 'CH00', '2026-03')).toBeNull();
  });

  it('laisse un relevé importé intact : on ne retire que ce qu’on a saisi', () => {
    const state = avecCompte();
    state.statements.push({ acc: 'CH00', from: '2026-03-01', to: '2026-03-31',
      opening: 0, closing: 900_000, movements: 2 });
    expect(clearAccountBalance(state, 'CH00', '2026-03-31')).toBe(false);
    expect(state.statements).toHaveLength(1);
    expect(accountBalances(state, '2026-03').comptes[0].appui.saisi).toBe(false);
  });
});
