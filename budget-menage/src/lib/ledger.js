/**
 * Journal : import, catégorisation, transferts internes, agrégats.
 *
 * Deux conventions tenues partout :
 *
 *  - **Les totaux sont des grandeurs positives.** Revenus, dépenses et épargne
 *    se lisent comme sur un compte de résultat ; seul le reste à vivre est
 *    signé, parce qu'il peut être négatif.
 *  - **Reste à vivre = revenus − dépenses − épargne.** L'épargne est un emploi
 *    du revenu, pas une consommation.
 *
 * Ces règles n'ont qu'une définition, ici : deux écrans qui répondraient
 * différemment à la même question, c'est un écran de trop.
 */

import { BANK_MAP_SEED, kindOf, rootOf } from './categories.js';
import { dayGap, monthBounds } from './dates.js';
import { bankBalanceAt } from './networth.js';
import { normLabel } from './normalise.js';
import { payeeKey } from './tiers.js';

// Ré-exporté : `normLabel` a longtemps vécu ici, et une bonne part du code
// l'importe encore de ce module.
export { normLabel };


export function emptyState() {
  const bank = {};
  for (const m of BANK_MAP_SEED) bank[normLabel(m.label)] = { label: m.label, cat: m.cat, treat: m.treat };
  return {
    version: 2,
    tx: [],
    accounts: {},
    rules: [],
    bank,
    transfers: [],
    seen: {},
    counter: 0,
    /** Relevés importés, avec leurs soldes : c'est d'eux que le patrimoine
     *  déduit les soldes bancaires plutôt que de les faire saisir. */
    statements: [],
    /** Positions du patrimoine et leurs valorisations mensuelles. */
    assets: [],
    valuations: [],
    /** Plafond du pilier 3a par année. Publié en fin d'année précédente : il
     *  se saisit, il ne se devine pas. 2025 est le seul pré-rempli. */
    tax: { 2025: 725800 },
  };
}

/* --------------------------------------------------------------- import */

/**
 * Empreinte d'une écriture. Le rang d'occurrence se calcule **au sein du
 * relevé** : c'est ce qui rend le même fichier réimportable sans rien ajouter,
 * tout en gardant deux lignes strictement identiques — qui sont deux écritures
 * réelles, pas un doublon.
 */
function fingerprint(accountKey, row, rank) {
  return [accountKey, row.date, row.cents, normLabel(row.label), rank].join('|');
}

export function commitStatements(state, statements) {
  const added = [];
  let duplicates = 0;

  for (const statement of statements) {
    if (!state.accounts[statement.key]) {
      state.accounts[statement.key] = { key: statement.key, label: statement.label };
    }
    // Le relevé est conservé avec ses soldes : c'est le seul chiffre dont on
    // sache qu'il est exact, et le patrimoine s'appuie dessus.
    if (statement.closing !== null && statement.to) {
      state.statements.push({
        acc: statement.key,
        from: statement.from,
        to: statement.to,
        opening: statement.opening,
        closing: statement.closing,
        movements: statement.movements,
      });
    }
    const ranks = new Map();
    for (const row of statement.rows) {
      const base = [statement.key, row.date, row.cents, normLabel(row.label)].join('|');
      const rank = (ranks.get(base) || 0) + 1;
      ranks.set(base, rank);

      const fp = fingerprint(statement.key, row, rank);
      if (state.seen[fp]) { duplicates += 1; continue; }
      state.seen[fp] = 1;

      state.counter += 1;
      const tx = {
        id: state.counter,
        acc: statement.key,
        date: row.date,
        cents: row.cents,
        label: row.label,
        norm: normLabel(row.label),
        cp: row.counterparty,
        ext: row.extCat,
        cat: null,
        transfer: 0,
      };
      state.tx.push(tx);
      added.push(tx);
    }
  }

  // Les règles de l'utilisateur d'abord — ce qu'il a écrit prime sur ce que la
  // banque propose —, la correspondance de la banque ensuite.
  const byRule = applyRules(state, added);
  const byBank = applyBank(state, added);
  const pairs = detectTransfers(state);

  state.tx.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id));
  return { added: added.length, duplicates, byRule, byBank, pairs };
}

/* -------------------------------------------------------- catégorisation */

