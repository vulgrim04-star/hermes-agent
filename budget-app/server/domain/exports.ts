/**
 * Export des écritures.
 *
 * Deux formats, pour deux usages : le CSV pour retravailler ailleurs, le
 * classeur Excel pour croiser et pivoter sans passer par un assistant d'import.
 *
 * Les lignes viennent de `transaction_lines` : une écriture ventilée sort en
 * autant de lignes que de découpes, ce qu'attend un tableur croisé dynamique.
 * Le total d'un export est donc le total du journal, sans double comptage.
 */

import ExcelJS from 'exceljs';

import { formatSwissDate } from '../../shared/dates.js';
import type { Owner } from '../../shared/model.js';
import type { Db } from '../db/connection.js';
import { positionsAt } from './networth.js';

export interface ExportFilters {
  from?: string;
  to?: string;
  accountId?: number;
  /** Catégorie **et ses sous-catégories** : filtrer sur une racine a un sens. */
  categoryId?: number;
  owner?: Owner;
}

export interface ExportRow {
  value_date: string;
  booking_date: string | null;
  account_label: string;
  label: string;
  counterparty: string | null;
  category_name: string | null;
  category_parent_name: string | null;
  kind: string | null;
  owner: Owner;
  amount_cents: number;
  currency: string;
  bank_reference: string | null;
  external_category: string | null;
  source: string;
  is_internal_transfer: number;
}

export function exportRows(db: Db, filters: ExportFilters = {}): ExportRow[] {
  const where: string[] = [];
  const params: (string | number)[] = [];

  if (filters.from !== undefined) {
    where.push('l.value_date >= ?');
    params.push(filters.from);
  }
  if (filters.to !== undefined) {
    where.push('l.value_date <= ?');
    params.push(filters.to);
  }
  if (filters.accountId !== undefined) {
    where.push('l.account_id = ?');
    params.push(filters.accountId);
  }
  if (filters.owner !== undefined) {
    where.push('l.owner = ?');
    params.push(filters.owner);
  }
  if (filters.categoryId !== undefined) {
    where.push('(l.category_id = ? OR c.parent_id = ?)');
    params.push(filters.categoryId, filters.categoryId);
  }

  return db
    .prepare(
      `SELECT l.value_date, t.booking_date, a.label AS account_label, l.label,
              t.counterparty, c.name AS category_name, p.name AS category_parent_name,
              c.kind, l.owner, l.amount_cents, l.currency, t.bank_reference,
              t.external_category, t.source, l.is_internal_transfer
         FROM transaction_lines l
         JOIN transactions t ON t.id = l.transaction_id
         JOIN accounts a ON a.id = l.account_id
         LEFT JOIN categories c ON c.id = l.category_id
         LEFT JOIN categories p ON p.id = c.parent_id
        ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY l.value_date DESC, l.transaction_id DESC, l.split_id`,
    )
    .all(...params) as ExportRow[];
}

const HEADERS = [
  'Date de valeur',
  'Date comptable',
  'Compte',
  'Libellé',
  'Contrepartie',
  'Catégorie',
  'Sous-catégorie',
  'Type',
  'Personne',
  'Montant',
  'Devise',
  'Référence',
  'Catégorie banque',
  'Source',
  'Transfert interne',
] as const;

const OWNER_LABELS: Record<Owner, string> = {
  p1: 'Personne 1',
  p2: 'Personne 2',
  commun: 'Commun',
};

const KIND_LABELS: Record<string, string> = {
  revenu: 'Revenu',
  depense: 'Dépense',
  epargne: 'Épargne',
};

/** Colonnes d'une ligne, dans l'ordre des en-têtes. */
function cellsOf(row: ExportRow): (string | number | null)[] {
  // La racine tient la colonne « Catégorie », la feuille la colonne
  // « Sous-catégorie » : une catégorie sans parent n'a pas de sous-catégorie.
  const parent = row.category_parent_name ?? row.category_name;
  const child = row.category_parent_name === null ? null : row.category_name;

  return [
    row.value_date,
    row.booking_date,
    row.account_label,
    row.label,
    row.counterparty,
    parent,
    child,
    row.kind === null ? null : (KIND_LABELS[row.kind] ?? row.kind),
    OWNER_LABELS[row.owner] ?? row.owner,
    row.amount_cents / 100,
    row.currency,
    row.bank_reference,
    row.external_category,
    row.source,
    row.is_internal_transfer === 1 ? 'oui' : 'non',
  ];
}

