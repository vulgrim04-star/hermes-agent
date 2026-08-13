import { useState } from 'react';

import {
  AMORTISSEMENT_ANNEES, CHARGE_MAX_BP, TAUX_CALCUL_BP, arbitrage3aDirect, chargeTheorique,
  simulerAmortissement,
} from '../lib/patrimoine.js';
import { fmt, fmtRate, parseAmount, parseRate } from '../lib/money.js';
import { edit } from '../store/useBudget.js';

const DEFAUT = {
  valeurCents: 0, detteCents: 0, tauxHypothecaireBp: null,
  amortissementAnnuelCents: 0, revenuAnnuelCents: null,
};

const montant = (cents) => (cents === null || cents === undefined ? '' : (cents / 100).toFixed(2));
const taux = (bp) => (bp === null || bp === undefined ? '' : (bp / 100).toString());

/**
 * Immobilier et hypothèque.
 *
 * Le chiffre qui décide en Suisse n'est pas la mensualité payée : c'est la
 * **charge théorique** que la banque recalcule au taux de 5 %, majorée de 1 %
 * d'entretien et de l'amortissement du 2e rang. Un ménage qui paie 1,2 % et
 * tient tout juste ce test n'a pas un problème dans quinze ans — il en a un au
 * prochain renouvellement.
 *
 * Rien n'est prérempli : la valeur du bien et le revenu brut ne se déduisent
 * d'aucun relevé, et un chiffre inventé sur un dossier hypothécaire vaut moins
 * que pas de chiffre du tout.
 */
export default function Immobilier({ data }) {
  const stocke = { ...DEFAUT, ...(data.immobilier || {}) };
  const pose = stocke.valeurCents > 0;

  return (
    <div className="block">
      <header>
        <div className="grow">
          <h3>Immobilier et hypothèque</h3>
          <p>
            La charge théorique au taux de calcul de {fmtRate(TAUX_CALCUL_BP)} : intérêts recalculés,
            1 % d’entretien, amortissement du 2e rang sur {AMORTISSEMENT_ANNEES} ans. Elle doit tenir
            sous un tiers du revenu brut.
          </p>
        </div>
      </header>

      <Saisie stocke={stocke} />
      {pose && <Charge params={stocke} />}
      {pose && <Simulation params={stocke} />}
      {pose && <Arbitrage data={data} defautTaux={stocke.tauxHypothecaireBp} />}
    </div>
  );
}

function Saisie({ stocke }) {
  const [form, setForm] = useState({
    valeur: montant(stocke.valeurCents), dette: montant(stocke.detteCents),
    taux: taux(stocke.tauxHypothecaireBp), amortissement: montant(stocke.amortissementAnnuelCents),
    revenu: montant(stocke.revenuAnnuelCents),
  });
  const [erreur, setErreur] = useState('');

  function enregistrer() {
    const valeur = parseAmount(form.valeur);
    const dette = parseAmount(form.dette);
    if (valeur === null || dette === null) { setErreur('Indiquez au moins la valeur du bien et la dette.'); return; }
    setErreur('');
    edit((s) => {
      s.immobilier = {
        valeurCents: valeur,
        detteCents: dette,
        tauxHypothecaireBp: form.taux.trim() ? parseRate(form.taux) : null,
        amortissementAnnuelCents: parseAmount(form.amortissement) ?? 0,
        revenuAnnuelCents: form.revenu.trim() ? parseAmount(form.revenu) : null,
      };
    });
  }

  const champ = (cle, label, placeholder) => (
    <label className="field">
      {label}
      <input className="num-in" inputMode="decimal" placeholder={placeholder}
        value={form[cle]} onChange={(e) => setForm({ ...form, [cle]: e.target.value })} />
    </label>
  );

  return (
    <div className="body">
      <div className="row">
        {champ('valeur', 'Valeur du bien', "800'000.00")}
        {champ('dette', 'Dette hypothécaire', "600'000.00")}
        {champ('taux', 'Taux payé (%)', '1.25')}
        {champ('amortissement', 'Amortissement annuel', "5'000.00")}
        {champ('revenu', 'Revenu annuel brut', "150'000.00")}
        <button type="button" className="btn primary" onClick={enregistrer}>Enregistrer</button>
      </div>
      {erreur && <p className="note err" style={{ marginTop: 10 }}>{erreur}</p>}
    </div>
  );
}

