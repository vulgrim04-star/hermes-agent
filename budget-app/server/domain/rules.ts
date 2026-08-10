/**
 * Moteur de règles de catégorisation.
 *
 * Une règle associe un motif de libellé à une catégorie. Deux principes la
 * gouvernent :
 *
 *  - **Elle comble les vides, elle n'écrase rien.** Une écriture déjà
 *    catégorisée à la main, ou déjà découpée, est laissée telle quelle. Un
 *    arbitrage humain ne se fait pas défaire par un automatisme.
 *  - **Elle est prévisible avant d'être appliquée.** `countMatches` chiffre ce
 *    qu'une règle prendrait avant qu'on ne la crée, pour qu'aucune règle trop
 *    large ne parte à l'aveugle sur l'exercice entier.
 */

import type { Owner } from '../../shared/model.js';
import type { Db } from '../db/connection.js';
import { normalizeLabel } from './fingerprint.js';

export type MatchType = 'contient' | 'regex';
export type Direction = 'tout' | 'debit' | 'credit';

export interface CategoryRule {
  id: number;
  pattern: string;
  match_type: MatchType;
  category_id: number | null;
  owner: Owner | null;
  direction: Direction;
  account_id: number | null;
  priority: number;
  is_active: number;
}

/** Ce qu'une règle examine d'une écriture. */
export interface RuleCandidate {
  label: string;
  label_normalized: string;
  amount_cents: number;
  account_id: number;
}

/**
 * Un motif `contient` porte sur le libellé normalisé — accents, casse et
 * ponctuation sont donc sans effet. Un motif `regex` porte sur le libellé brut,
 * insensible à la casse : qui écrit une expression régulière vise le texte réel.
 * Une expression invalide ne fait jamais correspondre, elle est refusée à la
 * création par `compileRegex`.
 */
export function matchesRule(rule: CategoryRule, candidate: RuleCandidate): boolean {
  if (rule.is_active === 0) return false;
  if (rule.account_id !== null && rule.account_id !== candidate.account_id) return false;
  if (rule.direction === 'debit' && candidate.amount_cents >= 0) return false;
  if (rule.direction === 'credit' && candidate.amount_cents <= 0) return false;

  if (rule.match_type === 'regex') {
    const expression = compileRegex(rule.pattern);
    return expression !== null && expression.test(candidate.label);
  }

  const needle = normalizeLabel(rule.pattern);
  if (needle === '') return false;
  return candidate.label_normalized.includes(needle);
}

const regexCache = new Map<string, RegExp | null>();

/** Compile une expression régulière, `null` si elle est invalide. */
export function compileRegex(pattern: string): RegExp | null {
  if (!regexCache.has(pattern)) {
    try {
      regexCache.set(pattern, new RegExp(pattern, 'i'));
    } catch {
      regexCache.set(pattern, null);
    }
  }
  return regexCache.get(pattern) ?? null;
}

/**
 * Écritures que les règles ont le droit de toucher : sans catégorie et sans
 * découpe. Une écriture découpée porte déjà une ventilation explicite.
 */
const UNCATEGORISED = `
  SELECT t.id, t.label, t.label_normalized, t.amount_cents, t.account_id
    FROM transactions t
   WHERE t.category_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id = t.id)
`;

export function activeRules(db: Db): CategoryRule[] {
  return db
    .prepare('SELECT * FROM category_rules WHERE is_active = 1 ORDER BY priority, id')
    .all() as CategoryRule[];
}

export interface RuleApplication {
  /** Nombre d'écritures catégorisées. */
  updated: number;
  /** Détail par règle, pour que le rapport dise quelle règle a fait quoi. */
  byRule: { ruleId: number; pattern: string; count: number }[];
}

/**
 * Rejoue les règles sur les écritures non catégorisées.
 * `transactionIds` restreint la portée — c'est ce qu'utilise la validation d'un
 * lot pour ne traiter que les écritures qu'elle vient d'insérer.
 */