/**
 * CSV pour Excel suisse : **BOM UTF-8** et **point-virgule**.
 *
 * Sans le BOM, Excel lit le fichier en ANSI et les accents sautent ; avec la
 * virgule comme séparateur, il refuse de découper les colonnes sur une machine
 * configurée en français de Suisse. Ce n'est pas élégant, c'est ce qui s'ouvre
 * du premier coup.
 */
export function toCsv(rows: readonly ExportRow[]): Buffer {
  const lines = [HEADERS.join(';')];

  for (const row of rows) {
    lines.push(
      cellsOf(row)
        .map((cell, index) => {
          if (cell === null) return '';
          // Les dates sortent au format suisse, les montants en nombre brut :
          // un tableur reconnaît les deux sans conversion.
          if (index <= 1 && typeof cell === 'string') return formatSwissDate(cell);
          if (typeof cell === 'number') return cell.toFixed(2);
          return escapeCsv(cell);
        })
        .join(';'),
    );
  }

  return Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from(`${lines.join('\r\n')}\r\n`, 'utf8'),
  ]);
}

function escapeCsv(value: string): string {
  return /[";\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Classeur Excel à cellules typées.
 *
 * Une date exportée en texte ne se trie pas, un montant en texte ne s'additionne
 * pas : les deux sont écrits dans leur type natif, avec leur format d'affichage.
 */
export async function toXlsx(rows: readonly ExportRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Budget du ménage';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Écritures', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  sheet.columns = HEADERS.map((header, index) => ({
    header,
    key: String(index),
    width: header === 'Libellé' ? 42 : Math.max(12, header.length + 3),
  }));
  sheet.getRow(1).font = { bold: true };

  for (const row of rows) {
    const cells = cellsOf(row);
    const added = sheet.addRow(
      cells.map((cell, index) => {
        if (cell === null) return null;
        // Une date ISO devient une vraie date, à midi UTC pour qu'aucun fuseau
        // ne la fasse basculer la veille.
        if (index <= 1 && typeof cell === 'string') return new Date(`${cell}T12:00:00Z`);
        return cell;
      }),
    );
    added.getCell(1).numFmt = 'dd.mm.yyyy';
    added.getCell(2).numFmt = 'dd.mm.yyyy';
    added.getCell(10).numFmt = '#,##0.00';
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * État des positions à un mois donné, pour la déclaration de fortune.
 *
 * Le 31 décembre est la date que retient le canton ; l'export sert de pièce
 * justificative, chaque position portant l'origine de son chiffre.
 */
export async function positionsToXlsx(db: Db, period: string): Promise<Buffer> {
  const positions = positionsAt(db, period);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(`Positions ${period}`, {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  sheet.columns = [
    { header: 'Position', key: 'label', width: 32 },
    { header: 'Nature', key: 'kind', width: 16 },
    { header: 'Personne', key: 'owner', width: 14 },
    { header: 'Quantité', key: 'quantity', width: 16 },
    { header: 'Cours', key: 'price', width: 14 },
    { header: 'Valeur', key: 'value', width: 16 },
    { header: 'Origine', key: 'origin', width: 20 },
  ];
  sheet.getRow(1).font = { bold: true };

  for (const position of positions) {
    const row = sheet.addRow([
      position.label,
      position.kind,
      OWNER_LABELS[position.owner] ?? position.owner,
      position.quantityE8 === null ? null : position.quantityE8 / 100_000_000,
      position.unitPriceCents === null ? null : position.unitPriceCents / 100,
      position.valueCents === null
        ? null
        : (position.isLiability ? -Math.abs(position.valueCents) : position.valueCents) / 100,
      position.origin,
    ]);
    row.getCell(4).numFmt = '#,##0.00000000';
    row.getCell(5).numFmt = '#,##0.00';
    row.getCell(6).numFmt = '#,##0.00';
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
