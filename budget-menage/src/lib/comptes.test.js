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
  accountBalances, addAccount, applyRules, clearAccountBalance, emptyState, hasSplits, ledger,
  pendingCount, renameAccount, rowKey, setAccountBalance, setNote, setSplits, totalsOf,
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

describe('découpage d’une écriture', () => {
  function migros() {
    const state = emptyState();
    state.accounts.CH00 = { key: 'CH00', label: 'Compte' };
    state.tx.push({ id: 1, acc: 'CH00', date: '2026-03-05', cents: -14_850,
      label: 'Migros', norm: 'MIGROS', cat: 'Courses', note: null, transfer: 0 });
    return state;
  }

  it('rend une ligne de journal par part, avec sa catégorie et son montant', () => {
    const state = migros();
    expect(setSplits(state, 1, [
      { cat: 'Courses', cents: -11_850 },
      { cat: 'Équipement du ménage', cents: -3_000 },
    ])).toEqual({ kind: 'reparti', parts: 2 });

    const rows = ledger(state, '2026-03-01', '2026-03-31');
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.cat)).toEqual(['Courses', 'Équipement du ménage']);
    expect(rows.map((r) => r.cents)).toEqual([-11_850, -3_000]);
    // Les clés restent distinctes : deux lignes issues d'une même écriture ne
    // doivent pas se confondre dans une liste.
    expect(new Set(rows.map(rowKey)).size).toBe(2);
    // Et le total du mois ne bouge pas d'un centime.
    expect(totalsOf(rows).expense).toBe(14_850);
  });

  it('refuse une répartition qui ne boucle pas, et dit de combien', () => {
    const state = migros();
    const r = setSplits(state, 1, [{ cat: 'Courses', cents: -10_000 }]);
    expect(r).toEqual({ kind: 'somme', ecart: -4_850 });
    // Rien n'est enregistré : une écriture à moitié répartie ferait disparaître
    // de l'argent des totaux sans qu'aucun écran ne puisse le signaler.
    expect(state.tx[0].splits).toBeUndefined();
  });

  it('refuse une part de sens contraire et une part nulle', () => {
    const state = migros();
    expect(setSplits(state, 1, [
      { cat: 'Courses', cents: -17_850 }, { cat: 'Remboursements', cents: 3_000 },
    ]).kind).toBe('sens');
    expect(setSplits(state, 1, [
      { cat: 'Courses', cents: -14_850 }, { cat: 'Divers', cents: 0 },
    ]).kind).toBe('part-nulle');
  });

  it('retire la catégorie de l’écriture entière : ce sont les parts qui la portent', () => {
    const state = migros();
    setSplits(state, 1, [
      { cat: 'Courses', cents: -11_850 }, { cat: 'Électronique', cents: -3_000 },
    ]);
    expect(state.tx[0].cat).toBeNull();
    expect(hasSplits(state.tx[0])).toBe(true);
    // Une règle ne doit pas reposer une catégorie par-dessus la répartition.
    state.rules.push({ pattern: 'MIGROS', cat: 'Courses' });
    applyRules(state, state.tx);
    expect(state.tx[0].cat).toBeNull();
  });

  it('sort de la file de révision une fois répartie', () => {
    const state = migros();
    state.tx[0].cat = null;
    expect(pendingCount(state).toClassify).toBe(1);
    setSplits(state, 1, [
      { cat: 'Courses', cents: -11_850 }, { cat: 'Électronique', cents: -3_000 },
    ]);
    expect(pendingCount(state).toClassify).toBe(0);
  });

  it('se défait, et l’écriture retrouve son unité', () => {
    const state = migros();
    setSplits(state, 1, [
      { cat: 'Courses', cents: -11_850 }, { cat: 'Électronique', cents: -3_000 },
    ]);
    expect(setSplits(state, 1, [])).toEqual({ kind: 'retire' });
    expect(hasSplits(state.tx[0])).toBe(false);
    expect(ledger(state, '2026-03-01', '2026-03-31')).toHaveLength(1);
  });

  it('ne lève pas sur une écriture absente', () => {
    expect(setSplits(migros(), 42, [{ cat: 'Courses', cents: -1 }]).kind).toBe('introuvable');
  });
});
