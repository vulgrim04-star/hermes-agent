import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { formatCents } from '../../shared/money.js';
import { apiGet, apiSend } from '../lib/api.js';
import type { BudgetRow } from '../lib/api.js';
import { KIND_LABELS } from '../lib/labels.js';
import { Badge, Button, Card, EmptyState, Field, inputClass } from '../components/ui.js';

/**
 * Réglage des budgets.
 *
 * Deux colonnes plutôt qu'une : le budget mensuel courant, et la dérogation du
 * mois affiché. Les primes d'assurance et les acomptes d'impôts ne tombent pas
 * tous les mois — sans dérogation, un budget annuel étalé sur douze mois donne
 * onze mois en excédent et un mois en dépassement.
 */
export function BudgetsPage() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(false);
  const queryClient = useQueryClient();

  const budgets = useQuery({
    queryKey: ['budgets', month],
    queryFn: () => apiGet<{ period: string; rows: BudgetRow[] }>(`/budgets?mois=${month}`),
  });

  const save = useMutation({
    mutationFn: (input: { categoryId: number; period: string | null; amount: string }) =>
      apiSend('/budgets', 'PUT', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['budgets'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const rows = budgets.data?.rows ?? [];
  const budgeted = rows.filter((row) => row.default_cents !== null || row.override_cents !== null);

  // Dérouler les quelque quatre-vingts catégories d'un bloc rend la page
  // illisible. On s'en tient au budgété, sauf recherche ou demande explicite —
  // et tant que rien n'est budgété, on montre tout, sans quoi la page est vide.
  const needle = search.trim().toLowerCase();
  const visible = rows.filter((row) => {
    if (needle !== '') {
      return `${row.parent_name ?? ''} ${row.name}`.toLowerCase().includes(needle);
    }
    if (showAll || budgeted.length === 0) return true;
    return (
      row.default_cents !== null ||
      row.override_cents !== null ||
      // La racine reste affichée si l'une de ses sous-catégories est budgétée.
      budgeted.some((entry) => entry.parent_id === row.category_id)
    );
  });

  return (
    <div className="flex flex-col gap-6">
      <Card
        title="Budgets"
        description="Un montant vide supprime la ligne. Le budget d’un mois est la dérogation si elle existe, le budget mensuel sinon."
        actions={
          <>
            <Field label="Chercher une catégorie">
              <input
                className={`${inputClass} w-56`}
                value={search}
                placeholder="loyer, 3a, impôts…"
                onChange={(event) => setSearch(event.target.value)}
              />
            </Field>
            <Field label="Mois de la dérogation">
              <input
                type="month"
                className={inputClass}
                value={month}
                onChange={(event) => setMonth(event.target.value)}
              />
            </Field>
          </>
        }
      >
        <p className="mb-4 text-sm text-slate-600">
          {budgeted.length === 0
            ? 'Aucun budget posé pour l’instant.'
            : `${budgeted.length} catégorie(s) budgétée(s), pour un total mensuel de ${formatCents(
                budgeted.reduce(
                  (sum, row) => sum + (row.override_cents ?? row.default_cents ?? 0),
                  0,
                ),
              )} CHF sur ${monthLabel(month)}.`}
        </p>

        {budgeted.length > 0 && search.trim() === '' && (
          <p className="mb-4">
            <Button onClick={() => setShowAll((value) => !value)}>
              {showAll
                ? 'N’afficher que les catégories budgétées'
                : `Afficher les ${rows.length} catégories`}
            </Button>
          </p>
        )}

        {budgets.isLoading ? (
          <EmptyState>Chargement…</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-2">Catégorie</th>
                  <th className="w-44">Budget mensuel</th>
                  <th className="w-44">Dérogation {monthLabel(month)}</th>
                  <th className="w-32">Applicable</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr
                    key={row.category_id}
                    className={`border-t border-slate-100 ${row.parent_id === null ? 'font-medium' : ''}`}
                  >
                    <td className="py-1.5">
                      {row.parent_id !== null && <span className="text-slate-300">›&nbsp;</span>}
                      {row.name}
                      {row.parent_id === null && (
                        <span className="ml-2 text-xs font-normal text-slate-400">
                          {KIND_LABELS[row.kind]}
                        </span>
                      )}
                    </td>
                    <td>
                      <AmountInput
                        value={row.default_cents}
                        onCommit={(amount) =>
                          save.mutate({ categoryId: row.category_id, period: null, amount })
                        }
                      />
                    </td>
                    <td>
                      <AmountInput
                        value={row.override_cents}
                        onCommit={(amount) =>
                          save.mutate({ categoryId: row.category_id, period: month, amount })
                        }
                      />
                    </td>
                    <td className="tabular text-slate-500">
                      {row.override_cents !== null ? (
                        <span className="flex items-center gap-2">
                          {formatCents(row.override_cents)}
                          <Badge tone="warn">dérogation</Badge>
                        </span>
                      ) : row.default_cents !== null ? (
                        formatCents(row.default_cents)
                      ) : (
                        '—'
                      )}
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

/** Champ de montant qui n'enregistre qu'à la sortie, pour ne pas écrire à chaque frappe. */
function AmountInput({
  value,
  onCommit,
}: {
  value: number | null;
  onCommit: (amount: string) => void;
}) {
  const initial = value === null ? '' : formatCents(value);
  const [draft, setDraft] = useState(initial);
  const [previous, setPrevious] = useState(initial);

  // Le champ suit la valeur du serveur tant que l'utilisateur n'y touche pas.
  if (initial !== previous) {
    setPrevious(initial);
    setDraft(initial);
  }

  return (
    <input
      className={`${inputClass} w-36 text-right tabular`}
      value={draft}
      placeholder="—"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft.trim() !== initial.trim()) onCommit(draft);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
    />
  );
}

const MONTH_NAMES = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

function monthLabel(yearMonth: string): string {
  const [year, month] = yearMonth.split('-');
  return `${MONTH_NAMES[Number(month) - 1] ?? yearMonth} ${year}`;
}
