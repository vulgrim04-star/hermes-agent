/**
 * Parseur MT940.
 *
 * Un relevé s'ouvre sur `:20:` et se referme sur `:62F:`. Entre les deux,
 * chaque `:61:` porte un mouvement et le `:86:` qui la suit en donne le
 * libellé. Le contrôle `:60F:` + somme des mouvements = `:62F:` se calcule par
 * relevé, en centimes entiers : il tombe juste ou il ne tombe pas, il n'y a pas
 * de tolérance à accorder.
 *
 * Contrairement au CSV, un MT940 **porte ses soldes** : le rapprochement s'y
 * exécute sans rien saisir.
 */

import { parseAmount } from './money.js';
import { accountIdentity, decodeBytes } from './csv.js';

/* -------------------------------------------------------------- découpage */

const FIELD_START = /^:(\d{2}[A-Z]?):(.*)$/;
const ENVELOPE_PREFIX = /^\{\d:[^}]*\}/;

/** Retire l'enveloppe SWIFT quand elle est présente. */
function stripEnvelope(line) {
  let text = line;
  let previous;
  do {
    previous = text;
    text = text.replace(ENVELOPE_PREFIX, '');
  } while (text !== previous);
  // `{4:` ouvre le bloc de texte, `-}` le ferme : ni l'un ni l'autre n'est un champ.
  return text.replace(/^\{4:\s*$/, '').replace(/^-\}\s*$/, '');
}

/**
 * Une ligne qui ne commence pas par `:` **prolonge le champ précédent** —
 * c'est ainsi que les libellés s'étalent sur plusieurs lignes. Perdre ce
 * rattachement, c'est perdre la moitié des libellés, silencieusement.
 */
export function tokenize(text) {
  const blocks = [];
  const stray = [];
  let current = null;
  let field = null;

  text.split(/\r\n|\n|\r/).forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = stripEnvelope(rawLine.replace(/\s+$/, ''));
    if (line === '' || line === '-') return;

    const match = FIELD_START.exec(line);
    if (!match) {
      if (!field) { stray.push({ lines: [line], lineNumber }); return; }
      field.lines.push(line);
      return;
    }

    field = { tag: match[1], lines: [match[2]], lineNumber };
    if (match[1] === '20' || current === null) {
      current = { fields: [] };
      blocks.push(current);
    }
    current.fields.push(field);
  });

  return { blocks, stray };
}

/* ------------------------------------------------------------------ champs */

/**
 * `:61:` — `6!n[4!n]2a[1!a]15d1!a3!c16x[//16x]` : date de valeur AAMMJJ, date
 * comptable MMJJ, sens, code fonds, montant, code opération, références.
 */
const ENTRY_LINE = /^(\d{6})(\d{4})?(RC|RD|CR|DR|C|D)([A-Z])?([\d,.]+)([A-Z][A-Z0-9]{3})(.*)$/;

/**
 * `RC` et `RD` sont des extournes : elles inversent le mouvement qu'elles
 * annulent, une extourne de crédit sort donc de l'argent.
 */
function signOf(mark) {
  return mark === 'C' || mark === 'CR' || mark === 'RD' ? 1 : -1;
}

function expandYear(two, ref = new Date().getUTCFullYear()) {
  const century = Math.floor(ref / 100) * 100;
  const candidate = century + two;
  return candidate > ref + 1 ? candidate - 100 : candidate;
}

function isoOf(y, m, d) {
  const iso = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return m >= 1 && m <= 12 && d >= 1 && d <= last ? iso : null;
}

export function parseMt940Date(raw) {
  if (!/^\d{6}$/.test(raw)) return null;
  return isoOf(expandYear(Number(raw.slice(0, 2))), Number(raw.slice(2, 4)), Number(raw.slice(4, 6)));
}

/**
 * `:61:` porte la date comptable sans année. Autour du 1er janvier, une
 * écriture comptabilisée le 31.12 et valorisée le 02.01 appartient à l'année
 * précédente — et inversement.
 */
