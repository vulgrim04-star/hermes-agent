import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { formatSwissDate } from '../../shared/dates.js';
import { apiGet, apiSend } from '../lib/api.js';
import type { Category, ReviewQueue, ReviewTransaction } from '../lib/api.js';
import { Amount, Badge, Button, Card, EmptyState, Field, inputClass } from '../components/ui.js';
import { RuleDialog } from '../components/RuleDialog.js';
import { SplitDialog } from '../components/SplitDialog.js';

/**
 * File de révision : l'écran de fin de mois.
 *
 * Il ne montre que ce qui reste à trancher — les écritures sans catégorie et
 * les transferts internes à confirmer. La catégorisation se fait au clavier :
 * une main sur les flèches, l'autre sur les chiffres.
 */
export function ReviewPage() {
  const queryClient = useQueryClient();
  const [cursor, setCursor] = useState(0);
  const [filter, setFilter] = useState('');
  const [splitFor, setSplitFor] = useState<ReviewTransaction | null>(null);
  const [ruleFor, setRuleFor] = useState<ReviewTransaction | null>(null);
  const filterInput = useRef<HTMLInputElement>(null);

  const queue = useQuery({ queryKey: ['review'], queryFn: () => apiGet<ReviewQueue>('/revision') });
  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => apiGet<Category[]>('/categories'),
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['review'] });
    void queryClient.invalidateQueries({ queryKey: ['transactions'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  }, [queryClient]);

  const assign = useMutation({
    mutationFn: (input: { id: number; categoryId: number }) =>
      apiSend(`/transactions/${input.id}`, 'PATCH', { categoryId: input.categoryId }),
    onSuccess: refresh,
  });

  const decideTransfer = useMutation({
    mutationFn: (input: { id: number; action: 'confirmer' | 'rejeter' }) =>
      apiSend(`/revision/transferts/${input.id}/${input.action}`, 'POST'),
    onSuccess: refresh,
  });

  const transactions = queue.data?.transactions ?? [];
  const frequent = queue.data?.frequent ?? [];
  const current = transactions[Math.min(cursor, transactions.length - 1)] ?? null;

  // La frappe libre filtre l'ensemble des catégories ; les neuf raccourcis
  // couvrent le quotidien, la recherche couvre le reste.
  const matches = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (needle === '') return [];
    return (categories.data ?? [])
      .filter((category) => category.parent_id !== null)
      .filter((category) =>
        `${category.parent_name ?? ''} ${category.name}`.toLowerCase().includes(needle),
      )
      .slice(0, 9);
  }, [filter, categories.data]);

  const shortcuts = filter.trim() === '' ? frequent : matches;

  const categorise = useCallback(
    (categoryId: number) => {
      if (current === null) return;
      assign.mutate({ id: current.id, categoryId });
      setFilter('');
      setCursor((value) => Math.max(0, Math.min(value, transactions.length - 2)));
    },
    [assign, current, transactions.length],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (splitFor !== null || ruleFor !== null) return;
      const typingInFilter = document.activeElement === filterInput.current;

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setCursor((value) => Math.min(value + 1, transactions.length - 1));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setCursor((value) => Math.max(value - 1, 0));
        return;
      }
      if (event.key === 'Escape') {
        setFilter('');
        filterInput.current?.blur();
        return;
      }
      if (/^[1-9]$/.test(event.key) && !typingInFilter) {
        const target = shortcuts[Number(event.key) - 1];
        if (target !== undefined) {
          event.preventDefault();
          categorise(target.id);
        }
        return;
      }
      if (event.key === 'Enter' && shortcuts.length > 0) {
        event.preventDefault();
        categorise(shortcuts[0]!.id);
        return;
      }
      if (typingInFilter) return;
      if (event.key === 'd' || event.key === 'D') {
        event.preventDefault();
        setSplitFor(current);
        return;
      }
      if (event.key === 'r' || event.key === 'R') {
        event.preventDefault();
        setRuleFor(current);
        return;
      }
      // Toute autre lettre bascule dans la recherche de catégorie, et **est**
      // le premier caractère de la recherche : sans `preventDefault`, le
      // navigateur l'insère une seconde fois dans le champ qui vient de
      // recevoir le focus.
      if (/^[a-zà-öø-ÿ]$/i.test(event.key)) {
        event.preventDefault();
        setFilter(event.key);
        filterInput.current?.focus();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [categorise, current, shortcuts, splitFor, ruleFor, transactions.length]);

  return (
    <div className="flex flex-col gap-6">
      <Card
        title={`À catégoriser (${transactions.length})`}
        description="↑ ↓ pour changer de ligne · 1 à 9 pour poser une catégorie · une lettre pour chercher · D pour découper · R pour créer la règle"
        actions={
          <Button
            onClick={() =>
              void apiSend('/regles/appliquer', 'POST').then(refresh)
            }
          >
            Rejouer les règles
          </Button>
        }
      >
        {queue.isLoading ? (
          <EmptyState>Chargement…</EmptyState>
        ) : transactions.length === 0 ? (
          <EmptyState>Tout est catégorisé. Rien ne vous attend.</EmptyState>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-end gap-4">
              <Field label="Chercher une catégorie">
                <input
                  ref={filterInput}
                  className={`${inputClass} w-72`}
                  value={filter}
                  placeholder="alimentation, loyer, 3a…"
                  onChange={(event) => setFilter(event.target.value)}
                />
              </Field>
              <div className="flex flex-wrap gap-1.5">
                {shortcuts.map((category, index) => (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => categorise(category.id)}
                    className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs hover:bg-slate-50"
                  >
                    <span className="mr-1.5 font-mono text-slate-400">{index + 1}</span>
                    {category.parent_name === null
                      ? category.name
                      : `${category.parent_name} › ${category.name}`}
                  </button>
                ))}
                {shortcuts.length === 0 && (
                  <span className="text-xs text-slate-400">Aucune catégorie ne correspond.</span>
                )}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="py-2">Date</th>
                    <th>Libellé</th>
                    <th>Compte</th>
                    <th className="text-right">Montant</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((transaction, index) => (
                    <tr
                      key={transaction.id}
                      onClick={() => setCursor(index)}
                      className={`cursor-pointer border-t border-slate-100 ${
                        current?.id === transaction.id ? 'bg-slate-100' : ''
                      }`}
                    >
                      <td className="py-2 whitespace-nowrap tabular">
                        {formatSwissDate(transaction.value_date)}
                      </td>
                      <td className="max-w-md">
                        {transaction.label}
                        {transaction.counterparty !== null && (
                          <span className="block text-xs text-slate-400">
                            {transaction.counterparty}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap text-slate-500">
                        {transaction.account_label}
                      </td>
                      <td className="whitespace-nowrap text-right">
                        <Amount cents={transaction.amount_cents} />
                      </td>
                      <td className="whitespace-nowrap text-right">
                        <Button variant="ghost" onClick={() => setSplitFor(transaction)}>
                          Découper
                        </Button>
                        <Button variant="ghost" onClick={() => setRuleFor(transaction)}>
                          Règle
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      <Card
        title={`Transferts internes à confirmer (${queue.data?.transfers.length ?? 0})`}
        description="Un virement entre deux de vos comptes n’est ni un revenu ni une dépense. Confirmé, il sort des totaux sans disparaître du journal."
        actions={
          <Button onClick={() => void apiSend('/revision/transferts/detecter', 'POST').then(refresh)}>
            Relancer la détection
          </Button>
        }
      >
        {(queue.data?.transfers.length ?? 0) === 0 ? (
          <EmptyState>Aucune paire en attente.</EmptyState>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-2">Sortie</th>
                <th>Entrée</th>
                <th className="text-right">Montant</th>
                <th>Écart</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(queue.data?.transfers ?? []).map((transfer) => (
                <tr key={transfer.id} className="border-t border-slate-100">
                  <td className="py-2">
                    <span className="block">{transfer.out_account}</span>
                    <span className="text-xs text-slate-400">
                      {formatSwissDate(transfer.out_date)} · {transfer.out_label}
                    </span>
                  </td>
                  <td>
                    <span className="block">{transfer.in_account}</span>
                    <span className="text-xs text-slate-400">
                      {formatSwissDate(transfer.in_date)} · {transfer.in_label}
                    </span>
                  </td>
                  <td className="whitespace-nowrap text-right">
                    <Amount cents={Math.abs(transfer.out_amount)} />
                  </td>
                  <td>
                    <Badge tone={transfer.day_gap === 0 ? 'ok' : 'neutral'}>
                      {transfer.day_gap === 0 ? 'même jour' : `${transfer.day_gap} j`}
                    </Badge>
                  </td>
                  <td className="whitespace-nowrap text-right">
                    <Button
                      variant="primary"
                      onClick={() => decideTransfer.mutate({ id: transfer.id, action: 'confirmer' })}
                    >
                      Confirmer
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => decideTransfer.mutate({ id: transfer.id, action: 'rejeter' })}
                    >
                      Ce n’en est pas un
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {splitFor !== null && (
        <SplitDialog
          transaction={splitFor}
          categories={categories.data ?? []}
          onClose={() => setSplitFor(null)}
          onSaved={() => {
            setSplitFor(null);
            refresh();
          }}
        />
      )}

      {ruleFor !== null && (
        <RuleDialog
          transaction={ruleFor}
          categories={categories.data ?? []}
          onClose={() => setRuleFor(null)}
          onCreated={() => {
            setRuleFor(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}
