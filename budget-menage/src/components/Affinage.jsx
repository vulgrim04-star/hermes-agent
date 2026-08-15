import { useState } from 'react';

import Avatar from './Avatar.jsx';
import { aAffiner, affinerTiers, resteAAffiner } from '../lib/affiner.js';
import { LEAVES } from '../lib/categories.js';
import { fmt } from '../lib/money.js';
import { edit, useBudget } from '../store/useBudget.js';

const PAGE = 40;

/**
 * La file d'affinage.
 *
 * Une écriture classée *Santé* n'est pas une écriture à classer : elle ne
 * remonte donc nulle part, et pourtant elle ne sert à rien — ni à une
 * déclaration, qui distingue une prime LAMal d'un dentiste, ni à un budget.
 * Sur un export réel, ces écritures-là sont plus nombreuses que celles qui
 * n'ont aucune catégorie.
 *
 * Le geste est réduit au minimum : un tiers, une liste courte — les
 * sous-catégories de sa racine viennent en premier —, et c'est tout son
 * historique qui suit, plus une règle pour les imports à venir.
 */
export default function Affinage() {
  const data = useBudget((s) => s.data);
  const [tout, setTout] = useState(false);
  const groupes = aAffiner(data);
  if (!groupes.length) return null;

  const reste = resteAAffiner(data);
  const vus = tout ? groupes : groupes.slice(0, PAGE);

  return (
    <div className="block">
      <header>
        <div className="grow">
          <h3>À affiner</h3>
          <p>
            {reste.ecritures} écriture(s) chez {reste.tiers} tiers portent une catégorie de la
            banque — <strong>trop large pour servir</strong>. Choisir une sous-catégorie la pose sur
            tout l’historique du tiers, et la retient pour les prochains imports.
          </p>
        </div>
      </header>

      <dl className="stats">
        <div className="stat">
          <dt>Écritures</dt>
          <dd>{reste.ecritures}</dd>
        </div>
        <div className="stat">
          <dt>Montant concerné</dt>
          <dd>{fmt(reste.montantCents)}</dd>
        </div>
      </dl>

      <div className="body flush">
        <ul className="rows">
          {vus.map((g) => <Ligne key={`${g.key}-${g.racine}`} groupe={g} />)}
        </ul>
        {groupes.length > vus.length && (
          <div style={{ padding: '12px 18px', borderTop: '1px solid var(--rule)' }}>
            <button type="button" className="btn wide" onClick={() => setTout(true)}>
              Afficher les {groupes.length - vus.length} tiers restants
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Ligne({ groupe }) {
  const [erreur, setErreur] = useState('');

  function choisir(cat) {
    if (!cat) return;
    const r = edit((s) => affinerTiers(s, groupe.key, groupe.racine, cat));
    setErreur(r.kind === 'affine' ? '' : 'Choisissez une sous-catégorie.');
  }

  // Les sous-catégories de la racine d'abord : dans neuf cas sur dix, la bonne
  // réponse est là, et la faire chercher dans soixante-dix entrées serait le
  // meilleur moyen de ne jamais affiner.
  const autres = LEAVES.filter((c) => c.parent !== groupe.racine);

  return (
    <li style={{ flexWrap: 'wrap' }}>
      <Avatar nom={groupe.label} />
      <div className="lead">
        <b>{groupe.label}</b>
        <span>
          {groupe.racine} · {groupe.occurrences}× · dernière {groupe.derniereFr}
        </span>
      </div>
      <span className={groupe.totalCents < 0 ? 'amount' : 'amount pos'}>{fmt(groupe.totalCents)}</span>
      <div className="row" style={{ flex: '1 1 100%' }}>
        <select
          defaultValue=""
          aria-label={`Affiner ${groupe.label}`}
          onChange={(e) => choisir(e.target.value)}
          style={{ flex: '1 1 200px', minWidth: 0 }}
        >
          <option value="">— préciser —</option>
          <optgroup label={`Sous-catégories de ${groupe.racine}`}>
            {groupe.feuilles.map((f) => <option key={f} value={f}>{f}</option>)}
          </optgroup>
          <optgroup label="Ailleurs dans le plan de comptes">
            {autres.map((c) => (
              <option key={c.name} value={c.name}>{c.parent} › {c.name}</option>
            ))}
          </optgroup>
        </select>
      </div>
      {erreur && <p className="note err" style={{ flex: '1 1 100%', marginTop: 8 }}>{erreur}</p>}
    </li>
  );
}
