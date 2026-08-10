import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiGet, apiSend } from '../lib/api.js';
import type { Category, CategoryRuleRow } from '../lib/api.js';
import { ownerLabel } from '../lib/labels.js';
import { Badge, Button, Card, EmptyState, inputClass } from '../components/ui.js';

const DIRECTION_LABELS: Record<string, string> = {
  tout: 'Indifférent',
  debit: 'Débits',
  credit: 'Crédits',
};

/**
 * Règles de catégorisation.
 *
 * L'ordre de priorité est ce qui départage deux règles qui correspondent à la
 * même écriture : la plus basse gagne. Une règle spécifique se place donc devant
 * une règle générique en lui donnant un nombre plus petit.
 */
export function RulesPage() {
  const queryClient = useQueryClient();

  const rules = useQuery({
    queryKey: ['rules'],
    queryFn: () => apiGet<CategoryRuleRow[]>('/regles'),
  });
  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => apiGet<Category[]>('/categories'),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['rules'] });
    void queryClient.invalidateQueries({ queryKey: ['transactions'] });
    void queryClient.invalidateQueries({ queryKey: ['review'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const update = useMutation({
    mutationFn: (input: { id: number; patch: Record<string, unknown> }) =>
      apiSend(`/regles/${input.id}`, 'PATCH', input.patch),
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: (id: number) => apiSend(`/regles/${id}`, 'DELETE'),
    onSuccess: refresh,
  });

  const replay = useMutation({
    mutationFn: () => apiSend<{ updated: number }>('/regles/appliquer', 'POST'),
    onSuccess: refresh,
  });

  return (
    <Card
      title={`Règles de catégorisation (${rules.data?.length ?? 0})`}
      description="Les règles se créent depuis la file de révision, au moment où vous classez une écriture. Elles se règlent ici."
      actions={
        <Button onClick={() => replay.mutate()} disabled={replay.isPending}>
          {replay.isPending ? 'Application…' : 'Rejouer sur les non catégorisées'}
        </Button>
      }
    >
      {replay.data !== undefined && (
        <p className="mb-4">
          <Badge tone="ok">{replay.data.updated} écriture(s) catégorisée(s)</Badge>
        </p>
      )}

      {rules.data === undefined ? (
        <EmptyState>Chargement…</EmptyState>
      ) : rules.data.length === 0 ? (
        <EmptyState>
          Aucune règle. Catégorisez une écriture dans la file de révision et acceptez la règle
          proposée.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-2 w-20">Priorité</th>
                <th>Motif</th>
                <th>Catégorie</th>
                <th>Sens</th>
                <th>Attribution</th>
                <th className="text-right">Utilisations</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rules.data.map((rule) => (
                <tr
                  key={rule.id}
                  className={`border-t border-slate-100 ${rule.is_active === 0 ? 'opacity-50' : ''}`}
                >
                  <td className="py-1.5">
                    <input
                      type="number"
                      className={`${inputClass} w-16 tabular`}
                      defaultValue={rule.priority}
                      onBlur={(event) => {
                        const priority = Number(event.target.value);
                        if (priority !== rule.priority) {
                          update.mutate({ id: rule.id, patch: { priority } });
                        }
                      }}
                    />
                  </td>
                  <td>
                    <input
                      className={`${inputClass} w-56`}
                      defaultValue={rule.pattern}
                      onBlur={(event) => {
                        const pattern = event.target.value.trim();
                        if (pattern !== '' && pattern !== rule.pattern) {
                          update.mutate({ id: rule.id, patch: { pattern } });
                        }
                      }}
                    />
                    {rule.match_type === 'regex' && (
                      <span className="ml-2">
                        <Badge>regex</Badge>
                      </span>
                    )}
                  </td>
                  <td>
                    <select
                      className={inputClass}
                      value={rule.category_id ?? ''}
                      onChange={(event) =>
                        update.mutate({
                          id: rule.id,
                          patch: { categoryId: Number(event.target.value) },
                        })
                      }
                    >
                      {(categories.data ?? []).map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.parent_name === null
                            ? category.name
                            : `${category.parent_name} › ${category.name}`}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="text-slate-500">{DIRECTION_LABELS[rule.direction]}</td>
                  <td className="text-slate-500">
                    {rule.owner === null ? '—' : ownerLabel(rule.owner)}
                  </td>
                  <td className="tabular text-right">{rule.hits}</td>
                  <td className="whitespace-nowrap text-right">
                    <Button
                      variant="ghost"
                      onClick={() =>
                        update.mutate({ id: rule.id, patch: { isActive: rule.is_active === 0 } })
                      }
                    >
                      {rule.is_active === 1 ? 'Désactiver' : 'Activer'}
                    </Button>
                    <Button variant="ghost" onClick={() => remove.mutate(rule.id)}>
                      Supprimer
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-xs text-slate-500">
        Priorité croissante : la règle au nombre le plus bas l’emporte. Rejouer les règles ne touche
        que les écritures non catégorisées — une catégorie posée à la main n’est jamais défaite.
      </p>
    </Card>
  );
}
