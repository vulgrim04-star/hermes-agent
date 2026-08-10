/**
 * Agrégats du tableau de bord mensuel.
 *
 * La lecture du journal et les conventions de calcul vivent dans `ledger.ts`,
 * partagées avec la vue annuelle : le reste à vivre n'a ainsi qu'une seule
 * définition dans le code, et les deux écrans ne peuvent pas diverger.
 */

import { previousMonth } from '../../shared/dates.js';
import type { CategoryKind } from '../../shared/model.js';
import type { Db } from '../db/connection.js';
import { actualsByCategory, byOrder, readCategories, readMonth, totalsOf } from './ledger.js';
import type { CategoryRow, Totals } from './ledger.js';

export type { Totals } from './ledger.js';
export { availableMonths } from './ledger.js';

export interface BudgetLine {
  categoryId: number | null;
  name: string;
  parentId: number | null;
  kind: CategoryKind;
  /** Grandeur positive, dans le sens naturel du type de mouvement. */
  actualCents: number;
  budgetCents: number | null;
  /** Budget − réel : négatif en cas de dépassement. */
  gapCents: number | null;
  /** Réel / budget, `null` sans budget. */
  ratio: number | null;
}

export interface MonthlySummary {
  month: string;
  totals: Totals;
  previous: { month: string | null; totals: Totals };
  uncategorised: { count: number; amountCents: number };
  budgetLines: BudgetLine[];
  expenseBreakdown: { categoryId: number | null; name: string; amountCents: number; share: number }[];
  topExpenses: {
    transactionId: number;
    valueDate: string;
    label: string;
    categoryName: string | null;
    amountCents: number;
  }[];
}

/** Budget applicable à une catégorie pour un mois : dérogation, sinon défaut. */
export function resolveBudgets(db: Db, month: string): Map<number, number> {
  const rows = db
    .prepare(
      `SELECT category_id,
              COALESCE(
                MAX(CASE WHEN period = ? THEN amount_cents END),
                MAX(CASE WHEN period IS NULL THEN amount_cents END)
              ) AS amount_cents
         FROM budgets
        GROUP BY category_id`,
    )
    .all(month) as { category_id: number; amount_cents: number | null }[];

  const budgets = new Map<number, number>();
  for (const row of rows) {
    if (row.amount_cents !== null) budgets.set(row.category_id, row.amount_cents);
  }
  return budgets;
}

/**
 * Construit une ligne de budget pour une catégorie.
 *
 * Une racine porte ses propres écritures et celles de ses sous-catégories,
 * budget compris : c'est ce total qui est comparé à son budget.
 */
export function budgetLineOf(
  category: CategoryRow,
  categories: readonly CategoryRow[],
  actuals: ReadonlyMap<number, number>,
  budgets: ReadonlyMap<number, number>,
): BudgetLine {
  const children = categories.filter((entry) => entry.parent_id === category.id);
  const actual =
    (actuals.get(category.id) ?? 0) +
    children.reduce((sum, child) => sum + (actuals.get(child.id) ?? 0), 0);
  const budget =
    budgets.get(category.id) ??
    (children.some((child) => budgets.has(child.id))
      ? children.reduce((sum, child) => sum + (budgets.get(child.id) ?? 0), 0)
      : null);

  return {
    categoryId: category.id,
    name: category.name,
    parentId: category.parent_id,
    kind: category.kind,
    actualCents: actual,
    budgetCents: budget,
    gapCents: budget === null ? null : budget - actual,
    ratio: budget === null || budget === 0 ? null : actual / budget,
  };
}

export function monthlySummary(db: Db, month: string): MonthlySummary {
  const lines = readMonth(db, month);
  const previous = previousMonth(month);

  const uncategorisedLines = lines.filter((line) => line.category_id === null);
  const budgets = resolveBudgets(db, month);
  const actualByCategory = actualsByCategory(lines);

  const categories = readCategories(db);
  const byId = new Map(categories.map((category) => [category.id, category]));

  // Une catégorie apparaît si elle a un budget ou un mouvement — et sa racine
  // avec elle, pour que le tableau reste lisible en arborescence.
  const visible = new Set<number>([...actualByCategory.keys(), ...budgets.keys()]);
  for (const id of [...visible]) {
    const parentId = byId.get(id)?.parent_id;
    if (parentId != null) visible.add(parentId);
  }

  // Rendu en ordre d'arborescence — chaque racine suivie de ses sous-catégories,
  // pour que l'écran n'ait pas à reconstruire la hiérarchie.
  const budgetLines: BudgetLine[] = [];
  for (const root of categories.filter((entry) => entry.parent_id === null).sort(byOrder)) {
    const children = categories.filter((entry) => entry.parent_id === root.id).sort(byOrder);
    const visibleChildren = children.filter((child) => visible.has(child.id));
    if (!visible.has(root.id) && visibleChildren.length === 0) continue;

    budgetLines.push(budgetLineOf(root, categories, actualByCategory, budgets));
    for (const child of visibleChildren) {
      budgetLines.push(budgetLineOf(child, categories, actualByCategory, budgets));
    }
  }

  // Répartition des dépenses par catégorie racine, non catégorisé inclus :
  // masquer ce qui n'est pas affecté donnerait un camembert flatteur et faux.
  const expenseByRoot = new Map<number | null, { name: string; amountCents: number }>();
  for (const line of lines) {
    if (line.kind !== 'depense') continue;
    const key = line.root_id;
    const name = line.root_name ?? 'Non catégorisé';
    const entry = expenseByRoot.get(key) ?? { name, amountCents: 0 };
    entry.amountCents -= line.amount_cents;
    expenseByRoot.set(key, entry);
  }
  const expenseTotal = [...expenseByRoot.values()].reduce((sum, entry) => sum + entry.amountCents, 0);
  const expenseBreakdown = [...expenseByRoot.entries()]
    .map(([categoryId, entry]) => ({
      categoryId,
      name: entry.name,
      amountCents: entry.amountCents,
      share: expenseTotal > 0 ? entry.amountCents / expenseTotal : 0,
    }))
    .filter((entry) => entry.amountCents > 0)
    .sort((a, b) => b.amountCents - a.amountCents);

  const topExpenses = lines
    .filter((line) => line.kind === 'depense' && line.amount_cents < 0)
    .sort((a, b) => a.amount_cents - b.amount_cents)
    .slice(0, 10)
    .map((line) => ({
      transactionId: line.transaction_id,
      valueDate: line.value_date,
      label: line.label,
      categoryName: line.category_name,
      amountCents: line.amount_cents,
    }));

  return {
    month,
    totals: totalsOf(lines),
    previous: {
      month: previous,
      totals: previous === null ? totalsOf([]) : totalsOf(readMonth(db, previous)),
    },
    uncategorised: {
      count: new Set(uncategorisedLines.map((line) => line.transaction_id)).size,
      amountCents: uncategorisedLines.reduce((sum, line) => sum + line.amount_cents, 0),
    },
    budgetLines,
    expenseBreakdown,
    topExpenses,
  };
}
