import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { formatSwissDate } from '../../shared/dates.js';
import { parseAmountToCents } from '../../shared/money.js';
import { apiGet, apiSend } from '../lib/api.js';
import type { Account, Category, Owner, TransactionList } from '../lib/api.js';
import { KIND_LABELS, OWNER_ORDER, ownerLabel } from '../lib/labels.js';
import { Amount, Badge, Button, Card, EmptyState, Field, inputClass } from '../components/ui.js';

interface Filters {
  from: string;
  to: string;
  accountId: string;
  owner: string;
  categoryId: string;
  search: string;
}

const EMPTY_FILTERS: Filters = {
  from: '',
  to: '',
  accountId: '',
  owner: '',
  categoryId: '',
  search: '',
};

export function TransactionsPage() {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [creating, setCreating] = useState(false);
  const queryClient = useQueryClient();

  const accounts = useQuery({ queryKey: ['accounts'], queryFn: () => apiGet<Account[]>('/comptes') });
  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => apiGet<Category[]>('/categories'),
  });
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiGet<Record<string, string>>('/parametres'),
  });

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value !== '') params.set(key, value);
    return params.toString();
  }, [filters]);

  const transactions = useQuery({
    queryKey: ['transactions', queryString],
    queryFn: () => apiGet<TransactionList>(`/transactions?${queryString}`),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['transactions'] });
    void queryClient.invalidateQueries({ queryKey: ['accounts'] });
  };

  const update = useMutation({
    mutationFn: (input: { id: number; patch: Record<string, unknown> }) =>
      apiSend(`/transactions/${input.id}`, 'PATCH', input.patch),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: number) => apiSend(`/transactions/${id}`, 'DELETE'),
    onSuccess: invalidate,
  });

  const totals = transactions.data?.totals;
  const balance = (totals?.income_cents ?? 0) + (totals?.expense_cents ?? 0);

  return (
    <div className="flex flex-col gap-6">
      <Card
        title="Filtres"
        actions={
          <>
            <Button onClick={() => setFilters(EMPTY_FILTERS)}>Réinitialiser</Button>
            <Button variant="primary" onClick={() => setCreating((value) => !value)}>
              {creating ? 'Fermer la saisie' : 'Nouvelle écriture'}
            </Button>
          </>
        }
      >
        <div className="flex flex-wrap gap-4">
          <Field label="Du">
            <input
              type="date"
              className={inputClass}
              value={filters.from}
              onChange={(e) => setFilters({ ...filters, from: e.target.value })}
            />
          </Field>
          <Field label="Au">
            <input
              type="date"
              className={inputClass}
              value={filters.to}
              onChange={(e) => setFilters({ ...filters, to: e.target.value })}
            />
          </Field>
          <Field label="Compte">
            <select
              className={inputClass}
              value={filters.accountId}
              onChange={(e) => setFilters({ ...filters, accountId: e.target.value })}
            >
              <option value="">Tous</option>
              {(accounts.data ?? []).map((account) => (
                <option key={account.id} value={account.id}>
                  {account.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Personne">
            <select
              className={inputClass}
              value={filters.owner}
              onChange={(e) => setFilters({ ...filters, owner: e.target.value })}
            >
              <option value="">Toutes</option>
              {OWNER_ORDER.map((owner) => (
                <option key={owner} value={owner}>
                  {ownerLabel(owner, settings.data)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Catégorie">
            <select
              className={inputClass}
              value={filters.categoryId}
              onChange={(e) => setFilters({ ...filters, categoryId: e.target.value })}
            >
              <option value="">Toutes</option>
              <option value="none">Non catégorisées</option>
              {(categories.data ?? []).map((category) => (
                <option key={category.id} value={category.id}>
                  {category.parent_name === null
                    ? category.name
                    : `${category.parent_name} › ${category.name}`}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Libellé contient">
            <input
              className={inputClass}
              value={filters.search}
              placeholder="coop"
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            />
          </Field>
        </div>
      </Card>

      {creating && (
        <ManualEntryForm
          accounts={accounts.data ?? []}
          categories={categories.data ?? []}
          settings={settings.data ?? {}}
          onCreated={() => {
            setCreating(false);
            invalidate();
          }}
        />
      )}

      <Card
        title={`Écritures (${totals?.count ?? 0})`}
        actions={
          <div className="flex items-center gap-4 text-sm">
            <span>
              Entrées <Amount cents={totals?.income_cents ?? 0} />
            </span>
            <span>
              Sorties <Amount cents={totals?.expense_cents ?? 0} />
            </span>
            <span className="font-semibold">
              Solde <Amount cents={balance} />
            </span>
          </div>
        }
      >
        {transactions.isLoading ? (
          <EmptyState>Chargement…</EmptyState>
        ) : (transactions.data?.rows.length ?? 0) === 0 ? (
          <EmptyState>Aucune écriture — importez un relevé ou saisissez-en une.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-2">Date</th>
                  <th>Libellé</th>
                  <th>Compte</th>
                  <th>Catégorie</th>
                  <th>Personne</th>
                  <th className="text-right">Montant</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(transactions.data?.rows ?? []).map((transaction) => (
                  <tr key={transaction.id} className="border-t border-slate-100 align-top">
                    <td className="py-2 whitespace-nowrap tabular">
                      {formatSwissDate(transaction.value_date)}
                      {transaction.booking_date !== null && (
                        <span className="block text-xs text-slate-400">
                          compta. {formatSwissDate(transaction.booking_date)}
                        </span>
                      )}
                    </td>
                    <td className="max-w-md">
                      <span>{transaction.label}</span>
                      <span className="ml-2 text-xs text-slate-400">
                        {transaction.source === 'manuel' ? 'saisie' : transaction.source}
                      </span>
                      {transaction.counterparty !== null && (
                        <span className="block text-xs text-slate-400">
                          {transaction.counterparty}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap text-slate-500">{transaction.account_label}</td>
                    <td>
                      <select
                        className={inputClass}
                        value={transaction.category_id ?? ''}
                        onChange={(e) =>
                          update.mutate({
                            id: transaction.id,
                            patch: {
                              categoryId: e.target.value === '' ? null : Number(e.target.value),
                            },
                          })
                        }
                      >
                        <option value="">— à catégoriser —</option>
                        {(categories.data ?? []).map((category) => (
                          <option key={category.id} value={category.id}>
                            {category.parent_name === null
                              ? `${category.name} (${KIND_LABELS[category.kind]})`
                              : `${category.parent_name} › ${category.name}`}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        className={inputClass}
                        value={transaction.owner}
                        onChange={(e) =>
                          update.mutate({
                            id: transaction.id,
                            patch: { owner: e.target.value as Owner },
                          })
                        }
                      >
                        {OWNER_ORDER.map((owner) => (
                          <option key={owner} value={owner}>
                            {ownerLabel(owner, settings.data)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="whitespace-nowrap text-right">
                      <Amount cents={transaction.amount_cents} />
                      {transaction.currency !== 'CHF' && (
                        <span className="ml-1 text-xs text-slate-400">{transaction.currency}</span>
                      )}
                    </td>
                    <td className="text-right">
                      <Button variant="ghost" onClick={() => remove.mutate(transaction.id)}>
                        Supprimer
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function ManualEntryForm({
  accounts,
  categories,
  settings,
  onCreated,
}: {
  accounts: Account[];
  categories: Category[];
  settings: Record<string, string>;
  onCreated: () => void;
}) {
  const [valueDate, setValueDate] = useState(new Date().toISOString().slice(0, 10));
  const [accountId, setAccountId] = useState('');
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [owner, setOwner] = useState<Owner | ''>('');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      apiSend('/transactions', 'POST', {
        accountId: Number(accountId),
        valueDate,
        label,
        amount,
        categoryId: categoryId === '' ? null : Number(categoryId),
        owner: owner === '' ? undefined : owner,
      }),
    onSuccess: () => {
      setLabel('');
      setAmount('');
      setError(null);
      onCreated();
    },
    onError: (cause: Error) => setError(cause.message),
  });

  // Aperçu de l'interprétation du montant : ce que la base enregistrera,
  // affiché avant d'enregistrer.
  const parsedAmount = amount.trim() === '' ? null : parseAmountToCents(amount);

  return (
    <Card
      title="Saisie manuelle"
      description="Un montant négatif est une dépense. Les formats 12'450.80 et 1234,56 sont acceptés."
    >
      <div className="flex flex-wrap items-end gap-4">
        <Field label="Date de valeur">
          <input
            type="date"
            className={inputClass}
            value={valueDate}
            onChange={(e) => setValueDate(e.target.value)}
          />
        </Field>
        <Field label="Compte">
          <select
            className={inputClass}
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          >
            <option value="">Choisir…</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Libellé">
          <input
            className={`${inputClass} w-72`}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </Field>
        <Field label="Montant">
          <input
            className={`${inputClass} w-40 text-right tabular`}
            value={amount}
            placeholder="-45.60"
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Field label="Catégorie">
          <select
            className={inputClass}
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">— à catégoriser —</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.parent_name === null
                  ? category.name
                  : `${category.parent_name} › ${category.name}`}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Personne">
          <select
            className={inputClass}
            value={owner}
            onChange={(e) => setOwner(e.target.value as Owner | '')}
          >
            <option value="">Défaut du compte</option>
            {OWNER_ORDER.map((value) => (
              <option key={value} value={value}>
                {ownerLabel(value, settings)}
              </option>
            ))}
          </select>
        </Field>
        <Button
          variant="primary"
          disabled={
            accountId === '' || label.trim() === '' || parsedAmount === null || create.isPending
          }
          onClick={() => create.mutate()}
        >
          Enregistrer
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500">
        {amount.trim() !== '' &&
          (parsedAmount === null ? (
            <Badge tone="error">Montant illisible</Badge>
          ) : (
            <span>
              Sera enregistré : <Amount cents={parsedAmount} className="font-semibold" /> CHF
            </span>
          ))}
        <span>
          L’écriture saisie reçoit la même empreinte qu’une écriture importée : si le relevé arrive
          ensuite, le doublon sera signalé.
        </span>
      </div>
      {error !== null && (
        <p className="mt-3">
          <Badge tone="error">{error}</Badge>
        </p>
      )}
    </Card>
  );
}
