/**
 * Vocabulaire commun aux deux parseurs.
 *
 * Un parseur ne touche jamais la base : il rend un `ParseResult` inerte, que le
 * pipeline dédoublonne, rapproche et persiste. Cette séparation est ce qui rend
 * les parseurs testables sur des échantillons sans monter une base.
 */

export type ImportFormat = 'csv' | 'mt940';

export interface ParsedTransaction {
  /** Ligne d'origine dans le fichier, pour pouvoir y retourner en cas de doute. */
  lineNumber: number | null;
  /** Date de valeur, ISO `AAAA-MM-JJ`. */
  valueDate: string;
  /** Date comptable si le format la porte. */
  bookingDate: string | null;
  /** Montant signé en centimes : débit négatif, crédit positif. */
  amountCents: number;
  currency: string;
  label: string;
  counterparty: string | null;
  bankReference: string | null;
  /** Solde après écriture tel qu'il figure dans le fichier, si présent. */
  runningBalanceCents: number | null;
}

export interface ParseIssue {
  lineNumber: number | null;
  severity: 'erreur' | 'avertissement';
  message: string;
  raw: string | null;
}

export interface ParsedStatement {
  /** IBAN normalisé lu dans le fichier, `null` si le format ne le porte pas. */
  accountKey: string | null;
  currency: string;
  statementReference: string | null;
  openingBalanceCents: number | null;
  closingBalanceCents: number | null;
  openingDate: string | null;
  closingDate: string | null;
  transactions: ParsedTransaction[];
}

export interface ParseResult {
  format: ImportFormat;
  /** Lignes de mouvement lues, réussies ou non — pas les lignes du fichier. */
  rowsRead: number;
  statements: ParsedStatement[];
  issues: ParseIssue[];
  /** Renseignements propres au CSV, affichés dans l'écran de diagnostic. */
  csv?: CsvDiagnostics;
}

export interface CsvDiagnostics {
  encoding: string;
  delimiter: string;
  /** Index 0 de la ligne d'en-tête dans le fichier (préambule UBS compris). */
  headerLine: number;
  headers: string[];
  signature: string;
  mapping: ColumnMapping;
  /** Vrai si le fichier était en ordre décroissant et a été remis dans l'ordre. */
  reversed: boolean;
}

/** Champs canoniques auxquels une colonne de fichier peut être associée. */
export const CANONICAL_FIELDS = [
  'valueDate',
  'bookingDate',
  'label',
  'debit',
  'credit',
  'amount',
  'balance',
  'reference',
  'currency',
  'counterparty',
] as const;

export type CanonicalField = (typeof CANONICAL_FIELDS)[number];

/**
 * Association colonne → champ, par index de colonne.
 * `labelExtra` recueille les colonnes de description supplémentaires
 * (UBS exporte volontiers `Description1`, `Description2`, `Description3`),
 * concaténées au libellé principal.
 */
export type ColumnMapping = Partial<Record<CanonicalField, number>> & {
  labelExtra?: number[];
};

export interface ColumnSample {
  index: number;
  header: string;
  /** Quelques valeurs réelles, pour que le mapping manuel se fasse à vue. */
  samples: string[];
  suggested: CanonicalField | null;
}

/** Le fichier CSV n'a pas été reconnu : l'utilisateur doit mapper les colonnes. */
export interface MappingRequired {
  kind: 'mapping-requis';
  encoding: string;
  delimiter: string;
  headerLine: number;
  headers: string[];
  signature: string;
  columns: ColumnSample[];
  /** Ce que la détection a cru comprendre — pré-remplit l'écran de mapping. */
  suggestion: ColumnMapping;
  /** Ce qui manque pour pouvoir lire le fichier. */
  missing: string[];
}

export type CsvOutcome = MappingRequired | { kind: 'analyse'; result: ParseResult };
