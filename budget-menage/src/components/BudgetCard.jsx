import { Link } from 'react-router-dom';

import { budgetStatus } from '../lib/budgets.js';
import { fmt } from '../lib/money.js';

/** Aujourd'hui, au format du journal. */
const aujourdhui = () => new Date().toISOString().slice(0, 10);

/**
 * Les enveloppes du mois, et surtout leur **rythme**.
 *
 * Un budget consulté le 31 ne sert qu'à constater. Le trait vertical marque où
 * la consommation devrait en être à cette date : c'est lui qui permet de
 * corriger pendant qu'il en est encore temps, et non de découvrir après coup.
 */
export default function BudgetCard({ data, period }) {
  const etat = budgetStatus(data, period, aujourdhui());
  if (!etat) return null;

  if (!etat.lignes.length) {
    return (
      <div className="block">
        <header>
          <div className="grow">
            <h3>Budgets</h3>
            <p>
              Aucune enveloppe fixée. Poser un montant par poste fait apparaître ici la
              consommation du mois et son rythme. <Link to="/reglages">Les définir</Link>.
            </p>
          </div>
        </header>
      </div>
    );
  }

  const enCours = etat.progression > 0 && etat.progression < 1;

  return (
    <div className="block">
      <header>
        <div className="grow">
          <h3>Budgets</h3>
          <p>
            {fmt(etat.consomme)} consommés sur {fmt(etat.prevu)} prévus
            {enCours && <> · {Math.round(etat.progression * 100)} % du mois écoulé</>}
            {etat.depassees > 0 && <> · <strong>{etat.depassees} enveloppe(s) dépassée(s)</strong></>}
          </p>
        </div>
      </header>

      <div className="body">
        <ul className="budgets">
          {etat.lignes.map((l) => (
            <li key={l.cat}>
              <div className="budget-tete">
                <span>{l.cat}</span>
                <span className="num">
                  {fmt(l.consomme)} <span className="muted">/ {fmt(l.prevu)}</span>
                </span>
              </div>
              <div className={l.depasse ? 'budget-barre depasse' : 'budget-barre'}>
                <i style={{ width: `${Math.min(100, Math.round((l.part || 0) * 100))}%` }} />
                {/* Le repère de rythme n'a de sens qu'en cours de mois. */}
                {enCours && <b style={{ left: `${Math.round(etat.progression * 100)}%` }} />}
              </div>
              <p className="budget-note">
                {l.depasse ? (
                  <span className="alerte">Dépassé de {fmt(l.consomme - l.prevu)}</span>
                ) : l.alerte ? (
                  <span className="alerte">
                    En avance de {fmt(l.avance)} sur le rythme du mois
                  </span>
                ) : (
                  <>Reste {fmt(l.reste)}</>
                )}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
