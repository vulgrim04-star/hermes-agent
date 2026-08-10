/**
 * Pilier 3a : versements de l'année et reste à verser.
 *
 * Le plafond change chaque année et n'est publié qu'en fin d'année précédente.
 * Il **ne se devine pas** : tant qu'il n'est pas saisi, l'état le dit et aucun
 * « reste à verser » n'est affiché. Un chiffre inventé sur une déduction
 * fiscale ne vaut pas mieux que pas de chiffre du tout.
 *
 * Les versements sont lus sur la vue `transaction_lines`, donc la part 3a d'une
 * écriture ventilée est comptée correctement.
 */

import { OWNERS } from '../../shared/model.js';
import type { Owner } from '../../shared/model.js';
import type { Db } from '../db/connection.js';

export interface Pillar3aPerson {
  owner: Owner;
  paidCents: number;
  /** `null` tant que le plafond de l'année n'est pas renseigné. */
  remainingCents: number | null;
}

export interface Pillar3aStatus {
  year: number;
  /** `null` si l'année n'est pas paramétrée. */
  ceilingCents: number | null;
  paidCents: number;
  perPerson: Pillar3aPerson[];
  /** Jours restants avant le 31 décembre ; 0 si l'année est passée. */
  daysLeft: number;
  message: string | null;
}

export function pillar3aStatus(db: Db, year: number, today = new Date()): Pillar3aStatus {
  const ceiling = db
    .prepare('SELECT pillar3a_ceiling_cents AS cents FROM tax_parameters WHERE year = ?')
    .get(year) as { cents: number | null } | undefined;
  const ceilingCents = ceiling?.cents ?? null;

  const rows = db
    .prepare(
      `SELECT l.owner AS owner, COALESCE(SUM(-l.amount_cents), 0) AS cents
         FROM transaction_lines l
         JOIN categories c ON c.id = l.category_id
        WHERE c.name = 'Pilier 3a'
          AND l.value_date BETWEEN ? AND ?
          AND l.is_internal_transfer = 0
        GROUP BY l.owner`,
    )
    .all(`${year}-01-01`, `${year}-12-31`) as { owner: Owner; cents: number }[];

  const paidByOwner = new Map(rows.map((row) => [row.owner, row.cents]));
  const perPerson = OWNERS.map((owner): Pillar3aPerson => {
    const paidCents = paidByOwner.get(owner) ?? 0;
    return {
      owner,
      paidCents,
      // Le plafond est individuel : chacun a le sien, et un versement « commun »
      // est rapporté au même plafond faute de savoir à qui l'attribuer.
      remainingCents: ceilingCents === null ? null : Math.max(0, ceilingCents - paidCents),
    };
  }).filter((person) => person.paidCents !== 0 || person.owner !== 'commun');

  return {
    year,
    ceilingCents,
    paidCents: rows.reduce((sum, row) => sum + row.cents, 0),
    perPerson,
    daysLeft: daysUntilYearEnd(year, today),
    message:
      ceilingCents === null
        ? `Le plafond 3a ${year} n'est pas renseigné : le reste à verser ne peut pas être calculé. Saisissez-le dans les réglages.`
        : null,
  };
}

function daysUntilYearEnd(year: number, today: Date): number {
  const end = Date.UTC(year, 11, 31);
  const now = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.max(0, Math.round((end - now) / 86_400_000));
}

/** Plafonds connus, du plus récent au plus ancien. */
export function taxParameters(db: Db): { year: number; ceilingCents: number | null; notes: string | null }[] {
  return (
    db
      .prepare(
        'SELECT year, pillar3a_ceiling_cents AS ceilingCents, notes FROM tax_parameters ORDER BY year DESC',
      )
      .all() as { year: number; ceilingCents: number | null; notes: string | null }[]
  );
}

export function setPillar3aCeiling(db: Db, year: number, ceilingCents: number | null): void {
  db.prepare(
    `INSERT INTO tax_parameters (year, pillar3a_ceiling_cents)
     VALUES (?, ?)
     ON CONFLICT (year) DO UPDATE SET pillar3a_ceiling_cents = excluded.pillar3a_ceiling_cents`,
  ).run(year, ceilingCents);
}
