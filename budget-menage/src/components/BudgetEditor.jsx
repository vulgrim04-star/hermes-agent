import { useState } from 'react';

import CategorySelect from './CategorySelect.jsx';
import { proposerBudgets, setBudget } from '../lib/budgets.js';
import { fmt, parseAmount } from '../lib/money.js';
import { monthLabel } from '../lib/dates.js';
import { edit, useBudget } from '../store/useBudget.js';

/**
 * Saisie des enveloppes.
 *
 * Un montant par défaut vaut pour tous les mois ; une surcharge ne vaut que
 * pour le mois choisi. C'est ce qui permet au mois des impôts de ne pas
 * déformer les onze autres.
 *
 * Le montant se saisit **positif**. Le sens vient de la catégorie — demander à
 * l'utilisateur de retenir un signe pour une enveloppe de dépense serait une
 * source d'erreur sans contrepartie.
 */
export default function BudgetEditor({ periods }) {
  const data = useBudget((s) => s.data);
  const [cat, setCat] = useState(null);
  const [montant, setMontant] = useState('');
  const [periode, setPeriode] = useState('');

  const lignes = Object.keys(data.budgets || {}).sort((a, b) => a.localeCompare(b, 'fr'));

  function poser() {
    const cents = parseAmount(montant);
    if (!cat || cents === null) return;
    edit((s) => setBudget(s, cat, periode || null, cents));
    setMontant('');
  }

  return (
    <div className="block">
      <header>
        <div className="grow">
          <h3>Budgets par catégorie</h3>
          <p>
            Un montant par défaut s’applique à tous les mois ; une surcharge ne vaut que pour le
            mois choisi. Le tableau de bord montre alors la consommation et son rythme.
          </p>
        </div>
      </header>

      <div className="body">
        <div className="row" style={{ marginBottom: 16 }}>
          <label className="field" style={{ flex: '1 1 200px' }}>
            Catégorie
            <CategorySelect value={cat} onChange={setCat} />
          </label>
          <label className="field">
            Montant mensuel
            <input
              className="num-in"
              inputMode="decimal"
              placeholder="600.00"
              value={montant}
              onChange={(e) => setMontant(e.target.value)}
            />
          </label>
          <label className="field">
            S’applique à
            <select value={periode} onChange={(e) => setPeriode(e.target.value)}>
              <option value="">tous les mois</option>
              {periods.map((p) => <option key={p} value={p}>{monthLabel(p)} seulement</option>)}
            </select>
          </label>
          <button
            type="button"
            className="btn primary"
            onClick={poser}
            disabled={!cat || parseAmount(montant) === null}
          >
            Poser
          </button>
        </div>

        <Propositions data={data} />

        {lignes.length ? (
          <ul className="rows">
            {lignes.map((c) => {
              const ligne = data.budgets[c];
              const surcharges = Object.keys(ligne).filter((k) => k !== 'defaut').sort();
              return (
                <li key={c}>
                  <div className="lead">
                    <b>{c}</b>
                    <span>
                      {ligne.defaut != null ? `${fmt(ligne.defaut)} par mois` : 'aucun montant par défaut'}
                      {surcharges.length > 0 && (
                        <> · {surcharges.map((p) => `${monthLabel(p)} : ${fmt(ligne[p])}`).join(' · ')}</>
                      )}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn danger"
                    onClick={() => edit((s) => {
                      // Le défaut et toutes ses surcharges : une surcharge
                      // orpheline survivrait sans qu'on sache d'où elle vient.
                      // Les clés sont figées avant la boucle — les supprimer
                      // pendant qu'on les parcourt en sauterait.
                      const cles = Object.keys(s.budgets?.[c] || {});
                      for (const k of cles) setBudget(s, c, k === 'defaut' ? null : k, null);
                    })}
                  >
                    Retirer
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted">Aucune enveloppe pour l’instant.</p>
        )}
      </div>
    </div>
  );
}

/**
 * Les enveloppes proposées par le journal.
 *
 * Poser vingt budgets à la main demande vingt chiffres qu'on n'a pas en tête —
 * c'est la raison pour laquelle un budget reste vide. Le journal les connaît :
 * il suffit de les lire, et de laisser le dernier mot à l'utilisateur.
 *
 * Chaque ligne dit **d'où sort le chiffre** : combien de mois observés, et
 * entre quels extrêmes. Un budget proposé sans son écart est un chiffre qu'on
 * accepte sans le comprendre, et qu'on ne saura pas corriger quand il dérivera.
 */
function Propositions({ data }) {
  const [mois, setMois] = useState(6);
  const [ouvert, setOuvert] = useState(false);
  const propositions = proposerBudgets(data, { mois });
  if (!propositions.length) return null;

  const manquantes = propositions.filter((p) => p.actuelCents === null);

  return (
    <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--rule)' }}>
      <div className="row" style={{ alignItems: 'center' }}>
        <button type="button" className="btn" onClick={() => setOuvert((o) => !o)}>
          {ouvert ? 'Masquer' : 'Proposer'} des enveloppes d’après l’historique
        </button>
        {ouvert && (
          <label className="field">
            Sur
            <select value={mois} onChange={(e) => setMois(Number(e.target.value))}>
              <option value={3}>3 mois</option>
              <option value={6}>6 mois</option>
              <option value={12}>12 mois</option>
            </select>
          </label>
        )}
      </div>

      {ouvert && (
        <>
          <p className="hint">
            Une catégorie régulière est proposée à sa <strong>médiane</strong> — un mois de vacances
            ne doit pas gonfler l’enveloppe des onze autres. Une catégorie irrégulière est
            <strong> lissée</strong> sur la période : le dentiste ne se budgète pas au mois où il
            tombe. Le mois en cours est écarté.
          </p>

          {manquantes.length > 0 && (
            <button
              type="button"
              className="btn primary wide"
              style={{ marginTop: 12 }}
              onClick={() => edit((s) => {
                for (const p of manquantes) setBudget(s, p.cat, null, p.proposeCents);
              })}
            >
              Poser les {manquantes.length} enveloppes manquantes ({fmt(
                manquantes.reduce((somme, p) => somme + p.proposeCents, 0))} par mois)
            </button>
          )}

          <ul className="rows" style={{ marginTop: 8 }}>
            {propositions.map((p) => (
              <li key={p.cat}>
                <div className="lead">
                  <b>{p.cat}</b>
                  <span>
                    {p.regulier
                      ? `médiane sur ${p.moisObserves} mois · de ${fmt(p.minCents)} à ${fmt(p.maxCents)}`
                      : `${p.moisObserves} mois sur ${p.moisPeriode} · ${fmt(p.totalCents)} lissés`}
                    {p.actuelCents !== null && ` · posé à ${fmt(p.actuelCents)}`}
                  </span>
                </div>
                <span className="amount">{fmt(p.proposeCents)}</span>
                <button
                  type="button"
                  className="btn quiet"
                  disabled={p.actuelCents === p.proposeCents}
                  onClick={() => edit((s) => setBudget(s, p.cat, null, p.proposeCents))}
                >
                  {p.actuelCents === null ? 'Poser' : 'Ajuster'}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
