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
  method: 'POST' | 'PATCH' | 'DELETE',
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

export type Owner = 'p1' | 'p2' | 'commun';

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
  kind: 'revenu' | 'depense' | 'epargne';
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
