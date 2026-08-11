import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { apiGet, apiUpload } from '../lib/api.js';
import type { Account, BatchReport, MappingRequired } from '../lib/api.js';
import { FIELD_LABELS } from '../lib/labels.js';
import { Badge, Button, Card, EmptyState, Field, inputClass } from '../components/ui.js';
import { BatchDiagnostics } from '../components/BatchDiagnostics.js';

type Step =
  | { kind: 'depot' }
  | { kind: 'mapping'; details: MappingRequired }
  | { kind: 'diagnostic'; batchId: number };

interface Notice {
  tone: 'warn' | 'error';
  message: string;
}

export function ImportPage() {
  const [step, setStep] = useState<Step>({ kind: 'depot' });
  const [notice, setNotice] = useState<Notice | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [accountId, setAccountId] = useState('');
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const accounts = useQuery({ queryKey: ['accounts'], queryFn: () => apiGet<Account[]>('/comptes') });

  async function send(mapping?: Record<string, number | number[]>, headerLine?: number, delimiter?: string) {
    if (file === null) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.set('file', file);
      if (accountId !== '') form.set('accountId', accountId);
      if (mapping !== undefined) form.set('mapping', JSON.stringify(mapping));
      if (headerLine !== undefined) form.set('headerLine', String(headerLine));
      if (delimiter !== undefined) form.set('delimiter', delimiter);

      const { status, data } = await apiUpload('/imports', form);
      setNotice(null);

      if (status === 201) {
        setStep({ kind: 'diagnostic', batchId: (data as { batchId: number }).batchId });
        void queryClient.invalidateQueries({ queryKey: ['batches'] });
      } else if (status === 422) {
        // Le serveur enveloppe le verdict : { kind: 'mapping-requis', details: … }.
        setStep({ kind: 'mapping', details: (data as { details: MappingRequired }).details });
      } else if (status === 409) {
        // Le compte manque, mais le mapping que l'utilisateur vient de saisir,
        // lui, est bon : on le laisse à l'écran plutôt que de le lui faire refaire.
        setNotice({ tone: 'warn', message: messageOf(data) });
      } else {
        setNotice({ tone: 'error', message: messageOf(data) });
      }
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setStep({ kind: 'depot' });
    setNotice(null);
    setFile(null);
    setAccountId('');
    if (fileInput.current !== null) fileInput.current.value = '';
  }

  return (
    <div className="flex flex-col gap-6">
      <Card
        title="Importer un relevé"
        description="Formats reconnus : CSV (séparateur, encodage et colonnes détectés automatiquement) et SWIFT MT940. Rien n’est comptabilisé avant votre validation."
      >
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Fichier">
            {/* Aucun filtre `accept` : iOS le mappe sur des UTI et grise alors
                tous les fichiers de l'app Fichiers, et le format se reconnaît
                de toute façon au contenu, jamais à l'extension. */}
            <input
              ref={fileInput}
              type="file"
              className="text-sm"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setStep({ kind: 'depot' });
              }}
            />
          </Field>
          <Field label="Compte (si le fichier ne porte pas d’IBAN)">
            <select
              className={inputClass}
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              <option value="">Déduire du fichier</option>
              {(accounts.data ?? []).map((account) => (
                <option key={account.id} value={account.id}>
                  {account.label}
                </option>
              ))}
            </select>
          </Field>
          <Button variant="primary" disabled={file === null || busy} onClick={() => void send()}>
            {busy ? 'Analyse…' : 'Analyser'}
          </Button>
          {step.kind !== 'depot' && <Button onClick={reset}>Recommencer</Button>}
        </div>

        {notice !== null && (
          <p className="mt-4 text-sm text-slate-700">
            <Badge tone={notice.tone}>
              {notice.tone === 'warn' ? 'Compte à désigner' : 'Échec'}
            </Badge>{' '}
            {notice.message}
          </p>
        )}
      </Card>

      {step.kind === 'mapping' && (
        <MappingForm
          details={step.details}
          busy={busy}
          onSubmit={(mapping) => void send(mapping, step.details.headerLine, step.details.delimiter)}
        />
      )}

      {step.kind === 'diagnostic' && <DiagnosticStep batchId={step.batchId} onDone={reset} />}
    </div>
  );
}

