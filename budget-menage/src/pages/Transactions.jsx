import { useState } from 'react';
import { Link } from 'react-router-dom';

import CategorySelect from '../components/CategorySelect.jsx';
import { frDate } from '../lib/dates.js';
import { fmt } from '../lib/money.js';
import { normLabel } from '../lib/ledger.js';
import { edit, useBudget } from '../store/useBudget.js';

const PAGE = 150;

export default function Transactions() {
  const data = useBudget((s) => s.data);
  const [query, setQuery] = useState('');
  const [all, setAll] = useState(false);

  if (!data.tx.length) {
    return (
      <div className="block">
        <div className="empty">
          Aucune écriture. <Link to="/import">Importez un relevé</Link> pour commencer.
        </div>
      </div>
    );
  }

  const needle = normLabel(query);
  const rows = data.tx.filter(
    (t) => !needle || t.norm.includes(needle) || (t.cat && normLabel(t.cat).includes(needle)),
  );
  const shown = all ? rows : rows.slice(0, PAGE);
  const balance = rows.reduce((sum, t) => sum + t.cents, 0);

  function setCategory(id, category) {
    edit((state) => {
      const tx = state.tx.find((t) => t.id === id);
      if (tx) tx.cat = category;
    });
  }

  return (
    <div className="block">
      <header>
        <div className="grow">
          <h3>Écritures</h3>
          <p>{rows.length} ligne(s), solde {fmt(balance)}</p>
        </div>
        <input
          type="search"
          placeholder="Rechercher un libellé…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setAll(false); }}
          style={{ minWidth: 220 }}
        />
      </header>
      <div className="body flush">
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Date</th><th>Libellé</th><th>Compte</th>
                <th className="num">Montant</th><th>Catégorie</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((tx) => (
                <tr key={tx.id}>
                  <td className="muted" style={{ width: 84 }}>{frDate(tx.date)}</td>
                  <td>
                    {tx.label}
                    {tx.transfer === 1 && <span className="pill" style={{ marginLeft: 6 }}>transfert interne</span>}
                    {tx.ext && (
                      <span className="muted" style={{ display: 'block', fontSize: 12 }}>banque : {tx.ext}</span>
                    )}
                  </td>
                  <td className="muted mono">{(data.accounts[tx.acc] || {}).label || tx.acc}</td>
                  <td className={tx.cents < 0 ? 'num neg' : 'num pos'}>{fmt(tx.cents)}</td>
                  <td>
                    <CategorySelect value={tx.cat} onChange={(c) => setCategory(tx.id, c)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length > shown.length && (
          <div style={{ padding: '12px 18px', borderTop: '1px solid var(--rule)' }}>
            <button type="button" className="btn" onClick={() => setAll(true)}>
              Afficher les {rows.length - shown.length} restantes
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
