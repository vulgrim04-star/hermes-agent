/**
 * Écriture d'un classeur Excel, sans dépendance.
 *
 * Un `.xlsx` est une archive ZIP contenant quelques fichiers XML. Les
 * bibliothèques du marché pèsent près d'un mégaoctet pour ce qu'on en fait
 * ici ; l'écrire à la main coûte deux cents lignes et n'ajoute rien au bundle
 * qu'un ménage télécharge à chaque visite.
 *
 * Ce qui compte : les cellules sont **typées**. Une date exportée en texte ne
 * se trie pas, un montant en texte ne s'additionne pas — et un export dont il
 * faut retaper les colonnes ne sert à rien.
 */

/* ---------------------------------------------------------------- CRC-32 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ------------------------------------------------------------------- ZIP */

/**
 * Archive ZIP à entrées **non compressées** (méthode « stored »).
 *
 * C'est du ZIP parfaitement conforme : Excel, Numbers et LibreOffice l'ouvrent
 * sans broncher. Compresser demanderait un implémenteur de deflate pour gagner
 * quelques dizaines de kilooctets sur un fichier qu'on ouvre une fois.
 */
function zip(files) {
  const encoder = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;

  const u16 = (n) => [n & 0xff, (n >>> 8) & 0xff];
  const u32 = (n) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];

  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.content);
    const sum = crc32(data);

    const local = [
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0), // heure et date : sans objet ici
      ...u32(sum), ...u32(data.length), ...u32(data.length),
      ...u16(name.length), ...u16(0),
    ];
    chunks.push(new Uint8Array(local), name, data);

    central.push([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0),
      ...u32(sum), ...u32(data.length), ...u32(data.length),
      ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(0), ...u32(offset),
    ]);
    offset += local.length + name.length + data.length;
  }

  const directory = [];
  for (const [index, entry] of central.entries()) {
    directory.push(new Uint8Array(entry), encoder.encode(files[index].name));
  }
  const directorySize = directory.reduce((sum, part) => sum + part.length, 0);

  const end = new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0),
    ...u16(files.length), ...u16(files.length),
    ...u32(directorySize), ...u32(offset), ...u16(0),
  ]);

  return new Blob([...chunks, ...directory, end], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

/* ------------------------------------------------------------------- XML */

const escapeXml = (value) =>
  String(value).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

/** Colonne 1 → `A`, 27 → `AA`. */
function columnName(index) {
  let name = '';
  let n = index;
  while (n > 0) {
    const rest = (n - 1) % 26;
    name = String.fromCharCode(65 + rest) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

/**
 * Une date Excel est un nombre de jours depuis le 30.12.1899 — l'époque
 * décalée d'un jour par le bogue de l'an 1900 qu'Excel a conservé pour rester
 * compatible avec Lotus 1-2-3.
 */
function excelSerial(iso) {
  const days = (Date.parse(iso + 'T00:00:00Z') - Date.parse('1899-12-30T00:00:00Z')) / 86400000;
  return Math.round(days);
}

/**
 * Une cellule : `{ v, t }` où `t` vaut `date`, `number` ou rien (texte).
 * Les chaînes sont écrites en ligne plutôt que par une table partagée : un
 * fichier de plus à produire pour aucun gain à cette échelle.
 */
function cellXml(reference, cell) {
  if (cell === null || cell === undefined || cell === '') return '';
  if (cell.t === 'date') return `<c r="${reference}" s="1"><v>${excelSerial(cell.v)}</v></c>`;
  if (cell.t === 'number') return `<c r="${reference}" s="2"><v>${cell.v}</v></c>`;
  return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell.v)}</t></is></c>`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

/** Trois styles : ordinaire, date suisse, montant à deux décimales groupées. */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2">
<numFmt numFmtId="164" formatCode="dd\\.mm\\.yyyy"/>
<numFmt numFmtId="165" formatCode="#,##0.00"/>
</numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function workbookXml(sheetName) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${escapeXml(sheetName).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
}

/**
 * Construit le classeur.
 *
 * `columns` porte les en-têtes et la largeur ; `rows` est un tableau de
 * cellules `{ v, t }`. La ligne d'en-tête est figée : sur huit cents écritures,
 * savoir quelle colonne on lit compte plus que l'esthétique.
 */
export function buildXlsx({ sheetName = 'Feuille 1', columns, rows }) {
  const widths = columns
    .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width || 16}" customWidth="1"/>`)
    .join('');

  const header =
    '<row r="1">' +
    columns
      .map((c, i) => `<c r="${columnName(i + 1)}1" s="3" t="inlineStr"><is><t>${escapeXml(c.header)}</t></is></c>`)
      .join('') +
    '</row>';

  const body = rows
    .map((row, r) =>
      `<row r="${r + 2}">` +
      row.map((cell, i) => cellXml(`${columnName(i + 1)}${r + 2}`, cell)).join('') +
      '</row>')
    .join('');

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${widths}</cols>
<sheetData>${header}${body}</sheetData>
</worksheet>`;

  return zip([
    { name: '[Content_Types].xml', content: CONTENT_TYPES },
    { name: '_rels/.rels', content: ROOT_RELS },
    { name: 'xl/workbook.xml', content: workbookXml(sheetName) },
    { name: 'xl/_rels/workbook.xml.rels', content: WORKBOOK_RELS },
    { name: 'xl/styles.xml', content: STYLES },
    { name: 'xl/worksheets/sheet1.xml', content: sheet },
  ]);
}

export const text = (v) => (v == null || v === '' ? null : { v, t: 'text' });
export const date = (iso) => (iso ? { v: iso, t: 'date' } : null);
/** Les montants sont stockés en centimes ; le classeur les rend en francs. */
export const money = (cents) => (cents == null ? null : { v: (cents / 100).toFixed(2), t: 'number' });
export const number = (value, decimals = 2) =>
  value == null ? null : { v: Number(value).toFixed(decimals), t: 'number' };
