import { useState } from 'react';

import Affinage from '../components/Affinage.jsx';
import Avatar from '../components/Avatar.jsx';
import CategorySelect from '../components/CategorySelect.jsx';
import { catOf } from '../lib/categories.js';
import { frDate } from '../lib/dates.js';
import { fmt } from '../lib/money.js';
import { applyRules, decideGroupe, decideTransfer, groupesDeTransferts, hasSplits, ruleScope, suggestPattern } from '../lib/ledger.js';
import { accepterRegle, proposerRegle } from '../lib/apprentissage.js';
import { edit, useBudget } from '../store/useBudget.js';

/**
 * L'écran de fin de mois : ce qui n'est pas classé, et les paires opposées à
 * arbitrer. Une écriture sans catégorie remonte ici ; une écriture mal classée
 * n'y remonterait jamais — d'où le parti de ne rien deviner.
 */
export default function Review() {
  const data = useBudget((s) => s.data);
  const [ruleFor, setRuleFor] = useState(null);
  const [proposition, setProposition] = useState(null);

  const { habitudes, aVerifier } = groupesDeTransferts(data);
  // Une écriture répartie est classée : ses parts portent les catégories.
  const queue = data.tx.filter((t) => !t.cat && !t.transfer && !hasSplits(t));

  return (
    <>
      {(habitudes.length > 0 || aVerifier.length > 0) && (
        <div className="block">
          <header>
            <div className="grow">
              <h3>Transferts internes à confirmer</h3>
              <p>
                Deux mouvements opposés entre deux de vos comptes. Confirmés, ils sortent des revenus
                et des dépenses sans disparaître du journal : un règlement de carte n’est pas une
                dépense de plus, la dépense a eu lieu à l’achat.
              </p>
            </div>
          </header>

          {/*
            Deux listes, et c'est tout l'objet de cet écran.

            Une sortie et une entrée du **même montant exact, le même jour,
            entre deux comptes du ménage** n'est pas une question : c'est la
            définition d'un virement interne. Sur un relevé réel, quarante-huit
            des cinquante-trois paires sont dans ce cas, réparties sur quatre
            habitudes. Les confirmer une par une ne fait gagner aucune
            certitude — ça fatigue, et une file qu'on n'épuise jamais laisse des
            doubles comptages dans tous les totaux.

            Les paires **décalées** sont d'une autre nature : à quelques jours
            d'écart, un paiement et une recette du même montant peuvent n'avoir
            aucun rapport. Confirmée à tort, la paire efface les deux écritures
            des totaux — l'erreur est silencieuse, et les soldes restent justes,
            donc le rapprochement ne la rattrape pas. Elles ne sont jamais
            emportées par un geste de masse.
          */}
          {habitudes.length > 0 && (
            <div className="body flush">
              <ul className="rows">
                {habitudes.map((h) => <Habitude key={h.cle} h={h} accounts={data.accounts} />)}
              </ul>
            </div>
          )}

          {aVerifier.length > 0 && (
            <>
              <div className="body" style={{ paddingBottom: 0 }}>
                <h4>À regarder une par une</h4>
                <p className="note" style={{ marginTop: 6 }}>
                  {aVerifier.length} paire(s) ne tombent pas le même jour. C’est là qu’une
                  coïncidence est possible, et une paire confirmée à tort efface deux écritures des
                  totaux sans que rien ne le signale.
                </p>
              </div>
              <div className="body flush">
                <ul className="rows">
                  {aVerifier.map((v) => <Decalee key={v.id} v={v} accounts={data.accounts} />)}
                </ul>
              </div>
            </>
          )}
        </div>
      )}

      <Affinage />

      <div className="block">
        <header>
          <div className="grow">
            <h3>À classer</h3>
            <p>
              {queue.length
                ? `${queue.length} écriture(s) sans catégorie. Elles restent dans les totaux, mais comptées à part.`
                : 'Rien en attente : tout est classé.'}
            </p>
          </div>
        </header>
        {queue.length ? (
          <div className="body flush">
            <ul className="rows">
              {queue.slice(0, 120).map((tx) => (
                <li key={tx.id} style={{ flexWrap: 'wrap' }}>
                  <Avatar nom={tx.cp || tx.label} />
                  <div className="lead">
                    <b>{tx.label}</b>
                    <span>
                      {frDate(tx.date)}
                      {tx.ext && <> · banque : {tx.ext}</>}
                    </span>
                  </div>
                  <span className={tx.cents < 0 ? 'amount' : 'amount pos'}>{fmt(tx.cents)}</span>
                  <div className="row" style={{ flex: '1 1 100%', alignItems: 'center' }}>
                    <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                      <CategorySelect
                        value={tx.cat}
                        onChange={(c) => {
                          edit((s) => {
                            const row = s.tx.find((t) => t.id === tx.id);
                            if (row) row.cat = c;
                          });
                          // Classer une ligne apprend quelque chose sur son
                          // tiers : on le propose, on ne l'applique pas.
                          setProposition(c ? proposerRegle(data, tx, c) : null);
                        }}
                      />
                    </div>
                    <button type="button" className="btn quiet" onClick={() => setRuleFor(tx)}>
                      Créer une règle…
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            {queue.length > 120 && (
              <p className="hint" style={{ padding: '12px 18px' }}>
                Les 120 premières ; classez-les et les suivantes apparaîtront.
              </p>
            )}
          </div>
        ) : (
          <div className="empty">Rien en attente.</div>
        )}
      </div>

      {proposition && (
        <Proposition
          proposition={proposition}
          onAccepter={() => {
            edit((s) => accepterRegle(s, proposition, applyRules));
            setProposition(null);
          }}
          onRefuser={() => setProposition(null)}
        />
      )}

      {ruleFor && <RuleDialog tx={ruleFor} onClose={() => setRuleFor(null)} />}
    </>
  );
}

/**
 * La proposition qui suit une correction.
 *
 * Elle n'apparaît que lorsqu'elle a un effet — le tiers a d'autres écritures en
 * attente — et elle annonce **combien**. Une proposition sans chiffre serait
 * une invitation à faire confiance ; avec le chiffre, elle se décide.
 *
 * Elle est posée en bas de l'écran, à portée du pouce, et n'interrompt rien :
 * on peut continuer à classer sans y répondre.
 */
function Proposition({ proposition, onAccepter, onRefuser }) {
  return (
    <div className="toast proposition" role="status">
      <span>
        <strong>{proposition.pattern}</strong> — {proposition.restantes} autre(s) écriture(s) à
        classer en « {proposition.cat} »
      </span>
      <button type="button" className="btn primary" onClick={onAccepter}>Tout classer</button>
      <button type="button" className="btn quiet" onClick={onRefuser} aria-label="Ignorer">✕</button>
    </div>
  );
}

/**
 * Le motif proposé retire l'appareil bancaire et les nombres ; il reste le
 * commerçant dans la plupart des libellés. La portée est recalculée à chaque
 * frappe : on voit ce que la règle prendrait **avant** de la poser.
 */
function RuleDialog({ tx, onClose }) {
  const data = useBudget((s) => s.data);
  const [pattern, setPattern] = useState(() => suggestPattern(tx.label));
  const [category, setCategory] = useState(tx.cat);
  const scope = ruleScope(data, pattern);

  function create() {
    if (!pattern.trim() || !catOf(category)) return;
    edit((state) => {
      state.rules.push({ pattern: pattern.trim(), cat: category });
      applyRules(state, state.tx.filter((t) => !t.cat && !hasSplits(t)));
    });
    onClose();
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'grid',
        placeItems: 'center', padding: 20, zIndex: 40,
      }}
      onClick={onClose}
    >
      <div className="block" style={{ maxWidth: 480, width: '100%', margin: 0 }} onClick={(e) => e.stopPropagation()}>
        <header><div className="grow"><h3>Nouvelle règle</h3><p>{tx.label}</p></div></header>
        <div className="body">
          <label className="field" style={{ marginBottom: 14 }}>
            Motif contenu dans le libellé
            <input value={pattern} onChange={(e) => setPattern(e.target.value)} autoFocus />
          </label>
          <label className="field" style={{ marginBottom: 14 }}>
            Catégorie à poser
            <CategorySelect value={category} onChange={setCategory} />
          </label>
          <p className="note">
            Cette règle classerait <strong>{scope}</strong> écriture(s) non catégorisée(s). Elle ne
            touchera jamais une catégorie posée à la main.
          </p>
          <div className="row" style={{ marginTop: 14 }}>
            <button type="button" className="btn primary" onClick={create} disabled={!pattern.trim() || !catOf(category)}>
              Créer la règle
            </button>
            <button type="button" className="btn" onClick={onClose}>Annuler</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Une habitude : un couple de comptes, des virements du jour même. */
function Habitude({ h, accounts }) {
  const nom = (k) => (accounts[k] || {}).label || k;
  const montants = h.montants.slice(0, 3).map(fmt).join(', ');
  return (
    <li style={{ flexWrap: 'wrap' }}>
      <div className="lead">
        <b>{nom(h.de)} → {nom(h.vers)}</b>
        <span>
          {h.occurrences} virement(s) sur {h.mois} mois, toujours le jour même · {montants}
          {h.montants.length > 3 && ` et ${h.montants.length - 3} autre(s)`}
        </span>
      </div>
      <span className="amount">{fmt(h.totalCents)}</span>
      <div className="row" style={{ flex: '1 1 100%' }}>
        <button
          type="button"
          className="btn primary"
          onClick={() => edit((s) => decideGroupe(s, h.cle, 'confirme'))}
        >
          Confirmer les {h.occurrences}
        </button>
        <button
          type="button"
          className="btn quiet"
          onClick={() => edit((s) => decideGroupe(s, h.cle, 'rejete'))}
        >
          Écarter
        </button>
      </div>
    </li>
  );
}

/** Une paire décalée : la seule qui demande un jugement. */
function Decalee({ v, accounts }) {
  const nom = (k) => (accounts[k] || {}).label || k;
  return (
    <li style={{ flexWrap: 'wrap' }}>
      <span className="puce-gravite attention" aria-hidden="true" />
      <div className="lead">
        <b>{fmt(v.montantCents)}</b>
        <span>
          {nom(v.de)} → {nom(v.vers)} · {frDate(v.date)} · arrivé {v.gap} jour(s) plus tard
        </span>
      </div>
      <div className="row" style={{ flex: '1 1 100%' }}>
        <button
          type="button"
          className="btn primary"
          onClick={() => edit((s) => decideTransfer(s, v.id, 'confirme'))}
        >
          Confirmer
        </button>
        <button
          type="button"
          className="btn quiet"
          onClick={() => edit((s) => decideTransfer(s, v.id, 'rejete'))}
        >
          Écarter
        </button>
      </div>
    </li>
  );
}
