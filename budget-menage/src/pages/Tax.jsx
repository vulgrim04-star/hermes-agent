import { useState } from 'react';
import { Link } from 'react-router-dom';

import { anneesFiscales, recapFiscal } from '../lib/fiscal.js';
import { download } from '../lib/download.js';
import { frDate } from '../lib/dates.js';
import { fmt, parseAmount } from '../lib/money.js';
import { ORIGIN_LABELS } from '../lib/networth.js';
import { buildXlsx, money as xmoney, text as xtext } from '../lib/xlsx.js';
import { edit, useBudget } from '../store/useBudget.js';

/**
 * Le récapitulatif de la déclaration.
 *
 * L'application **rassemble ce que le journal contient** — les primes payées,
 * les versements 3a, les dons, les intérêts de dettes, la fortune au 31
 * décembre. Elle **ne calcule aucune déduction** : les plafonds, les seuils et
 * les barèmes dépendent du canton, de la commune, de l'état civil et du revenu
 * net déterminant.
 *
 * Ce partage n'est pas de la prudence mal placée. À quelqu'un qui sait remplir
 * une déclaration, il ne manque pas les règles : il manque les totaux tirés de
 * ses relevés, et c'est précisément ce qui prend une soirée à reconstituer.
 */
export default function Tax() {
  const data = useBudget((s) => s.data);
  const annees = anneesFiscales(data);
  const [annee, setAnnee] = useState(() => annees[0] || new Date().getUTCFullYear() - 1);

  if (!annees.length) {
    return (
      <div className="block">
        <div className="empty">
          Aucune écriture. <Link to="/import">Importez un relevé</Link> pour commencer.
        </div>
      </div>
    );
  }

  const r = recapFiscal(data, Number(annee));

  return (
    <>
      <div className="block">
        <div className="body" style={{ paddingBottom: 0, display: 'flex', justifyContent: 'flex-end' }}>
          <select value={annee} onChange={(e) => setAnnee(Number(e.target.value))} aria-label="Année fiscale">
            {annees.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>

        <header>
          <div className="grow">
            <h3>Déclaration {r.annee}</h3>
            <p>
              Ce que votre journal contient, poste par poste. <strong>Aucune déduction n’est
              calculée</strong> : les plafonds et les seuils dépendent de votre situation et du
              barème. Les montants sont bruts, prêts à être reportés — et à confronter aux
              attestations que vous recevrez.
            </p>
          </div>
        </header>

        <dl className="stats">
          <div className="stat">
            <dt>Revenus encaissés</dt>
            <dd className="pos">{fmt(r.totalRevenus)}</dd>
          </div>
          <div className="stat">
            <dt>Mois mouvementés</dt>
            <dd className={r.complet ? undefined : 'alert'}>{r.moisMouvementes} / 12</dd>
          </div>
        </dl>

        {!r.complet && (
          <div className="body">
            <div className="note warn">
              Le journal ne porte que {r.moisMouvementes} mois sur 12 pour {r.annee}. Les montants
              ci-dessous sont justes sur ce qui est là, et <strong>incomplets</strong> — rien dans
              les chiffres eux-mêmes ne le dirait.
            </div>
          </div>
        )}

        <div className="body" style={{ paddingTop: 0 }}>
          <button type="button" className="btn primary wide"
            onClick={() => exporter(r, data)}>
            Exporter le récapitulatif {r.annee} (.xlsx)
          </button>
        </div>
      </div>

      <Pilier3a status={r.pilier3a} annee={r.annee} />

      <div className="block">
        <header>
          <div className="grow">
            <h3>Postes de la déclaration</h3>
            <p>Chaque poste rappelle la règle en une phrase ; le montant, lui, vient des relevés.</p>
          </div>
        </header>
        <div className="body flush">
          <ul className="rows">
            {r.postes.map((poste) => (
              <li key={poste.cle} style={{ flexWrap: 'wrap' }}>
                <div className="lead">
                  <b>{poste.titre}</b>
                  <span>{poste.detail.map((d) => `${d.cat} ${fmt(d.cents)}`).join(' · ')}</span>
                </div>
                <span className="amount">{fmt(poste.cents)}</span>
                <p className="hint" style={{ flex: '1 1 100%' }}>{poste.note}</p>
              </li>
            ))}
          </ul>
        </div>
        {r.postesVides.length > 0 && (
          <div className="body">
            <p className="hint">
              Aucun montant sur {r.annee} pour : {r.postesVides.join(', ').toLowerCase()}.
            </p>
            {/* La banque classe en « Assurances » ou « Santé » — des racines.
                La déclaration, elle, distingue une prime LAMal d'une assurance
                ménage : seules les catégories fines alimentent ces postes. */}
            <p className="hint">
              Ces postes ne se remplissent qu’avec des catégories <strong>fines</strong> : la
              banque classe en « Assurances », la déclaration distingue une prime LAMal d’une
              assurance ménage. Le plus rapide est de classer le <Link to="/tiers">tiers</Link> —
              la catégorie vaut alors pour tout son historique et pour l’avenir.
            </p>
          </div>
        )}
      </div>

      <div className="block">
        <header>
          <div className="grow">
            <h3>Revenus encaissés</h3>
            <p>
              Ce qui est <strong>entré sur les comptes</strong> — pas le salaire brut. Le certificat
              de salaire fait foi pour la déclaration ; ce total sert à le recouper.
            </p>
          </div>
        </header>
        <div className="body flush">
          <ul className="rows">
            {r.revenus.map((ligne) => (
              <li key={ligne.cat}>
                <div className="lead"><b>{ligne.cat}</b></div>
                <span className="amount pos">{fmt(ligne.cents)}</span>
              </li>
            ))}
            {!r.revenus.length && <li><span className="muted">Aucun revenu classé sur {r.annee}.</span></li>}
          </ul>
        </div>
      </div>

      <div className="block">
        <header>
          <div className="grow">
            <h3>Fortune au {frDate(r.fortune.date)}</h3>
            <p>La date que retient la déclaration de fortune du canton de Fribourg.</p>
          </div>
        </header>
        {r.fortune.positions.length ? (
          <>
            <dl className="stats">
              <div className="stat"><dt>Actifs</dt><dd>{fmt(r.fortune.actifsCents)}</dd></div>
              <div className="stat"><dt>Dettes</dt><dd>{fmt(r.fortune.dettesCents)}</dd></div>
              <div className="stat">
                <dt>Fortune nette</dt>
                <dd className={r.fortune.netCents < 0 ? 'neg' : 'pos'}>{fmt(r.fortune.netCents)}</dd>
              </div>
            </dl>
            <div className="body flush">
              <ul className="rows">
                {r.fortune.positions.map((p) => (
                  <li key={p.assetId}>
                    <div className="lead">
                      <b>{p.label}</b>
                      <span>{ORIGIN_LABELS[p.origin]}</span>
                    </div>
                    <span className={p.isLiability ? 'amount neg' : 'amount'}>
                      {p.isLiability ? '−' : ''}{fmt(Math.abs(p.valueCents))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </>
        ) : (
          <div className="empty">
            Aucune position valorisée au 31 décembre {r.annee}.{' '}
            <Link to="/patrimoine">Les saisir</Link>.
          </div>
        )}
      </div>
    </>
  );
}

function Pilier3a({ status, annee }) {
  const [plafond, setPlafond] = useState('');

  return (
    <div className="block">
      <header>
        <div className="grow">
          <h3>Pilier 3a {annee}</h3>
          <p>Le versement de l’année, et ce qu’il restait à verser au 31 décembre.</p>
        </div>
      </header>
      <div className="body">
        {status.message && (
          <div className="note warn" style={{ marginBottom: 14 }}>
            {status.message} Il se saisit, il ne se devine pas.
            <div className="row" style={{ marginTop: 10 }}>
              <input placeholder="7'258.00" value={plafond} onChange={(e) => setPlafond(e.target.value)} />
              <button type="button" className="btn" disabled={!plafond.trim()}
                onClick={() => {
                  const cents = parseAmount(plafond);
                  if (cents === null) return;
                  edit((s) => { s.tax = { ...s.tax, [annee]: cents }; });
                  setPlafond('');
                }}>
                Enregistrer le plafond {annee}
              </button>
            </div>
          </div>
        )}
        <dl className="stats" style={{ border: '1px solid var(--rule)', borderRadius: 'var(--r-ctl)', overflow: 'hidden' }}>
          <div className="stat"><dt>Versé</dt><dd>{fmt(status.paidCents)}</dd></div>
          <div className="stat">
            <dt>Plafond</dt>
            <dd>{status.ceilingCents === null ? '—' : fmt(status.ceilingCents)}</dd>
          </div>
          <div className="stat">
            <dt>Non utilisé</dt>
            <dd className={status.remainingCents ? 'alert' : undefined}>
              {status.remainingCents === null ? '—' : fmt(status.remainingCents)}
            </dd>
          </div>
        </dl>
        <p className="hint">
          Un plafond non utilisé ne se rattrape pas l’année suivante : c’est la seule déduction
          qu’on perd en ne la voyant pas à temps.
        </p>
      </div>
    </div>
  );
}

/**
 * Le classeur du récapitulatif : une ligne par poste, puis les revenus, puis
 * la fortune. Une colonne « Règle » porte la phrase qui dit ce que le montant
 * est — sans elle, un total sorti de son écran redevient un chiffre nu qu'on
 * reporte de travers.
 */
function exporter(r, data) {
  const lignes = [];
  const section = (titre) => lignes.push([xtext(titre), xtext(''), xtext('')]);

  section(`Récapitulatif ${r.annee}`);
  lignes.push([
    xtext('Mois mouvementés'),
    xtext(`${r.moisMouvementes} / 12`),
    xtext(r.complet ? '' : 'Année incomplète : les montants sont justes sur ce qui est importé.'),
  ]);

  section('Postes de la déclaration');
  for (const poste of r.postes) {
    lignes.push([xtext(poste.titre), xmoney(poste.cents), xtext(poste.note)]);
    for (const d of poste.detail) lignes.push([xtext(`    ${d.cat}`), xmoney(d.cents), xtext('')]);
  }

  section('Pilier 3a');
  lignes.push([xtext('Versé'), xmoney(r.pilier3a.paidCents), xtext('')]);
  lignes.push([
    xtext('Plafond'),
    r.pilier3a.ceilingCents === null ? xtext('non renseigné') : xmoney(r.pilier3a.ceilingCents),
    xtext('Un plafond non utilisé ne se rattrape pas l’année suivante.'),
  ]);

  section('Revenus encaissés');
  for (const ligne of r.revenus) lignes.push([xtext(ligne.cat), xmoney(ligne.cents), xtext('')]);
  lignes.push([xtext('Total'), xmoney(r.totalRevenus),
    xtext('Encaissé sur les comptes, pas le salaire brut : le certificat de salaire fait foi.')]);

  section(`Fortune au ${frDate(r.fortune.date)}`);
  for (const p of r.fortune.positions) {
    lignes.push([
      xtext(p.label),
      xmoney(p.isLiability ? -Math.abs(p.valueCents) : p.valueCents),
      xtext(ORIGIN_LABELS[p.origin]),
    ]);
  }
  lignes.push([xtext('Fortune nette'), xmoney(r.fortune.netCents), xtext('')]);

  download(`declaration-${r.annee}.xlsx`, buildXlsx({
    sheetName: `Déclaration ${r.annee}`,
    columns: [
      { header: 'Poste', width: 42 },
      { header: 'Montant', width: 16 },
      { header: 'Règle / origine', width: 70 },
    ],
    rows: lignes,
  }));
}
