import { useState } from 'react';
import { Link } from 'react-router-dom';

import Avatar from '../components/Avatar.jsx';
import CategorySelect from '../components/CategorySelect.jsx';
import { frDate } from '../lib/dates.js';
import { fmt } from '../lib/money.js';
import { normLabel } from '../lib/ledger.js';
import { edit, useBudget } from '../store/useBudget.js';

const PAGE = 150;

/**
 * Le journal, en lignes plutôt qu'en tableau.
 *
 * Un tableau de cinq colonnes ne tient pas dans 393 points : il fallait faire
 * défiler horizontalement pour atteindre la catégorie, c'est-à-dire la seule
 * colonne sur laquelle on agit. La ligne tactile met le libellé et le montant
 * face à face, et ouvre la catégorisation d'un geste.
 */
export default function Transactions() {
  const data = useBudget((s) => s.data);
  const [query, setQuery] = useState('');
  const [all, setAll] = useState(false);
  const [ouvert, setOuvert] = useState(null);

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
        {/* Pas de titre ici : le grand titre de l'écran dit déjà « Écritures ».
            Le compte et le solde, eux, changent avec la recherche. */}
        <div className="grow">
          <p>{rows.length} ligne(s), solde {fmt(balance)}</p>
        </div>
        <input
          type="search"
          placeholder="Rechercher un libellé…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setAll(false); }}
          style={{ minWidth: 220, flex: '1 1 200px' }}
        />
      </header>

      <div className="body flush">
        <ul className="rows">
          {shown.map((tx) => (
            <li key={tx.id} style={ouvert === tx.id ? { flexWrap: 'wrap' } : undefined}>
              <Avatar nom={tx.cp || tx.label} />
              <button
                type="button"
                className="lead"
                aria-expanded={ouvert === tx.id}
                onClick={() => setOuvert((o) => (o === tx.id ? null : tx.id))}
              >
                <b>{tx.label}</b>
                <span>
                  {frDate(tx.date)}
                  {tx.cat ? <> · {tx.cat}</> : <> · <span style={{ color: 'var(--warn)' }}>sans catégorie</span></>}
                  {tx.transfer === 1 && <> · transfert interne</>}
                </span>
              </button>
              <span className={tx.cents < 0 ? 'amount' : 'amount pos'}>{fmt(tx.cents)}</span>

              {ouvert === tx.id && (
                <div style={{ flex: '1 1 100%', paddingTop: 12 }}>
                  <div className="row">
                    <label className="field" style={{ flex: '1 1 220px' }}>
                      Catégorie
                      <CategorySelect value={tx.cat} onChange={(c) => setCategory(tx.id, c)} />
                    </label>
                  </div>
                  <p className="hint">
                    Compte {(data.accounts[tx.acc] || {}).label || tx.acc}
                    {tx.ext && <> · catégorie de la banque : {tx.ext}</>}
                  </p>
                </div>
              )}
            </li>
          ))}
        </ul>

        {rows.length > shown.length && (
          <div style={{ padding: '12px 18px', borderTop: '1px solid var(--rule)' }}>
            <button type="button" className="btn wide" onClick={() => setAll(true)}>
              Afficher les {rows.length - shown.length} restantes
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
