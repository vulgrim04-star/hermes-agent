/**
 * Correspondance entre les catégories de la banque et celles du ménage.
 *
 * Elle s'applique **après** les règles de l'utilisateur, jamais avant : ce que
 * l'utilisateur a écrit prime sur ce que la banque propose. Comme les règles,
 * elle ne comble que les vides — une catégorie posée à la main ou une écriture
 * déjà ventilée ne sont pas touchées.
 *
 * Un libellé laissé sans correspondance ne classe rien : l'écriture remonte
 * dans la file de révision, ce qui est le comportement recherché. Une catégorie
 * fausse ne remonterait nulle part.
 */

import type { Db } from '../db/connection.js';
import { normalizeLabel } from './fingerprint.js';

export type TreatAs = 'categorie' | 'transfert-interne' | 'ignorer';

export interface ExternalMapping {
  id: number;
  source: string;
  external_label: string;
  external_normalized: string;
  category_id: number | null;
  category_name: string | null;
  category_parent_name: string | null;
  treat_as: TreatAs;
  /** Écritures portant ce libellé, toutes périodes confondues. */
  transaction_count: number;
  /** Parmi elles, celles qui n'ont toujours pas de catégorie. */
  uncategorised_count: number;
}

export interface ApplyOutcome {
  /** Écritures classées par la correspondance. */
  categorised: number;
  /** Écritures marquées comme candidates à un transfert interne. */
  flaggedAsTransfer: number;
}

/**
 * Applique la correspondance à un ensemble d'écritures.
 *
 * Sans identifiants, elle s'applique à toutes les écritures non catégorisées —
 * c'est le bouton « appliquer rétroactivement » des réglages.
 */
export function applyExternalCategories(db: Db, transactionIds?: readonly number[]): ApplyOutcome {
  const scope = transactionIds === undefined ? null : new Set(transactionIds);
  if (scope !== null && scope.size === 0) return { categorised: 0, flaggedAsTransfer: 0 };

  const mappings = db
    .prepare(
      `SELECT external_normalized, category_id, treat_as
         FROM external_category_map
        WHERE category_id IS NOT NULL OR treat_as <> 'categorie'`,
    )
    .all() as { external_normalized: string; category_id: number | null; treat_as: TreatAs }[];
  if (mappings.length === 0) return { categorised: 0, flaggedAsTransfer: 0 };

  const byLabel = new Map(mappings.map((row) => [row.external_normalized, row]));

  // Ne sont candidates que les écritures sans catégorie et sans découpe : la
  // correspondance comble les vides, elle ne réécrit rien.
  const candidates = db
    .prepare(
      `SELECT t.id, t.external_category
         FROM transactions t
        WHERE t.category_id IS NULL
          AND t.external_category IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id = t.id)`,
    )
    .all() as { id: number; external_category: string }[];

  const setCategory = db.prepare('UPDATE transactions SET category_id = ? WHERE id = ?');
  let categorised = 0;
  let flaggedAsTransfer = 0;

  db.transaction(() => {
    for (const candidate of candidates) {
      if (scope !== null && !scope.has(candidate.id)) continue;

      const mapping = byLabel.get(normalizeLabel(candidate.external_category));
      if (mapping === undefined) continue;

      if (mapping.treat_as === 'transfert-interne') {
        // Rien n'est catégorisé : la paire sera proposée par la détection de
        // transferts, et confirmée par l'utilisateur. Compter ici sert au rapport.
        flaggedAsTransfer += 1;
        continue;
      }
      if (mapping.treat_as === 'ignorer' || mapping.category_id === null) continue;

      setCategory.run(mapping.category_id, candidate.id);
      categorised += 1;
    }
  })();

  return { categorised, flaggedAsTransfer };
}

/**
 * Table de correspondance telle qu'elle s'affiche : les libellés connus et ceux
 * rencontrés à l'import sans correspondance, avec ce qu'ils pèsent.
 */
export function listExternalCategories(db: Db): ExternalMapping[] {
  return db
    .prepare(
      `WITH rencontres AS (
         SELECT external_category AS label,
                COUNT(*)          AS total,
                SUM(CASE WHEN category_id IS NULL THEN 1 ELSE 0 END) AS sans_categorie
           FROM transactions
          WHERE external_category IS NOT NULL AND external_category <> ''
          GROUP BY external_category
       )
       SELECT m.id, m.source, m.external_label, m.external_normalized,
              m.category_id, m.treat_as,
              c.name  AS category_name,
              p.name  AS category_parent_name,
              COALESCE(r.total, 0)          AS transaction_count,
              COALESCE(r.sans_categorie, 0) AS uncategorised_count
         FROM external_category_map m
         LEFT JOIN categories c ON c.id = m.category_id
         LEFT JOIN categories p ON p.id = c.parent_id
         LEFT JOIN rencontres r ON r.label = m.external_label

       UNION ALL

       -- Libellés rencontrés que la table ne connaît pas encore : ils doivent
       -- se voir, sans quoi ils resteraient un angle mort de la catégorisation.
       SELECT NULL, 'ubs', r.label, r.label, NULL, 'categorie', NULL, NULL,
              r.total, r.sans_categorie
         FROM rencontres r
        WHERE NOT EXISTS (
          SELECT 1 FROM external_category_map m WHERE m.external_label = r.label
        )
       ORDER BY transaction_count DESC, external_label`,
    )
    .all() as ExternalMapping[];
}

export interface MappingInput {
  externalLabel: string;
  categoryId: number | null;
  treatAs: TreatAs;
}

/** Crée ou met à jour une correspondance. */
export function saveExternalCategory(db: Db, input: MappingInput): void {
  db.prepare(
    `INSERT INTO external_category_map (source, external_label, external_normalized, category_id, treat_as)
     VALUES ('ubs', ?, ?, ?, ?)
     ON CONFLICT (source, external_normalized) DO UPDATE SET
       external_label = excluded.external_label,
       category_id    = excluded.category_id,
       treat_as       = excluded.treat_as`,
  ).run(
    input.externalLabel,
    normalizeLabel(input.externalLabel),
    input.categoryId,
    input.treatAs,
  );
}