/**
 * Une règle porte soit sur un **motif** contenu dans le libellé, soit sur un
 * **tiers** entier.
 *
 * La règle de tiers est la plus sûre des deux : elle vise la contrepartie
 * telle que le regroupement l'a établie, sans dépendre de la façon dont la
 * banque a rédigé cette ligne-là. Un motif reste utile pour attraper une
 * famille de libellés que le regroupement sépare.
 *
 * Une règle sans `kind` est un motif : c'est la forme qu'avaient toutes les
 * règles avant les tiers, et elles doivent continuer de fonctionner telles
 * quelles.
 */
export function ruleMatches(rule, tx) {
  if (rule.kind === 'tiers') return payeeKey(tx.label, tx.cp) === rule.pattern;
  const needle = normLabel(rule.pattern);
  return Boolean(needle) && tx.norm.includes(needle);
}

/** Ne comble que les vides : une catégorie posée à la main n'est jamais touchée. */
export function applyRules(state, list) {
  let n = 0;
  for (const tx of list) {
    if (tx.cat) continue;
    for (const rule of state.rules) {
      if (ruleMatches(rule, tx)) { tx.cat = rule.cat; n += 1; break; }
    }
  }
  return n;
}

export function applyBank(state, list) {
  let n = 0;
  for (const tx of list) {
    if (tx.cat || !tx.ext) continue;
    const mapping = state.bank[normLabel(tx.ext)];
    if (!mapping || !mapping.cat) continue;
    // Un règlement de carte n'est pas une catégorie de dépense : il reste sans
    // catégorie et sera apparié comme transfert.
    if (mapping.treat !== 'categorie') continue;
    tx.cat = mapping.cat;
    n += 1;
  }
  return n;
}

/** Motif proposé : sans appareil bancaire, sans nombres — reste le commerçant. */
const NOISE = /\b(PAIEMENT|CARTE|ACHAT|DEBIT|CREDIT|VIREMENT|ORDRE|TWINT|BANCOMAT|RETRAIT|E BANKING|LSV|REF|NO|DU|LE|DATE)\b/g;

export function suggestPattern(label) {
  const cleaned = normLabel(label).replace(NOISE, ' ').replace(/\b\d+\b/g, ' ').replace(/\s+/g, ' ').trim();
  const words = (cleaned || normLabel(label)).split(' ').filter(Boolean);
  return words.slice(0, 3).join(' ');
}

/**
 * Combien d'écritures **non classées** une règle prendrait.
 *
 * C'est ce chiffre qui permet de juger une règle avant de la poser : « celle-ci
 * en classerait 23 » se décide, « celle-ci a l'air bien » ne se décide pas.
 */
export function ruleScope(state, pattern, kind = 'motif') {
  if (!pattern) return 0;
  const rule = { pattern, kind };
  return state.tx.filter((t) => !t.cat && !t.transfer && ruleMatches(rule, t)).length;
}

/* ------------------------------------------------------ transferts internes */

/**
 * Montants strictement opposés, comptes différents, quelques jours d'écart.
 * La paire est **proposée, jamais imposée** : deux mouvements opposés peuvent
 * être un remboursement entre le ménage et un tiers.
 */
export function detectTransfers(state, maxDays = 5) {
  const engaged = new Set();
  for (const p of state.transfers) { engaged.add(p.out); engaged.add(p.in); }

  const outs = state.tx.filter((t) => t.cents < 0 && !engaged.has(t.id));
  const ins = state.tx.filter((t) => t.cents > 0 && !engaged.has(t.id));
  const used = new Set();
  let made = 0;

  for (const out of outs) {
    if (used.has(out.id)) continue;
    let best = null;
    let bestGap = Infinity;
    for (const income of ins) {
      if (used.has(income.id) || income.cents !== -out.cents || income.acc === out.acc) continue;
      const gap = dayGap(out.date, income.date);
      // La contrepartie la plus proche en date : deux virements du même montant
      // le même mois ne se mélangent pas.
      if (gap <= maxDays && gap < bestGap) { best = income; bestGap = gap; }
    }
    if (!best) continue;
    used.add(out.id);
    used.add(best.id);
    state.transfers.push({
      id: state.transfers.length + 1,
      out: out.id,
      in: best.id,
      gap: bestGap,
      status: 'propose',
    });
    made += 1;
  }
  return made;
}

