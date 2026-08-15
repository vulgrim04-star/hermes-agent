import { Link } from 'react-router-dom';

import { etatCloture } from '../lib/cloture.js';
import { fmt } from '../lib/money.js';

/** Aujourd'hui, au format du journal. */
const aujourdhui = () => new Date().toISOString().slice(0, 10);

/**
 * Ce qui reste à faire, sur l'écran qu'on ouvre tous les jours.
 *
 * La carte **disparaît quand il n'y a rien** : c'est ce qui la rend crédible.
 * Une liste toujours présente devient un décor, et un décor ne se lit pas.
 *
 * Chaque ligne mène à l'écran qui la traite. Aucune ne prétend faire le
 * travail à votre place : elles disent ce qui est en attente, combien, et
 * pourquoi ça compte.
 */
export default function Cloture({ data, period }) {
  const etat = etatCloture(data, period, aujourdhui());
  if (!etat.reste) return null;

  return (
    <div className="block">
      <header>
        <div className="grow">
          <h3>À faire</h3>
          <p>
            {etat.reste} point(s) en attente sur ce mois.
            {etat.alertes > 0 && <> Dont <strong>{etat.alertes}</strong> qui ne peuvent pas rester en l’état.</>}
          </p>
        </div>
      </header>

      <div className="body flush">
        <ul className="rows">
          {etat.taches.map((t) => (
            <li key={t.cle}>
              <span className={`puce-gravite ${t.gravite}`} aria-hidden="true" />
              <Link to={t.vers} className="lead">
                <b>{t.titre}</b>
                <span>{t.detail}</span>
              </Link>
              <span className="amount">
                {t.compte}
                {t.montantCents !== undefined && (
                  <span className="sous">{fmt(t.montantCents)}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