function DiagnosticStep({ batchId, onDone }: { batchId: number; onDone: () => void }) {
  const report = useQuery({
    queryKey: ['batch', batchId],
    queryFn: () => apiGet<BatchReport>(`/imports/${batchId}`),
  });

  if (report.data === undefined) return <EmptyState>Chargement du diagnostic…</EmptyState>;
  return <BatchDiagnostics report={report.data} onValidated={onDone} onCancelled={onDone} />;
}

/**
 * Écran de mapping. Il n'apparaît que lorsque les en-têtes n'ont pas été
 * reconnus ; le mapping validé est ensuite mémorisé et réappliqué aux fichiers
 * du même format, sans repasser par ici.
 */
function MappingForm({
  details,
  busy,
  onSubmit,
}: {
  details: MappingRequired;
  busy: boolean;
  onSubmit: (mapping: Record<string, number | number[]>) => void;
}) {
  const [assignment, setAssignment] = useState<Record<number, string>>(() => {
    const initial: Record<number, string> = {};
    for (const column of details.columns) {
      if (column.suggested !== null) initial[column.index] = column.suggested;
    }
    return initial;
  });

  const mapping = buildMapping(assignment);
  const missing = missingOf(mapping);

  return (
    <Card
      title="Associer les colonnes"
      description={`Format non reconnu (${details.encoding}, séparateur « ${displayDelimiter(details.delimiter)} »). Indiquez ce que contient chaque colonne : l’association sera mémorisée pour les prochains fichiers de ce format.`}
    >
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="py-2">Colonne du fichier</th>
            <th>Exemples</th>
            <th>Champ de l’application</th>
          </tr>
        </thead>
        <tbody>
          {details.columns.map((column) => (
            <tr key={column.index} className="border-t border-slate-100">
              <td className="py-2 font-medium">{column.header || `Colonne ${column.index + 1}`}</td>
              <td className="text-slate-500">
                {column.samples.slice(0, 3).map((sample, index) => (
                  <span key={index} className="mr-3 font-mono text-xs">
                    {sample}
                  </span>
                ))}
              </td>
              <td>
                <select
                  className={inputClass}
                  value={assignment[column.index] ?? ''}
                  onChange={(event) =>
                    setAssignment({ ...assignment, [column.index]: event.target.value })
                  }
                >
                  <option value="">— ignorer —</option>
                  {Object.entries(FIELD_LABELS).map(([field, label]) => (
                    <option key={field} value={field}>
                      {label}
                    </option>
                  ))}
                  <option value="labelExtra">Libellé (complément)</option>
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button variant="primary" disabled={missing.length > 0 || busy} onClick={() => onSubmit(mapping)}>
          Analyser avec ce mapping
        </Button>
        {missing.length > 0 && <Badge tone="warn">Il manque {missing.join(', ')}.</Badge>}
      </div>
    </Card>
  );
}

function buildMapping(assignment: Record<number, string>): Record<string, number | number[]> {
  const mapping: Record<string, number | number[]> = {};
  const extra: number[] = [];

  for (const [index, field] of Object.entries(assignment)) {
    if (field === '') continue;
    if (field === 'labelExtra') extra.push(Number(index));
    else mapping[field] = Number(index);
  }
  if (extra.length > 0) mapping.labelExtra = extra.sort((a, b) => a - b);
  return mapping;
}

/** Mêmes exigences que côté serveur : une date, un libellé, un montant. */
function missingOf(mapping: Record<string, number | number[]>): string[] {
  const missing: string[] = [];
  if (mapping.valueDate === undefined && mapping.bookingDate === undefined) {
    missing.push('une colonne de date');
  }
  if (mapping.label === undefined) missing.push('une colonne de libellé');
  if (mapping.amount === undefined && mapping.debit === undefined && mapping.credit === undefined) {
    missing.push('un montant (ou un couple débit / crédit)');
  }
  return missing;
}

function displayDelimiter(delimiter: string): string {
  return delimiter === '\t' ? 'tabulation' : delimiter;
}

function messageOf(data: unknown): string {
  if (data !== null && typeof data === 'object' && 'message' in data) {
    return String((data as { message: unknown }).message);
  }
  return 'Le fichier n’a pas pu être analysé.';
}
