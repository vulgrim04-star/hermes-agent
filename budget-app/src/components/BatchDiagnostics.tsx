import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { formatSwissDate } from '../../shared/dates.js';
import { parseAmountToCents } from '../../shared/money.js';
import { apiGet, apiSend } from '../lib/api.js';
import type { BatchReport, ImportStatement, PendingTransaction } from '../lib/api.js';
import { RECONCILIATION_LABELS } from '../lib/labels.js';
import { Amount, Badge, Button, Card, inputClass } from './ui.js';

const PREVIEW_ROWS = 10;

/**
 * Écran de diagnostic d'un lot avant validation.
 *
 * Il montre ce qui a été compris du fichier, ce qui ne l'a pas été, et ce qui
 * empêche de valider. Un import ne se valide pas parce qu'il « a l'air bon » :
 * il se valide parce que le rapprochement est prouvé.
 */
export function BatchDiagnostics({
  report,
  onValidated,
  onCancelled,
}: {
  report: BatchReport;
  onValidated: () => void;
  onCancelled: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { batch, statements, rows, issues, blocking, notices } = report;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['batch', batch.id] });
    void queryClient.invalidateQueries({ queryKey: ['batches'] });
    void queryClient.invalidateQueries({ queryKey: ['transactions'] });
  };

  const toggle = useMutation({
    mutationFn: (input: { id: number; include: boolean }) =>
      apiSend(`/imports/pending/${input.id}`, 'PATCH', { include: input.include }),
    onSuccess: refresh,
  });

  const validate = useMutation({
    mutationFn: (force: boolean) => apiSend(`/imports/${batch.id}/validate`, 'POST', { force }),
    onSuccess: () => {
      setError(null);
      refresh();
      onValidated();
    },
    onError: (cause: Error) => setError(cause.message),
  });

  const remove = useMutation({
    mutationFn: () => apiSend(`/imports/${batch.id}`, 'DELETE'),
    onSuccess: () => {
      refresh();
      onCancelled();
    },
  });

  const included = rows.filter((row) => row.include === 1).length;
  const errors = issues.filter((issue) => issue.severity === 'erreur');
  const warnings = issues.filter((issue) => issue.severity === 'avertissement');
  const visibleRows = showAll ? rows : rows.slice(0, PREVIEW_ROWS);

  return (
    <div className="flex flex-col gap-6">
      <Card title="Rapport d’import" description={batch.filename}>
        <dl className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
          <Stat label="Format détecté" value={batch.format === 'mt940' ? 'SWIFT MT940' : 'CSV'} />
          <Stat
            label="Encodage / séparateur"
            value={
              batch.format === 'csv'
                ? `${batch.encoding ?? '—'} · ${batch.delimiter === '\t' ? 'tabulation' : (batch.delimiter ?? '—')}`
                : '—'
            }
          />
          <Stat label="Lignes lues" value={String(batch.rows_read)} />
          <Stat label="À importer" value={String(included)} />
          <Stat label="Doublons déjà en base" value={String(batch.rows_duplicate)} />
          <Stat label="Doublons probables" value={String(batch.rows_soft_duplicate)} />
          <Stat label="Lignes en erreur" value={String(batch.rows_error)} />
          <Stat
            label="Contrôle de solde"
            value={RECONCILIATION_LABELS[batch.reconciliation_status] ?? batch.reconciliation_status}
          />
        </dl>

        {blocking.length > 0 && (
          <div className="mt-5 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <p className="font-semibold">La validation est bloquée :</p>
            <ul className="mt-1 list-inside list-disc">
              {blocking.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
            <p className="mt-2 text-xs">
              Corrigez le fichier ou le mapping et relancez l’analyse. Si vous forcez malgré tout, le
              lot restera marqué comme forcé, avec l’écart constaté.
            </p>
          </div>
        )}

        <div className="mt-5 flex flex-wrap gap-3">
          <Button
            variant="primary"
            disabled={blocking.length > 0 || validate.isPending}
            onClick={() => validate.mutate(false)}
          >
            Valider l’import ({included} écriture{included > 1 ? 's' : ''})
          </Button>
          {blocking.length > 0 && (
            <Button variant="danger" onClick={() => validate.mutate(true)}>
              Forcer la validation malgré l’écart
            </Button>
          )}
          <Button onClick={() => remove.mutate()}>Abandonner ce lot</Button>
          {error !== null && <Badge tone="error">{error}</Badge>}
        </div>
      </Card>

      <Card
        title="Relevés et rapprochement"
        description={
          statements.length > 1
            ? `Ce fichier porte ${statements.length} comptes. Chacun est rapproché séparément.`
            : undefined
        }
      >
        {notices.length > 0 && (
          <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <ul className="list-inside list-disc">
              {notices.map((notice) => (
                <li key={notice}>{notice}</li>
              ))}
            </ul>
          </div>
        )}

        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="py-2">Relevé</th>
              <th>Compte</th>
              <th>Période</th>
              <th className="text-right">Solde d’ouverture</th>
              <th className="text-right">Mouvements</th>
              <th className="text-right">Solde de clôture</th>
              <th className="text-right">Écart</th>
            </tr>
          </thead>
          <tbody>
            {statements.map((statement) => (
              <StatementRow
                key={statement.id}
                statement={statement}
                editable={batch.status === 'brouillon'}
                onSaved={refresh}
              />
            ))}
          </tbody>
        </table>
      </Card>

      <Card
        title={`Écritures interprétées (${rows.length})`}
        description="Vérifiez que les dates, les libellés et le sens des montants correspondent à votre relevé."
        actions={
          rows.length > PREVIEW_ROWS ? (
            <Button onClick={() => setShowAll((value) => !value)}>
              {showAll ? `N’afficher que les ${PREVIEW_ROWS} premières` : `Tout afficher`}
            </Button>
          ) : undefined
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-2">Ligne</th>
                <th>Date de valeur</th>
                <th>Libellé</th>
                <th className="text-right">Montant</th>
                <th>Statut</th>
                <th className="text-right">Importer</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <PendingRow
                  key={row.id}
                  row={row}
                  onToggle={(include) => toggle.mutate({ id: row.id, include })}
                />
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {(errors.length > 0 || warnings.length > 0) && (
        <Card title={`Lignes non interprétées (${errors.length} erreur(s), ${warnings.length} avertissement(s))`}>
          <ul className="flex flex-col gap-2 text-sm">
            {[...errors, ...warnings].map((issue) => (
              <li key={issue.id} className="border-l-2 border-slate-200 pl-3">
                <span className="mr-2">
                  {issue.severity === 'erreur' ? (
                    <Badge tone="error">erreur</Badge>
                  ) : (
                    <Badge tone="warn">avertissement</Badge>
                  )}
                </span>
                {issue.line_number !== null && (
                  <span className="mr-2 text-slate-400">ligne {issue.line_number}</span>
                )}
                {issue.message}
                {issue.raw !== null && (
                  <code className="mt-1 block overflow-x-auto rounded bg-slate-50 p-2 font-mono text-xs text-slate-600">
                    {issue.raw}
                  </code>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

/**
 * Une ligne de relevé, avec saisie des soldes quand le fichier n'en portait pas.
 *
 * Le contrôle de rapprochement est ce qui prouve qu'un relevé est complet ;
 * l'export CSV d'UBS ne porte pas de solde, et sans saisie ce contrôle
 * n'existerait tout simplement pas pour la moitié des imports.
 */
function StatementRow({
  statement,
  editable,
  onSaved,
}: {
  statement: ImportStatement;
  editable: boolean;
  onSaved: () => void;
}) {
  const entering = editable && (statement.status === 'absent' || statement.balance_source === 'saisi');
  const [opening, setOpening] = useState(centsToInput(statement.opening_balance_cents));
  const [closing, setClosing] = useState(centsToInput(statement.closing_balance_cents));
  const [error, setError] = useState<string | null>(null);

  // Solde à nouveau : la clôture du relevé précédent du même compte. Il ne se
  // saisit donc qu'à la première importation d'un compte.
  const suggestion = useQuery({
    queryKey: ['statement-opening', statement.id],
    queryFn: () =>
      apiGet<{ openingCents: number | null }>(`/imports/statements/${statement.id}/ouverture-proposee`),
    enabled: entering && statement.opening_balance_cents === null,
  });

  useEffect(() => {
    const proposed = suggestion.data?.openingCents;
    if (proposed !== undefined && proposed !== null && opening === '') {
      setOpening(centsToInput(proposed));
    }
  }, [suggestion.data, opening]);

  const save = useMutation({
    mutationFn: () => {
      const parsedOpening = inputToCents(opening);
      const parsedClosing = inputToCents(closing);
      if (parsedOpening === 'illisible' || parsedClosing === 'illisible') {
        throw new Error('Montant illisible : attendu 12’450.80 ou 12450.80.');
      }
      return apiSend(`/imports/statements/${statement.id}`, 'PATCH', {
        openingCents: parsedOpening,
        closingCents: parsedClosing,
      });
    },
    onSuccess: () => {
      setError(null);
      onSaved();
    },
    onError: (cause: Error) => setError(cause.message),
  });

  return (
    <tr className="border-t border-slate-100 align-top">
      <td className="py-2">{statement.reference ?? '—'}</td>
      <td className="text-slate-500">{statement.account_label ?? '—'}</td>
      <td className="whitespace-nowrap text-slate-500">
        {statement.opening_date === null ? '—' : formatSwissDate(statement.opening_date)}
        {' → '}
        {statement.closing_date === null ? '—' : formatSwissDate(statement.closing_date)}
      </td>
      <td className="text-right">
        {entering ? (
          <input
            className={`${inputClass} w-32 text-right`}
            inputMode="decimal"
            placeholder="ouverture"
            value={opening}
            onChange={(event) => setOpening(event.target.value)}
          />
        ) : statement.opening_balance_cents === null ? (
          '—'
        ) : (
          <Amount cents={statement.opening_balance_cents} />
        )}
      </td>
      <td className="whitespace-nowrap text-right">
        <Amount cents={statement.movements_cents} />
      </td>
      <td className="text-right">
        {entering ? (
          <input
            className={`${inputClass} w-32 text-right`}
            inputMode="decimal"
            placeholder="clôture"
            value={closing}
            onChange={(event) => setClosing(event.target.value)}
          />
        ) : statement.closing_balance_cents === null ? (
          '—'
        ) : (
          <Amount cents={statement.closing_balance_cents} />
        )}
      </td>
      <td className="whitespace-nowrap text-right">
        {statement.status === 'ok' ? (
          <Badge tone="ok">bouclé</Badge>
        ) : statement.status === 'absent' ? (
          <Badge>sans solde</Badge>
        ) : (
          <Badge tone="error">
            <Amount cents={statement.gap_cents ?? 0} />
          </Badge>
        )}
        {entering && (
          <span className="ml-2 inline-block">
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              Contrôler
            </Button>
          </span>
        )}
        {error !== null && <span className="mt-1 block text-xs text-red-700">{error}</span>}
        {statement.balance_source === 'saisi' && statement.status !== 'absent' && (
          <span className="mt-1 block text-xs text-slate-400">soldes saisis</span>
        )}
      </td>
    </tr>
  );
}

function centsToInput(cents: number | null): string {
  return cents === null ? '' : (cents / 100).toFixed(2);
}

/** `null` pour un champ vide — un solde absent n'est pas un solde à zéro. */
function inputToCents(raw: string): number | null | 'illisible' {
  if (raw.trim() === '') return null;
  const parsed = parseAmountToCents(raw);
  return parsed === null ? 'illisible' : parsed;
}

function PendingRow({
  row,
  onToggle,
}: {
  row: PendingTransaction;
  onToggle: (include: boolean) => void;
}) {
  return (
    <tr className="border-t border-slate-100">
      <td className="py-2 text-slate-400">{row.line_number ?? '—'}</td>
      <td className="whitespace-nowrap tabular">{formatSwissDate(row.value_date)}</td>
      <td className="max-w-lg">
        {row.label}
        {row.counterparty !== null && (
          <span className="block text-xs text-slate-400">{row.counterparty}</span>
        )}
      </td>
      <td className="whitespace-nowrap text-right">
        <Amount cents={row.amount_cents} />
      </td>
      <td>
        {row.duplicate_kind === 'strict' ? (
          <Badge tone="warn">doublon — déjà en base</Badge>
        ) : row.duplicate_kind === 'probable' ? (
          <Badge tone="warn">doublon probable</Badge>
        ) : (
          <Badge tone="ok">nouvelle</Badge>
        )}
      </td>
      <td className="text-right">
        <input
          type="checkbox"
          checked={row.include === 1}
          onChange={(event) => onToggle(event.target.checked)}
        />
      </td>
    </tr>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 font-medium">{value}</dd>
    </div>
  );
}
