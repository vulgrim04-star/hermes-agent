import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { formatSwissDate } from '../../shared/dates.js';
import { formatCents } from '../../shared/money.js';
import { apiGet } from '../lib/api.js';
import type { MonthlyDashboard } from '../lib/api.js';
import { KIND_LABELS } from '../lib/labels.js';
import { Amount, Badge, Button, Card, EmptyState, inputClass } from '../components/ui.js';
import { Donut } from '../components/Donut.js';
import { AnnualView } from './AnnualView.js';

/**
 * Tableau de bord, à deux échelles.
 *
 * Le mois pour piloter, l'année pour comprendre : une prime semestrielle ou un
 * acompte trimestriel ne se lisent pas sur trente jours. Les deux vues partent
 * du même journal et de la même définition du reste à vivre.
 */
export function DashboardPage() {
  const [scale, setScale] = useState<'mois' | 'annee'>('mois');
  const [year, setYear] = useState('');

  return (
    <div className="flex flex-col gap-6">
      <nav className="flex gap-1 border-b border-slate-200">
        {(['mois', 'annee'] as const).map((entry) => (
          <button
            key={entry}
            type="button"
            onClick={() => setScale(entry)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
              scale === entry
                ? 'border-slate-900 text-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {entry === 'mois' ? 'Mois' : 'Année'}
          </button>
        ))}
      </nav>

      {scale === 'mois' ? <MonthlyView /> : <AnnualView year={year} onYearChange={setYear} />}
    </div>
  );
}

function MonthlyView() {
  const [month, setMonth] = useState<string | null>(null);

  const dashboard = useQuery({
    queryKey: ['dashboard', month],
    queryFn: () =>
      apiGet<MonthlyDashboard>(`/tableau-de-bord/mensuel${month === null ? '' : `?mois=${month}`}`),
  });

  if (dashboard.data === undefined) return <EmptyState>Chargement…</EmptyState>;
  const data = dashboard.data;
  const { totals, previous } = data;

  const months = data.availableMonths.length > 0 ? data.availableMonths : [data.month];
  // Comparer à un mois sans écriture n'apprend rien : mieux vaut le dire.
  const comparable =
    previous.month !== null && data.availableMonths.includes(previous.month);

  return (
    <div className="flex flex-col gap-6">
      <Card
        title="Vue du mois"
        actions={
          <select
            className={inputClass}
            value={data.month}
            onChange={(event) => setMonth(event.target.value)}
          >
            {months.map((value) => (
              <option key={value} value={value}>
                {monthLabel(value)}
              </option>
            ))}
          </select>
        }
      >
        {/* Le reste à vivre, seul et en grand : c'est la question qu'on se pose
            en ouvrant l'application, et elle ne doit pas être cherchée parmi
            quatre indicateurs de même poids. Le rouge n'apparaît que sur un
            mois vécu au-delà de ce qui est entré. */}
        <dl className="pb-6 pt-2 text-center">
          <dt className="text-[15px] text-slate-500">Reste à vivre</dt>
          <dd
            className={`mt-1 text-[clamp(40px,13vw,56px)] font-bold leading-none tracking-[-0.04em] tabular ${
              totals.remainingCents < 0 ? 'text-red-700' : ''
            }`}
          >
            {formatCents(totals.remainingCents)}
          </dd>
          {comparable && (
            <p className="mt-2 text-sm text-slate-500">
              <span className="font-semibold">
                {totals.remainingCents - previous.totals.remainingCents >= 0 ? '+' : '−'}
                {formatCents(Math.abs(totals.remainingCents - previous.totals.remainingCents))}
              </span>{' '}
              par rapport à la période précédente
            </p>
          )}
        </dl>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Stat
            label="Revenus"
            comparable={comparable}
            cents={totals.incomeCents}
            previousCents={previous.totals.incomeCents}
            tone="positive"
          />
          <Stat
            label="Dépenses"
            comparable={comparable}
            cents={totals.expenseCents}
            previousCents={previous.totals.expenseCents}
            tone="negative"
            lowerIsBetter
          />
          <Stat
            label="Épargne"
            comparable={comparable}
            cents={totals.savingsCents}
            previousCents={previous.totals.savingsCents}
            tone="positive"
          />
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Taux d’épargne</p>
            <p className="mt-1 text-xl font-semibold tabular">
              {totals.savingsRate === null ? '—' : formatRate(totals.savingsRate)}
            </p>
            <p className="mt-0.5 text-xs text-slate-400">
              {!comparable || previous.totals.savingsRate === null
                ? 'pas de mois précédent à comparer'
                : `mois précédent : ${formatRate(previous.totals.savingsRate)}`}
            </p>
          </div>
        </div>

        <p className="mt-5 text-xs text-slate-500">
          Reste à vivre = revenus − dépenses − épargne. L’épargne est un emploi du revenu, pas une
          consommation : elle est déduite, et le taux d’épargne la rapporte aux revenus.
        </p>

        {data.uncategorised.count > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <Badge tone="warn">{data.uncategorised.count} à catégoriser</Badge>
            <span>
              {formatCents(data.uncategorised.amountCents)} CHF ne sont pas encore affectés ; ils
              sont comptés dans les totaux d’après leur sens.
            </span>
            <Link
              to="/revision"
              className="ml-auto rounded-md bg-amber-900 px-3 py-1.5 text-xs font-medium text-white"
            >
              Ouvrir la révision
            </Link>
          </div>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Répartition des dépenses" description="Par catégorie de premier niveau.">
          <Donut
            entries={data.expenseBreakdown.map((entry) => ({
              key: String(entry.categoryId ?? 'non-categorise'),
              name: entry.name,
              value: entry.amountCents,
              reserved: entry.categoryId === null,
            }))}
            total={totals.expenseCents}
          />
        </Card>

        <Card title="Plus grosses dépenses du mois">
          {data.topExpenses.length === 0 ? (
            <EmptyState>Aucune dépense sur ce mois.</EmptyState>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {data.topExpenses.map((expense, index) => (
                  <tr
                    key={`${expense.transactionId}-${index}`}
                    className="border-b border-slate-100 last:border-0"
                  >
                    <td className="py-1.5 whitespace-nowrap tabular text-slate-500">
                      {formatSwissDate(expense.valueDate)}
                    </td>
                    <td className="max-w-xs truncate" title={expense.label}>
                      {expense.label}
                    </td>
                    <td className="whitespace-nowrap text-slate-500">
                      {expense.categoryName ?? '— à catégoriser —'}
                    </td>
                    <td className="whitespace-nowrap text-right">
                      <Amount cents={expense.amountCents} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <Card
        title="Budget contre réel"
        description="Une catégorie n’apparaît que si elle porte un budget ou un mouvement du mois."
        actions={<Link to="/budgets"><Button>Régler les budgets</Button></Link>}
      >
        {data.budgetLines.length === 0 ? (
          <EmptyState>Aucun mouvement ni budget sur ce mois.</EmptyState>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-2">Catégorie</th>
                <th className="text-right">Réel</th>
                <th className="text-right">Budget</th>
                <th className="text-right">Écart</th>
                <th className="w-56">Consommation</th>
              </tr>
            </thead>
            <tbody>
              {data.budgetLines.map((line) => (
                <tr
                  key={line.categoryId}
                  className={`border-t border-slate-100 ${line.parentId === null ? 'font-medium' : ''}`}
                >
                  <td className="py-2">
                    {line.parentId !== null && <span className="text-slate-300">›&nbsp;</span>}
                    {line.name}
                    {line.parentId === null && (
                      <span className="ml-2 text-xs font-normal text-slate-400">
                        {KIND_LABELS[line.kind]}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap text-right tabular">
                    {formatCents(line.actualCents)}
                  </td>
                  <td className="whitespace-nowrap text-right tabular text-slate-500">
                    {line.budgetCents === null ? '—' : formatCents(line.budgetCents)}
                  </td>
                  <td className="whitespace-nowrap text-right tabular">
                    {line.gapCents === null ? (
                      '—'
                    ) : (
                      <span className={line.gapCents < 0 ? 'text-red-700' : 'text-emerald-700'}>
                        {formatCents(line.gapCents, { signDisplay: 'always' })}
                      </span>
                    )}
                  </td>
                  <td>
                    <ConsumptionBar ratio={line.ratio} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

/**
 * Barre de consommation d'un budget. Le dépassement est signalé par la couleur
 * **et** par le libellé du pourcentage : la couleur ne porte jamais seule.
 */
function ConsumptionBar({ ratio }: { ratio: number | null }) {
  if (ratio === null) return <span className="text-xs text-slate-400">sans budget</span>;

  const over = ratio > 1;
  const width = Math.min(ratio, 1) * 100;

  return (
    <div className="flex items-center gap-2">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full ${over ? 'bg-red-600' : 'bg-slate-700'}`}
          style={{ width: `${width}%` }}
        />
      </div>
      <span className={`w-14 text-right text-xs tabular ${over ? 'text-red-700' : 'text-slate-500'}`}>
        {formatRate(ratio)}
      </span>
    </div>
  );
}

function Stat({
  label,
  cents,
  previousCents,
  tone,
  comparable,
  lowerIsBetter = false,
}: {
  label: string;
  cents: number;
  previousCents: number;
  tone: 'positive' | 'negative';
  comparable: boolean;
  lowerIsBetter?: boolean;
}) {
  const delta = cents - previousCents;
  const improved = lowerIsBetter ? delta < 0 : delta > 0;

  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p
        className={`mt-1 text-xl font-semibold tabular ${
          tone === 'negative' && cents !== 0 ? 'text-red-700' : 'text-slate-900'
        }`}
      >
        {formatCents(cents)}
      </p>
      <p className="mt-0.5 text-xs text-slate-400">
        {!comparable ? (
          'pas de mois précédent à comparer'
        ) : delta === 0 ? (
          'identique au mois précédent'
        ) : (
          <>
            <span className={improved ? 'text-emerald-700' : 'text-red-700'}>
              {formatCents(delta, { signDisplay: 'always' })}
            </span>{' '}
            vs mois précédent
          </>
        )}
      </p>
    </div>
  );
}

const MONTH_NAMES = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

function monthLabel(yearMonth: string): string {
  const [year, month] = yearMonth.split('-');
  const name = MONTH_NAMES[Number(month) - 1] ?? yearMonth;
  return `${name} ${year}`;
}

function formatRate(ratio: number): string {
  return `${(ratio * 100).toFixed(1).replace('.', ',')} %`;
}
