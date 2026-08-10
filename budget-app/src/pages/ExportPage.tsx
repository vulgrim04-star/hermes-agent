import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { formatSwissDate } from '../../shared/dates.js';
import { formatCents } from '../../shared/money.js';
import { apiGet, apiSend } from '../lib/api.js';
import type { Account, BackupFile, Category, Owner } from '../lib/api.js';
import { OWNER_ORDER, ownerLabel } from '../lib/labels.js';
import {
  Badge,
  Button,
  Card,
  DownloadLink,
  EmptyState,
  Field,
  inputClass,
} from '../components/ui.js';

/**
 * Export des écritures et sauvegarde de la base.
 *
 * Deux sujets voisins : faire sortir les données pour les travailler ailleurs,
 * et mettre la comptabilité à l'abri. Le second n'est pas facultatif — toute la
 * comptabilité tient dans un seul fichier.
 */
export function ExportPage() {
  return (
    <div className="flex flex-col gap-6">
      <ExportCard />
      <BackupCard />
    </div>
  );
}

function ExportCard() {
  // La déclaration de fortune porte sur l'année close, pas sur l'année en cours.
  const lastClosedYear = new Date().getUTCFullYear() - 1;
  const [filters, setFilters] = useState({
    from: '',
    to: '',
    accountId: '',
    categoryId: '',
    owner: '',
  });

  const accounts = useQuery({ queryKey: ['accounts'], queryFn: () => apiGet<Account[]>('/comptes') });
  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => apiGet<Category[]>('/categories'),
  });

  const query = useMemo(() => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value !== '') params.set(key, value);
    return params.toString();
  }, [filters]);

  const preview = useQuery({
    queryKey: ['export-preview', query],
    queryFn: () => apiGet<{ count: number; totalCents: number }>(`/export/apercu?${query}`),
  });

  return (
    <Card
      title="Exporter les écritures"
      description="Une écriture ventilée sort en autant de lignes que de découpes — c’est ce qu’attend un tableau croisé dynamique."
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
        <Field label="Catégorie">
          <select
            className={inputClass}
            value={filters.categoryId}
            onChange={(e) => setFilters({ ...filters, categoryId: e.target.value })}
          >
            <option value="">Toutes</option>
            {(categories.data ?? []).map((category) => (
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
            value={filters.owner}
            onChange={(e) => setFilters({ ...filters, owner: e.target.value as Owner | '' })}
          >
            <option value="">Toutes</option>
            {OWNER_ORDER.map((owner) => (
              <option key={owner} value={owner}>
                {ownerLabel(owner)}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <DownloadLink variant="primary" href={`/api/export/ecritures.xlsx?${query}`}>
          Télécharger en Excel (.xlsx)
        </DownloadLink>
        <DownloadLink href={`/api/export/ecritures.csv?${query}`}>Télécharger en CSV</DownloadLink>
        {preview.data !== undefined && (
          <span className="text-sm text-slate-600">
            {preview.data.count} ligne(s), solde {formatCents(preview.data.totalCents)}
          </span>
        )}
      </div>

      <p className="mt-4 text-xs text-slate-500">
        Le classeur Excel porte des dates et des montants typés, directement triables et
        pivotables. Le CSV est en UTF-8 avec BOM et séparateur point-virgule : Excel l’ouvre sans
        assistant d’import et sans casser les accents.
      </p>

      <div className="mt-5 border-t border-slate-100 pt-5">
        <p className="mb-3 text-sm text-slate-600">
          <span className="font-medium">État des positions au 31 décembre {lastClosedYear}</span> —
          une ligne par position, avec quantité, cours, valeur et l’origine du chiffre (saisi,
          déduit d’un relevé, ou reporté d’un mois antérieur). C’est la pièce à joindre à la
          déclaration de fortune.
        </p>
        <DownloadLink href={`/api/export/positions.xlsx?mois=${lastClosedYear}-12`}>
          Télécharger l’état des positions (.xlsx)
        </DownloadLink>
      </div>
    </Card>
  );
}

function BackupCard() {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const backups = useQuery({
    queryKey: ['backups'],
    queryFn: () => apiGet<BackupFile[]>('/sauvegardes'),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['backups'] });
    void queryClient.invalidateQueries({ queryKey: ['transactions'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    void queryClient.invalidateQueries({ queryKey: ['patrimoine'] });
  };

  const create = useMutation({
    mutationFn: () => apiSend<BackupFile>('/sauvegardes', 'POST'),
    onSuccess: (file) => {
      setMessage(`Sauvegarde créée : ${file.name}`);
      refresh();
    },
  });

  const restore = useMutation({
    mutationFn: (name: string) =>
      apiSend<{ safety: BackupFile }>(`/sauvegardes/${name}/restaurer`, 'POST'),
    onSuccess: (result) => {
      setConfirming(null);
      setMessage(
        `Base restaurée. L’état précédent a été sauvegardé sous ${result.safety.name}, au cas où.`,
      );
      refresh();
    },
  });

  return (
    <Card
      title="Sauvegarde de la base"
      description="Toute la comptabilité tient dans un fichier. Une sauvegarde en est une copie cohérente, prise sans arrêter l’application."
      actions={
        <Button variant="primary" onClick={() => create.mutate()} disabled={create.isPending}>
          {create.isPending ? 'Copie…' : 'Créer une sauvegarde'}
        </Button>
      }
    >
      {message !== null && (
        <p className="mb-4">
          <Badge tone="ok">{message}</Badge>
        </p>
      )}

      {backups.data === undefined ? (
        <EmptyState>Chargement…</EmptyState>
      ) : backups.data.length === 0 ? (
        <EmptyState>Aucune sauvegarde pour l’instant.</EmptyState>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="py-2">Fichier</th>
              <th>Créée le</th>
              <th className="text-right">Taille</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {backups.data.map((file) => (
              <tr key={file.name} className="border-t border-slate-100">
                <td className="py-1.5 font-mono text-xs">
                  {file.name}
                  {file.name.includes('-securite') && (
                    <span className="ml-2">
                      <Badge>avant restauration</Badge>
                    </span>
                  )}
                </td>
                <td className="tabular text-slate-500">
                  {formatSwissDate(file.createdAt.slice(0, 10))} {file.createdAt.slice(11, 16)}
                </td>
                <td className="tabular text-right text-slate-500">
                  {Math.round(file.sizeBytes / 1024)} Ko
                </td>
                <td className="whitespace-nowrap text-right">
                  <DownloadLink variant="ghost" href={`/api/sauvegardes/${file.name}`}>
                    Télécharger
                  </DownloadLink>
                  {confirming === file.name ? (
                    <>
                      <Button variant="danger" onClick={() => restore.mutate(file.name)}>
                        Confirmer le remplacement
                      </Button>
                      <Button variant="ghost" onClick={() => setConfirming(null)}>
                        Annuler
                      </Button>
                    </>
                  ) : (
                    <Button variant="ghost" onClick={() => setConfirming(file.name)}>
                      Restaurer
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="mt-4 text-xs text-slate-500">
        Téléchargez la sauvegarde pour la porter sur un disque externe : c’est le seul moyen
        qu’elle survive à la machine. Une restauration remplace la base en place — l’état actuel
        est automatiquement sauvegardé avant, de sorte qu’aucune manœuvre ne soit sans retour.
      </p>
    </Card>
  );
}