function Charge({ params }) {
  const c = chargeTheorique(params);

  return (
    <>
      <dl className="stats">
        <div className="stat">
          <dt>Charge théorique</dt>
          <dd>{fmt(c.totalCents)}<span className="sub">{fmt(c.mensuelCents)} par mois</span></dd>
        </div>
        <div className="stat">
          <dt>Part du revenu</dt>
          <dd className={c.tenable === false ? 'alert' : undefined}>
            {c.ratioBp === null ? '—' : fmtRate(c.ratioBp)}
            <span className="sub">
              {c.ratioBp === null ? 'revenu non renseigné' : `plafond ${fmtRate(CHARGE_MAX_BP)}`}
            </span>
          </dd>
        </div>
        <div className="stat">
          <dt>Nantissement</dt>
          <dd className={c.nantissementBp > 8000 ? 'alert' : undefined}>
            {c.nantissementBp === null ? '—' : fmtRate(c.nantissementBp)}
            <span className="sub">fonds propres {fmt(c.fondsPropresCents)}</span>
          </dd>
        </div>
      </dl>

      <div className="body flush">
        <table>
          <tbody>
            <tr>
              <td>Intérêts au taux de calcul de {fmtRate(TAUX_CALCUL_BP)}</td>
              <td className="num">{fmt(c.interetsTheoriquesCents)}</td>
            </tr>
            <tr>
              <td>Entretien et frais accessoires (1 % de la valeur)</td>
              <td className="num">{fmt(c.entretienCents)}</td>
            </tr>
            <tr>
              <td>
                Amortissement du 2e rang
                <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                  {c.deuxiemeRangCents > 0
                    ? `${fmt(c.deuxiemeRangCents)} à ramener sous les deux tiers en ${AMORTISSEMENT_ANNEES} ans`
                    : 'la dette est déjà sous les deux tiers : plus rien d’obligatoire'}
                </span>
              </td>
              <td className="num">{fmt(c.amortissementCents)}</td>
            </tr>
            <tr style={{ borderTop: '2px solid var(--rule-strong)', fontWeight: 600 }}>
              <td>Charge théorique annuelle</td>
              <td className="num">{fmt(c.totalCents)}</td>
            </tr>
            {c.interetsReelsCents !== null && (
              <tr>
                <td className="muted">Intérêts réellement payés, au taux saisi</td>
                <td className="num muted">{fmt(c.interetsReelsCents)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="body">
        {c.ratioBp === null ? (
          <div className="note warn">
            Sans revenu annuel brut, le test ne conclut pas. Il faudrait au moins{' '}
            {fmt(c.revenuMinimalCents)} de revenu pour que cette charge tienne sous un tiers.
          </div>
        ) : c.tenable ? (
          <div className="note ok">
            La charge tient : {fmtRate(c.ratioBp)} du revenu brut, sous le plafond de{' '}
            {fmtRate(CHARGE_MAX_BP)}. Le test resterait tenu jusqu’à{' '}
            {fmt(params.revenuAnnuelCents - c.revenuMinimalCents)} de revenu en moins.
          </div>
        ) : (
          <div className="note err">
            La charge ne tient pas : {fmtRate(c.ratioBp)} du revenu brut pour un plafond de{' '}
            {fmtRate(CHARGE_MAX_BP)}. Il faudrait {fmt(c.revenuMinimalCents)} de revenu, ou amortir.
          </div>
        )}
        {c.fondsPropresSuffisants === false && (
          <p className="hint">
            Les fonds propres sont sous 20 % de la valeur du bien — le seuil que demandent les
            banques à l’octroi.
          </p>
        )}
      </div>
    </>
  );
}

function Simulation({ params }) {
  const [saisie, setSaisie] = useState('');
  const cents = parseAmount(saisie);
  const s = cents === null || cents <= 0 ? null : simulerAmortissement(params, cents);

  return (
    <div className="body" style={{ borderTop: '1px solid var(--rule)' }}>
      <div className="row">
        <label className="field">
          Amortissement extraordinaire
          <input className="num-in" inputMode="decimal" placeholder="50'000.00"
            value={saisie} onChange={(e) => setSaisie(e.target.value)} />
        </label>
      </div>

      {s && (
        <>
          <dl className="stats" style={{ border: '1px solid var(--rule)', marginTop: 12 }}>
            <div className="stat">
              <dt>Charge théorique en moins</dt>
              <dd className="pos">{fmt(s.gainChargeAnnuelleCents)}<span className="sub">par an</span></dd>
            </div>
            <div className="stat">
              <dt>Intérêts en moins</dt>
              <dd className="pos">
                {s.economieInteretsCents === null ? '—' : fmt(s.economieInteretsCents)}
                <span className="sub">
                  {s.economieInteretsCents === null ? 'taux payé non saisi' : 'réellement payés, par an'}
                </span>
              </dd>
            </div>
            <div className="stat">
              <dt>Part du revenu</dt>
              <dd>
                {s.apres.ratioBp === null ? '—' : fmtRate(s.apres.ratioBp)}
                {s.gainRatioBp !== null && <span className="sub">−{fmtRate(s.gainRatioBp)}</span>}
              </dd>
            </div>
          </dl>
          {s.sortDuDeuxiemeRang && (
            <div className="note ok" style={{ marginTop: 12 }}>
              Ce versement fait passer la dette sous les deux tiers de la valeur : l’amortissement
              obligatoire disparaît, et pas seulement sa dernière tranche.
            </div>
          )}
          <p className="hint">
            L’argent ainsi placé est immobilisé dans le bien : il ne se récupère qu’en revendant ou
            en augmentant la dette, ce qui se renégocie et ne va pas de soi.
          </p>
        </>
      )}
    </div>
  );
}

/**
 * Amortir directement, ou par un 3a nanti ?
 *
 * L'arbitrage dépend entièrement de paramètres personnels — taux marginal
 * d'imposition, rendement attendu du 3a, impôt de retrait à Fribourg. Ils se
 * saisissent : aucune valeur par défaut ne serait honnête, et une comparaison
 * qui repose sur un taux inventé oriente une décision à cent mille francs.
 */
function Arbitrage({ data, defautTaux }) {
  const stocke = data.arbitrage || {};
  const [form, setForm] = useState({
    versement: montant(stocke.versementAnnuelCents ?? null),
    annees: String(stocke.annees ?? 10),
    marginal: taux(stocke.tauxMarginalBp ?? null),
    rendement: taux(stocke.rendement3aBp ?? null),
    retrait: taux(stocke.impotRetraitBp ?? null),
  });

  const params = {
    versementAnnuelCents: parseAmount(form.versement) ?? 0,
    annees: Number(form.annees) || 10,
    tauxHypothecaireBp: defautTaux ?? 0,
    tauxMarginalBp: parseRate(form.marginal) ?? 0,
    rendement3aBp: parseRate(form.rendement) ?? 0,
    impotRetraitBp: parseRate(form.retrait) ?? 0,
  };
  const a = arbitrage3aDirect(params);

  function memoriser(next) {
    setForm(next);
    edit((s) => {
      s.arbitrage = {
        versementAnnuelCents: parseAmount(next.versement),
        annees: Number(next.annees) || 10,
        tauxMarginalBp: parseRate(next.marginal),
        rendement3aBp: parseRate(next.rendement),
        impotRetraitBp: parseRate(next.retrait),
      };
    });
  }

  const champ = (cle, label, placeholder) => (
    <label className="field">
      {label}
      <input className="num-in" style={{ width: 96 }} inputMode="decimal" placeholder={placeholder}
        value={form[cle]} onChange={(e) => memoriser({ ...form, [cle]: e.target.value })} />
    </label>
  );

  return (
    <div className="body" style={{ borderTop: '1px solid var(--rule)' }}>
      <h4 style={{ margin: '0 0 4px' }}>Amortir directement, ou par un 3a nanti ?</h4>
      <p className="hint" style={{ marginTop: 0 }}>
        Le même versement annuel, deux chemins. Directement, la dette baisse et les intérêts avec —
        mais on perd leur déduction. Par le 3a, la dette reste entière, le versement est déductible
        et le capital travaille, puis l’impôt de retrait s’applique.
      </p>

      <div className="row">
        {champ('versement', 'Versement annuel', "7'258.00")}
        {champ('annees', 'Durée (années)', '10')}
        {champ('marginal', 'Taux marginal (%)', '25')}
        {champ('rendement', 'Rendement 3a (%)', '2')}
        {champ('retrait', 'Impôt de retrait (%)', '5')}
      </div>

      {a && (
        <>
          <dl className="stats" style={{ border: '1px solid var(--rule)', marginTop: 12 }}>
            <div className="stat">
              <dt>Amortissement direct</dt>
              <dd>
                {fmt(a.direct.totalCents)}
                <span className="sub">
                  dont {fmt(a.direct.interetsEpargnesNetsCents)} d’intérêts épargnés, nets d’impôt
                </span>
              </dd>
            </div>
            <div className="stat">
              <dt>Indirect par le 3a</dt>
              <dd>
                {fmt(a.indirect.totalCents)}
                <span className="sub">
                  {fmt(a.indirect.capital3aCents)} de capital, −{fmt(a.indirect.impotRetraitCents)} de
                  retrait, +{fmt(a.indirect.economieImpotCents)} d’impôt épargné
                </span>
              </dd>
            </div>
            <div className="stat">
              <dt>Écart après {a.annees} ans</dt>
              <dd className={a.favori === 'indirect' ? 'pos' : undefined}>
                {a.ecartCents > 0 ? '+' : ''}{fmt(a.ecartCents)}
                <span className="sub">
                  {a.favori === null ? 'à égalité' : `en faveur de l’${a.favori === 'indirect' ? 'indirect' : 'amortissement direct'}`}
                </span>
              </dd>
            </div>
          </dl>
          <p className="hint">
            Sous ces hypothèses seulement, et hors impôt sur la fortune : l’amortissement direct
            réduit la dette déductible, donc augmente la fortune imposable. L’écart réel dépend du
            barème de votre commune.
          </p>
        </>
      )}
    </div>
  );
}
