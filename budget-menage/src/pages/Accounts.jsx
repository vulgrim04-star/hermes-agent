import { useState } from 'react';
import { Link } from 'react-router-dom';

import Avatar from '../components/Avatar.jsx';
import Hero from '../components/Hero.jsx';
import { frDate } from '../lib/dates.js';
import { fmt, parseAmount } from '../lib/money.js';
import {
  accountBalances, addAccount, clearAccountBalance, controleSoldes, renameAccount,
  setAccountBalance,
} from '../lib/ledger.js';
import { edit, useBudget } from '../store/useBudget.js';

/** Aujourd'hui, au format du journal. */
const aujourdhui = () => new Date().toISOString().slice(0, 10);

/**
 * Les comptes, et surtout **leur solde**.
 *
 * C'est l'écran qui débloque tout le reste. L'export CSV d'UBS ne porte aucun
 * solde : sans point de départ, le patrimoine ne peut rien déduire d'un compte
 * suivi, et la prévision de trésorerie refuse — à raison — de projeter. Un seul
 * chiffre relevé sur l'application de la banque, saisi ici, suffit à ouvrir les
 * deux.
 *
 * Le cumul des mouvements importés n'est **pas** un solde, et l'écran ne les
 * met jamais sur le même plan : il ignore tout ce qui précède le premier
 * relevé, et se tromperait de plusieurs dizaines de milliers de francs.
 */
