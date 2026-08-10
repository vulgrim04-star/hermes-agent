import { useQuery } from '@tanstack/react-query';

import { formatCents } from '../../shared/money.js';
import { apiGet } from '../lib/api.js';
import type { AnnualDashboard } from '../lib/api.js';
import { Amount, Badge, Card, EmptyState, inputClass } from '../components/ui.js';
import { LineChart } from '../components/LineChart.js';

const MONTH_LABELS = [
  'jan',
  'fév',
  'mar',
  'avr',
  'mai',
  'juin',
  'juil',
  'août',
  'sep',
  'oct',
  'nov',
  'déc',
];

/**
 * Vue annuelle : douze mois en colonnes.
 *
 * Ce que le mensuel ne montre pas — la prime semestrielle, l'acompte
 * trimestriel, le 13e salaire — se lit ici. Les moyennes sont rapportées aux
 * douze mois, y compris ceux sans écriture : une moyenne calculée sur les seuls
 * mois mouvementés serait flatteuse.
 */
export function AnnualView({ year, onYearChange }: { year: string; onYearChange: (year: string) => void }) {
  const annual = useQuery({
    queryKey: ['dashboard', 'annuel', year],
    queryFn: () =>
      apiGet<AnnualDashboard>(`/tableau-de-bord/annuel${year === '' ? '' : `?annee=${year}`}`),
  });

  if (annual.data === undefined) return <EmptyState>Chargement…</EmptyState>;
  const data = annual.data;

  const monthly = data.months.map((column) => column.totals);

  return (
    <div className="flex flex-col gap-6">
      <Card
        title={`Année ${data.year}`}
        description={
          data.monthsWithEntries === 12
            ? 'Douze mois mouvementés.'
            : `${data.monthsWithEntries} mois sur 12 portent des écritures ; les autres comptent pour zéro dans les moyennes.`
        }
        actions={
          <select className={inputClass} value={year} onChange={(e) => onYearChange(e.target.value)}>
            {data.availableYears.length === 0 && <option value="">{data.year}</option>}
            {data.availableYears.map((available) => (
              <option key={available} value={String(available)}>
                {available}
              </option>
            ))}
          </select>
        }
      >
        <dl className="grid grid-cols-2 gap-4 md:grid-cols-5">
          <Figure label="Revenus" cents={data.totals.incomeCents} average={data.averages.incomeCents} />
          <Figure label="Dépenses" cents={data.totals.expenseCents} average={data.averages.expenseCents} />
          <Figure label="Épargne" cents={data.totals.savingsCents} average={data.averages.savingsCents} />
          <Figure
            label="Reste à vivre"
            cents={data.totals.remainingCents}
            average={data.averages.remainingCents}
            signed
          />
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Taux d’épargne</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular">
              {data.totals.savingsRate === null
                ? '—'
                : `${(data.totals.savingsRate * 100).toFixed(1)} %`}
            </dd>
          </div>
        </dl>

        {data.previous !== null && (
          <p className="mt-4 text-sm text-slate-600">
            {data.previous.year} : revenus {formatCents(data.previous.totals.incomeCents)}, dépenses{' '}
            {formatCents(data.previous.totals.expenseCents)}, reste à vivre{' '}
            {formatCents(data.previous.totals.remainingCents)}.
          </p>
        )}
        {data.uncategorised.count > 0 && (
          <p className="mt-4">
            <Badge tone="warn">
              {data.uncategorised.count} écriture(s) sans catégorie sur l’année,{' '}
              {formatCents(data.uncategorised.amountCents)}
            </Badge>
          </p>
        )}
      </Card>

      <Card
        title="Revenus, dépenses et reste à vivre, mois par mois"
        description="Trois séries : au-delà, les teintes ne se comparent plus deux à deux de façon sûre."
      >
        <LineChart
          labels={MONTH_LABELS}
          series={[
            { key: 'revenus', name: 'Revenus', values: monthly.map((t) => t.incomeCents), hue: 0 },
            { key: 'depenses', name: 'Dépenses', values: monthly.map((t) => t.expenseCents), hue: 1 },
            {
              key: 'reste',
              name: 'Reste à vivre',
              values: monthly.map((t) => t.remainingCents),
              hue: 2,
            },
          ]}
        />
      </Card>

      <Card title="Détail par catégorie" description="Une écriture ventilée est comptée dans chacune de ses catégories, et une seule fois au total.">
        {data.categories.length === 0 ? (
          <EmptyState>Aucune écriture sur cette année.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-2 pr-4">Catégorie</th>
                  {MONTH_LABELS.map((label) => (
                    <th key={label} className="px-1 text-right font-medium">
                      {label}
                    </th>
                  ))}
                  <th className="px-2 text-right">Total</th>
                  <th className="text-right">Moy.</th>
                </tr>
              </thead>
              <tbody>
                {data.categories.map((line) => (
                  <tr
                    key={line.categoryId}
                    className={`border-t border-slate-100 ${line.parentId === null ? 'font-medium' : ''}`}
                  >
                    <td className={`py-1.5 pr-4 whitespace-nowrap ${line.parentId === null ? '' : 'pl-4 text-slate-600'}`}>
                      {line.name}
                    </td>
                    {line.monthlyCents.map((cents, index) => (
                      <td
                        key={`${line.categoryId}-${index}`}
                        className="px-1 text-right tabular text-xs"
                      >
                        {cents === 0 ? (
                          <span className="text-slate-300">—</span>
                        ) : (
                          formatCents(cents)
                        )}
                      </td>
                    ))}
                    <td className="px-2 text-right tabular">{formatCents(line.totalCents)}</td>
                    <td className="text-right tabular text-slate-500">
                      {formatCents(line.averageCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Figure({
  label,
  cents,
  average,
  signed = false,
}: {
  label: string;
  cents: number;
  average: number;
  signed?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold tabular">
        {signed ? <Amount cents={cents} /> : formatCents(cents)}
      </dd>
      <dd className="text-xs text-slate-500">{formatCents(average)} / mois</dd>
    </div>
  );
}
