import { beforeEach, describe, expect, it } from 'vitest';

import { openDatabase } from '../db/connection.js';
import type { Db } from '../db/connection.js';
import { normalizeLabel } from './fingerprint.js';
import { applyRules, countMatches, matchesRule, suggestPattern } from './rules.js';
import type { CategoryRule, RuleCandidate } from './rules.js';

function rule(overrides: Partial<CategoryRule> = {}): CategoryRule {
  return {
    id: 1,
    pattern: 'COOP',
    match_type: 'contient',
    category_id: 10,
    owner: null,
    direction: 'tout',
    account_id: null,
    priority: 100,
    is_active: 1,
    ...overrides,
  };
}

function candidate(overrides: Partial<RuleCandidate> = {}): RuleCandidate {
  return {
    label: 'Paiement carte COOP PRONTO GENÈVE',
    label_normalized: 'PAIEMENT CARTE COOP PRONTO GENEVE',
    amount_cents: -4560,
    account_id: 1,
    ...overrides,
  };
}

describe('correspondance d’un motif « contient »', () => {
  it('ignore casse, accents et ponctuation', () => {
    expect(matchesRule(rule({ pattern: 'coop pronto' }), candidate())).toBe(true);
    expect(matchesRule(rule({ pattern: 'Coop-Pronto,' }), candidate())).toBe(true);
    expect(matchesRule(rule({ pattern: 'GENÈVE' }), candidate())).toBe(true);
  });

  it('ne correspond pas à un commerçant absent', () => {
    expect(matchesRule(rule({ pattern: 'MIGROS' }), candidate())).toBe(false);
  });

  it('refuse un motif vide, qui prendrait tout', () => {
    expect(matchesRule(rule({ pattern: '   ' }), candidate())).toBe(false);
    expect(matchesRule(rule({ pattern: '---' }), candidate())).toBe(false);
  });
});

describe('correspondance d’un motif « regex »', () => {
  it('s’applique au libellé brut, insensible à la casse', () => {
    expect(matchesRule(rule({ match_type: 'regex', pattern: 'coop\\s+pronto' }), candidate())).toBe(
      true,
    );
    expect(matchesRule(rule({ match_type: 'regex', pattern: 'GENÈVE$' }), candidate())).toBe(true);
  });

  it('ne fait jamais correspondre une expression invalide', () => {
    expect(matchesRule(rule({ match_type: 'regex', pattern: '([' }), candidate())).toBe(false);
  });
});

describe('filtres d’une règle', () => {
  it('restreint au sens du mouvement', () => {
    expect(matchesRule(rule({ direction: 'debit' }), candidate({ amount_cents: -4560 }))).toBe(true);
    expect(matchesRule(rule({ direction: 'debit' }), candidate({ amount_cents: 4560 }))).toBe(false);
    expect(matchesRule(rule({ direction: 'credit' }), candidate({ amount_cents: 4560 }))).toBe(true);
    expect(matchesRule(rule({ direction: 'credit' }), candidate({ amount_cents: -4560 }))).toBe(
      false,
    );
  });

  it('restreint à un compte', () => {
    expect(matchesRule(rule({ account_id: 1 }), candidate({ account_id: 1 }))).toBe(true);
    expect(matchesRule(rule({ account_id: 2 }), candidate({ account_id: 1 }))).toBe(false);
  });

  it('ne s’applique pas si elle est désactivée', () => {
    expect(matchesRule(rule({ is_active: 0 }), candidate())).toBe(false);
  });
});

describe('motif proposé à partir d’un libellé', () => {
  it('retire l’appareil bancaire et garde le commerçant', () => {
    expect(suggestPattern('Paiement carte COOP PRONTO GENÈVE')).toBe('COOP PRONTO');
    expect(suggestPattern('Prélèvement Assura primes LAMal février')).toBe('ASSURA');
    expect(suggestPattern('Achat en ligne Digitec Galaxus, Zürich')).toBe('DIGITEC');
    expect(suggestPattern('Kartenzahlung Migros Fribourg')).toBe('MIGROS');
  });

  it('retire les mois, pour qu’un loyer de janvier prenne aussi février', () => {
    expect(suggestPattern('Ordre permanent Loyer janvier')).toBe('LOYER');
  });

  it('ignore les nombres et les jetons trop courts', () => {
    expect(suggestPattern('CFF 12345 SA')).toBe('CFF');
    expect(suggestPattern('Virement 2025 salaire')).toBe('SALAIRE');
  });

  it('rend le libellé normalisé quand il n’en reste rien', () => {
    expect(suggestPattern('Paiement carte')).toBe('PAIEMENT CARTE');
    expect(suggestPattern('')).toBe('');
  });
});

// --------------------------------------------------------------- en base

let db: Db;
let accountId: number;
let courses: number;
let restaurants: number;

beforeEach(() => {
  db = openDatabase(':memory:');
  accountId = Number(
    db.prepare("INSERT INTO accounts (account_key, label) VALUES ('CH1', 'Courant')").run()
      .lastInsertRowid,
  );
  courses = (db.prepare("SELECT id FROM categories WHERE name = 'Courses'").get() as { id: number })
    .id;
  restaurants = (
    db.prepare("SELECT id FROM categories WHERE name = 'Restaurants & take-away'").get() as {
      id: number;
    }
  ).id;
});

