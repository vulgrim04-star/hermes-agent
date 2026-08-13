import { useState } from 'react';

import Allocation from '../components/Allocation.jsx';
import Evolution from '../components/Evolution.jsx';
import Immobilier from '../components/Immobilier.jsx';
import Projection from '../components/Projection.jsx';
import { shiftMonth } from '../lib/dates.js';
import { fmt, parseAmount } from '../lib/money.js';
import { QUANTITY_SCALE, ASSET_KINDS, ORIGIN_LABELS, addAsset, pillar3aStatus,
  positionsAt, removeAsset, setValuation } from '../lib/networth.js';
import { edit, useBudget } from '../store/useBudget.js';

/**
 * Patrimoine : ce que le ménage possède, moins ce qu'il doit.
 *
 * Les comptes suivis se déduisent des relevés ; les autres positions se
 * relèvent à la main. L'origine de chaque chiffre est affichée, parce qu'une
 * valeur reportée du mois dernier ne vaut pas une valeur relevée ce mois-ci.
 */
export default function NetWorth() {
  const data = useBudget((s) => s.data);
  const [period, setPeriod] = useState(() => new Date().toISOString().slice(0, 7));

  const positions = positionsAt(data, period);

  const assets = positions.filter((p) => !p.isLiability).reduce((s, p) => s + (p.valueCents || 0), 0);
  const liabilities = positions
    .filter((p) => p.isLiability)
    .reduce((s, p) => s + Math.abs(p.valueCents || 0), 0);
  const carried = positions.filter((p) => p.origin === 'report').length;
  const unknown = positions.filter((p) => p.valueCents === null).length;

  return (
    <>
      <div className="block">
        <header>
          <div className="grow">
            <h3>Patrimoine net</h3>
            <p>Actifs moins dettes, à la fin du mois choisi.</p>
          </div>
          <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
        </header>
        <dl className="stats">
          <div className="stat"><dt>Actifs</dt><dd>{fmt(assets)}</dd></div>
          <div className="stat"><dt>Dettes</dt><dd>{fmt(liabilities)}</dd></div>
          <div className="stat">
            <dt>Patrimoine net</dt>
            <dd className={assets - liabilities < 0 ? 'neg' : 'pos'}>{fmt(assets - liabilities)}</dd>
          </div>
          <div className="stat"><dt>Positions</dt><dd>{positions.length}</dd></div>
        </dl>
        {(carried > 0 || unknown > 0) && (
          <div className="body">
            <p className="row">
              {carried > 0 && <span className="pill warn">{carried} position(s) reportée(s)</span>}
              {unknown > 0 && <span className="pill warn">{unknown} position(s) non renseignée(s)</span>}
            </p>
          </div>
        )}
      </div>

      <Evolution data={data} from={shiftMonth(period, -23)} to={period} />
      <Allocation data={data} period={period} />
      <PositionsCard positions={positions} period={period} accounts={data.accounts} />
      <NewPosition accounts={data.accounts} />
      <Projection data={data} departCents={assets - liabilities} />
      <Immobilier data={data} />
      <Pillar3a data={data} year={Number(period.slice(0, 4))} />
      <YearEnd data={data} year={Number(period.slice(0, 4)) - 1} />
    </>
  );
}

