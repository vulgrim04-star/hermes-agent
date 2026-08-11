/**
 * Lecture d'un export bancaire CSV.
 *
 * Rien n'est codé en dur : l'encodage, le séparateur, la ligne d'en-tête et les
 * colonnes sont déduits du fichier. Deviner à l'envers transformerait « Genève »
 * en « GenÃ¨ve » et corromprait silencieusement tous les libellés — donc toutes
 * les règles de catégorisation qui s'appuieront dessus.
 *
 * Le module ne touche à aucun état : il rend un résultat inerte que l'import
 * dédoublonne, rapproche et enregistre. C'est ce qui le rend vérifiable.
 */

import { parseAmount } from './money.js';
import { parseDate } from './dates.js';

/* ------------------------------------------------------------------ encodage */

export function decodeBytes(buffer) {
  const b = new Uint8Array(buffer);
  const startsWith = (p) => b.length >= p.length && p.every((x, i) => b[i] === x);

  if (startsWith([0xef, 0xbb, 0xbf]))
    return { text: new TextDecoder('utf-8').decode(b.subarray(3)), encoding: 'utf-8 (BOM)' };
  if (startsWith([0xff, 0xfe]))
    return { text: new TextDecoder('utf-16le').decode(b.subarray(2)), encoding: 'utf-16le' };
  if (startsWith([0xfe, 0xff]))
    return { text: new TextDecoder('utf-16be').decode(b.subarray(2)), encoding: 'utf-16be' };

  // UTF-8 strict d'abord ; à défaut Windows-1252, le seul encodage 8 bits qui
  // ne peut pas échouer, chaque octet y ayant une représentation.
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(b), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(b), encoding: 'windows-1252' };
  }
}

/* ---------------------------------------------------------------- séparateur */

function countOutsideQuotes(line, mark) {
  let n = 0;
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { i += 1; continue; }
      quoted = !quoted;
      continue;
    }
    if (!quoted && ch === mark) n += 1;
  }
  return n;
}

/**
 * Le bon séparateur est celui qui découpe **régulièrement**, pas celui qui
 * apparaît le plus : une virgule décimale bat le point-virgule en fréquence.
 */
export function detectDelimiter(lines) {
  const sample = lines.filter((l) => l.trim()).slice(0, 50);
  let best = { delimiter: ';', confidence: 0 };
  if (!sample.length) return best;

  for (const candidate of [';', ',', '\t', '|']) {
    const tally = new Map();
    for (const line of sample) {
      const n = countOutsideQuotes(line, candidate);
      if (n) tally.set(n, (tally.get(n) || 0) + 1);
    }
    if (!tally.size) continue;

    let dominant = 0;
    let dominantLines = 0;
    for (const [count, lines_] of tally) {
      if (lines_ > dominantLines || (lines_ === dominantLines && count > dominant)) {
        dominant = count;
        dominantLines = lines_;
      }
    }
    // Pondéré par le nombre de colonnes : à régularité égale, un séparateur qui
    // découpe en 8 colonnes est plus crédible qu'un qui en découpe 2.
    const confidence = (dominantLines / sample.length) * Math.min(1, dominant / 3);
    if (confidence > best.confidence) best = { delimiter: candidate, confidence };
  }
  return best;
}

/** Analyse réelle : guillemets, guillemets échappés, retours dans un champ. */
export function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; }
        else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === delimiter) { row.push(field); field = ''; continue; }
    if (ch === '\r') {
      if (text[i + 1] === '\n') i += 1;
      row.push(field); rows.push(row); row = []; field = '';
      continue;
    }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/* -------------------------------------------------------------- en-têtes */

