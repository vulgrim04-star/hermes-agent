import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { formatCents, parseAmountToCents } from '../../shared/money.js';
import { apiGet, apiSend } from '../lib/api.js';
import type { Category, Owner, SplitRow } from '../lib/api.js';
import { OWNER_ORDER, ownerLabel } from '../lib/labels.js';
import { Amount, Badge, Button, inputClass } from './ui.js';
import { Dialog } from './Dialog.js';

interface Draft {
  key: number;
  categoryId: string;
  amount: string;
  owner: Owner | '';
}

/**
 * Ventilation d'une écriture entre plusieurs catégories.
 *
 * Le reliquat est affiché en permanence et l'enregistrement reste fermé tant
 * qu'il n'est pas nul : une ventilation qui ne boucle pas n'est pas une
 * ventilation. Le serveur refait le même contrôle.
 */
export function SplitDialog({
  transaction,
  categories,
  onClose,
  onSaved,
}: {
  transaction: { id: number; label: string; amount_cents: number };
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);

  // Une écriture déjà ventilée s'ouvre sur sa ventilation.
  const existing = useQuery({
    queryKey: ['splits', transaction.id],
    queryFn: () => apiGet<SplitRow[]>(`/transactions/${transaction.id}/decoupage`),
  });

  const rows: Draft[] =
    drafts ??
    (existing.data === undefined
      ? []
      : existing.data.length > 0
        ? existing.data.map((split, index) => ({
            key: index,
            categoryId: String(split.category_id ?? ''),
            amount: formatCents(split.amount_cents),
            owner: (split.owner ?? '') as Owner | '',
          }))
        : [
            { key: 0, categoryId: '', amount: formatCents(transaction.amount_cents), owner: '' },
            { key: 1, categoryId: '', amount: '', owner: '' },
          ]);

  const parsed = rows.map((row) => (row.amount.trim() === '' ? null : parseAmountToCents(row.amount)));
  const unreadable = parsed.some((value, index) => value === null && rows[index]!.amount.trim() !== '');
  const total = parsed.reduce((sum: number, value) => sum + (value ?? 0), 0);
  const remainder = transaction.amount_cents - total;
  const filled = rows.filter((row, index) => row.amount.trim() !== '' && parsed[index] !== null);
  const balanced = remainder === 0 && filled.length >= 1 && !unreadable;

  function update(key: number, patch: Partial<Draft>) {
    setDrafts(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  async function save() {
    setError(null);
    const payload = rows
      .filter((row) => row.amount.trim() !== '')
      .map((row) => ({
        categoryId: row.categoryId === '' ? null : Number(row.categoryId),
        amount: row.amount,
        owner: row.owner === '' ? null : row.owner,
      }));

    try {
      await apiSend(`/transactions/${transaction.id}/decoupage`, 'PUT', { splits: payload });
      onSaved();
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  return (
    <Dialog
      title="Découper l’écriture"
      description={`${transaction.label} — ${formatCents(transaction.amount_cents)} CHF`}
      onClose={onClose}
      footer={
        <>
          <Button variant="primary" disabled={!balanced} onClick={() => void save()}>
            Enregistrer la ventilation
          </Button>
          <Button onClick={onClose}>Annuler</Button>
          <Button
            variant="danger"
            onClick={() =>
              void apiSend(`/transactions/${transaction.id}/decoupage`, 'PUT', { splits: [] }).then(
                onSaved,
              )
            }
          >
            Supprimer la ventilation
          </Button>
          <span className="ml-auto text-sm">
            {balanced ? (
              <Badge tone="ok">La ventilation boucle</Badge>
            ) : (
              <span className="text-slate-600">
                Reliquat à ventiler <Amount cents={remainder} className="font-semibold" />
              </span>
            )}
          </span>
        </>
      }
    >
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="py-2">Catégorie</th>
            <th className="w-40">Montant</th>
            <th className="w-44">Personne</th>
            <th className="w-10" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-t border-slate-100">
              <td className="py-2">
                <select
                  className={`${inputClass} w-full`}
                  value={row.categoryId}
                  onChange={(event) => update(row.key, { categoryId: event.target.value })}
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
              </td>
              <td>
                <input
                  className={`${inputClass} w-full text-right tabular`}
                  value={row.amount}
                  placeholder="montant"
                  onChange={(event) => update(row.key, { amount: event.target.value })}
                />
              </td>
              <td>
                <select
                  className={`${inputClass} w-full`}
                  value={row.owner}
                  onChange={(event) => update(row.key, { owner: event.target.value as Owner | '' })}
                >
                  <option value="">Défaut de l’écriture</option>
                  {OWNER_ORDER.map((owner) => (
                    <option key={owner} value={owner}>
                      {ownerLabel(owner)}
                    </option>
                  ))}
                </select>
              </td>
              <td className="text-right">
                <Button
                  variant="ghost"
                  onClick={() => setDrafts(rows.filter((entry) => entry.key !== row.key))}
                >
                  ×
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          onClick={() =>
            setDrafts([
              ...rows,
              {
                key: Math.max(0, ...rows.map((row) => row.key)) + 1,
                categoryId: '',
                // La nouvelle ligne est pré-remplie du reliquat : le cas courant
                // est de ventiler ce qui reste.
                amount: remainder === 0 ? '' : formatCents(remainder),
                owner: '',
              },
            ])
          }
        >
          Ajouter une ligne
        </Button>
        {unreadable && <Badge tone="error">Un montant est illisible.</Badge>}
        {error !== null && <Badge tone="error">{error}</Badge>}
      </div>
    </Dialog>
  );
}
