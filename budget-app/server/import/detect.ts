/**
 * Reconnaissance du format d'un fichier déposé.
 *
 * On regarde le contenu, pas l'extension : un MT940 arrive aussi bien en `.sta`,
 * `.940`, `.txt` ou sans extension du tout selon la façon dont l'e-banking l'a
 * livré. L'extension ne sert que de départage quand le contenu ne tranche pas.
 */

import { decodeBuffer, splitLines } from './csv/decode.js';
import type { ImportFormat } from './types.js';

const MT940_FIELD = /^:\d{2}[A-Z]?:/;

export interface FormatDetection {
  format: ImportFormat;
  /** Ce qui a emporté la décision, affiché dans l'écran de diagnostic. */
  reason: string;
}

export function detectFormat(input: Uint8Array, filename = ''): FormatDetection {
  const { text } = decodeBuffer(input);
  const lines = splitLines(text)
    .map((line) => line.trim())
    .filter((line) => line !== '');

  const head = lines.slice(0, 40);
  const fieldLines = head.filter((line) => MT940_FIELD.test(line)).length;
  const hasStatementStart = head.some((line) => line.startsWith(':20:') || line.includes('{4:'));

  if (fieldLines >= 3 && hasStatementStart) {
    return { format: 'mt940', reason: 'champs SWIFT :20:, :25:, :61: reconnus en tête de fichier' };
  }

  const extension = filename.toLowerCase().split('.').pop() ?? '';
  if (fieldLines >= 3 || ['sta', '940', 'mt940'].includes(extension)) {
    return { format: 'mt940', reason: `structure ou extension « .${extension} » de relevé SWIFT` };
  }

  return { format: 'csv', reason: 'fichier tabulaire' };
}
