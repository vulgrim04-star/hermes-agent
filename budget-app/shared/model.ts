/** Types partagés entre le serveur et l'interface. */

/** Attribution d'une écriture au sein du ménage. */
export type Owner = 'p1' | 'p2' | 'commun';

/** Type de mouvement porté par une catégorie. */
export type CategoryKind = 'revenu' | 'depense' | 'epargne';

export const OWNERS: readonly Owner[] = ['p1', 'p2', 'commun'];
export const CATEGORY_KINDS: readonly CategoryKind[] = ['revenu', 'depense', 'epargne'];

export function isOwner(value: unknown): value is Owner {
  return typeof value === 'string' && (OWNERS as readonly string[]).includes(value);
}
