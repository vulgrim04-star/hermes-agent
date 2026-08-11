import { useState } from 'react';
import { Link } from 'react-router-dom';

import Donut, { foldSlices } from '../components/Donut.jsx';
import { MONTHS_SHORT, frDate, monthBounds, monthLabel } from '../lib/dates.js';
import { fmt } from '../lib/money.js';
import { kindOf, rootOf } from '../lib/categories.js';
import { expenseByRoot, ledger, monthsAvailable, totalsOf, yearsAvailable } from '../lib/ledger.js';
import { useBudget } from '../store/useBudget.js';

/**
 * Le mois pour piloter, l'année pour comprendre : une prime semestrielle ou un
 * acompte trimestriel ne se lisent pas sur trente jours. Les deux vues partent
 * du même journal et de la même définition du reste à vivre.
 */
export default function Dashboard() {
  const data = useBudget((s) => s.data);
  const [scale, setScale] = useState('mois');
  const months = monthsAvailable(data);
  const years = yearsAvailable(data);
  const [month, setMonth] = useState(months[0] || '');
  const [year, setYear] = useState(years[0] || '');

  if (!data.tx.length) {
    return (
      <div className="block">
        <div className="empty">
          Aucune écriture pour l’instant. <Link to="/import">Importez un relevé</Link> pour commencer.
        </div>
      </div>
    );
  }

  const period = scale === 'mois' ? (months.includes(month) ? month : months[0]) : (years.includes(year) ? year : years[0]);

  return (
    <>
      <div className="block">
        <header>
          <div className="grow">
            <h3>{scale === 'mois' ? monthLabel(period) : 'Année ' + period}</h3>
            <p>
              Reste à vivre = revenus − dépenses − épargne. L’épargne est un emploi du revenu, pas une
              consommation : elle a sa ligne propre et elle est déduite.
            </p>
          </div>
          <div className="row">
            <select value={scale} onChange={(e) => setScale(e.target.value)}>
              <option value="mois">Mois</option>
              <option value="annee">Année</option>
            </select>
            {scale === 'mois' ? (
              <select value={period} onChange={(e) => setMonth(e.target.value)}>
                {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
              </select>
            ) : (
              <select value={period} onChange={(e) => setYear(e.target.value)}>
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            )}
          </div>
        </header>
        {scale === 'mois' ? <MonthTotals data={data} period={period} /> : <YearTotals data={data} year={period} />}
      </div>

      {scale === 'mois' ? <MonthDetail data={data} period={period} /> : <YearTable data={data} year={period} />}
    </>
  );
}

function Totals({ totals, extra }) {
  return (
    <dl className="stats">
      <div className="stat"><dt>Revenus</dt><dd>{fmt(totals.income)}</dd></div>
      <div className="stat"><dt>Dépenses</dt><dd>{fmt(totals.expense)}</dd></div>
      <div className="stat"><dt>Épargne</dt><dd>{fmt(totals.savings)}</dd></div>
      <div className="stat">
        <dt>Reste à vivre</dt>
        <dd className={totals.remaining < 0 ? 'neg' : 'pos'}>
          {fmt(totals.remaining)}
          {extra && <span className="sub">{extra}</span>}
        </dd>
      </div>
      <div className="stat">
        <dt>Taux d’épargne</dt>
        <dd>{totals.rate === null ? '—' : (totals.rate * 100).toFixed(1) + ' %'}</dd>
      </div>
    </dl>
  );
}

function MonthTotals({ data, period }) {
  const { start, end } = monthBounds(period);
  const rows = ledger(data, start, end);
  const uncategorised = rows.filter((r) => !r.cat);

  return (
    <>
      <Totals totals={totalsOf(rows)} />
      {uncategorised.length > 0 && (
        <div className="body">
          <div className="note warn">
            {uncategorised.length} écriture(s) sans catégorie ce mois-ci,{' '}
            {fmt(uncategorised.reduce((sum, r) => sum + r.cents, 0))}. Elles restent dans les totaux,
            classées par leur signe — un tableau de bord ne doit jamais être faux en silence sur ce
            qui n’a pas encore été affecté. <Link to="/revision">Les traiter</Link>.
          </div>
        </div>
      )}
    </>
  );
}

function MonthDetail({ data, period }) {
  const { start, end } = monthBounds(period);
  const rows = ledger(data, start, end);
  const slices = foldSlices(expenseByRoot(rows));
  const top = rows.filter((r) => r.cents < 0).sort((a, b) => a.cents - b.cents).slice(0, 8);

  return (
    <div className="split">
      <div className="block">
        <header><div className="grow"><h3>Dépenses par poste</h3></div></header>
        <div className="body">
          {slices.length ? (
            <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
              <Donut slices={slices} />
              <div className="legend" style={{ flex: '1 1 200px' }}>
                {slices.map((slice) => (
                  <div key={slice.name}>
                    <i style={{ background: slice.color }} />
                    {slice.name}
                    <span className="num">{fmt(slice.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="muted">Aucune dépense sur la période.</p>
          )}
        </div>
      </div>

      <div className="block">
        <header><div className="grow"><h3>Plus grosses dépenses</h3></div></header>
        <div className="body flush">
          <table>
            <tbody>
              {top.length ? top.map((row) => (
                <tr key={row.id}>
                  <td className="muted" style={{ width: 84 }}>{frDate(row.date)}</td>
                  <td>
                    {row.label}
                    {row.cat && <span className="muted" style={{ display: 'block', fontSize: 12 }}>{row.cat}</span>}
                  </td>
                  <td className="num neg">{fmt(row.cents)}</td>
                </tr>
              )) : (
                <tr><td className="empty">Rien à afficher.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function yearColumns(data, year) {
  return Array.from({ length: 12 }, (_, i) => {
    const period = `${year}-${String(i + 1).padStart(2, '0')}`;
    const { start, end } = monthBounds(period);
    return { period, totals: totalsOf(ledger(data, start, end)) };
  });
}

function YearTotals({ data, year }) {
  const totals = totalsOf(ledger(data, year + '-01-01', year + '-12-31'));
  const columns = yearColumns(data, year);
  const lived = columns.filter((c) => c.totals.income || c.totals.expense || c.totals.savings).length;
  return <Totals totals={totals} extra={`${lived} mois sur 12 mouvementés`} />;
}

function YearTable({ data, year }) {
  const columns = yearColumns(data, year);
  const rows = ledger(data, year + '-01-01', year + '-12-31');
  const totals = totalsOf(rows);

  // Moyennes rapportées aux douze mois, y compris ceux sans écriture : une
  // moyenne calculée sur les seuls mois mouvementés flatte de moitié un ménage
  // qui n'a importé qu'une partie de l'année.
  const average = (value) => Math.round(value / 12);

  const byCategory = new Map();
  for (const row of rows) {
    const name = rootOf(row.cat) || 'Non catégorisé';
    const months = byCategory.get(name) || new Array(12).fill(0);
    const kind = kindOf(row.cat, row.cents);
    months[Number(row.date.slice(5, 7)) - 1] += kind === 'revenu' ? row.cents : -row.cents;
    byCategory.set(name, months);
  }
  const categories = [...byCategory.entries()].sort(
    (a, b) => b[1].reduce((s, v) => s + v, 0) - a[1].reduce((s, v) => s + v, 0),
  );

  const lines = [
    ['Revenus', 'income'],
    ['Dépenses', 'expense'],
    ['Épargne', 'savings'],
    ['Reste à vivre', 'remaining'],
  ];

  return (
    <div className="block">
      <header>
        <div className="grow">
          <h3>Douze mois en colonnes</h3>
          <p>
            Moyennes mensuelles : revenus {fmt(average(totals.income))}, dépenses{' '}
            {fmt(average(totals.expense))}, reste à vivre {fmt(average(totals.remaining))}.
          </p>
        </div>
      </header>
      <div className="body flush">
        <div className="scroll">
          <table className="tight">
            <thead>
              <tr>
                <th>Poste</th>
                {MONTHS_SHORT.map((m) => <th key={m} className="num">{m}</th>)}
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {lines.map(([label, key]) => (
                <tr key={key}>
                  <td><strong>{label}</strong></td>
                  {columns.map((c) => (
                    <td key={c.period} className="num">
                      {c.totals[key] ? fmt(c.totals[key]) : <span className="muted">—</span>}
                    </td>
                  ))}
                  <td className="num"><strong>{fmt(totals[key])}</strong></td>
                </tr>
              ))}
              <tr><td colSpan={14} style={{ borderBottom: '1px solid var(--rule-strong)', padding: 2 }} /></tr>
              {categories.map(([name, months]) => (
                <tr key={name}>
                  <td>{name}</td>
                  {months.map((value, i) => (
                    <td key={i} className="num">{value ? fmt(value) : <span className="muted">—</span>}</td>
                  ))}
                  <td className="num">{fmt(months.reduce((s, v) => s + v, 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
