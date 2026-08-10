/**
 * Reconnaissance de l'IBAN dans un fichier.
 *
 * Le CSV UBS ne porte pas l'IBAN dans une colonne : il figure dans le préambule
 * qui précède le tableau. On le cherche donc dans tout le texte, et on le valide
 * par la clé modulo 97 — sans quoi n'importe quelle référence alphanumérique
 * ferait un faux positif et rattacherait les écritures au mauvais compte.
 */

const IBAN_CANDIDATE = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){10,32}\b/g;

/** Longueur officielle de l'IBAN par pays, pour les pays qu'un ménage suisse croise. */
const IBAN_LENGTHS: Record<string, number> = {
  CH: 21,
  LI: 21,
  DE: 22,
  FR: 27,
  IT: 27,
  AT: 20,
  ES: 24,
  GB: 22,
  LU: 20,
  NL: 18,
  BE: 16,
  PT: 25,
};

export function normalizeIban(raw: string): string {
  return raw.replace(/[\s-]/g, '').toUpperCase();
}

/** Contrôle modulo 97 (ISO 13616) : reste attendu de 1. */
export function isValidIban(raw: string): boolean {
  const iban = normalizeIban(raw);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;

  const expectedLength = IBAN_LENGTHS[iban.slice(0, 2)];
  if (expectedLength !== undefined && iban.length !== expectedLength) return false;

  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const value = char >= 'A' && char <= 'Z' ? String(char.charCodeAt(0) - 55) : char;
    for (const digit of value) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder === 1;
}

/** Premier IBAN valide rencontré dans le texte, `null` s'il n'y en a pas. */
export function findIban(text: string): string | null {
  const matches = text.toUpperCase().match(IBAN_CANDIDATE);
  if (matches === null) return null;
  for (const candidate of matches) {
    const normalized = normalizeIban(candidate);
    if (isValidIban(normalized)) return normalized;
  }
  return null;
}

/** `CH9300762011623852957` → `CH93 0076 2011 6238 5295 7`, pour l'affichage. */
export function formatIban(iban: string): string {
  return normalizeIban(iban).replace(/(.{4})/g, '$1 ').trim();
}
