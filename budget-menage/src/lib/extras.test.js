import { describe, expect, it } from 'vitest';

import { analyseFile } from './analyse.js';
import { analyseMt940, looksLikeMt940, parseBalanceLine, parseEntryLine, parseNarrative } from './mt940.js';
import { reconcile } from './csv.js';
import { commitStatements, emptyState } from './ledger.js';
import {
  bankBalanceAt, netWorthAt, netWorthSeries, pillar3aStatus, positionsAt,
  addAsset, setValuation, clearValuation, valueFromQuantity, shiftMonth,
} from './networth.js';
import { buildXlsx, date as xdate, money as xmoney, text as xtext } from './xlsx.js';

const bytes = (text) => new TextEncoder().encode(text).buffer;

const MT940 = [
  ':20:RELEVE-2026-03',
  ':25:CH5604835012345678009',
  ':28C:00003/001',
  ':60F:C260301CHF10000,00',
  ':61:2603050305D1890,00NMSCREF-LOYER//BK-001',
  ':86:LOYER MARS, RUE DE LAUSANNE 12',
  ':61:260325C6500,00NTRFSALAIRE//BK-002',
  ':86:?20SALAIRE MARS?32EMPLOYEUR SA',
  ':62F:C260331CHF14610,00',
  '-',
].join('\r\n');

describe('MT940', () => {
  it('se reconnaît au contenu, pas à l’extension', () => {
    expect(looksLikeMt940(MT940)).toBe(true);
    expect(looksLikeMt940('Date;Libellé;Montant\n01.01.2026;Coop;-10.00')).toBe(false);
  });

  it('lit une ligne d’opération, virgule décimale imposée', () => {
    const entry = parseEntryLine('2603050305D1890,00NMSCREF-LOYER//BK-001');
    expect(entry).toMatchObject({
      valueDate: '2026-03-05',
      bookingDate: null,
      amountCents: -189000,
      customerReference: 'REF-LOYER',
      bankReference: 'BK-001',
    });
  });

  it('traite une extourne de crédit comme une sortie', () => {
    // RD inverse le mouvement qu'elle annule.
    expect(parseEntryLine('260305RD100,00NMSCX').amountCents).toBe(100_00);
    expect(parseEntryLine('260305RC100,00NMSCX').amountCents).toBe(-100_00);
  });

  it('lit un solde et son sens', () => {
    expect(parseBalanceLine('C260301CHF10000,00')).toEqual({
      date: '2026-03-01', currency: 'CHF', amountCents: 1_000_000,
    });
    expect(parseBalanceLine('D260301CHF250,50').amountCents).toBe(-25050);
  });

  it('déplie un libellé structuré et en sort la contrepartie', () => {
    expect(parseNarrative(['?20SALAIRE MARS?32EMPLOYEUR SA'])).toEqual({
      label: 'SALAIRE MARS', counterparty: 'EMPLOYEUR SA',
    });
  });

  it('recolle un libellé libre sur plusieurs lignes', () => {
    expect(parseNarrative(['LOYER MARS,', 'RUE DE LAUSANNE 12']).label)
      .toBe('LOYER MARS, RUE DE LAUSANNE 12');
  });

  it('rend un relevé rapproché sans rien faire saisir', () => {
    const report = analyseMt940(bytes(MT940), 'releve.sta');
    expect(report.ok).toBe(true);
    expect(report.read).toBe(2);

    const statement = report.statements[0];
    expect(statement.key).toBe('CH5604835012345678009');
    expect(statement.opening).toBe(1_000_000);
    expect(statement.closing).toBe(1_461_000);
    expect(statement.movements).toBe(461_000);
    // 10'000 − 1'890 + 6'500 = 14'610 : le contrôle boucle de lui-même.
    expect(reconcile(statement)).toEqual({ status: 'ok', gap: 0 });
  });

  it('signale un solde de clôture faux plutôt que de l’accepter', () => {
    const faux = MT940.replace(':62F:C260331CHF14610,00', ':62F:C260331CHF14000,00');
    const statement = analyseMt940(bytes(faux), 'faux.sta').statements[0];
    expect(reconcile(statement)).toEqual({ status: 'ko', gap: -61_000 });
  });

  it('signale une ligne :61: illisible sans perdre le reste', () => {
    const casse = MT940.replace(':61:260325C6500,00NTRFSALAIRE//BK-002', ':61:XXXXXX');
    const report = analyseMt940(bytes(casse), 'casse.sta');
    expect(report.issues.some((i) => i.severity === 'erreur')).toBe(true);
    expect(report.statements[0].rows).toHaveLength(1);
  });

  it('refuse un fichier sans relevé exploitable', () => {
    expect(analyseMt940(bytes(':99:rien du tout'), 'vide.sta').ok).toBe(false);
  });

  it('entre dans le journal comme un CSV', () => {
    const state = emptyState();
    const report = analyseFile(bytes(MT940), 'releve.sta');
    expect(report.format).toBe('mt940');
    const result = commitStatements(state, report.statements);
    expect(result.added).toBe(2);
    // Le relevé soldé est conservé : le patrimoine s'appuie dessus.
    expect(state.statements[0]).toMatchObject({ acc: 'CH5604835012345678009', closing: 1_461_000 });
  });
});

