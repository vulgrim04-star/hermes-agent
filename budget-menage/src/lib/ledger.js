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

export function normLabel(label) {
  return String(label)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

export function emptyState() {
  const bank = {};
  for (const m of BANK_MAP_SEED) bank[normLabel(m.label)] = { label: m.label, cat: m.cat, treat: m.treat };
  return { version: 1, tx: [], accounts: {}, rules: [], bank, transfers: [], seen: {}, counter: 0 };
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

/** Ne comble que les vides : une catégorie posée à la main n'est jamais touchée. */
export function applyRules(state, list) {
  let n = 0;
  for (const tx of list) {
    if (tx.cat) continue;
    for (const rule of state.rules) {
      if (tx.norm.includes(normLabel(rule.pattern))) { tx.cat = rule.cat; n += 1; break; }
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

export function ruleScope(state, pattern) {
  const needle = normLabel(pattern);
  if (!needle) return 0;
  return state.tx.filter((t) => !t.cat && t.norm.includes(needle)).length;
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

export function pendingCount(state) {
  const toClassify = state.tx.filter((t) => !t.cat && !t.transfer).length;
  const toPair = state.transfers.filter((p) => p.status === 'propose').length;
  return { toClassify, toPair, total: toClassify + toPair };
}
