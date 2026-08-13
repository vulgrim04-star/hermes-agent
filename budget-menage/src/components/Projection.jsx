import { useState } from 'react';

import AreaChart from './AreaChart.jsx';
import { projection, tauxEpargne } from '../lib/patrimoine.js';
import { fmt, fmtRate, parseAmount, parseRate } from '../lib/money.js';
import { monthLabel } from '../lib/dates.js';
import { edit } from '../store/useBudget.js';

/**
 * Taux d'épargne constaté, et ce qu'il donne à cinq et dix ans.
 *
 * L'épargne se **mesure** au journal — revenus moins consommation — et ne se
 * saisit pas : c'est le seul chiffre de cette carte qui ne soit pas une
 * hypothèse. Le rendement, lui, en est une, et l'écran sépare toujours ce qui a
 * été versé de ce que le rendement a produit : sur dix ans à 4 %, l'essentiel
 * du résultat vient encore des versements, et c'est utile à voir.
 */
export default function Projection({ data, departCents }) {
  const mesure = tauxEpargne(data, { mois: 12 });
  const stocke = data.hypotheses || {};
  const [form, setForm] = useState({
    rendement: stocke.rendementBp == null ? '' : String(stocke.rendementBp / 100),
    epargne: stocke.epargneMensuelleCents == null ? '' : (stocke.epargneMensuelleCents / 100).toFixed(2),
  });

  if (!mesure) return null;

  // L'épargne constatée sert de proposition ; on peut la remplacer par une
  // hypothèse, mais jamais par accident — le champ vide reprend la mesure.
  const saisie = parseAmount(form.epargne);
  const epargneMensuelle = form.epargne.trim() && saisie !== null ? saisie : mesure.epargneMensuelleCents;
  const rendementBp = parseRate(form.rendement) ?? 0;

  function memoriser(next) {
    setForm(next);
    edit((s) => {
      s.hypotheses = {
        rendementBp: parseRate(next.rendement),
        epargneMensuelleCents: next.epargne.trim() ? parseAmount(next.epargne) : null,
      };
    });
  }

  const dix = projection({ departCents, epargneMensuelleCents: epargneMensuelle, rendementBp, annees: 10 });
  const cinq = dix.points[5];

  return (
    <div className="block">
      <header>
        <div className="grow">
          <h3>Taux d’épargne et projection</h3>
          <p>
            Mesuré sur {mesure.mois} mois complets{mesure.moisIgnore && <> — {monthLabel(mesure.moisIgnore)} est
            en cours et n’est pas compté</>}. L’épargne, ici, c’est le revenu moins la consommation :
            elle inclut ce qui dort sur le compte courant, pas seulement les virements d’épargne.
          </p>
        </div>
      </header>

      <dl className="stats">
        <div className="stat">
          <dt>Taux d’épargne</dt>
          <dd className={mesure.epargne < 0 ? 'neg' : 'pos'}>
            {mesure.taux === null ? '—' : `${Math.round(mesure.taux * 100)} %`}
            <span className="sub">du revenu brut encaissé</span>
          </dd>
        </div>
        <div className="stat">
          <dt>Épargne mensuelle</dt>
          <dd>{fmt(mesure.epargneMensuelleCents)}<span className="sub">moyenne constatée</span></dd>
        </div>
        <div className="stat">
          <dt>Revenus</dt>
          <dd>{fmt(mesure.revenus)}<span className="sub">sur la période</span></dd>
        </div>
        <div className="stat">
          <dt>Consommation</dt>
          <dd>{fmt(mesure.depenses)}<span className="sub">sur la période</span></dd>
        </div>
      </dl>

      <div className="body">
        <div className="row">
          <label className="field">
            Épargne mensuelle retenue
            <input className="num-in" inputMode="decimal"
              placeholder={(mesure.epargneMensuelleCents / 100).toFixed(2)}
              value={form.epargne} onChange={(e) => memoriser({ ...form, epargne: e.target.value })} />
          </label>
          <label className="field">
            Rendement annuel (%)
            <input className="num-in" style={{ width: 96 }} inputMode="decimal" placeholder="0"
              value={form.rendement} onChange={(e) => memoriser({ ...form, rendement: e.target.value })} />
          </label>
        </div>

        <dl className="stats" style={{ border: '1px solid var(--rule)', marginTop: 12 }}>
          <div className="stat">
            <dt>Départ</dt>
            <dd>{fmt(departCents)}<span className="sub">patrimoine net du mois</span></dd>
          </div>
          <div className="stat">
            <dt>Dans 5 ans</dt>
            <dd>{fmt(cinq.capitalCents)}<span className="sub">dont {fmt(cinq.rendementCents)} de rendement</span></dd>
          </div>
          <div className="stat">
            <dt>Dans 10 ans</dt>
            <dd>{fmt(dix.finCents)}<span className="sub">dont {fmt(dix.rendementCents)} de rendement</span></dd>
          </div>
        </dl>

        <div style={{ marginTop: 14 }}>
          <AreaChart
            points={dix.points.map((p) => ({ label: p.annee === 0 ? 'aujourd’hui' : `dans ${p.annee} an(s)`, value: p.capitalCents }))}
          />
        </div>

        <p className="hint">
          Une projection, pas une prévision : elle suppose une épargne constante et un rendement
          régulier, ce qu’aucun marché ne fait. {rendementBp === 0
            ? 'Sans rendement saisi, elle ne montre que l’effet de l’épargne — c’est déjà le terme qui pèse le plus.'
            : `À ${fmtRate(rendementBp)} par an, ${Math.round((dix.rendementCents / Math.max(1, dix.finCents - departCents)) * 100)} % de ce qui s’ajoute vient du rendement, le reste des versements.`}
        </p>
      </div>
    </div>
  );
}
