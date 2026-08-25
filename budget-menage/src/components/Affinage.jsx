import { useState } from 'react';

import Avatar from './Avatar.jsx';
import { aAffiner, affinerTiers, concentration, resteAAffiner } from '../lib/affiner.js';
import { LEAVES } from '../lib/categories.js';
import { fmt } from '../lib/money.js';
import { edit, useBudget } from '../store/useBudget.js';

const PAGE = 40;

/**
 * Trois façons d'entrer dans la file, parce qu'on n'affine pas pour la même
 * raison selon le jour : remplir une déclaration, rendre un budget lisible, ou
 * finir le travail.
 */
const VUES = [
  { cle: 'declaration', label: 'Déclaration' },
  { cle: 'budget', label: 'Budget' },
  { cle: 'tout', label: 'Tout' },
];

const part = (a, b) => (b ? Math.round((100 * a) / b) : 0);

/**
 * La file d'affinage.
 *
 * Une écriture classée *Santé* n'est pas une écriture à classer : elle ne
 * remonte donc nulle part, et pourtant elle ne sert à rien — ni à une
 * déclaration, qui distingue une prime LAMal d'un dentiste, ni à un budget.
 *
 * **Ce que cet écran ne fait plus, c'est présenter la file comme un bloc.**
 * Mesuré sur un export réel : cinq tiers valent 43 % du montant, vingt en
 * valent 80 %, et deux tiers des tiers ne reviennent qu'une fois pour 19 % du
 * total. Une liste de cent quarante-sept éléments d'apparence égale fait
 * abandonner avant le vingtième — c'est-à-dire avant d'avoir eu l'essentiel.
 * Le travail est à rendement décroissant : l'écran doit donc dire où il devient
 * inutile de continuer, et pour quel usage.
 */
export default function Affinage() {
  const data = useBudget((s) => s.data);
  const [vue, setVue] = useState('declaration');
  const [tout, setTout] = useState(false);

  const groupes = aAffiner(data);
  if (!groupes.length) return null;

  const reste = resteAAffiner(data);
  const conc = concentration(groupes);

  const listes = {
    declaration: groupes.filter((g) => g.postes.length > 0),
    budget: groupes.slice(0, conc.seuil),
    tout: groupes,
  };
  // Une vue vide n'est pas offerte : un onglet qui ne mène à rien ne se clique
  // qu'une fois, et discrédite les deux autres.
  const offertes = VUES.filter((v) => listes[v.cle].length > 0);
  const active = listes[vue].length ? vue : offertes[0].cle;
  const liste = listes[active];
  const vus = tout ? liste : liste.slice(0, PAGE);

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
          <dt>Montant à préciser</dt>
          <dd>{fmt(reste.montantCents)}</dd>
        </div>
        <div className="stat">
          <dt>Dont la déclaration attend</dt>
          <dd>{fmt(reste.fiscal.montantCents)}</dd>
        </div>
      </dl>

      <div className="body" style={{ paddingBottom: 0 }}>
        <div className="segmented" role="group" aria-label="Ce qu’on affine">
          {offertes.map((v) => (
            <button
              key={v.cle}
              type="button"
              aria-pressed={active === v.cle}
              onClick={() => { setVue(v.cle); setTout(false); }}
            >
              {v.label}
            </button>
          ))}
        </div>
        <p className="note" style={{ marginTop: 10 }}>{expliquer(active, { groupes, reste, conc, listes })}</p>
      </div>

      <div className="body flush">
        <ul className="rows">
          {vus.map((g) => <Ligne key={`${g.key}-${g.racine}`} groupe={g} />)}
        </ul>
        {liste.length > vus.length && (
          <div style={{ padding: '12px 18px', borderTop: '1px solid var(--rule)' }}>
            <button type="button" className="btn wide" onClick={() => setTout(true)}>
              Afficher les {liste.length - vus.length} tiers restants
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Ce que la vue courante dit du travail : combien, pour quoi, et jusqu'où. */
function expliquer(vue, { groupes, reste, conc, listes }) {
  if (vue === 'declaration') {
    return `${listes.declaration.length} tiers sur ${groupes.length} alimentent un poste de votre `
      + `déclaration — ${fmt(reste.fiscal.montantCents)}, soit ${part(reste.fiscal.montantCents, reste.montantCents)} % `
      + 'du montant à affiner. Les autres n’y changeront rien.';
  }
  if (vue === 'budget') {
    return `Les ${conc.seuil} tiers les plus lourds valent ${Math.round(conc.part * 100)} % du montant `
      + `(${fmt(conc.seuilCents)}). Au-delà, chaque tiers pèse de moins en moins : c’est le moment de s’arrêter.`;
  }
  return `${conc.uniques} tiers ne reviennent qu’une seule fois, pour ${fmt(conc.uniquesCents)} à eux tous `
    + `— ${part(conc.uniquesCents, conc.totalCents)} % du total. Les affiner est le travail le moins rentable de la liste.`;
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
      {groupe.postes.length > 0 && (
        <span className="pill fisc" title={`Alimente : ${groupe.postes.join(', ')}`}>déclaration</span>
      )}
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