const SYNONYMS = {
  valueDate: ['date de valeur', 'date valeur', 'valuta', 'valutadatum', 'value date', 'valeur', 'date'],
  bookingDate: ['date de comptabilisation', 'date comptable', 'date de transaction',
    "date d operation", 'buchungsdatum', 'transaktionsdatum', 'booking date', 'posting date'],
  label: ['description', 'description 1', 'libelle', "libelle de l operation",
    'texte de comptabilisation', 'buchungstext', 'verwendungszweck', 'beschreibung',
    'details', 'motif', 'objet', 'texte', 'text'],
  debit: ['debit', 'debit chf', 'belastung', 'sortie', 'retrait', 'montant debit'],
  credit: ['credit', 'credit chf', 'gutschrift', 'entree', 'versement', 'montant credit'],
  amount: ['montant de la transaction', 'montant unique', 'montant', 'einzelbetrag', 'betrag', 'amount'],
  balance: ['solde du compte', 'solde', 'saldo', 'balance'],
  reference: ['numero de transaction', 'no de transaction', 'transaction no', 'reference', 'referenz'],
  currency: ['devise', 'wahrung', 'currency', 'monnaie', 'ccy'],
  counterparty: ["donneur d ordre", 'beneficiaire', 'contrepartie', 'auftraggeber', 'empfanger', 'payee'],
  // « Solde du compte » contient « compte » : c'est l'égalité exacte, mieux
  // notée qu'une inclusion, qui garde cette colonne sur le solde.
  account: ['numero de compte ou de carte', 'no de compte ou de carte', 'numero de compte',
    'no de compte', 'compte ou carte', 'kontonummer', 'account number', 'account', 'iban',
    'compte', 'konto'],
  direction: ['revenu ou depense', 'sens du mouvement', 'type de mouvement',
    'einnahme oder ausgabe', 'income or expense', 'sens'],
  extCat: ['categorie de la banque', 'categorie', 'kategorie', 'category'],
};

export function normHeader(header) {
  return String(header)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .trim();
}

/** Égalité notée 1, inclusion 0,7 ; à score égal, le synonyme le plus long. */
export function matchHeader(header) {
  const n = normHeader(header);
  if (!n) return null;
  let best = null;
  let bestLength = 0;
  for (const field of Object.keys(SYNONYMS)) {
    for (const synonym of SYNONYMS[field]) {
      let score = 0;
      if (n === synonym) score = 1;
      else if (new RegExp('(^| )' + synonym + '( |$)').test(n)) score = 0.7;
      else continue;
      if (!best || score > best.score || (score === best.score && synonym.length > bestLength)) {
        best = { field, score };
        bestLength = synonym.length;
      }
    }
  }
  return best;
}

const EXTRA_LABEL = /^(?:description|beschreibung|libelle|texte|text|details)\s*([2-9])$/;

export function guessMapping(headers) {
  const map = {};
  const scores = {};
  const extra = [];

  headers.forEach((header, index) => {
    if (EXTRA_LABEL.test(normHeader(header))) { extra.push(index); return; }
    const match = matchHeader(header);
    if (!match) return;
    if (scores[match.field] !== undefined && scores[match.field] >= match.score) {
      if (match.field === 'label') extra.push(index);
      return;
    }
    if (map[match.field] !== undefined && match.field === 'label') extra.push(map[match.field]);
    map[match.field] = index;
    scores[match.field] = match.score;
  });

  if (extra.length) map.labelExtra = extra.sort((a, b) => a - b);
  return map;
}

/** Les exports commencent souvent par un préambule avant le tableau. */
function findHeaderLine(rows) {
  let bestIndex = -1;
  let bestScore = 0;
  rows.slice(0, 30).forEach((row, index) => {
    if (row.length < 2) return;
    const score = row.reduce((total, cell) => {
      const m = matchHeader(cell);
      return m ? total + m.score : total;
    }, 0);
    if (score > bestScore) { bestScore = score; bestIndex = index; }
  });
  return bestScore >= 2 ? bestIndex : -1;
}

function missingFields(map) {
  const missing = [];
  if (map.valueDate === undefined && map.bookingDate === undefined) missing.push('une colonne de date');
  if (map.label === undefined) missing.push('une colonne de libellé');
  if (map.amount === undefined && map.debit === undefined && map.credit === undefined)
    missing.push('une colonne de montant (ou un couple débit / crédit)');
  return missing;
}

/* ------------------------------------------------------------------ comptes */

