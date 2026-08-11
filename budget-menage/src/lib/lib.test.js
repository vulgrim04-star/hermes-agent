import { describe, expect, it } from 'vitest';

import { fmt, parseAmount } from './money.js';
import { frDate, parseDate } from './dates.js';
import { accountIdentity, analyse, detectDelimiter, directionConflict, parseDelimited, reconcile, validIban } from './csv.js';
import { commitStatements, emptyState, ledger, totalsOf } from './ledger.js';

describe('montants', () => {
  it('lit les formes rencontrées dans les exports bancaires', () => {
    expect(parseAmount("12'450.80")).toBe(1245080);
    expect(parseAmount('1 234.56')).toBe(123456);
    expect(parseAmount('1.234,56')).toBe(123456);
    expect(parseAmount('-12.50')).toBe(-1250);
    expect(parseAmount('12.50-')).toBe(-1250);
    expect(parseAmount('(12.50)')).toBe(-1250);
    expect(parseAmount('CHF 1’000.00')).toBe(100000);
  });

  it('lit un groupe de milliers comme tel, pas comme des décimales', () => {
    expect(parseAmount('1.005')).toBe(100500);
    expect(parseAmount('1,234')).toBe(123400);
  });

  it('rend null sur ce qui n’est pas un montant — jamais 0', () => {
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('n/a')).toBeNull();
    expect(parseAmount('1.2.3')).toBeNull();
    expect(parseAmount('0.00')).toBe(0);
  });

  it('formate à la suisse, apostrophe droite', () => {
    expect(fmt(1245080)).toBe("12'450.80");
    expect(fmt(-4560)).toBe('-45.60');
    expect(fmt(0)).toBe('0.00');
    expect(fmt(100000000)).toBe("1'000'000.00");
  });
});

describe('dates', () => {
  it('lit les formats d’export', () => {
    expect(parseDate('31.12.2025')).toBe('2025-12-31');
    expect(parseDate('01/02/26')).toBe('2026-02-01');
    expect(parseDate('20251231')).toBe('2025-12-31');
    expect(parseDate('2025-12-31')).toBe('2025-12-31');
  });

  it('refuse une date qui n’existe pas', () => {
    expect(parseDate('31.02.2025')).toBeNull();
    expect(parseDate('')).toBeNull();
  });

  it('affiche à la suisse', () => {
    expect(frDate('2025-12-31')).toBe('31.12.2025');
  });
});

describe('comptes', () => {
  it('valide un IBAN par la clé modulo 97', () => {
    expect(validIban('CH93 0076 2011 6238 5295 7')).toBe(true);
    expect(validIban('CH93 0076 2011 6238 5295 8')).toBe(false);
  });

  it('réduit une carte masquée à ses quatre chiffres', () => {
    expect(accountIdentity('****7648')).toEqual({ key: 'CARTE-7648', label: 'Carte ****7648' });
    expect(accountIdentity('******7648').key).toBe('CARTE-7648');
  });

  it('rend une clé stable quel que soit l’espacement de l’IBAN', () => {
    expect(accountIdentity('CH93 0076 2011 6238 5295 7').key)
      .toBe(accountIdentity('ch9300762011623852957').key);
  });
});

describe('découpage CSV', () => {
  it('respecte les guillemets et les guillemets échappés', () => {
    const rows = parseDelimited('a,"b,c","d""e"\r\nf,g,h', ',');
    expect(rows[0]).toEqual(['a', 'b,c', 'd"e']);
    expect(rows[1]).toEqual(['f', 'g', 'h']);
  });

  it('choisit le séparateur qui découpe régulièrement', () => {
    const lines = ['a;b;c;d', '1;2;3;4', '5;6;7;8'];
    expect(detectDelimiter(lines).delimiter).toBe(';');
  });
});

