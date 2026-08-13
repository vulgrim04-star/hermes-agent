import { useState } from 'react';
import { Link } from 'react-router-dom';

import Avatar from '../components/Avatar.jsx';
import CategorySelect from '../components/CategorySelect.jsx';
import SplitEditor from '../components/SplitEditor.jsx';
import { frDate, monthLabel } from '../lib/dates.js';
import { fmt } from '../lib/money.js';
import { hasSplits, monthsAvailable, normLabel, setNote } from '../lib/ledger.js';
import { edit, useBudget } from '../store/useBudget.js';

const PAGE = 150;
const VIDE = { compte: '', mois: '', sens: '', etat: '' };

/**
 * Le journal, en lignes plutôt qu'en tableau.
 *
 * Un tableau de cinq colonnes ne tient pas dans 393 points : il fallait faire
 * défiler horizontalement pour atteindre la catégorie, c'est-à-dire la seule
 * colonne sur laquelle on agit. La ligne tactile met le libellé et le montant
 * face à face, et ouvre la catégorisation, l'annotation et le découpage d'un
 * geste.
 */
export default function Transactions() {
  const data = useBudget((s) => s.data);
  const [query, setQuery] = useState('');
  const [filtres, setFiltres] = useState(VIDE);
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
  const mois = monthsAvailable(data);

  /*
   * Le texte cherche dans le libellé, la catégorie et la note ; les listes
   * déroulantes restreignent. Les deux se cumulent, et le compte affiché en
   * tête suit — sans quoi on ne saurait pas si un filtre a mordu.
   */
  const rows = data.tx.filter((t) => {
    if (needle
      && !t.norm.includes(needle)
      && !(t.cat && normLabel(t.cat).includes(needle))
      // Une note se cherche : c'est souvent pour ça qu'on l'a écrite.
      && !(t.note && normLabel(t.note).includes(needle))) return false;
    if (filtres.compte && t.acc !== filtres.compte) return false;
    if (filtres.mois && !t.date.startsWith(filtres.mois)) return false;
    if (filtres.sens === 'debit' && t.cents >= 0) return false;
    if (filtres.sens === 'credit' && t.cents <= 0) return false;
    if (filtres.etat === 'sans-cat' && (t.cat || hasSplits(t) || t.transfer)) return false;
    if (filtres.etat === 'reparties' && !hasSplits(t)) return false;
    if (filtres.etat === 'annotees' && !t.note) return false;
    if (filtres.etat === 'transferts' && t.transfer !== 1) return false;
    return true;
  });
  const shown = all ? rows : rows.slice(0, PAGE);
  const balance = rows.reduce((sum, t) => sum + t.cents, 0);
  const actifs = Object.values(filtres).filter(Boolean).length;

  function poser(champ, valeur) {
    setFiltres({ ...filtres, [champ]: valeur });
    setAll(false);
  }

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
          <p>
            {rows.length} ligne(s) sur {data.tx.length}, solde {fmt(balance)}
          </p>
        </div>
        <input
          type="search"
          placeholder="Libellé, catégorie, note…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setAll(false); }}
          style={{ minWidth: 220, flex: '1 1 200px' }}
        />
      </header>

      {/* Les filtres se cumulent avec la recherche. Sur 783 écritures, chercher
          « ce qui n'est pas classé en mars sur la carte » à la main n'est pas
          une recherche : c'est un dépouillement. */}
      <div className="body" style={{ paddingBottom: 12 }}>
        <div className="row filtres">
          <select value={filtres.compte} onChange={(e) => poser('compte', e.target.value)} aria-label="Compte">
            <option value="">Tous les comptes</option>
            {Object.values(data.accounts).map((a) => (
              <option key={a.key} value={a.key}>{a.label || a.key}</option>
            ))}
          </select>
          <select value={filtres.mois} onChange={(e) => poser('mois', e.target.value)} aria-label="Mois">
            <option value="">Tous les mois</option>
            {mois.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
          <select value={filtres.sens} onChange={(e) => poser('sens', e.target.value)} aria-label="Sens">
            <option value="">Débits et crédits</option>
            <option value="debit">Débits seuls</option>
            <option value="credit">Crédits seuls</option>
          </select>
          <select value={filtres.etat} onChange={(e) => poser('etat', e.target.value)} aria-label="État">
            <option value="">Tous les états</option>
            <option value="sans-cat">Sans catégorie</option>
            <option value="reparties">Réparties</option>
            <option value="annotees">Annotées</option>
            <option value="transferts">Transferts internes</option>
          </select>
          {(actifs > 0 || query) && (
            <button type="button" className="btn quiet"
              onClick={() => { setFiltres(VIDE); setQuery(''); setAll(false); }}>
              Tout afficher
            </button>
          )}
        </div>
      </div>

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
                  {/* Une écriture répartie est classée — par ses parts. La
                      dire « sans catégorie » enverrait chercher un travail
                      qui est justement fait. */}
                  {hasSplits(tx)
                    ? <> · réparti en {tx.splits.length} : {tx.splits.map((p) => p.cat).join(', ')}</>
                    : tx.cat
                      ? <> · {tx.cat}</>
                      : <> · <span style={{ color: 'var(--warn)' }}>sans catégorie</span></>}
                  {tx.transfer === 1 && <> · transfert interne</>}
                  {tx.note && <> · <span style={{ color: 'var(--accent)' }}>{tx.note}</span></>}
                </span>
              </button>
              <span className={tx.cents < 0 ? 'amount' : 'amount pos'}>{fmt(tx.cents)}</span>

              {ouvert === tx.id && (
                <div style={{ flex: '1 1 100%', paddingTop: 12 }}>
                  {/* Une écriture répartie n'a plus de catégorie propre : la
                      proposer ici ferait deux vérités concurrentes. */}
                  {!hasSplits(tx) && (
                    <div className="row">
                      <label className="field" style={{ flex: '1 1 220px', minWidth: 0 }}>
                        Catégorie
                        <CategorySelect value={tx.cat} onChange={(c) => setCategory(tx.id, c)} />
                      </label>
                    </div>
                  )}
                  <Note tx={tx} />
                  {tx.transfer !== 1 && <SplitEditor key={(tx.splits || []).length} tx={tx} />}
                  <p className="hint">
                    Compte {(data.accounts[tx.acc] || {}).label || tx.acc}
                    {tx.ext && <> · catégorie de la banque : {tx.ext}</>}
                  </p>
                </div>
              )}
            </li>
          ))}
        </ul>

        {!rows.length && (
          <p className="empty">Aucune écriture ne répond à ces critères.</p>
        )}
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

/**
 * L'annotation d'une écriture.
 *
 * Une catégorie range, une note explique : « remboursé par Marie », « acompte,
 * solde en mars ». Elle s'enregistre à la sortie du champ plutôt qu'à chaque
 * frappe — un journal de plusieurs centaines d'écritures se réécrirait
 * entièrement à chaque lettre tapée.
 */
function Note({ tx }) {
  const [texte, setTexte] = useState(tx.note || '');

  return (
    <label className="field" style={{ marginTop: 12 }}>
      Note
      <input
        value={texte}
        placeholder="remboursé par Marie, acompte, facture 2024…"
        onChange={(e) => setTexte(e.target.value)}
        onBlur={() => { if ((tx.note || '') !== texte.trim()) edit((s) => setNote(s, tx.id, texte)); }}
      />
    </label>
  );
}