function PositionsCard({ positions, period, accounts }) {
  return (
    <div className="block">
      <header>
        <div className="grow">
          <h3>Positions au {period}</h3>
          <p>
            Une valeur saisie l’emporte sur le solde déduit des relevés ; un mois non saisi reprend
            la dernière valeur connue, signalée comme telle.
          </p>
        </div>
      </header>
      {positions.length ? (
        <div className="body flush">
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Position</th><th className="num">Quantité</th><th className="num">Cours</th>
                  <th className="num">Valeur</th><th>Origine</th><th />
                </tr>
              </thead>
              <tbody>
                {positions.map((position) => (
                  <PositionRow key={position.assetId} position={position} period={period} accounts={accounts} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="empty">Aucune position. Ajoutez-en une ci-dessous.</div>
      )}
    </div>
  );
}

function PositionRow({ position, period, accounts }) {
  const [quantity, setQuantity] = useState(
    position.quantityE8 === null ? '' : String(position.quantityE8 / QUANTITY_SCALE));
  const [price, setPrice] = useState(
    position.unitPriceCents === null ? '' : (position.unitPriceCents / 100).toFixed(2));
  const [value, setValue] = useState(
    position.origin === 'saisi' && position.valueCents !== null ? (position.valueCents / 100).toFixed(2) : '');
  const [error, setError] = useState('');

  function save() {
    const cents = value.trim() === '' ? null : parseAmount(value);
    const priceCents = price.trim() === '' ? null : parseAmount(price);
    const quantityE8 = quantity.trim() === ''
      ? null
      : Math.round(Number(quantity.replace(',', '.')) * QUANTITY_SCALE);

    if ((value.trim() && cents === null) || (price.trim() && priceCents === null)) {
      setError('Montant illisible.');
      return;
    }
    if (quantityE8 !== null && !Number.isFinite(quantityE8)) { setError('Quantité illisible.'); return; }

    const outcome = edit((state) =>
      setValuation(state, { assetId: position.assetId, period, valueCents: cents,
        quantityE8, unitPriceCents: priceCents }));
    setError(outcome.kind === 'valeur-manquante' ? 'Indiquez une valeur, ou une quantité et un cours.' : '');
  }

  return (
    <tr>
      <td>
        {position.label}
        {position.isLiability && <span className="pill" style={{ marginLeft: 6 }}>dette</span>}
        {position.account && (
          <span className="muted mono" style={{ display: 'block', fontSize: 12 }}>
            {(accounts[position.account] || {}).label || position.account}
          </span>
        )}
      </td>
      <td className="num">
        <input className="num-in" style={{ width: 110 }} placeholder="—"
          value={quantity} onChange={(e) => setQuantity(e.target.value)} />
      </td>
      <td className="num">
        <input className="num-in" style={{ width: 110 }} placeholder="—"
          value={price} onChange={(e) => setPrice(e.target.value)} />
      </td>
      <td className="num">
        <input className="num-in" placeholder={position.valueCents === null ? '—' : (position.valueCents / 100).toFixed(2)}
          value={value} onChange={(e) => setValue(e.target.value)} />
      </td>
      <td className="muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
        {ORIGIN_LABELS[position.origin]}
        {position.reportedFrom && ` de ${position.reportedFrom}`}
      </td>
      <td className="num" style={{ whiteSpace: 'nowrap' }}>
        <button type="button" className="btn" onClick={save}>Enregistrer</button>{' '}
        <button type="button" className="btn quiet"
          onClick={() => { if (window.confirm(`Retirer « ${position.label} » ?`)) edit((s) => removeAsset(s, position.assetId)); }}>
          Retirer
        </button>
        {error && <span style={{ display: 'block', fontSize: 12, color: 'var(--err)' }}>{error}</span>}
      </td>
    </tr>
  );
}

function NewPosition({ accounts }) {
  const [form, setForm] = useState({ label: '', kind: 'titres', account: '' });

  return (
    <div className="block">
      <header><div className="grow"><h3>Ajouter une position</h3></div></header>
      <div className="body">
        <div className="row">
          <label className="field">
            Libellé
            <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          </label>
          <label className="field">
            Nature
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              {ASSET_KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="field">
            Compte suivi (facultatif)
            <select value={form.account} onChange={(e) => setForm({ ...form, account: e.target.value })}>
              <option value="">Aucun — valeur saisie</option>
              {Object.values(accounts).map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
            </select>
          </label>
          <button type="button" className="btn primary" disabled={!form.label.trim()}
            onClick={() => {
              edit((state) => addAsset(state, {
                label: form.label.trim(), kind: form.kind, account: form.account || null,
              }));
              setForm({ label: '', kind: 'titres', account: '' });
            }}>
            Ajouter
          </button>
        </div>
        <p className="hint">
          Adossée à un compte suivi, une position reprend le solde déduit des relevés importés : il
          n’y a rien à saisir tous les mois.
        </p>
      </div>
    </div>
  );
}

function Pillar3a({ data, year }) {
  const [ceiling, setCeiling] = useState('');
  const status = pillar3aStatus(data, year);

  return (
    <div className="block">
      <header>
        <div className="grow">
          <h3>Pilier 3a {year}</h3>
          <p>{status.daysLeft > 0 ? `${status.daysLeft} jour(s) avant le 31 décembre.` : 'L’année est close.'}</p>
        </div>
      </header>
      <div className="body">
        {status.message && (
          <div className="note warn" style={{ marginBottom: 14 }}>
            {status.message} Le plafond est publié en fin d’année précédente : il se saisit, il ne
            se devine pas.
            <div className="row" style={{ marginTop: 10 }}>
              <input placeholder="7'258.00" value={ceiling} onChange={(e) => setCeiling(e.target.value)} />
              <button type="button" className="btn" disabled={!ceiling.trim()}
                onClick={() => {
                  const cents = parseAmount(ceiling);
                  if (cents === null) return;
                  edit((state) => { state.tax = { ...state.tax, [year]: cents }; });
                  setCeiling('');
                }}>
                Enregistrer le plafond {year}
              </button>
            </div>
          </div>
        )}
        <dl className="stats" style={{ border: '1px solid var(--rule)' }}>
          <div className="stat"><dt>Versé</dt><dd>{fmt(status.paidCents)}</dd></div>
          <div className="stat">
            <dt>Plafond</dt>
            <dd>{status.ceilingCents === null ? '—' : fmt(status.ceilingCents)}</dd>
          </div>
          <div className="stat">
            <dt>Reste à verser</dt>
            <dd>{status.remainingCents === null ? '—' : fmt(status.remainingCents)}</dd>
          </div>
        </dl>
        <p className="hint">
          Les versements sont les écritures classées « Prévoyance › Pilier 3a ».
        </p>
      </div>
    </div>
  );
}

/** État au 31 décembre : la date que retient la déclaration de fortune. */
function YearEnd({ data, year }) {
  const period = `${year}-12`;
  const positions = positionsAt(data, period).filter((p) => p.valueCents !== null);
  if (!positions.length) return null;

  const net = positions.reduce(
    (sum, p) => sum + (p.isLiability ? -Math.abs(p.valueCents) : p.valueCents), 0);

  return (
    <div className="block">
      <header>
        <div className="grow">
          <h3>État au 31 décembre {year}</h3>
          <p>La date que retient la déclaration de fortune du canton de Fribourg.</p>
        </div>
      </header>
      <div className="body flush">
        <table>
          <tbody>
            {positions.map((position) => (
              <tr key={position.assetId}>
                <td>{position.label}</td>
                <td className="muted" style={{ fontSize: 12 }}>{ORIGIN_LABELS[position.origin]}</td>
                <td className="num">
                  {position.isLiability ? '−' : ''}{fmt(Math.abs(position.valueCents))}
                </td>
              </tr>
            ))}
            <tr style={{ borderTop: '2px solid var(--rule-strong)', fontWeight: 600 }}>
              <td colSpan={2}>Fortune nette</td>
              <td className={net < 0 ? 'num neg' : 'num pos'}>{fmt(net)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
