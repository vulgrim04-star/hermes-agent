/**
 * Point d'entrée unique de l'analyse d'un fichier déposé.
 *
 * Le format est reconnu sur le **contenu**, jamais sur l'extension : un MT940
 * s'appelle volontiers `.txt`, et un CSV renommé `.sta` reste un CSV.
 */

import { analyse as analyseCsv, decodeBytes } from './csv.js';
import { analyseMt940, looksLikeMt940 } from './mt940.js';

export function analyseFile(buffer, filename) {
  const { text } = decodeBytes(buffer);
  const format = looksLikeMt940(text) ? 'mt940' : 'csv';
  const report = format === 'mt940' ? analyseMt940(buffer, filename) : analyseCsv(buffer, filename);
  return { ...report, format };
}