export default function Accounts() {
  const data = useBudget((s) => s.data);
  const soldes = accountBalances(data);
  const [nouveau, setNouveau] = useState('');

  return (
    <>
      <div className="block">
        <Hero
          label={soldes.etablis > 0 ? 'Solde des comptes établis' : 'Aucun solde établi'}
          cents={soldes.total}
        />
        <dl className="stats">
          <div className="stat">
            <dt>Comptes</dt>
            <dd>{soldes.comptes.length}</dd>
          </div>
          <div className="stat">
            <dt>Soldes établis</dt>
            <dd>{soldes.etablis} / {soldes.comptes.length}</dd>
          </div>
        </dl>
        {soldes.inconnus > 0 && (
          <div className="body">
            <div className="note warn">
              {soldes.inconnus} compte(s) sans solde établi ne sont dans aucun total. Saisir un
              solde relevé sur l’application de votre banque ouvre la projection de trésorerie et
              le suivi du patrimoine — le cumul des mouvements importés, lui, ne vaut pas un solde :
              il ignore tout ce qui précède le premier relevé.
            </div>
          </div>
        )}
      </div>

      <Controle data={data} />

      {soldes.comptes.length ? (
        <div className="block">
          <header>
            <div className="grow">
              <h3>Vos comptes</h3>
              <p>
                Le libellé s’écrit librement ; la clé du compte, elle, ne bouge jamais — c’est elle
                qui rattache les écritures, les relevés et les positions du patrimoine.
              </p>
            </div>
          </header>
          <div className="body flush">
            <ul className="rows">
              {soldes.comptes.map((compte) => <Compte key={compte.key} compte={compte} />)}
            </ul>
          </div>
        </div>
      ) : (
        <div className="block">
          <div className="empty">
            Aucun compte. <Link to="/import">Importez un relevé</Link>, ou créez un compte à la main
            ci-dessous.
          </div>
        </div>
      )}

      <div className="block">
        <header>
          <div className="grow">
            <h3>Ajouter un compte à la main</h3>
            <p>
              La caisse en espèces, un compte chez une banque qui n’exporte rien. Il n’aura pas
              d’écriture importée : son solde se saisit.
            </p>
          </div>
        </header>
        <div className="body">
          <div className="row">
            <label className="field" style={{ flex: '1 1 220px' }}>
              Libellé
              <input value={nouveau} onChange={(e) => setNouveau(e.target.value)} placeholder="Caisse en espèces" />
            </label>
            <button type="button" className="btn primary" disabled={!nouveau.trim()}
              onClick={() => { edit((s) => addAccount(s, nouveau)); setNouveau(''); }}>
              Créer
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function Compte({ compte }) {
  const [ouvert, setOuvert] = useState(false);
  const [label, setLabel] = useState(compte.label);
  const [montant, setMontant] = useState('');
  const [date, setDate] = useState(aujourdhui);
  const [erreur, setErreur] = useState('');

  function enregistrerSolde() {
    const cents = parseAmount(montant);
    if (cents === null) { setErreur('Montant illisible.'); return; }
    const ok = edit((s) => setAccountBalance(s, compte.key, date, cents));
    setErreur(ok ? '' : 'Date impossible.');
    if (ok) setMontant('');
  }

  return (
    <li style={ouvert ? { flexWrap: 'wrap' } : undefined}>
      <Avatar nom={compte.label} />
      <button type="button" className="lead" aria-expanded={ouvert} onClick={() => setOuvert((o) => !o)}>
        <b>{compte.label}</b>
        <span>
          {compte.ecritures} écriture(s)
          {compte.derniere && <> · dernière {frDate(compte.derniere)}</>}
          {compte.appui
            ? <> · solde {compte.appui.saisi ? 'saisi' : 'du relevé'} au {frDate(compte.appui.date)}</>
            : <> · <span style={{ color: 'var(--warn)' }}>aucun solde</span></>}
        </span>
      </button>
      <span className="amount">{compte.solde === null ? '—' : fmt(compte.solde)}</span>

      {ouvert && (
        <div style={{ flex: '1 1 100%', paddingTop: 12 }}>
          <div className="row">
            <label className="field" style={{ flex: '1 1 200px' }}>
              Libellé du compte
              <input value={label} onChange={(e) => setLabel(e.target.value)}
                onBlur={() => edit((s) => renameAccount(s, compte.key, label))} />
            </label>
          </div>

          <div className="row" style={{ marginTop: 12 }}>
            <label className="field">
              Solde constaté
              <input className="num-in" inputMode="decimal" placeholder="12'450.80"
                value={montant} onChange={(e) => setMontant(e.target.value)} />
            </label>
            <label className="field">
              À la date du
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <button type="button" className="btn primary" onClick={enregistrerSolde} disabled={!montant.trim()}>
              Enregistrer le solde
            </button>
            {compte.appui && compte.appui.saisi && (
              <button type="button" className="btn danger"
                onClick={() => edit((s) => clearAccountBalance(s, compte.key, compte.appui.date))}>
                Retirer le solde saisi
              </button>
            )}
          </div>

          {erreur && <p className="note err" style={{ marginTop: 10 }}>{erreur}</p>}
          <p className="hint">
            Relevez le solde sur l’application de votre banque, à une date où vous l’avez sous les
            yeux. Les écritures postérieures s’y ajoutent d’elles-mêmes ; celles qui précèdent s’en
            retranchent. Mouvements importés : {fmt(compte.cumul)} — ce n’est pas un solde.
            Clé du compte : <span className="mono">{compte.key}</span>.
          </p>
        </div>
      )}
    </li>
  );
}

/**
 * Le rapprochement d'un relevé à l'autre.
 *
 * L'import prouve qu'un relevé boucle sur lui-même. Ce contrôle-ci prouve que
 * **rien ne manque entre deux relevés** — et c'est la seule vérification qui
 * attrape un mois jamais importé, un export tronqué, un fichier oublié. Le
 * journal paraît alors complet, les totaux sont plausibles, et l'écart est
 * pourtant là.
 *
 * La carte ne s'affiche pas quand il n'y a rien à contrôler : deux soldes au
 * minimum sont nécessaires par compte, et un contrôle impossible n'est pas un
 * contrôle réussi — le dire aurait été mentir par omission.
 */
function Controle({ data }) {
  const r = controleSoldes(data);
  if (!r.controlables) return null;

  return (
    <div className="block">
      <header>
        <div className="grow">
          <h3>Contrôle des soldes</h3>
          <p>
            Entre deux soldes connus, la différence doit valoir la somme des mouvements. Sinon,
            l’écart chiffre exactement ce qui manque au journal.
          </p>
        </div>
      </header>

      <dl className="stats">
        <div className="stat">
          <dt>Intervalles contrôlés</dt>
          <dd>{r.comptes.reduce((s, c) => s + c.controles.length, 0)}</dd>
        </div>
        <div className="stat">
          <dt>Écarts</dt>
          <dd className={r.ecarts > 0 ? 'alert' : 'pos'}>{r.ecarts}</dd>
        </div>
      </dl>

      <div className="body flush">
        <ul className="rows">
          {r.comptes.flatMap((compte) => compte.controles.map((c) => (
            <li key={`${compte.key}-${c.a}`}>
              <div className="lead">
                <b>{compte.label}</b>
                <span>
                  du {frDate(c.de)} au {frDate(c.a)} · {c.ecritures} écriture(s)
                  {c.saisi && <> · solde saisi</>}
                </span>
              </div>
              <span className={c.ecartCents === 0 ? 'amount pos' : 'amount neg'}>
                {c.ecartCents === 0 ? 'boucle' : fmt(c.ecartCents)}
              </span>
            </li>
          )))}
        </ul>
      </div>

      {r.ecarts > 0 && (
        <div className="body">
          <div className="note warn">
            Un écart <strong>négatif</strong> veut dire que le journal montre moins de mouvements
            que les soldes n’en supposent : il manque des écritures sur cette période — un relevé
            à réimporter. Un écart <strong>positif</strong> veut dire l’inverse : des écritures en
            trop, ou un solde saisi qui n’est pas celui de cette date.
          </div>
        </div>
      )}
    </div>
  );
}