describe('patrimoine', () => {
  function withStatement() {
    const state = emptyState();
    commitStatements(state, analyseFile(bytes(MT940), 'releve.sta').statements);
    return state;
  }

  it('calcule une quantité en arithmétique entière', () => {
    expect(valueFromQuantity(50_000_000, 5_843_215)).toBe(2_921_608);
    expect(valueFromQuantity(42_815_000, 5_843_215)).toBe(2_501_773);
  });

  it('reprend le solde de clôture du relevé', () => {
    expect(bankBalanceAt(withStatement(), 'CH5604835012345678009', '2026-03')).toBe(1_461_000);
  });

  it('y ajoute les mouvements postérieurs', () => {
    const state = withStatement();
    state.tx.push({ id: 99, acc: 'CH5604835012345678009', date: '2026-04-10', cents: -50_000,
      label: 'x', norm: 'X', cat: null, transfer: 0 });
    expect(bankBalanceAt(state, 'CH5604835012345678009', '2026-04')).toBe(1_411_000);
  });

  it('remonte le temps depuis un relevé postérieur', () => {
    // Février précède le relevé : sans marche arrière le compte afficherait
    // zéro, ce qui n'est pas « rien » mais « inconnu ».
    expect(bankBalanceAt(withStatement(), 'CH5604835012345678009', '2026-02')).toBe(1_000_000);
  });

  it('ne rend rien pour un compte sans relevé soldé', () => {
    expect(bankBalanceAt(emptyState(), 'CH999', '2026-03')).toBeNull();
  });

  it('alimente une position adossée au compte', () => {
    const state = withStatement();
    edit(state, (s) => addAsset(s, { label: 'Compte courant', kind: 'compte', account: 'CH5604835012345678009' }));
    const position = positionsAt(state, '2026-03')[0];
    expect(position).toMatchObject({ valueCents: 1_461_000, origin: 'releve' });
  });

  it('laisse une saisie manuelle l’emporter sur le relevé', () => {
    const state = withStatement();
    const id = addAsset(state, { label: 'Compte', kind: 'compte', account: 'CH5604835012345678009' });
    setValuation(state, { assetId: id, period: '2026-03', valueCents: 999_999 });
    expect(positionsAt(state, '2026-03')[0]).toMatchObject({ valueCents: 999_999, origin: 'saisi' });
  });

  it('reporte la dernière valeur connue en le signalant', () => {
    const state = emptyState();
    const id = addAsset(state, { label: 'ETF', kind: 'titres', account: null });
    setValuation(state, { assetId: id, period: '2026-01', valueCents: 5_000_000 });
    expect(positionsAt(state, '2026-05')[0]).toMatchObject({
      valueCents: 5_000_000, origin: 'report', reportedFrom: '2026-01',
    });
  });

  it('ne reporte pas une valeur postérieure au mois demandé', () => {
    const state = emptyState();
    const id = addAsset(state, { label: 'ETF', kind: 'titres', account: null });
    setValuation(state, { assetId: id, period: '2026-05', valueCents: 5_000_000 });
    expect(positionsAt(state, '2026-01')[0]).toMatchObject({ valueCents: null, origin: 'inconnu' });
  });

  it('rend la main au report quand la saisie du mois est effacée', () => {
    const state = emptyState();
    const id = addAsset(state, { label: 'ETF', kind: 'titres', account: null });
    setValuation(state, { assetId: id, period: '2026-01', valueCents: 5_000_000 });
    setValuation(state, { assetId: id, period: '2026-02', valueCents: 5_200_000 });
    expect(clearValuation(state, id, '2026-02')).toBe(true);
    expect(positionsAt(state, '2026-02')[0]).toMatchObject({ valueCents: 5_000_000, origin: 'report' });
  });

  it('soustrait les dettes des actifs', () => {
    const state = emptyState();
    const etf = addAsset(state, { label: 'ETF', kind: 'titres', account: null });
    const dette = addAsset(state, { label: 'Prêt', kind: 'dette', account: null });
    setValuation(state, { assetId: etf, period: '2026-03', valueCents: 5_000_000 });
    setValuation(state, { assetId: dette, period: '2026-03', valueCents: 1_200_000 });
    expect(netWorthAt(state, '2026-03')).toMatchObject({
      assets: 5_000_000, liabilities: 1_200_000, net: 3_800_000,
    });
  });

  it('rend une série continue et enjambe l’année', () => {
    const state = emptyState();
    const id = addAsset(state, { label: 'ETF', kind: 'titres', account: null });
    setValuation(state, { assetId: id, period: '2025-12', valueCents: 1_000_000 });
    const series = netWorthSeries(state, '2025-11', '2026-02');
    expect(series.map((p) => p.period)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(series.map((p) => p.net)).toEqual([0, 1_000_000, 1_000_000, 1_000_000]);
    expect(series[2].carried).toBe(1);
  });

  it('rend une série vide sur une plage inversée', () => {
    expect(netWorthSeries(emptyState(), '2026-05', '2026-01')).toEqual([]);
  });

  it('décale un mois sans se tromper d’année', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
  });

  it('refuse un mois mal formé', () => {
    const state = emptyState();
    const id = addAsset(state, { label: 'ETF', kind: 'titres', account: null });
    expect(setValuation(state, { assetId: id, period: '2026-13', valueCents: 1 })).toEqual({ kind: 'mois-invalide' });
  });
});