let sequence = 0;
function addTransaction(label: string, amountCents: number, categoryId: number | null = null): number {
  sequence += 1;
  return Number(
    db
      .prepare(
        `INSERT INTO transactions
           (account_id, value_date, amount_cents, label, label_normalized, category_id, source, fingerprint, soft_key)
         VALUES (?, '2025-01-15', ?, ?, ?, ?, 'manuel', ?, ?)`,
      )
      .run(
        accountId,
        amountCents,
        label,
        normalizeLabel(label),
        categoryId,
        `fp${sequence}`,
        `sk${sequence}`,
      ).lastInsertRowid,
  );
}

function addRule(overrides: Partial<CategoryRule> = {}): number {
  const value = rule(overrides);
  return Number(
    db
      .prepare(
        `INSERT INTO category_rules (pattern, match_type, category_id, owner, direction, account_id, priority)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        value.pattern,
        value.match_type,
        value.category_id,
        value.owner,
        value.direction,
        value.account_id,
        value.priority,
      ).lastInsertRowid,
  );
}

function categoryOf(id: number): number | null {
  return (db.prepare('SELECT category_id FROM transactions WHERE id = ?').get(id) as {
    category_id: number | null;
  }).category_id;
}

describe('application des règles', () => {
  it('catégorise les écritures non catégorisées', () => {
    const first = addTransaction('Paiement carte COOP PRONTO GENÈVE', -4560);
    const second = addTransaction('COOP Pronto Lausanne', -1200);
    addRule({ pattern: 'COOP', category_id: courses });

    expect(applyRules(db)).toMatchObject({ updated: 2 });
    expect(categoryOf(first)).toBe(courses);
    expect(categoryOf(second)).toBe(courses);
  });

  it('ne défait jamais une catégorie posée à la main', () => {
    const manual = addTransaction('Paiement carte COOP PRONTO', -4560, restaurants);
    addRule({ pattern: 'COOP', category_id: courses });

    expect(applyRules(db).updated).toBe(0);
    expect(categoryOf(manual)).toBe(restaurants);
  });

  it('laisse une écriture découpée intacte', () => {
    const split = addTransaction('Paiement carte COOP PRONTO', -10000);
    db.prepare(
      'INSERT INTO transaction_splits (transaction_id, category_id, amount_cents) VALUES (?, ?, ?)',
    ).run(split, restaurants, -10000);
    addRule({ pattern: 'COOP', category_id: courses });

    expect(applyRules(db).updated).toBe(0);
    expect(categoryOf(split)).toBeNull();
  });

  it('retient la règle la plus prioritaire quand deux correspondent', () => {
    const transaction = addTransaction('COOP Restaurant Gare', -3200);
    addRule({ pattern: 'COOP', category_id: courses, priority: 100 });
    addRule({ pattern: 'COOP RESTAURANT', category_id: restaurants, priority: 10 });

    applyRules(db);
    expect(categoryOf(transaction)).toBe(restaurants);
  });

  it('pose l’attribution quand la règle en porte une', () => {
    const transaction = addTransaction('Abonnement fitness', -8900);
    addRule({ pattern: 'FITNESS', category_id: courses, owner: 'p1' });

    applyRules(db);
    expect(db.prepare('SELECT owner FROM transactions WHERE id = ?').get(transaction)).toEqual({
      owner: 'p1',
    });
  });

  it('compte les utilisations de chaque règle', () => {
    addTransaction('COOP Pronto', -450);
    addTransaction('COOP Pronto', -450);
    const ruleId = addRule({ pattern: 'COOP', category_id: courses });

    const result = applyRules(db);
    expect(result.byRule).toEqual([{ ruleId, pattern: 'COOP', count: 2 }]);
    expect(db.prepare('SELECT hits FROM category_rules WHERE id = ?').get(ruleId)).toEqual({
      hits: 2,
    });
  });

  it('se restreint aux écritures désignées', () => {
    const first = addTransaction('COOP Pronto', -450);
    const second = addTransaction('COOP Pronto Lausanne', -650);
    addRule({ pattern: 'COOP', category_id: courses });

    expect(applyRules(db, [first]).updated).toBe(1);
    expect(categoryOf(first)).toBe(courses);
    expect(categoryOf(second)).toBeNull();
  });
});

describe('simulation d’une règle', () => {
  it('chiffre ce qu’elle prendrait avant qu’on ne la crée', () => {
    addTransaction('COOP Pronto', -450);
    addTransaction('COOP Pronto Lausanne', -650);
    addTransaction('Migros Fribourg', -2300);
    addTransaction('COOP déjà classée', -900, restaurants);

    expect(countMatches(db, rule({ pattern: 'COOP', category_id: courses }))).toBe(2);
    expect(countMatches(db, rule({ pattern: 'MIGROS', category_id: courses }))).toBe(1);
    expect(countMatches(db, rule({ pattern: 'INTROUVABLE', category_id: courses }))).toBe(0);
  });
});
