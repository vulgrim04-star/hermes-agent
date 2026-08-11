/**
 * Point d'entrée unique de l'analyse d'un fichier déposé.
 *
 * Le format est reconnu sur le **contenu**, jamais sur l'extension : un MT940
 * s'appelle volontiers `.txt`, et un CSV renommé `.sta` reste un CSV.
 */

import { analyse as analyseCsv, decodeBytes } from './csv.js';
import { analyseMt940, looksLikeMt940 } from './mt940.js';

/**
 * Formats binaires que l'e-banking propose à côté du CSV, et qu'on reconnaît à
 * leur signature pour pouvoir dire *quoi faire* plutôt que « format non
 * reconnu ».
 *
 * Sans cela, un classeur Excel part dans le décodeur de texte, en ressort en
 * charabia, et l'utilisateur lit une liste de colonnes manquantes qui ne lui
 * apprend rien : son fichier n'a jamais été un tableau, c'est une archive ZIP.
 */
const SIGNATURES = [
  {
    octets: [0x50, 0x4b, 0x03, 0x04],
    nom: 'un classeur Excel (.xlsx) ou une archive',
    conseil:
      'Dans votre e-banking, réexportez le relevé au format CSV plutôt qu’Excel — c’est une ' +
      'option de la même fenêtre de téléchargement.',
  },
  {
    octets: [0xd0, 0xcf, 0x11, 0xe0],
    nom: 'un ancien classeur Excel (.xls)',
    conseil: 'Réexportez le relevé au format CSV depuis votre e-banking.',
  },
  {
    octets: [0x25, 0x50, 0x44, 0x46],
    nom: 'un document PDF',
    conseil:
      'Un PDF est une image du relevé, pas ses données : les montants n’y sont pas exploitables. ' +
      'Réexportez au format CSV ou MT940.',
  },
];

function signatureDe(buffer) {
  const head = new Uint8Array(buffer.slice ? buffer.slice(0, 4) : buffer, 0, 4);
  return SIGNATURES.find((s) => s.octets.every((o, i) => head[i] === o)) || null;
}

export function analyseFile(buffer, filename) {
  const binaire = signatureDe(buffer);
  if (binaire) {
    return {
      ok: false,
      filename,
      headers: [],
      format: 'binaire',
      missing: [`un relevé en texte — ce fichier est ${binaire.nom}. ${binaire.conseil}`],
    };
  }

  const { text } = decodeBytes(buffer);
  const format = looksLikeMt940(text) ? 'mt940' : 'csv';
  const report = format === 'mt940' ? analyseMt940(buffer, filename) : analyseCsv(buffer, filename);
  return { ...report, format };
}