export function decideTransfer(state, pairId, status) {
  const pair = state.transfers.find((p) => p.id === pairId);
  if (!pair) return;
  pair.status = status;
  const flag = status === 'confirme' ? 1 : 0;
  for (const id of [pair.out, pair.in]) {
    const tx = state.tx.find((t) => t.id === id);
    if (tx) tx.transfer = flag;
  }
}

/* ------------------------------------------------------------- agrégats */

/** Un transfert confirmé sort des totaux sans disparaître du journal. */
export function ledger(state, from, to) {
  return state.tx.filter((t) => !t.transfer && t.date >= from && t.date <= to);
}

export function totalsOf(rows) {
  let income = 0;
  let expense = 0;
  let savings = 0;
  for (const t of rows) {
    const kind = kindOf(t.cat, t.cents);
    if (kind === 'revenu') income += t.cents;
    else if (kind === 'epargne') savings -= t.cents;
    else expense -= t.cents;
  }
  const remaining = income - expense - savings;
  return { income, expense, savings, remaining, rate: income > 0 ? savings / income : null };
}

export function monthsAvailable(state) {
  return [...new Set(state.tx.map((t) => t.date.slice(0, 7)))].sort().reverse();
}

export function yearsAvailable(state) {
  return [...new Set(state.tx.map((t) => t.date.slice(0, 4)))].sort().reverse();
}

export function monthTotals(state, period) {
  const { start, end } = monthBounds(period);
  return totalsOf(ledger(state, start, end));
}

/** Dépenses par catégorie racine, non catégorisé compris et marqué. */
export function expenseByRoot(rows) {
  const byRoot = new Map();
  for (const t of rows) {
    if (kindOf(t.cat, t.cents) !== 'depense') continue;
    const name = rootOf(t.cat) || 'Non catégorisé';
    const entry = byRoot.get(name) || { name, value: 0, reserved: !t.cat };
    entry.value -= t.cents;
    byRoot.set(name, entry);
  }
  return [...byRoot.values()];
}

/**
 * Solde de chaque compte, et solde total.
 *
 * **La somme des mouvements importés n'est pas un solde.** C'est la distinction
 * qui compte ici : un ménage qui importe huit mois de relevés lirait sinon un
 * « solde » qui n'est que le cumul de ces huit mois, alors que le compte
 * existait avant. L'écart peut se chiffrer en dizaines de milliers de francs.
 *
 * On ne rend donc un solde que lorsqu'un relevé soldé permet de l'établir —
 * `bankBalanceAt` part du solde de clôture rapproché le plus proche et y
 * applique les mouvements postérieurs. À défaut, le compte est rendu avec
 * `solde: null` et le cumul de ses mouvements à part, nommé pour ce qu'il est.
 *
 * Le total additionne les seuls soldes établis, et dit combien de comptes il a
 * dû laisser de côté : un total qui engloberait silencieusement des comptes
 * inconnus serait faux sans le dire.
 */
export function accountBalances(state, period) {
  const mois = period || monthsAvailable(state)[0] || null;
  const bounds = mois ? monthBounds(mois) : null;

  const comptes = Object.values(state.accounts).map((compte) => {
    const mouvements = state.tx.filter(
      (t) => t.acc === compte.key && (!bounds || t.date <= bounds.end),
    );
    const cumul = mouvements.reduce((somme, t) => somme + t.cents, 0);
    const solde = bounds ? bankBalanceAt(state, compte.key, mois) : null;

    return {
      key: compte.key,
      label: compte.label || compte.key,
      solde,
      origine: solde === null ? 'mouvements' : 'releve',
      cumul,
      ecritures: mouvements.length,
    };
  });

  comptes.sort((a, b) => a.label.localeCompare(b.label, 'fr'));

  const etablis = comptes.filter((c) => c.solde !== null);
  return {
    comptes,
    total: etablis.reduce((somme, c) => somme + c.solde, 0),
    etablis: etablis.length,
    inconnus: comptes.length - etablis.length,
    mois,
  };
}

export function pendingCount(state) {
  const toClassify = state.tx.filter((t) => !t.cat && !t.transfer).length;
  const toPair = state.transfers.filter((p) => p.status === 'propose').length;
  return { toClassify, toPair, total: toClassify + toPair };
}