export function parseEntryDate(raw, valueDateIso) {
  if (!/^\d{4}$/.test(raw)) return null;
  const valueYear = Number(valueDateIso.slice(0, 4));
  const valueMonth = Number(valueDateIso.slice(5, 7));
  const month = Number(raw.slice(0, 2));
  const day = Number(raw.slice(2, 4));

  let year = valueYear;
  if (month === 12 && valueMonth === 1) year = valueYear - 1;
  else if (month === 1 && valueMonth === 12) year = valueYear + 1;
  return isoOf(year, month, day);
}

export function parseEntryLine(value) {
  const match = ENTRY_LINE.exec(value.trim());
  if (!match) return null;

  const [, rawValueDate, rawBookingDate, mark, , rawAmount, transactionType, rest] = match;
  const valueDate = parseMt940Date(rawValueDate);
  if (!valueDate) return null;

  // Le MT940 impose la virgule décimale : l'imposer évite qu'un « 1.234,56 »
  // soit lu à l'envers.
  const magnitude = parseAmount(rawAmount, ',');
  if (magnitude === null) return null;

  const bookingDate = rawBookingDate === undefined ? null : parseEntryDate(rawBookingDate, valueDate);
  const remainder = (rest || '').trim();
  const separator = remainder.indexOf('//');
  const customer = (separator < 0 ? remainder : remainder.slice(0, separator)).trim();
  const after = separator < 0 ? '' : remainder.slice(separator + 2).trim();

  return {
    valueDate,
    bookingDate: bookingDate === valueDate ? null : bookingDate,
    amountCents: signOf(mark) * Math.abs(magnitude),
    transactionType,
    customerReference: customer === '' || customer === 'NONREF' ? null : customer,
    bankReference: after === '' ? null : after.slice(0, 16),
  };
}

/** `:60F:` / `:62F:` — `1!a6!n3!a15d`, le sens portant sur le solde. */
export function parseBalanceLine(value) {
  const match = /^([CD])(\d{6})([A-Z]{3})([\d,.]+)$/.exec(value.trim());
  if (!match) return null;
  const date = parseMt940Date(match[2]);
  const magnitude = parseAmount(match[4], ',');
  if (date === null || magnitude === null) return null;
  return {
    date,
    currency: match[3],
    amountCents: (match[1] === 'D' ? -1 : 1) * Math.abs(magnitude),
  };
}

const STRUCTURED = /\?(\d{2})([^?]*)/g;
const collapse = (t) => t.replace(/\s+/g, ' ').trim();

/**
 * `:86:` — deux formes coexistent : le texte libre (usage courant en Suisse)
 * et la forme structurée en sous-champs `?20?21…`. La seconde se reconnaît à
 * ses marqueurs et se déplie ; sinon les lignes sont recollées.
 */
export function parseNarrative(lines) {
  const joined = lines.join('\n');
  if (!/\?\d{2}/.test(joined)) return { label: collapse(lines.join(' ')), counterparty: null };

  const purpose = [];
  const counterparty = [];
  for (const [, code, content] of joined.replace(/\n/g, '').matchAll(STRUCTURED)) {
    const key = Number(code);
    const text = (content || '').trim();
    if (!text) continue;
    if (key >= 20 && key <= 29) purpose.push(text);
    else if (key === 32 || key === 33) counterparty.push(text);
    else if (key === 0) purpose.unshift(text);
  }
  return {
    label: collapse(purpose.join(' ')),
    counterparty: counterparty.length ? collapse(counterparty.join(' ')) : null,
  };
}

/* ----------------------------------------------------------------- relevés */

const KNOWN_TAGS = new Set(['20', '21', '25', '28', '28C', '60F', '60M', '61', '86', '62F', '62M', '64', '65', '86S']);

