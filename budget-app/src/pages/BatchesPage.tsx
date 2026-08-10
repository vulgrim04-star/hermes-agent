import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { formatSwissDate } from '../../shared/dates.js';
import { apiGet, apiSend } from '../lib/api.js';
import type { BatchReport, ImportBatch } from '../lib/api.js';
import { Amount, Badge, Button, Card, EmptyState } from '../components/ui.js';
import { BatchDiagnostics } from '../components/BatchDiagnostics.js';

export function BatchesPage() {
  const [openBatch, setOpenBatch] = useState<number | null>(null);
  const queryClient = useQueryClient();

  const batches = useQuery({
    queryKey: ['batches'],
    queryFn: () => apiGet<ImportBatch[]>('/imports'),
  });

  const remove = useMutation({
    mutationFn: (id: number) => apiSend(`/imports/${id}`, 'DELETE'),
    onSuccess: () => {
      setOpenBatch(null);
      void queryClient.invalidateQueries({ queryKey: ['batches'] });
      void queryClient.invalidateQueries({ queryKey: ['transactions'] });
      void queryClient.invalidateQueries({ queryKey: ['accounts'] });
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <Card
        title="Lots d’import"
        description="Supprimer un lot supprime les écritures qu’il a produites, et rien d’autre."
      >
        {batches.data === undefined ? (
          <EmptyState>Chargement…</EmptyState>
        ) : batches.data.length === 0 ? (
          <EmptyState>Aucun import pour l’instant.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-2">Date</th>
                  <th>Fichier</th>
                  <th>Format</th>
                  <th>Compte</th>
                  <th className="text-right">Lues</th>
                  <th className="text-right">Importées</th>
                  <th className="text-right">Doublons</th>
                  <th className="text-right">Erreurs</th>
                  <th>Rapprochement</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {batches.data.map((batch) => (
                  <tr key={batch.id} className="border-t border-slate-100">
                    <td className="py-2 whitespace-nowrap tabular">
                      {formatSwissDate(batch.created_at.slice(0, 10))}
                    </td>
                    <td className="max-w-xs truncate" title={batch.filename}>
                      {batch.filename}
                      {batch.status === 'brouillon' && (
                        <span className="ml-2">
                          <Badge tone="warn">brouillon</Badge>
                        </span>
                      )}
                    </td>
                    <td className="uppercase text-slate-500">{batch.format}</td>
                    <td className="text-slate-500">{batch.accounts ?? '—'}</td>
                    <td className="tabular text-right">{batch.rows_read}</td>
                    <td className="tabular text-right">{batch.rows_imported}</td>
                    <td className="tabular text-right">
                      {batch.rows_duplicate + batch.rows_soft_duplicate}
                    </td>
                    <td className="tabular text-right">{batch.rows_error}</td>
                    <td className="whitespace-nowrap">
                      {batch.reconciliation_status === 'ok' ? (
                        <Badge tone="ok">bouclé</Badge>
                      ) : batch.reconciliation_status === 'absent' ? (
                        <Badge>sans solde</Badge>
                      ) : (
                        <Badge tone="error">
                          écart <Amount cents={batch.reconciliation_gap_cents ?? 0} />
                        </Badge>
                      )}
                      {batch.forced === 1 && (
                        <span className="ml-1">
                          <Badge tone="warn">forcé</Badge>
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap text-right">
                      <Button
                        variant="ghost"
                        onClick={() => setOpenBatch(openBatch === batch.id ? null : batch.id)}
                      >
                        {openBatch === batch.id ? 'Fermer' : 'Détail'}
                      </Button>
                      <Button variant="ghost" onClick={() => remove.mutate(batch.id)}>
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
          Un lot marqué « forcé » a été validé malgré un contrôle en échec ; l’écart constaté reste
          inscrit en face, pour que la décision reste visible.
        </p>
      </Card>

      {openBatch !== null && <BatchDetail batchId={openBatch} onClose={() => setOpenBatch(null)} />}
    </div>
  );
}

function BatchDetail({ batchId, onClose }: { batchId: number; onClose: () => void }) {
  const report = useQuery({
    queryKey: ['batch', batchId],
    queryFn: () => apiGet<BatchReport>(`/imports/${batchId}`),
  });

  if (report.data === undefined) return <EmptyState>Chargement du lot…</EmptyState>;
  return <BatchDiagnostics report={report.data} onValidated={onClose} onCancelled={onClose} />;
}
