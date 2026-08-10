/**
 * Agrégats du tableau de bord mensuel.
 *
 * Tout est calculé sur la vue `transaction_lines`, qui rend une ligne par
 * découpe et une seule ligne pour une écriture entière : le découpage est donc
 * traité correctement sans que chaque requête ait à s'en soucier.
 *
 * Deux conventions, tenues partout :
 *
 *  - **Les totaux sont des grandeurs positives.** Revenus, dépenses et épargne
 *    se lisent comme sur un compte de résultat ; seul le reste à vivre est
 *    signé, parce qu'il peut être négatif.
 *  - **Reste à vivre = revenus − dépenses − épargne.** L'épargne est un emploi
 *    du revenu, pas une consommation.
 */

import { monthBounds, previousMonth } from '../../shared/dates.js';
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

interface LineRow {
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

function readLines(db: Db, month: string): LineRow[] {
  const bounds = monthBounds(month);
  if (bounds === null) return [];
  return db.prepare(LINES).all(bounds.start, bounds.end) as LineRow[];
}

function totalsOf(lines: readonly LineRow[]): Totals {
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

/** Budget applicable à une catégorie pour un mois : dérogation, sinon défaut. */
function resolveBudgets(db: Db, month: string): Map<number, number> {
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

export function monthlySummary(db: Db, month: string): MonthlySummary {
  const lines = readLines(db, month);
  const previous = previousMonth(month);

  const uncategorisedLines = lines.filter((line) => line.category_id === null);
  const budgets = resolveBudgets(db, month);

  // Réel par catégorie, dans le sens naturel du type de mouvement.
  const actualByCategory = new Map<number, number>();
  for (const line of lines) {
    if (line.category_id === null) continue;
    const magnitude = line.kind === 'revenu' ? line.amount_cents : -line.amount_cents;
    actualByCategory.set(
      line.category_id,
      (actualByCategory.get(line.category_id) ?? 0) + magnitude,
    );
  }

  const categories = db
    .prepare('SELECT id, name, parent_id, kind, sort_order FROM categories')
    .all() as { id: number; name: string; parent_id: number | null; kind: CategoryKind; sort_order: number }[];
  const byId = new Map(categories.map((category) => [category.id, category]));

  // Une catégorie apparaît si elle a un budget ou un mouvement — et sa racine
  // avec elle, pour que le tableau reste lisible en arborescence.
  const visible = new Set<number>([...actualByCategory.keys(), ...budgets.keys()]);
  for (const id of [...visible]) {
    const parentId = byId.get(id)?.parent_id;
    if (parentId != null) visible.add(parentId);
  }

  const byOrder = (a: { sort_order: number; name: string }, b: { sort_order: number; name: string }) =>
    a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'fr');

  // Rendu en ordre d'arborescence — chaque racine suivie de ses sous-catégories,
  // pour que l'écran n'ait pas à reconstruire la hiérarchie.
  const budgetLines: BudgetLine[] = [];
  const lineOf = (category: (typeof categories)[number]): BudgetLine => {
    // Une racine porte ses propres écritures et celles de ses sous-catégories,
    // budget compris : c'est ce total qui est comparé à son budget.
    const children = categories.filter((entry) => entry.parent_id === category.id);
    const actual =
      (actualByCategory.get(category.id) ?? 0) +
      children.reduce((sum, child) => sum + (actualByCategory.get(child.id) ?? 0), 0);
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
  };

  for (const root of categories.filter((entry) => entry.parent_id === null).sort(byOrder)) {
    const children = categories.filter((entry) => entry.parent_id === root.id).sort(byOrder);
    const visibleChildren = children.filter((child) => visible.has(child.id));
    if (!visible.has(root.id) && visibleChildren.length === 0) continue;

    budgetLines.push(lineOf(root));
    for (const child of visibleChildren) budgetLines.push(lineOf(child));
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
      totals: previous === null ? totalsOf([]) : totalsOf(readLines(db, previous)),
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