describe('sens annoncé', () => {
  it('signale une contradiction sans rien corriger', () => {
    expect(directionConflict('Dépense', 6490)).toContain('positif');
    expect(directionConflict('Revenu', -100)).toContain('négatif');
    expect(directionConflict('Dépense', -100)).toBeNull();
  });
});

const HEADER = '"Date de transaction","Numéro de compte ou de carte","Description","Revenu ou dépense","Montant","Monnaie","Catégorie"\r\n';
const FILE =
  HEADER +
  '"31.03.2026","CH56 0483 5012 3456 7800 9","SALAIRE MARS","Revenu","6\'500.00","CHF","Salaire et rentes"\r\n' +
  '"28.03.2026","CH56 0483 5012 3456 7800 9","REGLEMENT CARTE 7648","Dépense","-1\'250.00","CHF","Factures de carte de crédit"\r\n' +
  '"25.03.2026","CH56 0483 5012 3456 7800 9","REMBOURSEMENT, RETOUR ARTICLE","Dépense","64.90","CHF","Achats"\r\n' +
  '"20.03.2026","CH56 0483 5012 3456 7800 9","LOYER AVRIL","Dépense","-1\'890.00","CHF","Ménage"\r\n' +
  '"03.03.2026","CH56 0483 5012 3456 7800 9","BULLETIN DE VERSEMENT","Dépense","-45.00","CHF","Autres transactions"\r\n' +
  '"03.03.2026","CH56 0483 5012 3456 7800 9","BULLETIN DE VERSEMENT","Dépense","-45.00","CHF","Autres transactions"\r\n' +
  '"28.03.2026","****7648","PAIEMENT FACTURE CARTE","Revenu","1\'250.00","CHF","Factures de carte de crédit"\r\n' +
  '"22.03.2026","****7648","COOP PRONTO GENÈVE, GARE","Dépense","-38.45","CHF","Alimentation"\r\n';

function bytes(text) {
  return new TextEncoder().encode(text).buffer;
}

describe('analyse d’un export multi-comptes', () => {
  const report = analyse(bytes(FILE), 'export.csv');

  it('lit le fichier sans erreur', () => {
    expect(report.ok).toBe(true);
    expect(report.issues.filter((i) => i.severity === 'erreur')).toEqual([]);
    expect(report.read).toBe(8);
  });

  it('rend un relevé par compte', () => {
    expect(report.statements.map((s) => s.key)).toEqual(['CH5604835012345678009', 'CARTE-7648']);
    expect(report.statements.map((s) => s.rows.length)).toEqual([6, 2]);
  });

  it('propose un libellé lisible pour une carte', () => {
    expect(report.statements[1].label).toBe('Carte ****7648');
  });

  it('borne la période sur les dates, pas sur l’ordre du fichier', () => {
    expect(report.statements[0].from).toBe('2026-03-03');
    expect(report.statements[0].to).toBe('2026-03-31');
  });

  it('découpe un libellé contenant une virgule', () => {
    const coop = report.statements[1].rows.find((r) => r.label.startsWith('COOP'));
    expect(coop.label).toBe('COOP PRONTO GENÈVE, GARE');
    expect(coop.cents).toBe(-3845);
  });

  it('signale le sens contradictoire sans écarter la ligne', () => {
    const conflicts = report.issues.filter((i) => i.message.includes('Sens contradictoire'));
    expect(conflicts).toHaveLength(1);
    const remboursement = report.statements[0].rows.find((r) => r.label.startsWith('REMBOURSEMENT'));
    expect(remboursement.cents).toBe(6490);
  });
});

describe('rapprochement', () => {
  it('boucle quand ouverture + mouvements = clôture', () => {
    const statement = { opening: 1000000, closing: 1000000 - 5000, movements: -5000 };
    expect(reconcile(statement)).toEqual({ status: 'ok', gap: 0 });
  });

  it('désigne l’écart quand il ne boucle pas', () => {
    const statement = { opening: 1000000, closing: 1000000, movements: -5000 };
    expect(reconcile(statement)).toEqual({ status: 'ko', gap: 5000 });
  });

  it('reste « absent » tant qu’un solde manque', () => {
    expect(reconcile({ opening: 1000, closing: null, movements: 0 }).status).toBe('absent');
  });
});

