/**
 * Lecture du journal et conventions de calcul, partagées par le tableau de bord
 * mensuel et la vue annuelle.
 *
 * Tout part de la vue `transaction_lines`, qui rend une ligne par découpe et une
 * seule ligne pour une écriture entière : le découpage est donc traité
 * correctement sans que chaque requête ait à s'en soucier.
 *
 * Deux conventions, tenues partout :
 *
 *  - **Les totaux sont des grandeurs positives.** Revenus, dépenses et épargne
 *    se lisent comme sur un compte de résultat ; seul le reste à vivre est
 *    signé, parce qu'il peut être négatif.
 *  - **Reste à vivre = revenus − dépenses − épargne.** L'épargne est un emploi
 *    du revenu, pas une consommation.
 *
 * Ce module existe pour qu'il n'y ait **qu'une seule définition du reste à
 * vivre** dans le code : deux écrans qui répondent différemment à la même
 * question, c'est un écran de trop.
 */

import { monthBounds } from '../../shared/dates.js';
import type { CategoryKind } from '../../shared/model.js';
import type { Db } from '../db/connection.js';

export interface Totals {
  /** Grandeurs positives, sauf `remainingCents` qui est signé. */
  incomeCents: number;
  expenseCents: number;
  savingsCents: number;
  remainingCents: number;
  /** Épargne / revenus, `null` quand il n'y a pas de revenu à rapporter. */
  savingsRate: number | null;
}

export interface LineRow {
  transaction_id: number;
  value_date: string;
  label: string;
  amount_cents: number;
  category_id: number | null;
  kind: CategoryKind;
  category_name: string | null;
  root_id: number | null;
  root_name: string | null;
}

export interface CategoryRow {
  id: number;
  name: string;
  parent_id: number | null;
  kind: CategoryKind;
  sort_order: number;
}

/**
 * Une ligne sans catégorie est classée par son signe : elle reste dans les
 * totaux, faute de quoi le tableau de bord serait faux en silence sur ce qui
 * n'a pas encore été affecté. Elle est en outre comptée à part, pour que
 * l'utilisateur sache ce qui reste à traiter.
 */
const LINES = `
  SELECT l.transaction_id, l.value_date, l.label, l.amount_cents, l.category_id,
         COALESCE(c.kind, CASE WHEN l.amount_cents > 0 THEN 'revenu' ELSE 'depense' END) AS kind,
         c.name AS category_name,
         COALESCE(c.parent_id, c.id) AS root_id,
         COALESCE(p.name, c.name) AS root_name
    FROM transaction_lines l
    LEFT JOIN categories c ON c.id = l.category_id
    LEFT JOIN categories p ON p.id = c.parent_id
   WHERE l.is_internal_transfer = 0
     AND l.value_date BETWEEN ? AND ?
`;

/** Lignes du journal sur une plage de dates, bornes comprises. */
export function readRange(db: Db, start: string, end: string): LineRow[] {
  return db.prepare(LINES).all(start, end) as LineRow[];
}

/** Lignes d'un mois `AAAA-MM`. Un mois mal formé ne rend rien. */
export function readMonth(db: Db, month: string): LineRow[] {
  const bounds = monthBounds(month);
  if (bounds === null) return [];
  return readRange(db, bounds.start, bounds.end);
}

export function totalsOf(lines: readonly LineRow[]): Totals {
  let incomeCents = 0;
  let expenseCents = 0;
  let savingsCents = 0;

  for (const line of lines) {
    if (line.kind === 'revenu') incomeCents += line.amount_cents;
    else if (line.kind === 'epargne') savingsCents -= line.amount_cents;
    else expenseCents -= line.amount_cents;
  }

  const remainingCents = incomeCents - expenseCents - savingsCents;
  return {
    incomeCents,
    expenseCents,
    savingsCents,
    remainingCents,
    savingsRate: incomeCents > 0 ? savingsCents / incomeCents : null,
  };
}

/**
 * Réel par catégorie, dans le sens naturel du type de mouvement : une dépense
 * de 45.60 vaut +4560 en face de son budget, pas −4560.
 */
export function actualsByCategory(lines: readonly LineRow[]): Map<number, number> {
  const totals = new Map<number, number>();
  for (const line of lines) {
    if (line.category_id === null) continue;
    const magnitude = line.kind === 'revenu' ? line.amount_cents : -line.amount_cents;
    totals.set(line.category_id, (totals.get(line.category_id) ?? 0) + magnitude);
  }
  return totals;
}

export function readCategories(db: Db): CategoryRow[] {
  return db
    .prepare('SELECT id, name, parent_id, kind, sort_order FROM categories')
    .all() as CategoryRow[];
}

/** Ordre d'affichage : celui du plan de comptes, puis l'alphabet français. */
export function byOrder(
  a: { sort_order: number; name: string },
  b: { sort_order: number; name: string },
): number {
  return a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'fr');
}

/** Mois pour lesquels la base contient des écritures, du plus récent au plus ancien. */
export function availableMonths(db: Db): string[] {
  return (
    db
      .prepare(
        `SELECT DISTINCT substr(value_date, 1, 7) AS month
           FROM transactions ORDER BY month DESC`,
      )
      .all() as { month: string }[]
  ).map((row) => row.month);
}
