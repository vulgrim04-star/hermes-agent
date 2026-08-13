import { useState } from 'react';

import CategorySelect from './CategorySelect.jsx';
import { setBudget } from '../lib/budgets.js';
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
