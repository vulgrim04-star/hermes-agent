import { useMemo, useState } from 'react';

import CategorySelect from '../components/CategorySelect.jsx';
import { frDate } from '../lib/dates.js';
import { fmt } from '../lib/money.js';
import { accountBalances } from '../lib/ledger.js';
import { categoriseTiers, groupByPayee } from '../lib/tiers.js';
import { detectRecurring } from '../lib/recurrences.js';
import { forecast } from '../lib/forecast.js';
import { edit, useBudget } from '../store/useBudget.js';

/**
 * Projection de trésorerie à trois mois.
 *
 * Elle ne projette **que** les récurrences observées : les dépenses
 * arbitrables ne sont pas extrapolées, parce qu'on ignore ce que le ménage
 * choisira de dépenser. La projection est donc structurellement optimiste, et
 * l'écran le dit plutôt que de laisser croire à une prévision complète.
 */
function Tresorerie({ projection: p }) {
  const creux = p.creux;
  return (
    <div className="block">
      <header>
        <div className="grow">
          <h3>Trésorerie à trois mois</h3>
          <p>
            À partir du solde rapproché et des seules charges et revenus récurrents. Vos dépenses
            courantes ne sont pas extrapolées : la courbe réelle passera en dessous.
          </p>
        </div>
      </header>

      <dl className="stats">
        <div className="stat">
          <dt>Solde de départ</dt>
          <dd>
            {fmt(p.depart)}
            {p.comptesInconnus > 0 && (
              <span className="sub">{p.comptesInconnus} compte(s) sans solde établi, exclus</span>
            )}
          </dd>
        </div>
        <div className="stat">
          <dt>Entrées attendues</dt>
          <dd className="pos">{fmt(p.entrees)}</dd>
        </div>
        <div className="stat">
          <dt>Sorties engagées</dt>
          <dd>{fmt(p.sorties)}</dd>
        </div>
        <div className="stat">
          <dt>Au {frDate(p.fin)}</dt>
          <dd className={p.arrivee < 0 ? 'alert' : undefined}>{fmt(p.arrivee)}</dd>
        </div>
      </dl>

      {creux && (
        <div className="body">
          <div className="note err">
            <strong>Le solde passerait sous le seuil le {frDate(creux.date)}</strong> — {fmt(creux.solde)},
            après « {creux.label} ».
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Tiers et charges récurrentes.
 *
 * Deux lectures que l'écriture seule ne donne pas : **combien chez qui**, et
 * **ce qui tombera de toute façon**. Sur un export réel, une soixantaine de
 * tiers couvrent les deux tiers du journal — classer un tiers vaut donc
 * beaucoup plus cher que classer une écriture.
 */
export default function Tiers() {
  const data = useBudget((s) => s.data);
  const [filtre, setFiltre] = useState('');
  const [voirInterrompues, setVoirInterrompues] = useState(false);

  const tiers = useMemo(() => groupByPayee(data), [data]);
  const recurrences = useMemo(() => detectRecurring(data), [data]);
  const projection = useMemo(() => forecast(data, { mois: 3 }), [data]);
  const soldes = useMemo(() => accountBalances(data), [data]);

  if (!data.tx.length) {
    return <div className="block"><div className="empty">Aucune écriture. Importez un relevé pour commencer.</div></div>;
  }

  const charges = recurrences.filter((r) => r.sens === 'depense' && !r.dormante);
  const revenus = recurrences.filter((r) => r.sens === 'revenu' && !r.dormante);
  const interrompues = recurrences.filter((r) => r.dormante);
  const socle = charges.reduce((somme, r) => somme + r.medianeCents, 0);
  const derives = recurrences.filter((r) => r.derive && !r.dormante);

  const besoin = filtre.trim().toUpperCase();
  const visibles = besoin ? tiers.filter((t) => t.key.includes(besoin)) : tiers;

  return (
    <>
      {derives.length > 0 && (
        <div className="note warn" style={{ marginBottom: 18 }}>
          <strong>{derives.length} charge(s) ont changé de montant.</strong>
          <ul>
            {derives.map((r) => (
              <li key={r.key}>
                {r.label} : {r.derive.cents > 0 ? '+' : ''}{fmt(r.derive.cents)} par rapport à
                l’habitude de {fmt(r.medianeCents)}, le {frDate(r.derive.tx.date)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {projection ? <Tresorerie projection={projection} /> : charges.length > 0 && (
        <div className="block">
          <header>
            <div className="grow">
              <h3>Trésorerie à trois mois</h3>
              {/* Une carte absente ressemble à une panne. Mieux vaut dire ce
                  qui manque : la projection a besoin d'un point de départ, et
                  l'export CSV d'UBS ne porte aucun solde. */}
              <p>
                Indisponible : aucun solde de compte n’est établi
                {soldes.comptes.length > 0 && <> sur les {soldes.comptes.length} comptes du journal</>}.
                Une projection a besoin d’un point de départ, et la somme des mouvements importés
                n’en est pas un — elle ignore tout ce qui précède le premier relevé.
              </p>
              <p style={{ marginTop: 8 }}>
                Saisissez les soldes d’ouverture et de clôture au moment de l’import : l’export CSV
                d’UBS n’en porte pas, un relevé MT940 les porte et se rapproche tout seul.
              </p>
            </div>
          </header>
        </div>
      )}

      <div className="block">
        <header>
          <div className="grow">
            <h3>Charges récurrentes</h3>
            <p>
              Ce qui tombe chaque mois, quoi qu’il arrive. C’est une observation du passé, pas un
              engagement : une charge peut être résiliée, une échéance décalée.
            </p>
          </div>
        </header>

        <dl className="stats">
          <div className="stat">
            <dt>Socle mensuel</dt>
            <dd>{fmt(socle)}<span className="sub">{charges.length} charge(s)</span></dd>
          </div>
          {revenus.length > 0 && (
            <div className="stat">
              <dt>Revenus récurrents</dt>
              <dd className="pos">
                {fmt(revenus.reduce((s, r) => s + r.medianeCents, 0))}
                <span className="sub">{revenus.length} source(s)</span>
              </dd>
            </div>
          )}
        </dl>

        <div className="body flush">
          <ul className="rows">
            {charges.map((r) => (
              <li key={r.key}>
                <div className="lead">
                  <b>{r.label}</b>
                  {/* Une seule ligne, tronquée au besoin : sur téléphone, un
                      sous-titre qui passe à la ligne casse le rythme de la
                      liste et fait sauter le montant hors de son axe. */}
                  <span title={r.prochaine ? `Prochaine échéance le ${frDate(r.prochaine)}` : undefined}>
                    {r.cat || 'sans catégorie'} · {r.mois} mois
                    {r.prochaine && <> · → {frDate(r.prochaine)}</>}
                  </span>
                </div>
                <span className="amount">{fmt(-r.medianeCents)}</span>
              </li>
            ))}
            {!charges.length && (
              <li><span className="muted">Aucune charge récurrente détectée — il faut au moins trois mois d’historique.</span></li>
            )}
          </ul>
        </div>

        {interrompues.length > 0 && (
          <div className="body">
            <button type="button" className="btn quiet" onClick={() => setVoirInterrompues((v) => !v)}>
              {voirInterrompues ? 'Masquer' : 'Voir'} les {interrompues.length} charge(s) interrompue(s)
            </button>
            {voirInterrompues && (
              <ul className="rows" style={{ marginTop: 10 }}>
                {interrompues.map((r) => (
                  <li key={r.key}>
                    <div className="lead">
                      <b>{r.label}</b>
                      <span>dernière le {frDate(r.derniere)} — aucune échéance annoncée</span>
                    </div>
                    <span className="amount muted">{fmt(-r.medianeCents)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="block">
        <header>
          <div className="grow">
            <h3>Tiers</h3>
            <p>
              {tiers.length} contrepartie(s) pour {data.tx.filter((t) => !t.transfer).length} écriture(s).
              Poser une catégorie ici la pose sur tout l’historique du tiers — sans jamais écraser
              une catégorie que vous avez saisie à la main.
            </p>
          </div>
          <input
            type="search"
            placeholder="Filtrer un tiers…"
            value={filtre}
            onChange={(e) => setFiltre(e.target.value)}
            style={{ minWidth: 200 }}
          />
        </header>

        <div className="body flush">
          <ul className="rows">
            {visibles.slice(0, 120).map((t) => (
              <li key={t.key}>
                <div className="lead">
                  <b>{t.label}</b>
                  <span>
                    {t.occurrences}× sur {t.mois} mois · dernière {frDate(t.derniere)}
                    {t.aClasser > 0 && <> · <strong>{t.aClasser} à classer</strong></>}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className={t.total < 0 ? 'amount' : 'amount pos'}>{fmt(t.total)}</span>
                  <CategorySelect
                    value={t.cat}
                    onChange={(cat) => cat && edit((d) => categoriseTiers(d, t.key, cat))}
                  />
                </div>
              </li>
            ))}
          </ul>
          {visibles.length > 120 && (
            <p className="hint" style={{ padding: '12px 18px' }}>
              {visibles.length - 120} tiers de plus, tous de faible poids. Filtrez pour les atteindre.
            </p>
          )}
        </div>
      </div>
    </>
  );
}
