import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { formatCents, parseAmountToCents } from '../../shared/money.js';
import { apiGet, apiSend } from '../lib/api.js';
import type { Account, NetWorthSnapshot, Pillar3aStatus, Position } from '../lib/api.js';
import { OWNER_ORDER, ownerLabel } from '../lib/labels.js';
import { Amount, Badge, Button, Card, EmptyState, Field, inputClass } from '../components/ui.js';
import { LineChart } from '../components/LineChart.js';

const KINDS = [
  { value: 'compte', label: 'Compte bancaire' },
  { value: 'titres', label: 'Titres (ETF, actions)' },
  { value: 'crypto', label: 'Cryptomonnaie' },
  { value: 'prevoyance', label: 'Prévoyance (3a, LPP)' },
  { value: 'immobilier', label: 'Immobilier' },
  { value: 'vehicule', label: 'Véhicule' },
  { value: 'dette', label: 'Dette' },
  { value: 'autre', label: 'Autre' },
] as const;

const ORIGIN_LABELS: Record<Position['origin'], string> = {
  saisi: 'saisi',
  releve: 'déduit du relevé',
  report: 'reporté',
  inconnu: 'non renseigné',
};

/**
 * Patrimoine : ce que le ménage possède, moins ce qu'il doit.
 *
 * Les comptes suivis se déduisent des relevés ; les autres positions se
 * relèvent à la main. L'origine de chaque chiffre est affichée, parce qu'une
 * valeur reportée du mois dernier ne vaut pas une valeur relevée ce mois-ci.
 */