function readStatement(fields, issues) {
  let reference = null;
  let accountRaw = null;
  let opening = null;
  let closing = null;

  // Une opération illisible garde sa place : le `:86:` qui la suit s'y
  // rattache et disparaît avec elle, au lieu d'aller grossir le libellé de
  // l'écriture précédente.
  const entries = [];
  let read = 0;

  for (const field of fields) {
    const value = field.lines.join(' ').trim();
    const flag = (message, severity = 'erreur') => issues.push({ line: field.lineNumber, severity, message });

    switch (field.tag) {
      case '20':
        reference = value || null;
        break;
      case '25':
        accountRaw = value;
        break;
      case '60F':
      case '60M': {
        const balance = parseBalanceLine(value);
        if (!balance) { flag('Solde d’ouverture illisible.'); break; }
        // Un relevé fractionné répète le solde intermédiaire : seul le premier
        // rencontré fait foi comme ouverture.
        if (opening === null) opening = balance;
        break;
      }
      case '62F':
      case '62M': {
        const balance = parseBalanceLine(value);
        if (!balance) { flag('Solde de clôture illisible.'); break; }
        closing = balance;
        break;
      }
      case '61': {
        read += 1;
        const entry = parseEntryLine(field.lines[0] || '');
        if (!entry) flag('Ligne d’opération :61: illisible.');
        const extra = field.lines.slice(1).join(' ').trim();
        entries.push({ entry, lineNumber: field.lineNumber, narrative: extra ? [extra] : [] });
        break;
      }
      case '86': {
        const target = entries[entries.length - 1];
        if (!target) { flag('Libellé :86: sans opération :61: qui le précède.', 'avertissement'); break; }
        target.narrative.push(...field.lines);
        break;
      }
      default:
        if (!KNOWN_TAGS.has(field.tag)) flag(`Champ :${field.tag}: non reconnu, ignoré.`, 'avertissement');
    }
  }

  if (reference === null && entries.length === 0) return null;

  const rows = [];
  for (const { entry, narrative } of entries) {
    if (!entry) continue;
    const parsed = parseNarrative(narrative);
    rows.push({
      line: null,
      date: entry.valueDate,
      cents: entry.amountCents,
      label: parsed.label || entry.transactionType,
      account: null,
      counterparty: parsed.counterparty,
      extCat: null,
    });
  }

  const identity = accountRaw ? accountIdentity(accountRaw) : null;
  const dates = rows.map((r) => r.date);

  return {
    read,
    statement: {
      key: identity ? identity.key : reference || 'MT940',
      label: identity ? identity.label : `Relevé ${reference || 'MT940'}`,
      rows,
      from: dates.reduce((a, b) => (a === null || b < a ? b : a), null),
      to: dates.reduce((a, b) => (a === null || b > a ? b : a), null),
      movements: rows.reduce((sum, r) => sum + r.cents, 0),
      // Le MT940 porte ses soldes : le contrôle s'exécute sans rien saisir.
      opening: opening ? opening.amountCents : null,
      closing: closing ? closing.amountCents : null,
    },
  };
}

export function analyseMt940(buffer, filename) {
  const { text, encoding } = decodeBytes(buffer);
  const { blocks, stray } = tokenize(text);

  const issues = stray.map((s) => ({
    line: s.lineNumber,
    severity: 'avertissement',
    message: 'Ligne hors champ, ignorée.',
  }));

  const statements = [];
  let read = 0;
  for (const block of blocks) {
    const result = readStatement(block.fields, issues);
    if (!result) continue;
    read += result.read;
    statements.push(result.statement);
  }

  if (statements.length === 0) {
    return {
      ok: false,
      filename,
      encoding,
      delimiter: '—',
      headers: [],
      missing: ["un relevé exploitable : aucun champ :20: suivi d'écritures"],
    };
  }

  return { ok: true, filename, encoding, delimiter: '—', headers: [], map: {}, read, issues, statements };
}

/**
 * Détection du format sur le **contenu**, pas sur l'extension : un MT940
 * s'appelle volontiers `.txt`, et un CSV renommé `.sta` reste un CSV.
 */
export function looksLikeMt940(text) {
  const head = text.slice(0, 4000);
  return /(^|\n)\s*:20:/.test(head) || /(^|\n)\s*:61:/.test(head) || /\{4:/.test(head);
}
