/**
 * Dates : stockage en ISO `AAAA-MM-JJ`, affichage en suisse `JJ.MM.AAAA`.
 *
 * Le stockage ISO permet de trier et de filtrer par comparaison de chaînes en
 * SQL, sans arithmétique de fuseau horaire — une date de valeur bancaire est
 * une date civile, pas un instant.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Vrai si l'ISO désigne un jour réellement existant (rejette le 31.02). */
export function isValidIsoDate(iso: string): boolean {
  const match = ISO_DATE.exec(iso);
  if (match === null) return false;
  const [, y, m, d] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

function toIso(year: number, month: number, day: number): string | null {
  const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return isValidIsoDate(iso) ? iso : null;
}

/**
 * Analyse une date d'export : `31.12.2025`, `31.12.25`, `31/12/2025`,
 * `31-12-2025` ou déjà `2025-12-31`. Renvoie l'ISO, ou `null`.
 */
export function parseSwissDate(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (text === '') return null;

  if (ISO_DATE.test(text)) return isValidIsoDate(text) ? text : null;

  // Date compacte AAAAMMJJ, fréquente dans les exports bruts.
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  if (compact !== null) return toIso(Number(compact[1]), Number(compact[2]), Number(compact[3]));

  const match = /^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2}|\d{4})$/.exec(text);
  if (match === null) return null;
  const [, d, m, y] = match;

  const yearDigits = y as string;
  const year = yearDigits.length === 2 ? expandTwoDigitYear(Number(yearDigits)) : Number(yearDigits);
  return toIso(year, Number(m), Number(d));
}

/** `2025-12-31` → `31.12.2025`. Rend la chaîne telle quelle si elle n'est pas ISO. */
export function formatSwissDate(iso: string): string {
  const match = ISO_DATE.exec(iso);
  if (match === null) return iso;
  const [, y, m, d] = match;
  return `${d}.${m}.${y}`;
}

/**
 * Année sur deux chiffres → siècle. Les relevés bancaires portent sur le passé
 * proche ou l'exercice courant : au-delà de l'an prochain, on bascule au siècle
 * précédent plutôt que de dater un relevé de 2077.
 */
function expandTwoDigitYear(twoDigits: number, reference = new Date().getUTCFullYear()): number {
  const century = Math.floor(reference / 100) * 100;
  const candidate = century + twoDigits;
  return candidate > reference + 1 ? candidate - 100 : candidate;
}

/** `:60F:` / `:61:` — date MT940 `AAMMJJ` → ISO. */
export function parseMt940Date(raw: string, reference?: number): string | null {
  if (!/^\d{6}$/.test(raw)) return null;
  const year = expandTwoDigitYear(Number(raw.slice(0, 2)), reference);
  return toIso(year, Number(raw.slice(2, 4)), Number(raw.slice(4, 6)));
}

/**
 * `:61:` — date comptable `MMJJ`, sans année. L'année est celle de la date de
 * valeur, sauf autour du 1er janvier : une écriture comptabilisée le 31.12 et
 * valorisée le 02.01 appartient à l'année précédente, et inversement.
 */
export function parseMt940EntryDate(raw: string, valueDateIso: string): string | null {
  if (!/^\d{4}$/.test(raw)) return null;
  const match = ISO_DATE.exec(valueDateIso);
  if (match === null) return null;

  const valueYear = Number(match[1]);
  const valueMonth = Number(match[2]);
  const entryMonth = Number(raw.slice(0, 2));
  const entryDay = Number(raw.slice(2, 4));

  let year = valueYear;
  if (entryMonth === 12 && valueMonth === 1) year = valueYear - 1;
  else if (entryMonth === 1 && valueMonth === 12) year = valueYear + 1;

  return toIso(year, entryMonth, entryDay);
}

/** Mois précédent au format `AAAA-MM`, `null` si l'entrée n'en est pas un. */
export function previousMonth(yearMonth: string): string | null {
  const match = /^(\d{4})-(\d{2})$/.exec(yearMonth);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return month === 1
    ? `${year - 1}-12`
    : `${match[1]}-${String(month - 1).padStart(2, '0')}`;
}

/** `2025-01-15` → `2025-01`. */
export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

/** Premier et dernier jour du mois `AAAA-MM`, bornes incluses. */
export function monthBounds(yearMonth: string): { start: string; end: string } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(yearMonth);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    start: `${match[1]}-${match[2]}-01`,
    end: `${match[1]}-${match[2]}-${String(lastDay).padStart(2, '0')}`,
  };
}