const IBAN_LENGTHS = { CH: 21, LI: 21, DE: 22, FR: 27, IT: 27, AT: 20, ES: 24, GB: 22, LU: 20, NL: 18, BE: 16, PT: 25 };

export function normIban(raw) {
  return raw.replace(/[\s-]/g, '').toUpperCase();
}

/** Contrôle modulo 97 : sans lui, n'importe quelle référence ferait un compte. */
export function validIban(raw) {
  const iban = normIban(raw);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  const expected = IBAN_LENGTHS[iban.slice(0, 2)];
  if (expected && iban.length !== expected) return false;

  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const value = char >= 'A' && char <= 'Z' ? String(char.charCodeAt(0) - 55) : char;
    for (const digit of value) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

export function fmtIban(iban) {
  return normIban(iban).replace(/(.{4})/g, '$1 ').trim();
}

/** `****7648` : le nombre d'astérisques varie, les quatre chiffres non. */
const MASKED_CARD = /^[*x•·\s]{2,}(\d{4})$/i;

export function accountIdentity(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;

  const card = MASKED_CARD.exec(text);
  if (card) return { key: 'CARTE-' + card[1], label: 'Carte ****' + card[1] };

  const iban = normIban(text);
  if (validIban(iban)) return { key: iban, label: fmtIban(iban) };

  const compact = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return compact ? { key: compact, label: text } : null;
}

const IBAN_CANDIDATE = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){10,32}\b/g;

function fallbackAccount(text) {
  const found = String(text).toUpperCase().match(IBAN_CANDIDATE);
  if (!found) return null;
  for (const candidate of found) {
    if (validIban(candidate)) {
      const key = normIban(candidate);
      return { key, label: fmtIban(key) };
    }
  }
  return null;
}

/* -------------------------------------------------------------------- sens */

const EXPENSE_WORDS = ['depense', 'ausgabe', 'expense', 'debit', 'sortie', 'belastung'];
const INCOME_WORDS = ['revenu', 'einnahme', 'income', 'credit', 'entree', 'gutschrift'];

/**
 * Le sens annoncé par la banque ne décide de rien : il contrôle. Le montant
 * fait foi, et la contradiction est signalée plutôt que corrigée — sur un
 * export réel, ce sont des remboursements classés « Dépense ».
 */
export function directionConflict(raw, cents) {
  if (!raw || !cents) return null;
  const n = String(raw).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const expense = EXPENSE_WORDS.some((w) => n.includes(w));
  const income = INCOME_WORDS.some((w) => n.includes(w));
  if (expense === income) return null;
  if (expense && cents > 0) return 'annoncée « ' + raw + ' » avec un montant positif';
  if (income && cents < 0) return 'annoncée « ' + raw + ' » avec un montant négatif';
  return null;
}

/* ----------------------------------------------------------------- analyse */

function cellAt(row, index) {
  return index === undefined ? '' : String(row[index] == null ? '' : row[index]).trim();
}

/**
 * Analyse un fichier et rend **un relevé par compte**.
 *
 * Un export UBS mélange comptes bancaires et cartes dans une seule colonne.
 * Sans ce groupement, les achats par carte et leur règlement atterrissent sur
 * le même compte, et les dépenses sont comptées deux fois — à l'achat, puis au
 * règlement.
 */
