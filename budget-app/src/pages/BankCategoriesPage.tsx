import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiGet, apiSend } from '../lib/api.js';
import type { Category, ExternalCategoryRow } from '../lib/api.js';
import { Badge, Button, Card, EmptyState, inputClass } from '../components/ui.js';

const TREATMENTS = [
  { value: 'categorie', label: 'Catégorie' },
  { value: 'transfert-interne', label: 'Transfert interne' },
  { value: 'ignorer', label: 'Ignorer' },
] as const;

/**
 * Correspondance entre les catégories de la banque et celles du ménage.
 *
 * Elle s'applique après les règles de l'utilisateur et ne comble que les vides.
 * Un libellé laissé sans correspondance ne classe rien : l'écriture remonte
 * dans la file de révision, ce qui vaut mieux qu'une catégorie approximative
 * posée en silence.
 */
export function BankCategoriesPage() {
  const queryClient = useQueryClient();
  const [applied, setApplied] = useState<string | null>(null);

  const mappings = useQuery({
    queryKey: ['bank-categories'],
    queryFn: () => apiGet<ExternalCategoryRow[]>('/categories-banque'),
  });
  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => apiGet<Category[]>('/categories'),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['bank-categories'] });
    void queryClient.invalidateQueries({ queryKey: ['review'] });
    void queryClient.invalidateQueries({ queryKey: ['transactions'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const save = useMutation({
    mutationFn: (input: { externalLabel: string; categoryId: number | null; treatAs: string }) =>
      apiSend('/categories-banque', 'PUT', input),
    onSuccess: refresh,
  });

  const applyAll = useMutation({
    mutationFn: () =>
      apiSend<{ categorised: number; flaggedAsTransfer: number }>(
        '/categories-banque/appliquer',
        'POST',
      ),
    onSuccess: (result) => {
      setApplied(
        `${result.categorised} écriture(s) classée(s), ${result.flaggedAsTransfer} laissée(s) aux transferts internes.`,
      );
      refresh();
    },
  });

  const rows = mappings.data ?? [];
  const unknown = rows.filter((row) => row.id === null);

  return (
    <Card
      title="Catégories livrées par la banque"
      description="UBS classe déjà chaque écriture. Ce classement est repris ici, après vos règles et seulement là où rien n’a été posé."
      actions={
        <Button variant="primary" onClick={() => applyAll.mutate()} disabled={applyAll.isPending}>
          {applyAll.isPending ? 'Application…' : 'Appliquer aux écritures sans catégorie'}
        </Button>
      }
    >
      {applied !== null && (
        <p className="mb-4">
          <Badge tone="ok">{applied}</Badge>
        </p>
      )}

      {unknown.length > 0 && (
        <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {unknown.length} libellé(s) rencontré(s) à l’import ne figurent pas encore dans la table.
          Ils sont listés ci-dessous, sans correspondance.
        </p>
      )}

      {rows.length === 0 ? (
        <EmptyState>Aucune catégorie de banque connue.</EmptyState>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="py-2">Libellé de la banque</th>
              <th className="text-right">Écritures</th>
              <th className="text-right">Sans catégorie</th>
              <th>Traitement</th>
              <th>Catégorie du ménage</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <MappingRow
                key={row.external_label}
                row={row}
                categories={categories.data ?? []}
                onSave={(categoryId, treatAs) =>
                  save.mutate({ externalLabel: row.external_label, categoryId, treatAs })
                }
              />
            ))}
          </tbody>
        </table>
      )}

      <p className="mt-4 text-xs text-slate-500">
        « Transfert interne » convient aux règlements de carte et aux virements entre vos comptes :
        ils ne sont pas des dépenses, et les compter comme telles doublerait la charge déjà
        enregistrée à l’achat. Ces écritures restent sans catégorie et sont proposées à
        l’appariement dans la révision.
      </p>
    </Card>
  );
}

function MappingRow({
  row,
  categories,
  onSave,
}: {
  row: ExternalCategoryRow;
  categories: Category[];
  onSave: (categoryId: number | null, treatAs: string) => void;
}) {
  return (
    <tr className="border-t border-slate-100">
      <td className="py-1.5">
        {row.external_label}
        {row.id === null && (
          <span className="ml-2">
            <Badge tone="warn">nouveau</Badge>
          </span>
        )}
      </td>
      <td className="tabular text-right text-slate-500">{row.transaction_count}</td>
      <td className="tabular text-right">
        {row.uncategorised_count > 0 ? (
          <span className="text-amber-700">{row.uncategorised_count}</span>
        ) : (
          <span className="text-slate-400">0</span>
        )}
      </td>
      <td>
        <select
          className={inputClass}
          value={row.treat_as}
          onChange={(event) => onSave(row.category_id, event.target.value)}
        >
          {TREATMENTS.map((treatment) => (
            <option key={treatment.value} value={treatment.value}>
              {treatment.label}
            </option>
          ))}
        </select>
      </td>
      <td>
        <select
          className={inputClass}
          value={row.category_id ?? ''}
          disabled={row.treat_as !== 'categorie'}
          onChange={(event) =>
            onSave(event.target.value === '' ? null : Number(event.target.value), row.treat_as)
          }
        >
          <option value="">— à décider —</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.parent_name === null
                ? category.name
                : `${category.parent_name} › ${category.name}`}
            </option>
          ))}
        </select>
      </td>
    </tr>
  );
}
