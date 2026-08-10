/**
 * Identité d'un compte telle qu'elle figure dans un fichier de la banque.
 *
 * Un export UBS ne contient pas que des IBAN : la colonne « Numéro de compte ou
 * de carte » mélange les comptes bancaires et les cartes, ces dernières
 * désignées par leurs quatre derniers chiffres (`****7648`). Les deux doivent
 * donner une clé stable — c'est elle qui rattache une écriture à un compte et
 * qui entre dans l'empreinte de déduplication — et un libellé lisible, parce
 * qu'« IBAN brut » n'est pas un nom de compte pour qui tient les comptes.
 */

import { formatIban, isValidIban, normalizeIban } from './iban.js';

export type AccountKind = 'iban' | 'carte' | 'autre';

export interface AccountIdentity {
  /** Clé stable, réémise à l'identique par la banque à chaque export. */
  key: string;
  kind: AccountKind;
  /** Libellé proposé à la création du compte. */
  label: string;
}

/** `****7648`, `**** 7648`, `xxxx7648` — les masques de carte rencontrés. */
const MASKED_CARD = /^[*x•·\s]{2,}(\d{4})$/i;

export function normalizeAccountKey(raw: string): AccountIdentity | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  const card = MASKED_CARD.exec(trimmed);
  if (card !== null) {
    const digits = card[1]!;
    // La clé ne reprend pas les astérisques : leur nombre varie d'un export à
    // l'autre, alors que les quatre chiffres, eux, ne bougent pas.
    return { key: `CARTE-${digits}`, kind: 'carte', label: `Carte ****${digits}` };
  }

  const iban = normalizeIban(trimmed);
  if (isValidIban(iban)) return { key: iban, kind: 'iban', label: formatIban(iban) };

  // Les diacritiques sont dépliés avant d'être écartés : sans quoi « épargne »
  // perdrait son « é » et donnerait la même clé que « pargne ».
  const compact = trimmed
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (compact === '') return null;
  return { key: compact, kind: 'autre', label: trimmed };
}
