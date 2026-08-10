/**
 * Client d'API.
 *
 * Toutes les requêtes partent vers `/api`, que Vite renvoie au serveur local.
 * Aucune adresse externe n'apparaît ici, et il ne doit jamais y en avoir : les
 * données de ce dossier ne quittent pas la machine.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly payload: unknown = null,
  ) {
    super(message);
  }
}

async function unwrap<T>(response: Response): Promise<T> {
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload !== null && typeof payload === 'object' && 'message' in payload
        ? String((payload as { message: unknown }).message)
        : `Erreur ${response.status}`;
    throw new ApiError(response.status, message, payload);
  }
  return payload as T;
}

export async function apiGet<T>(path: string): Promise<T> {
  return unwrap<T>(await fetch(`/api${path}`));
}

export async function apiSend<T>(
  path: string,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  body?: unknown,
): Promise<T> {
  return unwrap<T>(
    await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

/** Dépôt de fichier : le statut fait partie de la réponse utile (422, 409…). */
export async function apiUpload(
  path: string,
  form: FormData,
): Promise<{ status: number; data: unknown }> {
  const response = await fetch(`/api${path}`, { method: 'POST', body: form });
  return { status: response.status, data: await response.json().catch(() => null) };
}

// ------------------------------------------------------------------ Modèles

export type { Owner, CategoryKind } from '../../shared/model.js';
import type { CategoryKind, Owner } from '../../shared/model.js';

export interface Account {
  id: number;
  account_key: string;
  label: string;
  currency: string;
  default_owner: Owner;
  is_active: number;
  transaction_count: number;
}

export interface Category {
  id: number;
  parent_id: number | null;
  parent_name: string | null;
  name: string;
  kind: CategoryKind;
}

// ------------------------------------------ Catégorisation, budgets, révision

export interface CategoryRuleRow {
  id: number;
  pattern: string;
  match_type: 'contient' | 'regex';
  category_id: number | null;
  category_name: string | null;
  category_parent_name: string | null;
  owner: Owner | null;
  direction: 'tout' | 'debit' | 'credit';
  account_id: number | null;
  account_label: string | null;
  priority: number;
  is_active: number;
  hits: number;
}

export interface ReviewTransaction {
  id: number;
  value_date: string;
  booking_date: string | null;
  amount_cents: number;
  currency: string;
  label: string;
  counterparty: string | null;
  owner: Owner;
  source: string;
  account_label: string;
}

export interface TransferPairRow {
  id: number;
  day_gap: number;
  out_id: number;
  out_date: string;
  out_label: string;
  out_amount: number;
  out_account: string;
  in_id: number;
  in_date: string;
  in_label: string;
  in_amount: number;
  in_account: string;
}

export interface ReviewQueue {
  transactions: ReviewTransaction[];
  frequent: { id: number; name: string; parent_name: string | null; uses: number }[];
  transfers: TransferPairRow[];
}

export interface SplitRow {
  id: number;
  transaction_id: number;
  category_id: number | null;
  category_name: string | null;
  category_parent_name: string | null;
  amount_cents: number;
  owner: Owner | null;
  note: string | null;
}

export interface BudgetRow {
  category_id: number;
  name: string;
  parent_id: number | null;
  parent_name: string | null;
  kind: CategoryKind;
  default_cents: number | null;
  override_cents: number | null;
}

export interface DashboardTotals {
  incomeCents: number;
  expenseCents: number;
  savingsCents: number;
  remainingCents: number;
  savingsRate: number | null;
}

export interface DashboardBudgetLine {
  categoryId: number | null;
  name: string;
  parentId: number | null;
  kind: CategoryKind;
  actualCents: number;
  budgetCents: number | null;
  gapCents: number | null;
  ratio: number | null;
}

export interface MonthlyDashboard {
  month: string;
  availableMonths: string[];
  totals: DashboardTotals;
  previous: { month: string | null; totals: DashboardTotals };
  uncategorised: { count: number; amountCents: number };
  budgetLines: DashboardBudgetLine[];
  expenseBreakdown: { categoryId: number | null; name: string; amountCents: number; share: number }[];
  topExpenses: {
    transactionId: number;
    valueDate: string;
    label: string;
    categoryName: string | null;
    amountCents: number;
  }[];
}

export interface Transaction {
  id: number;
  account_id: number;
  account_label: string;
  value_date: string;
  booking_date: string | null;
  amount_cents: number;
  currency: string;
  label: string;
  counterparty: string | null;
  bank_reference: string | null;
  category_id: number | null;
  category_name: string | null;
  category_parent_name: string | null;
  owner: Owner;
  notes: string | null;
  source: 'csv' | 'mt940' | 'manuel';
  batch_id: number | null;
}

export interface TransactionList {
  rows: Transaction[];
  totals: { count: number; income_cents: number; expense_cents: number };
}

export interface ImportBatch {
  id: number;
  filename: string;
  format: 'csv' | 'mt940';
  status: 'brouillon' | 'valide';
  encoding: string | null;
  delimiter: string | null;
  rows_read: number;
  rows_imported: number;
  rows_duplicate: number;
  rows_soft_duplicate: number;
  rows_error: number;
  reconciliation_status: 'ok' | 'ko' | 'absent';
  reconciliation_gap_cents: number | null;
  forced: number;
  created_at: string;
  validated_at: string | null;
  transaction_count: number;
  accounts: string | null;
}

export interface ImportStatement {
  id: number;
  account_label: string | null;
  account_key: string | null;
  reference: string | null;
  currency: string;
  opening_balance_cents: number | null;
  closing_balance_cents: number | null;
  opening_date: string | null;
  closing_date: string | null;
  movements_cents: number;
  gap_cents: number | null;
  status: 'ok' | 'ko' | 'absent';
}

export interface PendingTransaction {
  id: number;
  statement_id: number;
  line_number: number | null;
  value_date: string;
  booking_date: string | null;
  amount_cents: number;
  currency: string;
  label: string;
  counterparty: string | null;
  bank_reference: string | null;
  duplicate_kind: 'aucun' | 'strict' | 'probable';
  include: number;
}

export interface ImportIssue {
  id: number;
  line_number: number | null;
  severity: 'erreur' | 'avertissement';
  message: string;
  raw: string | null;
}

export interface BatchReport {
  batch: ImportBatch;
  statements: ImportStatement[];
  rows: PendingTransaction[];
  issues: ImportIssue[];
  blocking: string[];
}

export type CanonicalField =
  | 'valueDate'
  | 'bookingDate'
  | 'label'
  | 'debit'
  | 'credit'
  | 'amount'
  | 'balance'
  | 'reference'
  | 'currency'
  | 'counterparty';

export interface ColumnSample {
  index: number;
  header: string;
  samples: string[];
  suggested: CanonicalField | null;
}

export interface MappingRequired {
  kind: 'mapping-requis';
  encoding: string;
  delimiter: string;
  headerLine: number;
  headers: string[];
  signature: string;
  columns: ColumnSample[];
  suggestion: Record<string, number | number[]>;
  missing: string[];
}
