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
import { dayGap, monthBounds, validIso } from './dates.js';
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
        /** Annotation libre du ménage. Elle n'existe que si on l'écrit. */
        note: null,
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
    if (tx.cat || hasSplits(tx)) continue;
    for (const rule of state.rules) {
      if (ruleMatches(rule, tx)) { tx.cat = rule.cat; n += 1; break; }
    }
  }
  return n;
}

export function applyBank(state, list) {
  let n = 0;
  for (const tx of list) {
    if (tx.cat || !tx.ext || hasSplits(tx)) continue;
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
/**
 * Le journal, ligne à ligne — et une écriture répartie en donne plusieurs.
 *
 * Un passage à la Migros à 148.50 dont 30.00 sont un article de ménage n'est
 * pas une dépense d'alimentation de 148.50. Le découpage rend donc **une ligne
 * par part**, avec sa propre catégorie et son propre montant, et tout ce qui
 * consomme le journal — totaux, postes, budgets, camembert — s'en trouve juste
 * sans rien changer d'autre.
 *
 * Les lignes issues d'un découpage portent `splitOf` et `splitIndex` : elles ne
 * sont pas des écritures, et rien ne doit les enregistrer comme telles.
 */
export function ledger(state, from, to) {
  const rows = [];
  for (const tx of state.tx) {
    if (tx.transfer || tx.date < from || tx.date > to) continue;
    if (tx.splits && tx.splits.length) {
      tx.splits.forEach((part, i) => {
        rows.push({ ...tx, cat: part.cat, cents: part.cents, splitOf: tx.id, splitIndex: i });
      });
    } else {
      rows.push(tx);
    }
  }
  return rows;
}

/** Clé stable d'une ligne de journal, découpage compris. */
export function rowKey(row) {
  return row.splitOf === undefined ? String(row.id) : `${row.splitOf}-${row.splitIndex}`;
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

    // Sur quel relevé le solde s'appuie : l'écran doit pouvoir dire si le
    // chiffre vient d'un relevé importé ou d'une valeur saisie à la main.
    const soldes = state.statements
      .filter((s) => s.acc === compte.key && s.closing !== null && s.to)
      .sort((a, b) => (a.to < b.to ? -1 : a.to > b.to ? 1 : 0));
    const appui = bounds
      ? [...soldes].reverse().find((s) => s.to <= bounds.end) || soldes.find((s) => s.to > bounds.end) || null
      : null;

    return {
      key: compte.key,
      label: compte.label || compte.key,
      solde,
      origine: solde === null ? 'mouvements' : 'releve',
      appui: appui ? { date: appui.to, saisi: Boolean(appui.saisi) } : null,
      cumul,
      ecritures: mouvements.length,
      derniere: mouvements.reduce((max, t) => (t.date > max ? t.date : max), ''),
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

/* -------------------------------------------------------------- découpage */

/** Une écriture répartie ne porte plus de catégorie propre : ses parts la portent. */
export function hasSplits(tx) {
  return Boolean(tx.splits && tx.splits.length);
}

/**
 * Répartit une écriture entre plusieurs catégories.
 *
 * La règle est absolue : **la somme des parts vaut l'écriture, au centime**.
 * Une répartition qui ne boucle pas ferait apparaître ou disparaître de
 * l'argent dans tous les totaux, sans qu'aucun écran ne puisse le signaler —
 * c'est exactement le genre d'erreur qu'une comptabilité ne rattrape jamais.
 *
 * Les parts gardent le sens de l'écriture : on ne répartit pas une dépense de
 * 148.50 en −178.50 et +30.00. Une part nulle est refusée, elle n'ajouterait
 * qu'une ligne vide dans le journal.
 *
 * Une liste vide retire le découpage et rend son unité à l'écriture.
 */
export function setSplits(state, id, parts) {
  const tx = state.tx.find((t) => t.id === id);
  if (!tx) return { kind: 'introuvable' };

  if (!parts || !parts.length) {
    delete tx.splits;
    return { kind: 'retire' };
  }

  const propres = parts.map((p) => ({ cat: p.cat || null, cents: Math.round(p.cents) }));
  if (propres.some((p) => !p.cents)) return { kind: 'part-nulle' };
  if (propres.some((p) => Math.sign(p.cents) !== Math.sign(tx.cents))) return { kind: 'sens' };

  const somme = propres.reduce((s, p) => s + p.cents, 0);
  if (somme !== tx.cents) return { kind: 'somme', ecart: tx.cents - somme };

  tx.splits = propres;
  // La catégorie de l'écriture entière n'a plus de sens : ce sont les parts qui
  // la portent, et deux vérités concurrentes finiraient par diverger.
  tx.cat = null;
  return { kind: 'reparti', parts: propres.length };
}

/* ------------------------------------------------------------- annotation */

/**
 * Note libre sur une écriture.
 *
 * Une catégorie range, une note **explique** : « remboursé par Marie »,
 * « acompte, solde en mars », « facture 2024 payée en retard ». C'est ce qui
 * évite de rouvrir un relevé six mois plus tard pour se rappeler pourquoi une
 * ligne sort de l'ordinaire.
 *
 * Une note vide est retirée plutôt que stockée comme chaîne vide : `null` et
 * `''` se ressembleraient à la lecture et se compteraient différemment.
 */
export function setNote(state, id, texte) {
  const tx = state.tx.find((t) => t.id === id);
  if (!tx) return null;
  const propre = String(texte ?? '').trim();
  tx.note = propre || null;
  return tx.note;
}

/* ---------------------------------------------------------------- comptes */

/**
 * Renomme un compte. La clé — l'IBAN, ou ce qui en tient lieu — ne bouge
 * jamais : c'est elle qui rattache les écritures, les relevés et les positions
 * du patrimoine. Seul le libellé affiché change.
 */
export function renameAccount(state, key, label) {
  const compte = state.accounts[key];
  if (!compte) return false;
  const propre = String(label ?? '').trim();
  compte.label = propre || key;
  return true;
}

/**
 * Crée un compte à la main — la caisse en espèces, un compte chez une banque
 * qui n'exporte rien. Il n'a pas d'IBAN : la clé est fabriquée, et préfixée
 * pour qu'on ne la confonde jamais avec celle d'un relevé importé.
 */
export function addAccount(state, label) {
  const propre = String(label ?? '').trim();
  if (!propre) return null;
  let n = 1;
  while (state.accounts[`MANUEL-${n}`]) n += 1;
  const key = `MANUEL-${n}`;
  state.accounts[key] = { key, label: propre };
  return key;
}

/**
 * Enregistre un solde de compte constaté à une date.
 *
 * C'est la pièce qui manquait à tout le reste : l'export CSV d'UBS ne porte
 * aucun solde, et sans point de départ le patrimoine ne peut rien déduire, la
 * trésorerie refuse de projeter. Un chiffre relevé sur l'application de la
 * banque suffit à débloquer les deux.
 *
 * Il est rangé comme un relevé sans mouvements, ce que `bankBalanceAt` sait
 * déjà exploiter — solde le plus proche, puis marche avant ou arrière le long
 * des écritures. Deux saisies à la même date se remplacent : c'est une
 * correction, pas une seconde vérité.
 */
export function setAccountBalance(state, key, date, cents) {
  if (!state.accounts[key] || !validIso(date) || !Number.isFinite(cents)) return false;
  const existant = state.statements.find((s) => s.acc === key && s.to === date && s.saisi);
  if (existant) { existant.closing = Math.round(cents); return true; }
  state.statements.push({
    acc: key,
    from: null,
    to: date,
    opening: null,
    closing: Math.round(cents),
    movements: null,
    /** Marque la saisie manuelle : l'écran doit dire d'où vient un chiffre. */
    saisi: true,
  });
  return true;
}

export function clearAccountBalance(state, key, date) {
  const i = state.statements.findIndex((s) => s.acc === key && s.to === date && s.saisi);
  if (i < 0) return false;
  state.statements.splice(i, 1);
  return true;
}

export function pendingCount(state) {
  const toClassify = state.tx.filter((t) => !t.cat && !t.transfer && !hasSplits(t)).length;
  const toPair = state.transfers.filter((p) => p.status === 'propose').length;
  return { toClassify, toPair, total: toClassify + toPair };
}
