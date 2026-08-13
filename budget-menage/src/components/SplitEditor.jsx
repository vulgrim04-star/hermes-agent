import { useState } from 'react';

import CategorySelect from './CategorySelect.jsx';
import { fmt, parseAmount } from '../lib/money.js';
import { setSplits } from '../lib/ledger.js';
import { edit } from '../store/useBudget.js';

/**
 * Répartition d'une écriture entre plusieurs catégories.
 *
 * Un passage à la Migros à 148.50 dont 30.00 sont un article de ménage n'est
 * pas une dépense d'alimentation de 148.50. C'était la dernière chose que
 * l'application locale savait faire et pas celle-ci.
 *
 * Le **reste à répartir** est affiché en permanence, et l'enregistrement reste
 * fermé tant qu'il n'est pas nul : c'est le seul garde-fou qui empêche de
 * l'argent d'apparaître ou de disparaître des totaux. Le bouton « tout le
 * reste » évite d'avoir à faire la soustraction de tête, qui est précisément
 * l'endroit où l'on se trompe.
 */
export default function SplitEditor({ tx }) {
  const existantes = tx.splits || [];
  const [parts, setParts] = useState(() =>
    existantes.length
      ? existantes.map((p) => ({ cat: p.cat, montant: (Math.abs(p.cents) / 100).toFixed(2) }))
      : [{ cat: tx.cat, montant: '' }, { cat: null, montant: '' }]);
  const [erreur, setErreur] = useState('');

  const signe = tx.cents < 0 ? -1 : 1;
  const cents = parts.map((p) => {
    const v = parseAmount(p.montant);
    return v === null ? 0 : Math.abs(v) * signe;
  });
  const somme = cents.reduce((s, c) => s + c, 0);
  const reste = tx.cents - somme;

  function majPart(i, champ, valeur) {
    setParts(parts.map((p, j) => (j === i ? { ...p, [champ]: valeur } : p)));
  }

  function enregistrer() {
    const resultat = edit((s) =>
      setSplits(s, tx.id, parts.map((p, i) => ({ cat: p.cat, cents: cents[i] }))));
    const messages = {
      somme: 'La somme des parts doit valoir l’écriture, au centime.',
      'part-nulle': 'Une part à zéro n’ajoute qu’une ligne vide.',
      sens: 'Toutes les parts vont dans le même sens que l’écriture.',
      introuvable: 'Écriture introuvable.',
    };
    setErreur(messages[resultat.kind] || '');
  }

  return (
    <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--rule)' }}>
      <h4>Répartir cette écriture</h4>
      <p className="hint" style={{ marginTop: 2 }}>
        Une ligne de journal par part, avec sa propre catégorie. Les totaux, les postes et les
        budgets suivent.
      </p>

      <ul className="rows" style={{ marginTop: 8 }}>
        {parts.map((part, i) => (
          <li key={i} style={{ padding: '10px 0', minHeight: 0, gap: 8, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 160px', minWidth: 0 }}>
              <CategorySelect value={part.cat} onChange={(c) => majPart(i, 'cat', c)} />
            </div>
            <input
              className="num-in"
              style={{ width: 110 }}
              inputMode="decimal"
              placeholder="0.00"
              value={part.montant}
              onChange={(e) => majPart(i, 'montant', e.target.value)}
            />
            <button type="button" className="btn quiet"
              title="Prendre tout le reste" aria-label="Prendre tout le reste"
              onClick={() => majPart(i, 'montant', (Math.abs(cents[i] + reste) / 100).toFixed(2))}>
              reste
            </button>
            <button type="button" className="btn danger" aria-label="Retirer cette part"
              disabled={parts.length <= 2}
              onClick={() => setParts(parts.filter((_, j) => j !== i))}>
              ✕
            </button>
          </li>
        ))}
      </ul>

      <div className="row" style={{ marginTop: 10, alignItems: 'center' }}>
        <button type="button" className="btn quiet" onClick={() => setParts([...parts, { cat: null, montant: '' }])}>
          Ajouter une part
        </button>
        <span className={reste === 0 ? 'pill ok' : 'pill warn'}>
          {reste === 0 ? 'la somme boucle' : `reste à répartir ${fmt(reste)}`}
        </span>
        <button type="button" className="btn primary" onClick={enregistrer}
          disabled={reste !== 0 || parts.some((p, i) => !p.cat || cents[i] === 0)}>
          Enregistrer la répartition
        </button>
        {existantes.length > 0 && (
          <button type="button" className="btn danger"
            onClick={() => { edit((s) => setSplits(s, tx.id, [])); setErreur(''); }}>
            Supprimer la répartition
          </button>
        )}
      </div>

      {erreur && <p className="note err" style={{ marginTop: 10 }}>{erreur}</p>}
    </div>
  );
}
