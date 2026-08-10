import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiGet, apiSend } from '../lib/api.js';
import type { Account, Owner } from '../lib/api.js';
import { OWNER_ORDER, ownerLabel } from '../lib/labels.js';
import { Badge, Button, Card, EmptyState, Field, inputClass } from '../components/ui.js';
import { formatIban } from '../../shared/iban.js';

export function AccountsPage() {
  const queryClient = useQueryClient();
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: () => apiGet<Account[]>('/comptes') });
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiGet<Record<string, string>>('/parametres'),
  });

  const update = useMutation({
    mutationFn: (input: { id: number; patch: Partial<Account> }) =>
      apiSend(`/comptes/${input.id}`, 'PATCH', {
        label: input.patch.label,
        defaultOwner: input.patch.default_owner,
        currency: input.patch.currency,
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['accounts'] }),
  });

  const saveSettings = useMutation({
    mutationFn: (patch: Record<string, string>) => apiSend('/parametres', 'PATCH', patch),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['settings'] }),
  });

  return (
    <div className="flex flex-col gap-6">
      <Card
        title="Comptes"
        description="Les comptes sont créés automatiquement à l’import, à partir de l’IBAN du fichier. Le libellé et l’attribution par défaut se règlent ici."
      >
        {accounts.data === undefined ? (
          <EmptyState>Chargement…</EmptyState>
        ) : accounts.data.length === 0 ? (
          <EmptyState>Aucun compte pour l’instant — importez un relevé.</EmptyState>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-2">Numéro</th>
                <th>Libellé</th>
                <th>Devise</th>
                <th>Attribution par défaut</th>
                <th className="text-right">Écritures</th>
              </tr>
            </thead>
            <tbody>
              {accounts.data.map((account) => (
                <tr key={account.id} className="border-t border-slate-100">
                  <td className="py-2 font-mono text-xs text-slate-500">
                    {formatIban(account.account_key)}
                  </td>
                  <td>
                    <input
                      className={`${inputClass} w-full`}
                      defaultValue={account.label}
                      onBlur={(event) => {
                        const label = event.target.value.trim();
                        if (label !== '' && label !== account.label) {
                          update.mutate({ id: account.id, patch: { label } });
                        }
                      }}
                    />
                  </td>
                  <td className="tabular">{account.currency}</td>
                  <td>
                    <select
                      className={inputClass}
                      value={account.default_owner}
                      onChange={(event) =>
                        update.mutate({
                          id: account.id,
                          patch: { default_owner: event.target.value as Owner },
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
                  <td className="tabular text-right">{account.transaction_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-4 text-xs text-slate-500">
          L’attribution par défaut s’applique aux écritures importées ensuite ; celles déjà en base
          ne sont pas modifiées rétroactivement.
        </p>
      </Card>

      <Card
        title="Ménage"
        description="Les noms utilisés partout dans l’application pour l’attribution des écritures."
      >
        <HouseholdForm
          settings={settings.data ?? {}}
          onSave={(patch) => saveSettings.mutate(patch)}
          saving={saveSettings.isPending}
        />
      </Card>

      <ManualAccountForm />
    </div>
  );
}

function HouseholdForm({
  settings,
  onSave,
  saving,
}: {
  settings: Record<string, string>;
  onSave: (patch: Record<string, string>) => void;
  saving: boolean;
}) {
  const [first, setFirst] = useState(settings.person_1_label ?? 'Personne 1');
  const [second, setSecond] = useState(settings.person_2_label ?? 'Personne 2');

  return (
    <div className="flex flex-wrap items-end gap-4">
      <Field label="Personne 1">
        <input className={inputClass} value={first} onChange={(e) => setFirst(e.target.value)} />
      </Field>
      <Field label="Personne 2">
        <input className={inputClass} value={second} onChange={(e) => setSecond(e.target.value)} />
      </Field>
      <Button
        variant="primary"
        disabled={saving}
        onClick={() => onSave({ person_1_label: first, person_2_label: second })}
      >
        Enregistrer
      </Button>
    </div>
  );
}

function ManualAccountForm() {
  const queryClient = useQueryClient();
  const [accountKey, setAccountKey] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => apiSend('/comptes', 'POST', { accountKey, label, currency: 'CHF' }),
    onSuccess: () => {
      setAccountKey('');
      setLabel('');
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['accounts'] });
    },
    onError: (cause: Error) => setError(cause.message),
  });

  return (
    <Card
      title="Ajouter un compte à la main"
      description="Utile pour les exports qui ne portent pas d’IBAN : le compte est créé ici, puis désigné au moment de l’import."
    >
      <div className="flex flex-wrap items-end gap-4">
        <Field label="IBAN ou numéro">
          <input
            className={`${inputClass} w-80`}
            value={accountKey}
            placeholder="CH93 0076 2011 6238 5295 7"
            onChange={(e) => setAccountKey(e.target.value)}
          />
        </Field>
        <Field label="Libellé">
          <input
            className={`${inputClass} w-64`}
            value={label}
            placeholder="Compte commun"
            onChange={(e) => setLabel(e.target.value)}
          />
        </Field>
        <Button
          variant="primary"
          disabled={accountKey.trim() === '' || label.trim() === '' || create.isPending}
          onClick={() => create.mutate()}
        >
          Créer
        </Button>
        {error !== null && <Badge tone="error">{error}</Badge>}
      </div>
    </Card>
  );
}