describe('Pilier 3a', () => {
  function withPayments() {
    const state = emptyState();
    state.tx.push(
      { id: 1, acc: 'A', date: '2026-02-15', cents: -350_000, label: '3a', norm: '3A', cat: 'Pilier 3a', transfer: 0 },
      { id: 2, acc: 'A', date: '2025-02-15', cents: -700_000, label: '3a', norm: '3A', cat: 'Pilier 3a', transfer: 0 },
    );
    return state;
  }

  it('réclame le plafond tant qu’il n’est pas renseigné', () => {
    const status = pillar3aStatus(withPayments(), 2026, new Date('2026-08-10T00:00:00Z'));
    expect(status.ceilingCents).toBeNull();
    expect(status.remainingCents).toBeNull();
    expect(status.message).toContain('plafond 3a 2026');
  });

  it('livre 2025 pré-rempli', () => {
    expect(pillar3aStatus(withPayments(), 2025).ceilingCents).toBe(725_800);
  });

  it('chiffre le reste à verser une fois le plafond saisi', () => {
    const state = withPayments();
    state.tax[2026] = 725_800;
    const status = pillar3aStatus(state, 2026, new Date('2026-12-01T00:00:00Z'));
    expect(status).toMatchObject({ paidCents: 350_000, remainingCents: 375_800, daysLeft: 30 });
  });

  it('ne descend pas sous zéro quand le plafond est dépassé', () => {
    const state = withPayments();
    state.tax[2026] = 300_000;
    expect(pillar3aStatus(state, 2026).remainingCents).toBe(0);
  });

  it('ne retient que les versements de l’année demandée', () => {
    const state = withPayments();
    state.tax[2026] = 725_800;
    expect(pillar3aStatus(state, 2026).paidCents).toBe(350_000);
  });
});

describe('classeur Excel', () => {
  it('produit une archive ZIP reconnaissable', async () => {
    const blob = buildXlsx({
      sheetName: 'Écritures',
      columns: [{ header: 'Date' }, { header: 'Libellé' }, { header: 'Montant' }],
      rows: [[xdate('2026-01-08'), xtext('Coop Genève'), xmoney(-123456)]],
    });
    const head = new Uint8Array(await blob.arrayBuffer()).slice(0, 4);
    // « PK\x03\x04 » : la signature d'une entrée locale ZIP.
    expect([...head]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(blob.type).toContain('spreadsheetml');
  });

  it('type les cellules : date en série, montant en nombre', async () => {
    const blob = buildXlsx({
      columns: [{ header: 'Date' }, { header: 'Montant' }],
      rows: [[xdate('2026-01-08'), xmoney(-123456)]],
    });
    const xml = new TextDecoder().decode(await blob.arrayBuffer());
    // 08.01.2026 = 46030 jours depuis le 30.12.1899.
    expect(xml).toContain('<v>46030</v>');
    expect(xml).toContain('<v>-1234.56</v>');
    // Un montant ne doit pas sortir en chaîne.
    expect(xml).not.toContain('t="inlineStr"><is><t xml:space="preserve">-1234.56');
  });

  it('échappe ce qui casserait le XML', async () => {
    const blob = buildXlsx({
      columns: [{ header: 'Libellé' }],
      rows: [[xtext('Coop & <fils> "self"')]],
    });
    const xml = new TextDecoder().decode(await blob.arrayBuffer());
    expect(xml).toContain('Coop &amp; &lt;fils&gt; &quot;self&quot;');
  });

  it('fige la ligne d’en-tête', async () => {
    const blob = buildXlsx({ columns: [{ header: 'A' }], rows: [] });
    const xml = new TextDecoder().decode(await blob.arrayBuffer());
    expect(xml).toContain('state="frozen"');
  });
});

/** Petit utilitaire local : `edit` du store n'existe pas hors navigateur. */
function edit(state, mutator) {
  return mutator(state);
}