describe('journal', () => {
  it('classe d’après la catégorie de la banque, et pas les libellés ambigus', () => {
    const state = emptyState();
    const report = analyse(bytes(FILE), 'export.csv');
    const result = commitStatements(state, report.statements);

    expect(result.added).toBe(8);
    expect(state.tx.find((t) => t.label === 'SALAIRE MARS').cat).toBe('Salaire');
    // « Autres transactions » est laissé sans correspondance, donc à classer.
    expect(state.tx.find((t) => t.label.startsWith('BULLETIN')).cat).toBeNull();
  });

  it('apparie le règlement de carte comme transfert interne', () => {
    const state = emptyState();
    commitStatements(state, analyse(bytes(FILE), 'export.csv').statements);
    expect(state.transfers).toHaveLength(1);
    expect(state.transfers[0].status).toBe('propose');
  });

  it('reste idempotent : le même fichier réimporté n’ajoute rien', () => {
    const state = emptyState();
    commitStatements(state, analyse(bytes(FILE), 'export.csv').statements);
    const again = commitStatements(state, analyse(bytes(FILE), 'export.csv').statements);
    expect(again.added).toBe(0);
    expect(again.duplicates).toBe(8);
    expect(state.tx).toHaveLength(8);
  });

  it('conserve deux lignes strictement identiques', () => {
    const state = emptyState();
    commitStatements(state, analyse(bytes(FILE), 'export.csv').statements);
    expect(state.tx.filter((t) => t.label.startsWith('BULLETIN'))).toHaveLength(2);
  });

  it('applique reste à vivre = revenus − dépenses − épargne', () => {
    const state = emptyState();
    commitStatements(state, analyse(bytes(FILE), 'export.csv').statements);
    const totals = totalsOf(ledger(state, '2026-03-01', '2026-03-31'));
    // Salaire 6'500 + règlement de carte crédité 1'250, ce dernier restant sans
    // catégorie (« transfert-interne ») et donc classé par son signe.
    expect(totals.income).toBe(775000);
    expect(totals.remaining).toBe(totals.income - totals.expense - totals.savings);
  });

  it('impute un remboursement à sa catégorie plutôt qu’aux revenus', () => {
    const state = emptyState();
    commitStatements(state, analyse(bytes(FILE), 'export.csv').statements);

    // La banque classe ce remboursement en « Achats » : il vient en diminution
    // des dépenses de shopping, il ne gonfle pas les revenus du ménage.
    const remboursement = state.tx.find((t) => t.label.startsWith('REMBOURSEMENT'));
    expect(remboursement.cat).toBe('Shopping');
    expect(remboursement.cents).toBe(6490);

    const withRefund = totalsOf(ledger(state, '2026-03-01', '2026-03-31'));
    remboursement.cat = null;
    const bySign = totalsOf(ledger(state, '2026-03-01', '2026-03-31'));
    expect(bySign.income - withRefund.income).toBe(6490);
    expect(bySign.expense - withRefund.expense).toBe(6490);
  });

  it('sort un transfert confirmé des totaux sans le supprimer', () => {
    const state = emptyState();
    commitStatements(state, analyse(bytes(FILE), 'export.csv').statements);
    const before = totalsOf(ledger(state, '2026-03-01', '2026-03-31'));

    const pair = state.transfers[0];
    pair.status = 'confirme';
    for (const id of [pair.out, pair.in]) state.tx.find((t) => t.id === id).transfer = 1;

    const after = totalsOf(ledger(state, '2026-03-01', '2026-03-31'));
    expect(after.income).toBe(before.income - 125000);
    expect(after.expense).toBe(before.expense - 125000);
    expect(state.tx).toHaveLength(8);
  });
});
