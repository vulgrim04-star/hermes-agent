import { evolution } from '../lib/patrimoine.js';
import { fmt } from '../lib/money.js';
import { MONTHS_SHORT } from '../lib/dates.js';

const court = (period) => `${MONTHS_SHORT[Number(period.slice(5, 7)) - 1]} ${period.slice(2, 4)}`;

/** Signe explicite : sur une variation, `1'800.00` seul est ambigu. */
const signe = (cents) => (cents > 0 ? `+${fmt(cents)}` : fmt(cents));

/**
 * Évolution du patrimoine, et **d'où elle vient**.
 *
 * Le chiffre du patrimoine net ne dit pas grand-chose seul. Ce qui se pilote,
 * c'est sa décomposition : ce que le ménage a mis de côté, et ce que le marché
 * a fait. Un patrimoine qui monte de 20'000 par la bourse peut redescendre de
 * 20'000 le mois suivant ; 20'000 d'épargne, non.
 *
 * La valorisation est un **reste** : la variation que les flux du ménage
 * n'expliquent pas. Elle porte donc aussi les mois où une position n'a pas été
 * relevée — la carte le dit plutôt que de faire passer un oubli de saisie pour
 * une performance.
 */
export default function Evolution({ data, from, to }) {
  const bilan = evolution(data, from, to);
  if (!bilan.mesurable) return null;

  const mesures = bilan.points.filter((p) => p.variation !== null);
  const derniers = mesures.slice(-6).reverse();
  // Une seule échelle pour toutes les barres : sinon un mois à 200 francs
  // paraît aussi fourni qu'un mois à 8'000.
  const echelle = Math.max(...mesures.map((p) => Math.abs(p.epargne) + Math.abs(p.valorisation)), 1);

  return (
    <div className="block">
      <header>
        <div className="grow">
          <h3>Évolution du patrimoine net</h3>
          <p>
            Sur {bilan.mois} mois. La variation se décompose en ce que le ménage a mis de côté et
            en ce que la valorisation des placements a produit — le reste que les flux n’expliquent
            pas.
          </p>
        </div>
      </header>

      <dl className="stats">
        <div className="stat">
          <dt>Variation</dt>
          <dd className={bilan.variation < 0 ? 'neg' : 'pos'}>{signe(bilan.variation)}</dd>
        </div>
        <div className="stat">
          <dt>Épargne du ménage</dt>
          <dd>{signe(bilan.epargne)}<span className="sub">revenus moins consommation</span></dd>
        </div>
        <div className="stat">
          <dt>Valorisation</dt>
          <dd className={bilan.valorisation < 0 ? 'neg' : undefined}>
            {signe(bilan.valorisation)}
            <span className="sub">marché, cours, réévaluations</span>
          </dd>
        </div>
      </dl>

      {bilan.incertains > 0 && (
        <div className="body" style={{ paddingTop: 0 }}>
          <div className="note warn">
            {bilan.incertains} mois sur {bilan.mois} portent une position non renseignée. Leur
            décomposition n’est pas fiable : ce qui manque au patrimoine se retrouve en
            valorisation.
          </div>
        </div>
      )}

      <div className="body flush">
        <ul className="rows">
          {derniers.map((p) => (
            <li key={p.period}>
              <div className="lead">
                <b>{court(p.period)}</b>
                <span>
                  épargne {signe(p.epargne)} · valorisation {signe(p.valorisation)}
                  {p.reporte && <> · valeur reportée</>}
                </span>
                <div className="decompo">
                  <i className="ep" style={{ width: `${(Math.abs(p.epargne) / echelle) * 100}%` }} />
                  <i className={p.valorisation < 0 ? 'val neg' : 'val'}
                    style={{ width: `${(Math.abs(p.valorisation) / echelle) * 100}%` }} />
                </div>
              </div>
              <span className={p.variation < 0 ? 'amount neg' : 'amount'}>{signe(p.variation)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
