/**
 * Vue annuelle : douze mois en colonnes.
 *
 * Elle répond à des questions que le mensuel ne peut pas traiter — la prime
 * d'assurance semestrielle, l'acompte d'impôts trimestriel, le 13e salaire ne
 * se lisent qu'à l'échelle de l'année. Les totaux et les moyennes s'y calculent
 * sur les douze mois, y compris ceux sans écriture : un mois vide vaut zéro et
 * pèse dans la moyenne, sans quoi une moyenne mensuelle serait flatteuse dès
 * qu'un mois manque.
 *
 * Tout passe par `ledger.ts` : mêmes lignes, mêmes conventions, même définition
 * du reste à vivre que le tableau de bord mensuel.
 */

import type { CategoryKind } from '../../shared/model.js';
import type { Db } from '../db/connection.js';
import { actualsByCategory, byOrder, readCategories, readRange, totalsOf } from './ledger.js';
import type { LineRow, Totals } from './ledger.js';

export interface MonthColumn {
  month: string;
  totals: Totals;
}

export interface AnnualCategoryLine {
  categoryId: number;
  name: string;
  parentId: number | null;
  kind: CategoryKind;
  /** Douze valeurs, dans le sens naturel du type de mouvement. */
  monthlyCents: number[];
  totalCents: number;
  averageCents: number;
}

export interface AnnualSummary {
  year: number;
  months: MonthColumn[];
  totals: Totals;
  /** Moyennes mensuelles sur douze mois. */
  averages: Totals;
  categories: AnnualCategoryLine[];
  /** Année précédente, seulement si elle porte des écritures. */
  previous: { year: number; totals: Totals } | null;
  /** Mois effectivement mouvementés, pour distinguer un zéro d'un vide. */
  monthsWithEntries: number;
  uncategorised: { count: number; amountCents: number };
}

function monthsOf(year: number): string[] {
  return Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, '0')}`);
}

function readYear(db: Db, year: number): LineRow[] {
  return readRange(db, `${year}-01-01`, `${year}-12-31`);
}

/** Moyenne mensuelle sur douze mois, arrondie au centime. */
function averageOf(totals: Totals): Totals {
  const divide = (value: number) => Math.round(value / 12);
  const incomeCents = divide(totals.incomeCents);
  const expenseCents = divide(totals.expenseCents);
  const savingsCents = divide(totals.savingsCents);
  return {
    incomeCents,
    expenseCents,
    savingsCents,
    // Recalculé plutôt que divisé : la somme des arrondis n'est pas l'arrondi
    // de la somme, et le reste à vivre doit rester la différence affichée.
    remainingCents: incomeCents - expenseCents - savingsCents,
    savingsRate: totals.savingsRate,
  };
}

export function annualSummary(db: Db, year: number): AnnualSummary {
  const lines = readYear(db, year);
  const byMonth = new Map<string, LineRow[]>();
  for (const line of lines) {
    const month = line.value_date.slice(0, 7);
    const bucket = byMonth.get(month);
    if (bucket === undefined) byMonth.set(month, [line]);
    else bucket.push(line);
  }

  const months = monthsOf(year).map((month) => ({
    month,
    totals: totalsOf(byMonth.get(month) ?? []),
  }));

  const totals = totalsOf(lines);
  const categories = readCategories(db);
  const byId = new Map(categories.map((category) => [category.id, category]));

  // Réel par catégorie et par mois. Une catégorie n'apparaît que si elle a été
  // mouvementée dans l'année — un plan de comptes de 78 lignes en colonnes de
  // douze mois serait illisible et vide aux trois quarts.
  const perMonth = monthsOf(year).map((month) => actualsByCategory(byMonth.get(month) ?? []));
  const touched = new Set<number>();
  for (const monthActuals of perMonth) for (const id of monthActuals.keys()) touched.add(id);
  for (const id of [...touched]) {
    const parentId = byId.get(id)?.parent_id;
    if (parentId != null) touched.add(parentId);
  }

  const lineOf = (categoryId: number): AnnualCategoryLine => {
    const category = byId.get(categoryId)!;
    const children = categories.filter((entry) => entry.parent_id === categoryId);
    const monthlyCents = perMonth.map(
      (monthActuals) =>
        (monthActuals.get(categoryId) ?? 0) +
        children.reduce((sum, child) => sum + (monthActuals.get(child.id) ?? 0), 0),
    );
    const totalCents = monthlyCents.reduce((sum, value) => sum + value, 0);
    return {
      categoryId,
      name: category.name,
      parentId: category.parent_id,
      kind: category.kind,
      monthlyCents,
      totalCents,
      averageCents: Math.round(totalCents / 12),
    };
  };

  const categoryLines: AnnualCategoryLine[] = [];
  for (const root of categories.filter((entry) => entry.parent_id === null).sort(byOrder)) {
    const children = categories
      .filter((entry) => entry.parent_id === root.id && touched.has(entry.id))
      .sort(byOrder);
    if (!touched.has(root.id) && children.length === 0) continue;

    categoryLines.push(lineOf(root.id));
    for (const child of children) categoryLines.push(lineOf(child.id));
  }

  const previousLines = readYear(db, year - 1);
  const uncategorisedLines = lines.filter((line) => line.category_id === null);

  return {
    year,
    months,
    totals,
    averages: averageOf(totals),
    categories: categoryLines,
    // Une année précédente sans écriture n'est pas une année à zéro : elle n'a
    // pas eu lieu, et afficher −100 % de variation serait un mensonge.
    previous:
      previousLines.length === 0 ? null : { year: year - 1, totals: totalsOf(previousLines) },
    monthsWithEntries: months.filter((column) => byMonth.has(column.month)).length,
    uncategorised: {
      count: new Set(uncategorisedLines.map((line) => line.transaction_id)).size,
      amountCents: uncategorisedLines.reduce((sum, line) => sum + line.amount_cents, 0),
    },
  };
}

/** Années pour lesquelles la base contient des écritures, de la plus récente. */
export function availableYears(db: Db): number[] {
  return (
    db
      .prepare(
        `SELECT DISTINCT CAST(substr(value_date, 1, 4) AS INTEGER) AS year
           FROM transactions ORDER BY year DESC`,
      )
      .all() as { year: number }[]
  ).map((row) => row.year);
}
