/**
 * Découpage d'un fichier MT940 en champs.
 *
 * Le format est une suite de champs `:tag:valeur`, où une ligne qui ne commence
 * pas par `:` **prolonge le champ précédent** — c'est ainsi que les libellés
 * `:86:` s'étalent sur plusieurs lignes. Perdre ce rattachement revient à perdre
 * la moitié des libellés, silencieusement.
 *
 * On tolère l'enveloppe SWIFT (`{1:…}{2:…}{4:` … `-}`) quand elle est présente,
 * les fins de ligne CRLF, et le marqueur de fin de bloc `-` isolé.
 */

import { splitLines } from '../csv/decode.js';

export interface Mt940Field {
  tag: string;
  /** Première ligne du champ, puis ses lignes de continuation. */
  lines: string[];
  /** Numéro de ligne dans le fichier, base 1. */
  lineNumber: number;
}

export interface Mt940Block {
  fields: Mt940Field[];
}

const FIELD_START = /^:(\d{2}[A-Z]?):(.*)$/;
const ENVELOPE_PREFIX = /^\{\d:[^}]*\}/;

/** Retire l'enveloppe SWIFT éventuelle et rend la ligne exploitable. */
function stripEnvelope(line: string): string {
  let text = line;
  let previous: string;
  do {
    previous = text;
    text = text.replace(ENVELOPE_PREFIX, '');
  } while (text !== previous);
  // `{4:` ouvre le bloc de texte, `-}` le ferme : ni l'un ni l'autre n'est un champ.
  return text.replace(/^\{4:\s*$/, '').replace(/^-\}\s*$/, '');
}

/**
 * Découpe en blocs : chaque `:20:` ouvre un relevé. Un fichier d'export mensuel
 * en contient volontiers plusieurs, un par période ou par compte.
 */
export function tokenize(text: string): { blocks: Mt940Block[]; strayLines: Mt940Field[] } {
  const blocks: Mt940Block[] = [];
  const strayLines: Mt940Field[] = [];
  let current: Mt940Block | null = null;
  let field: Mt940Field | null = null;

  splitLines(text).forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = stripEnvelope(rawLine.replace(/\s+$/, ''));

    if (line === '' || line === '-') return; // ligne vide ou fin de bloc

    const match = FIELD_START.exec(line);
    if (match === null) {
      if (field === null) {
        strayLines.push({ tag: '', lines: [line], lineNumber });
        return;
      }
      field.lines.push(line);
      return;
    }

    const [, tag, value] = match;
    field = { tag: tag as string, lines: [value as string], lineNumber };

    if (tag === '20' || current === null) {
      current = { fields: [] };
      blocks.push(current);
    }
    current.fields.push(field);
  });

  return { blocks, strayLines };
}
