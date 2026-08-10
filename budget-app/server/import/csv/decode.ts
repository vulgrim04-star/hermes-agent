/**
 * Décodage d'un export CSV.
 *
 * L'encodage varie d'un export UBS à l'autre : UTF-8 avec ou sans BOM,
 * UTF-16LE pour certains exports tabulés, et Windows-1252 (ou ISO-8859-1) pour
 * les plus anciens. Deviner à l'envers transforme « Genève » en « GenÃ¨ve » et
 * corrompt silencieusement tous les libellés — donc toutes les règles de
 * catégorisation qui s'y appuieront.
 */

export type Encoding = 'utf-8' | 'utf-8-bom' | 'utf-16le' | 'utf-16be' | 'windows-1252';

export interface DecodedText {
  text: string;
  encoding: Encoding;
}

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) return false;
  return prefix.every((byte, index) => bytes[index] === byte);
}

/**
 * Décode en s'appuyant d'abord sur le BOM, puis sur une tentative UTF-8
 * stricte : si le contenu n'est pas de l'UTF-8 valide, `TextDecoder` en mode
 * `fatal` lève, et on retombe sur Windows-1252 — le seul encodage 8 bits qui
 * ne peut pas échouer, chaque octet y ayant une représentation.
 */
export function decodeBuffer(input: Uint8Array): DecodedText {
  if (startsWith(input, [0xef, 0xbb, 0xbf])) {
    return { text: new TextDecoder('utf-8').decode(input.subarray(3)), encoding: 'utf-8-bom' };
  }
  if (startsWith(input, [0xff, 0xfe])) {
    return { text: new TextDecoder('utf-16le').decode(input.subarray(2)), encoding: 'utf-16le' };
  }
  if (startsWith(input, [0xfe, 0xff])) {
    return { text: new TextDecoder('utf-16be').decode(input.subarray(2)), encoding: 'utf-16be' };
  }

  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(input), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(input), encoding: 'windows-1252' };
  }
}

/** Découpe en lignes en tolérant CRLF, LF et CR seuls. */
export function splitLines(text: string): string[] {
  return text.split(/\r\n|\n|\r/);
}
