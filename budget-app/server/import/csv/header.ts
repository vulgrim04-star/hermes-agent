/**
 * Reconnaissance des colonnes d'un export CSV.
 *
 * Rien n'est codé en dur sur la position des colonnes : on lit les en-têtes et
 * on les rapproche d'un dictionnaire de synonymes (français, allemand, anglais
 * — les trois langues dans lesquelles UBS exporte). Ce qui n'est pas reconnu
 * part vers l'écran de mapping manuel, dont le résultat est mémorisé.
 */

import { createHash } from 'node:crypto';

import type { CanonicalField, ColumnMapping } from '../types.js';

/** Minuscules, sans diacritiques, sans ponctuation, espaces compactés. */
export function normalizeHeader(header: string): string {
  return header
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .trim();
}

/**
 * Synonymes par champ. L'ordre compte peu — le rapprochement privilégie le
 * synonyme le plus long, pour que « date de valeur » l'emporte sur « date ».
 */
const SYNONYMS: Record<CanonicalField, readonly string[]> = {
  valueDate: [
    'date de valeur',
    'date valeur',
    'valuta',
    'valutadatum',
    'value date',
    'valeur',
    'date',
  ],
  bookingDate: [
    'date de comptabilisation',
    'date comptable',
    'date de transaction',
    'date d operation',
    'date operation',
    'buchungsdatum',
    'transaktionsdatum',
    'booking date',
    'trade date',
    'posting date',
  ],
  label: [
    'description',
    'description 1',
    'libelle',
    'libelle de l operation',
    'texte de comptabilisation',
    'buchungstext',
    'verwendungszweck',
    'beschreibung',
    'details',
    'motif',
    'objet',
    'texte',
    'text',
  ],
  debit: ['debit', 'debit chf', 'belastung', 'sortie', 'retrait', 'montant debit'],
  credit: ['credit', 'credit chf', 'gutschrift', 'entree', 'versement', 'montant credit'],
  amount: [
    'montant de la transaction',
    'montant unique',
    'montant',
    'einzelbetrag',
    'betrag',
    'amount',
  ],
  balance: ['solde du compte', 'solde', 'saldo', 'balance'],
  reference: [
    'numero de transaction',
    'no de transaction',
    'transaktions nr',
    'transaction no',
    'numero d ordre',
    'reference',
    'referenz',
  ],
  currency: ['devise', 'wahrung', 'currency', 'monnaie', 'ccy'],
  counterparty: [
    'donneur d ordre',
    'beneficiaire',
    'contrepartie',
    'auftraggeber',
    'empfanger',
    'counterparty',
    'payee',
  ],
  // « Solde du compte » contient « compte » : c'est le rapprochement par le
  // synonyme le plus long, à égalité de score, qui garde cette colonne sur
  // `balance` — et l'égalité exacte, mieux notée qu'une inclusion, la protège.
  account: [
    'numero de compte ou de carte',
    'no de compte ou de carte',
    'numero de compte',
    'no de compte',
    'compte ou carte',
    'kontonummer',
    'konto nr',
    'account number',
    'account',
    'iban',
    'compte',
    'konto',
  ],
  direction: [
    'revenu ou depense',
    'sens du mouvement',
    'type de mouvement',
    'einnahme oder ausgabe',
    'income or expense',
    'sens',
  ],
  externalCategory: ['categorie de la banque', 'categorie', 'kategorie', 'category'],
};

interface FieldMatch {
  field: CanonicalField;
  score: number;
}

/** Colonnes de description numérotées au-delà de la première : Description2, Beschreibung 3… */
const EXTRA_LABEL = /^(?:description|beschreibung|libelle|texte|text|details)\s*([2-9])$/;

/**
 * Rapproche un en-tête d'un champ canonique.
 * Score 1 pour une égalité, 0,7 pour une inclusion — le seuil d'inclusion
 * permet de reconnaître « Débit CHF » ou « Montant (CHF) » sans les énumérer.
 */