export function applyRules(db: Db, transactionIds?: readonly number[]): RuleApplication {
  const rules = activeRules(db);
  if (rules.length === 0) return { updated: 0, byRule: [] };

  const candidates = (
    transactionIds === undefined
      ? db.prepare(UNCATEGORISED).all()
      : transactionIds.length === 0
        ? []
        : db
            .prepare(`${UNCATEGORISED} AND t.id IN (${transactionIds.map(() => '?').join(',')})`)
            .all(...transactionIds)
  ) as (RuleCandidate & { id: number })[];

  const counts = new Map<number, number>();
  const setCategory = db.prepare(
    `UPDATE transactions
        SET category_id = ?, owner = COALESCE(?, owner), updated_at = datetime('now')
      WHERE id = ?`,
  );

  const run = db.transaction(() => {
    let updated = 0;
    for (const candidate of candidates) {
      // Première règle qui correspond, par priorité croissante : une règle
      // spécifique se place devant une règle générique en lui donnant une
      // priorité plus basse.
      const rule = rules.find((entry) => matchesRule(entry, candidate));
      if (rule === undefined || rule.category_id === null) continue;

      setCategory.run(rule.category_id, rule.owner, candidate.id);
      counts.set(rule.id, (counts.get(rule.id) ?? 0) + 1);
      updated += 1;
    }

    const touch = db.prepare(
      "UPDATE category_rules SET hits = hits + ?, last_used_at = datetime('now') WHERE id = ?",
    );
    for (const [ruleId, count] of counts) touch.run(count, ruleId);
    return updated;
  });

  const updated = run();
  return {
    updated,
    byRule: [...counts.entries()].map(([ruleId, count]) => ({
      ruleId,
      pattern: rules.find((rule) => rule.id === ruleId)?.pattern ?? '',
      count,
    })),
  };
}

/**
 * Combien d'écritures non catégorisées cette règle prendrait-elle ?
 * Chiffré avant création, pour qu'une règle trop large se voie tout de suite.
 */
export function countMatches(db: Db, rule: Omit<CategoryRule, 'id'>): number {
  const candidates = db.prepare(UNCATEGORISED).all() as RuleCandidate[];
  const probe: CategoryRule = { ...rule, id: 0 };
  return candidates.filter((candidate) => matchesRule(probe, candidate)).length;
}

/**
 * Mots d'appareil bancaire et de calendrier : ils décrivent le canal ou la
 * période, jamais le commerçant. Les garder dans un motif le rendrait à la fois
 * trop long et trop fragile — « LOYER JANVIER » ne prendrait pas février.
 */
const NOISE_TOKENS = new Set([
  // canal de paiement, français
  'PAIEMENT', 'PAIEMENTS', 'CARTE', 'ACHAT', 'ACHATS', 'EN', 'LIGNE', 'VIREMENT', 'VIREMENTS',
  'ENTRANT', 'SORTANT', 'PRELEVEMENT', 'ORDRE', 'PERMANENT', 'DEBIT', 'CREDIT', 'TRANSFERT',
  'VERSEMENT', 'RETRAIT', 'BANCOMAT', 'EXTOURNE', 'REMBOURSEMENT',
  // canal de paiement, allemand
  'KARTENZAHLUNG', 'GUTSCHRIFT', 'LASTSCHRIFT', 'UEBERWEISUNG', 'DAUERAUFTRAG', 'BELASTUNG',
  'ZAHLUNG', 'KARTE',
  // mots outils et formes juridiques
  'DU', 'DE', 'DES', 'LA', 'LE', 'LES', 'AU', 'AUX', 'ET', 'POUR', 'PAR', 'SUR', 'AVEC', 'UN',
  'UNE', 'SA', 'SARL', 'AG', 'GMBH', 'SNC', 'REF', 'REFERENCE', 'NONREF', 'NR', 'NO', 'CHF', 'EUR',
  // mois
  'JANVIER', 'FEVRIER', 'MARS', 'AVRIL', 'MAI', 'JUIN', 'JUILLET', 'AOUT', 'SEPTEMBRE',
  'OCTOBRE', 'NOVEMBRE', 'DECEMBRE',
  'JANUAR', 'FEBRUAR', 'MAERZ', 'APRIL', 'JUNI', 'JULI', 'AUGUST', 'SEPTEMBER', 'OKTOBER',
  'NOVEMBER', 'DEZEMBER',
]);

/**
 * Motif proposé à partir d'un libellé, à l'usage de l'apprentissage.
 *
 * On retire le bruit, les nombres et les jetons trop courts, puis on garde le
 * premier jeton s'il est assez distinctif à lui seul, les deux premiers sinon —
 * « COOP » seul serait ambigu, « COOP PRONTO » désigne l'enseigne.
 * Le motif reste modifiable avant création : c'est une proposition, pas un verdict.
 */
export function suggestPattern(label: string): string {
  const normalized = normalizeLabel(label);
  if (normalized === '') return '';

  const tokens = normalized
    .split(' ')
    .filter((token) => token.length > 2 && !NOISE_TOKENS.has(token) && !/^\d+$/.test(token));

  if (tokens.length === 0) return normalized;
  const first = tokens[0] as string;
  if (first.length >= 6 || tokens.length === 1) return first;
  return `${first} ${tokens[1] as string}`;
}
