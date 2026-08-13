import { useState } from 'react';

import Avatar from '../components/Avatar.jsx';
import CategorySelect from '../components/CategorySelect.jsx';
import { catOf } from '../lib/categories.js';
import { frDate } from '../lib/dates.js';
import { fmt } from '../lib/money.js';
import { applyRules, decideTransfer, ruleScope, suggestPattern } from '../lib/ledger.js';
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

  const pairs = data.transfers.filter((p) => p.status === 'propose');
  const queue = data.tx.filter((t) => !t.cat && !t.transfer);
  const byId = new Map(data.tx.map((t) => [t.id, t]));

  return (
    <>
      {pairs.length > 0 && (
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
            {/*
              Confirmer cinquante-trois paires une par une décourage, et une
              file qu'on n'épuise jamais finit par être ignorée — ce qui laisse
              des doubles comptages dans les totaux.

              Le geste reste **délibéré** : la liste est sous les yeux, le
              nombre et le montant sont annoncés, et chaque paire peut être
              rejetée avant. Ce qui est écarté, c'est la répétition, pas la
              décision.
            */}
            {pairs.length > 1 && (
              <button
                type="button"
                className="btn"
                onClick={() => edit((s) => {
                  for (const pair of s.transfers.filter((p) => p.status === 'propose')) {
                    decideTransfer(s, pair.id, 'confirme');
                  }
                })}
              >
                Confirmer les {pairs.length} paires ({fmt(pairs.reduce((somme, pair) => {
                  const out = byId.get(pair.out);
                  return somme + (out ? Math.abs(out.cents) : 0);
                }, 0))})
              </button>
            )}
          </header>
          <div className="body flush">
            <ul className="rows">
              {pairs.map((pair) => {
                const out = byId.get(pair.out);
                const income = byId.get(pair.in);
                if (!out || !income) return null;
                return (
                  <li key={pair.id} style={{ flexWrap: 'wrap' }}>
                    <div className="lead">
                      <b>{out.label}</b>
                      <span>
                        {frDate(out.date)} · {(data.accounts[out.acc] || {}).label || out.acc}
                        {' → '}
                        {(data.accounts[income.acc] || {}).label || income.acc}
                        {pair.gap > 0 && ` · ${pair.gap} j d’écart`}
                      </span>
                    </div>
                    <span className="amount">{fmt(out.cents)}</span>
                    <div className="row" style={{ flex: '1 1 100%' }}>
                      <button
                        type="button"
                        className="btn primary"
                        onClick={() => edit((s) => decideTransfer(s, pair.id, 'confirme'))}
                      >
                        Confirmer
                      </button>
                      <button
                        type="button"
                        className="btn quiet"
                        onClick={() => edit((s) => decideTransfer(s, pair.id, 'rejete'))}
                      >
                        Écarter
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

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
                    <div style={{ flex: '1 1 200px' }}>
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
      applyRules(state, state.tx.filter((t) => !t.cat));
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