export function matchHeader(header: string): FieldMatch | null {
  const normalized = normalizeHeader(header);
  if (normalized === '') return null;

  let best: FieldMatch | null = null;
  let bestLength = 0;

  for (const [field, synonyms] of Object.entries(SYNONYMS) as [
    CanonicalField,
    readonly string[],
  ][]) {
    for (const synonym of synonyms) {
      let score = 0;
      if (normalized === synonym) score = 1;
      else if (new RegExp(`(^| )${synonym}( |$)`).test(normalized)) score = 0.7;
      else continue;

      const better =
        best === null || score > best.score || (score === best.score && synonym.length > bestLength);
      if (better) {
        best = { field, score };
        bestLength = synonym.length;
      }
    }
  }

  return best;
}

export interface MappingGuess {
  mapping: ColumnMapping;
  /** Champs canoniques suggérés, colonne par colonne. */
  suggestions: (CanonicalField | null)[];
  /** Ce qui empêche de lire le fichier sans intervention. */
  missing: string[];
}

/** Un mapping est exploitable s'il porte une date, un libellé et un montant. */
export function missingRequirements(mapping: ColumnMapping): string[] {
  const missing: string[] = [];
  if (mapping.valueDate === undefined && mapping.bookingDate === undefined) {
    missing.push('une colonne de date');
  }
  if (mapping.label === undefined) missing.push('une colonne de libellé');
  if (mapping.amount === undefined && mapping.debit === undefined && mapping.credit === undefined) {
    missing.push('une colonne de montant (ou un couple débit / crédit)');
  }
  return missing;
}

export function guessMapping(headers: readonly string[]): MappingGuess {
  const mapping: ColumnMapping = {};
  const suggestions: (CanonicalField | null)[] = headers.map(() => null);
  const scores = new Map<CanonicalField, number>();
  const labelExtra: number[] = [];

  headers.forEach((header, index) => {
    const normalized = normalizeHeader(header);
    if (EXTRA_LABEL.test(normalized)) {
      // Description2/3 : complément de libellé, jamais le libellé principal.
      labelExtra.push(index);
      suggestions[index] = 'label';
      return;
    }

    const match = matchHeader(header);
    if (match === null) return;

    const previousScore = scores.get(match.field);
    if (previousScore !== undefined && previousScore >= match.score) {
      // Une autre colonne revendique déjà ce champ avec un meilleur score.
      if (match.field === 'label') labelExtra.push(index);
      return;
    }

    const previousIndex = mapping[match.field];
    if (previousIndex !== undefined) {
      suggestions[previousIndex] = null;
      if (match.field === 'label') labelExtra.push(previousIndex);
    }

    mapping[match.field] = index;
    suggestions[index] = match.field;
    scores.set(match.field, match.score);
  });

  if (labelExtra.length > 0) mapping.labelExtra = labelExtra.sort((a, b) => a - b);

  return { mapping, suggestions, missing: missingRequirements(mapping) };
}

/**
 * Repère la ligne d'en-tête : les exports UBS commencent par un préambule
 * (titulaire, IBAN, période) avant le tableau. On retient la première ligne
 * dont au moins deux cellules ressemblent à des en-têtes connus.
 */
export function findHeaderLine(rows: readonly (readonly string[])[], limit = 30): number {
  let bestIndex = -1;
  let bestScore = 0;

  rows.slice(0, limit).forEach((row, index) => {
    if (row.length < 2) return;
    const score = row.reduce((total, cell) => {
      const match = matchHeader(cell);
      return match === null ? total : total + match.score;
    }, 0);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  return bestScore >= 2 ? bestIndex : -1;
}

/** Empreinte d'un format d'export : en-têtes normalisés + séparateur. */
export function signatureOf(headers: readonly string[], delimiter: string): string {
  const payload = headers.map(normalizeHeader).join('|') + `#${delimiter}`;
  return createHash('sha256').update(payload, 'utf8').digest('hex').slice(0, 32);
}