export function analyse(buffer, filename) {
  const { text, encoding } = decodeBytes(buffer);
  const lines = text.split(/\r\n|\n|\r/);
  const { delimiter } = detectDelimiter(lines);
  const grid = parseDelimited(text, delimiter);

  let headerLine = findHeaderLine(grid);
  if (headerLine < 0) headerLine = grid.findIndex((r) => r.some((c) => String(c).trim()));
  if (headerLine < 0) headerLine = 0;

  const headers = (grid[headerLine] || []).map((c) => String(c).trim());
  const map = guessMapping(headers);
  const missing = missingFields(map);
  if (missing.length) return { ok: false, filename, encoding, delimiter, headers, missing };

  const issues = [];
  const rows = [];
  let read = 0;

  for (let index = headerLine + 1; index < grid.length; index += 1) {
    const row = grid[index] || [];
    const line = index + 1;
    const filled = row.filter((c) => String(c).trim() !== '');
    if (!filled.length) continue;
    read += 1;

    if (filled.length < 2) {
      issues.push({ line, severity: 'avertissement', message: 'Ligne ignorée : une seule cellule renseignée.' });
      read -= 1;
      continue;
    }

    const rawDate = cellAt(row, map.valueDate) || cellAt(row, map.bookingDate);
    const date = parseDate(rawDate);
    if (!date) {
      issues.push({ line, severity: 'erreur', message: 'Date illisible : « ' + rawDate + ' ».' });
      continue;
    }

    // Colonne de montant signé, ou couple débit / crédit. Les deux remplis sur
    // la même ligne est une anomalie, pas une somme algébrique.
    let cents = null;
    const debit = cellAt(row, map.debit);
    const credit = cellAt(row, map.credit);
    if (debit && credit) {
      issues.push({ line, severity: 'erreur', message: 'Débit et crédit renseignés sur la même ligne.' });
      continue;
    } else if (debit) {
      const value = parseAmount(debit);
      if (value === null) { issues.push({ line, severity: 'erreur', message: 'Montant illisible : « ' + debit + ' ».' }); continue; }
      cents = -Math.abs(value);
    } else if (credit) {
      const value = parseAmount(credit);
      if (value === null) { issues.push({ line, severity: 'erreur', message: 'Montant illisible : « ' + credit + ' ».' }); continue; }
      cents = value;
    } else {
      const raw = cellAt(row, map.amount);
      const value = parseAmount(raw);
      if (value === null) {
        issues.push({ line, severity: 'erreur', message: raw ? 'Montant illisible : « ' + raw + ' ».' : 'Ligne sans montant.' });
        continue;
      }
      cents = value;
    }

    const parts = [cellAt(row, map.label)].concat((map.labelExtra || []).map((i) => cellAt(row, i)));
    const label = parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim() || '(sans libellé)';

    const conflict = directionConflict(cellAt(row, map.direction), cents);
    if (conflict) {
      issues.push({ line, severity: 'avertissement', message: 'Sens contradictoire : ligne ' + conflict + '. Le montant fait foi.' });
    }

    const extCat = cellAt(row, map.extCat);
    rows.push({
      line,
      date,
      cents,
      label,
      account: accountIdentity(cellAt(row, map.account)),
      counterparty: cellAt(row, map.counterparty) || null,
      extCat: extCat || null,
    });
  }

  const fallback = fallbackAccount(text);
  const groups = new Map();
  for (const r of rows) {
    const identity =
      r.account || fallback || { key: filename.replace(/\.[^.]+$/, '').toUpperCase(), label: filename };
    if (!groups.has(identity.key)) groups.set(identity.key, { key: identity.key, label: identity.label, rows: [] });
    groups.get(identity.key).rows.push(r);
  }

  const statements = [...groups.values()].map((group) => {
    // Bornes calculées, pas prises aux extrémités : un export UBS est en ordre
    // décroissant, et l'ordre du fichier ne peut pas être trié sans casser le
    // rang d'occurrence dont dépend l'empreinte.
    const dates = group.rows.map((r) => r.date);
    return {
      key: group.key,
      label: group.label,
      rows: group.rows,
      from: dates.reduce((a, b) => (a === null || b < a ? b : a), null),
      to: dates.reduce((a, b) => (a === null || b > a ? b : a), null),
      movements: group.rows.reduce((sum, r) => sum + r.cents, 0),
      opening: null,
      closing: null,
    };
  });

  return { ok: true, filename, encoding, delimiter, headers, map, read, issues, statements };
}

/** ouverture + mouvements = clôture, relevé par relevé. */
export function reconcile(statement) {
  if (statement.opening === null || statement.closing === null) return { status: 'absent', gap: 0 };
  const gap = statement.closing - (statement.opening + statement.movements);
  return { status: gap === 0 ? 'ok' : 'ko', gap };
}