export function NetWorthPage() {
  const [period, setPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const queryClient = useQueryClient();

  const snapshot = useQuery({
    queryKey: ['patrimoine', period],
    queryFn: () => apiGet<NetWorthSnapshot>(`/patrimoine?mois=${period}`),
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['patrimoine'] });

  if (snapshot.data === undefined) return <EmptyState>Chargement…</EmptyState>;
  const { positions, series } = snapshot.data;

  const assetsCents = positions
    .filter((position) => !position.isLiability)
    .reduce((sum, position) => sum + (position.valueCents ?? 0), 0);
  const liabilitiesCents = positions
    .filter((position) => position.isLiability)
    .reduce((sum, position) => sum + Math.abs(position.valueCents ?? 0), 0);
  const unknown = positions.filter((position) => position.valueCents === null).length;
  const carried = positions.filter((position) => position.origin === 'report').length;

  return (
    <div className="flex flex-col gap-6">
      <Card
        title="Patrimoine net"
        description="Actifs moins dettes, à la fin du mois choisi."
        actions={
          <input
            type="month"
            className={inputClass}
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
          />
        }
      >
        <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Actifs</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular">{formatCents(assetsCents)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Dettes</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular">{formatCents(liabilitiesCents)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Patrimoine net</dt>
            <dd className="mt-0.5 text-lg font-semibold">
              <Amount cents={assetsCents - liabilitiesCents} />
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Positions</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular">{positions.length}</dd>
          </div>
        </dl>

        {(carried > 0 || unknown > 0) && (
          <p className="mt-4 flex flex-wrap gap-2">
            {carried > 0 && <Badge tone="warn">{carried} position(s) reportée(s)</Badge>}
            {unknown > 0 && <Badge tone="warn">{unknown} position(s) non renseignée(s)</Badge>}
          </p>
        )}
      </Card>

      {series.length > 1 && (
        <Card title="Évolution du patrimoine net">
          <LineChart
            labels={series.map((point) => point.period.slice(2).replace('-', '/'))}
            series={[
              {
                key: 'net',
                name: 'Patrimoine net',
                values: series.map((point) => point.netCents),
                hue: 0,
              },
            ]}
          />
        </Card>
      )}

      <PositionsCard positions={positions} period={period} onChange={refresh} />
      <NewPositionCard onCreated={refresh} />
      <Pillar3aCard year={Number(period.slice(0, 4))} />
      <YearEndCard period={period} />
    </div>
  );
}

function PositionsCard({
  positions,
  period,
  onChange,
}: {
  positions: Position[];
  period: string;
  onChange: () => void;
}) {
  return (
    <Card
      title={`Positions au ${period}`}
      description="Une valeur saisie l’emporte sur le solde déduit des relevés ; un mois non saisi reprend la dernière valeur connue, signalée comme telle."
    >
      {positions.length === 0 ? (
        <EmptyState>Aucune position. Ajoutez-en une ci-dessous.</EmptyState>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="py-2">Position</th>
              <th>Personne</th>
              <th className="text-right">Quantité</th>
              <th className="text-right">Cours</th>
              <th className="text-right">Valeur</th>
              <th>Origine</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {positions.map((position) => (
              <PositionRow
                key={position.assetId}
                position={position}
                period={period}
                onChange={onChange}
              />
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function PositionRow({
  position,
  period,
  onChange,
}: {
  position: Position;
  period: string;
  onChange: () => void;
}) {
  const [value, setValue] = useState(
    position.origin === 'saisi' && position.valueCents !== null
      ? (position.valueCents / 100).toFixed(2)
      : '',
  );
  const [quantity, setQuantity] = useState(
    position.quantityE8 === null ? '' : String(position.quantityE8 / 100_000_000),
  );
  const [price, setPrice] = useState(
    position.unitPriceCents === null ? '' : (position.unitPriceCents / 100).toFixed(2),
  );
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const cents = value.trim() === '' ? null : parseAmountToCents(value);
      const priceCents = price.trim() === '' ? null : parseAmountToCents(price);
      const quantityE8 =
        quantity.trim() === '' ? null : Math.round(Number(quantity.replace(',', '.')) * 100_000_000);

      if ((value.trim() !== '' && cents === null) || (price.trim() !== '' && priceCents === null)) {
        throw new Error('Montant illisible.');
      }
      if (quantityE8 !== null && !Number.isFinite(quantityE8)) throw new Error('Quantité illisible.');

      return apiSend(`/patrimoine/positions/${position.assetId}/valorisation`, 'PUT', {
        period,
        valueCents: cents,
        quantityE8,
        unitPriceCents: priceCents,
      });
    },
    onSuccess: () => {
      setError(null);
      onChange();
    },
    onError: (cause: Error) => setError(cause.message),
  });

  return (
    <tr className="border-t border-slate-100">
      <td className="py-1.5">
        {position.label}
        {position.isLiability && (
          <span className="ml-2">
            <Badge>dette</Badge>
          </span>
        )}
      </td>
      <td className="text-slate-500">{ownerLabel(position.owner)}</td>
      <td className="text-right">
        <input
          className={`${inputClass} w-28 text-right`}
          inputMode="decimal"
          placeholder="—"
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
        />
      </td>
      <td className="text-right">
        <input
          className={`${inputClass} w-28 text-right`}
          inputMode="decimal"
          placeholder="—"
          value={price}
          onChange={(event) => setPrice(event.target.value)}
        />
      </td>
      <td className="text-right">
        <input
          className={`${inputClass} w-32 text-right`}
          inputMode="decimal"
          placeholder={position.valueCents === null ? '—' : (position.valueCents / 100).toFixed(2)}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </td>
      <td className="whitespace-nowrap text-xs text-slate-500">
        {ORIGIN_LABELS[position.origin]}
        {position.reportedFrom !== null && ` de ${position.reportedFrom}`}
      </td>
      <td className="whitespace-nowrap text-right">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          Enregistrer
        </Button>
        {error !== null && <span className="ml-2 text-xs text-red-700">{error}</span>}
      </td>
    </tr>
  );
}

function NewPositionCard({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState({
    label: '',
    kind: 'titres',
    owner: 'commun',
    accountId: '',
    isLiability: false,
  });

  const accounts = useQuery({ queryKey: ['accounts'], queryFn: () => apiGet<Account[]>('/comptes') });

  const create = useMutation({
    mutationFn: () =>
      apiSend('/patrimoine/positions', 'POST', {
        label: form.label,
        kind: form.kind,
        owner: form.owner,
        isLiability: form.isLiability,
        accountId: form.accountId === '' ? null : Number(form.accountId),
      }),
    onSuccess: () => {
      setForm({ label: '', kind: 'titres', owner: 'commun', accountId: '', isLiability: false });
      onCreated();
    },
  });

  return (
    <Card title="Ajouter une position">
      <div className="flex flex-wrap items-end gap-4">
        <Field label="Libellé">
          <input
            className={inputClass}
            value={form.label}
            onChange={(event) => setForm({ ...form, label: event.target.value })}
          />
        </Field>
        <Field label="Nature">
          <select
            className={inputClass}
            value={form.kind}
            onChange={(event) =>
              setForm({
                ...form,
                kind: event.target.value,
                isLiability: event.target.value === 'dette',
              })
            }
          >
            {KINDS.map((kind) => (
              <option key={kind.value} value={kind.value}>
                {kind.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Personne">
          <select
            className={inputClass}
            value={form.owner}
            onChange={(event) => setForm({ ...form, owner: event.target.value })}
          >
            {OWNER_ORDER.map((owner) => (
              <option key={owner} value={owner}>
                {ownerLabel(owner)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Compte suivi (facultatif)">
          <select
            className={inputClass}
            value={form.accountId}
            onChange={(event) => setForm({ ...form, accountId: event.target.value })}
          >
            <option value="">Aucun — valeur saisie</option>
            {(accounts.data ?? []).map((account) => (
              <option key={account.id} value={account.id}>
                {account.label}
              </option>
            ))}
          </select>
        </Field>
        <Button
          variant="primary"
          disabled={form.label.trim() === '' || create.isPending}
          onClick={() => create.mutate()}
        >
          Ajouter
        </Button>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Adossée à un compte suivi, une position reprend le solde déduit des relevés importés : il
        n’y a rien à saisir tous les mois.
      </p>
    </Card>
  );
}

function Pillar3aCard({ year }: { year: number }) {
  const queryClient = useQueryClient();
  const [ceiling, setCeiling] = useState('');

  const status = useQuery({
    queryKey: ['pilier-3a', year],
    queryFn: () => apiGet<Pillar3aStatus>(`/patrimoine/pilier-3a?annee=${year}`),
  });

  const save = useMutation({
    mutationFn: () =>
      apiSend(`/patrimoine/pilier-3a/${year}`, 'PUT', {
        ceilingCents: parseAmountToCents(ceiling),
      }),
    onSuccess: () => {
      setCeiling('');
      void queryClient.invalidateQueries({ queryKey: ['pilier-3a'] });
    },
  });

  if (status.data === undefined) return null;
  const data = status.data;

  return (
    <Card
      title={`Pilier 3a ${year}`}
      description={
        data.daysLeft > 0
          ? `${data.daysLeft} jour(s) avant le 31 décembre.`
          : 'L’année est close.'
      }
    >
      {data.message !== null && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {data.message}
          <div className="mt-2 flex items-end gap-2">
            <input
              className={inputClass}
              inputMode="decimal"
              placeholder="7'258.00"
              value={ceiling}
              onChange={(event) => setCeiling(event.target.value)}
            />
            <Button onClick={() => save.mutate()} disabled={ceiling.trim() === ''}>
              Enregistrer le plafond {year}
            </Button>
          </div>
        </div>
      )}

      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="py-2">Personne</th>
            <th className="text-right">Versé</th>
            <th className="text-right">Plafond</th>
            <th className="text-right">Reste à verser</th>
          </tr>
        </thead>
        <tbody>
          {data.perPerson.map((person) => (
            <tr key={person.owner} className="border-t border-slate-100">
              <td className="py-1.5">{ownerLabel(person.owner)}</td>
              <td className="text-right tabular">{formatCents(person.paidCents)}</td>
              <td className="text-right tabular text-slate-500">
                {data.ceilingCents === null ? '—' : formatCents(data.ceilingCents)}
              </td>
              <td className="text-right tabular font-medium">
                {person.remainingCents === null ? '—' : formatCents(person.remainingCents)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

/** État au 31 décembre : ce que la déclaration de fortune demande. */
function YearEndCard({ period }: { period: string }) {
  const year = Number(period.slice(0, 4));
  const target = `${year - 1}-12`;

  const snapshot = useQuery({
    queryKey: ['patrimoine', target],
    queryFn: () => apiGet<NetWorthSnapshot>(`/patrimoine?mois=${target}`),
  });

  if (snapshot.data === undefined) return null;
  const positions = snapshot.data.positions.filter((position) => position.valueCents !== null);
  if (positions.length === 0) return null;

  const net = positions.reduce(
    (sum, position) =>
      sum + (position.isLiability ? -Math.abs(position.valueCents!) : position.valueCents!),
    0,
  );

  return (
    <Card
      title={`État au 31 décembre ${year - 1}`}
      description="La date que retient la déclaration de fortune du canton de Fribourg."
    >
      <table className="w-full text-sm">
        <tbody>
          {positions.map((position) => (
            <tr key={position.assetId} className="border-t border-slate-100">
              <td className="py-1.5">{position.label}</td>
              <td className="text-xs text-slate-500">{ORIGIN_LABELS[position.origin]}</td>
              <td className="text-right tabular">
                {position.isLiability ? '−' : ''}
                {formatCents(Math.abs(position.valueCents!))}
              </td>
            </tr>
          ))}
          <tr className="border-t-2 border-slate-300 font-semibold">
            <td className="py-1.5" colSpan={2}>
              Fortune nette
            </td>
            <td className="text-right">
              <Amount cents={net} />
            </td>
          </tr>
        </tbody>
      </table>
    </Card>
  );
}
