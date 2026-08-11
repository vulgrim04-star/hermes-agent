/**
 * Dates : stockage ISO `AAAA-MM-JJ`, affichage suisse `JJ.MM.AAAA`.
 *
 * Une date de valeur bancaire est une date civile, pas un instant : le stockage
 * ISO permet de trier et de filtrer par comparaison de chaînes, sans jamais
 * faire d'arithmétique de fuseau horaire.
 */

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function validIso(s) {
  const m = ISO.exec(s);
  if (!m) return false;
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

function toIso(y, m, d) {
  const s =
    String(y).padStart(4, '0') + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  return validIso(s) ? s : null;
}

/**
 * Un relevé porte sur le passé proche : au-delà de l'an prochain, une année sur
 * deux chiffres bascule au siècle précédent plutôt que de dater de 2077.
 */
function expandYear(two, ref = new Date().getUTCFullYear()) {
  const century = Math.floor(ref / 100) * 100;
  const candidate = century + two;
  return candidate > ref + 1 ? candidate - 100 : candidate;
}

/** `31.12.2025`, `31/12/25`, `20251231` ou déjà `2025-12-31`. */
export function parseDate(raw) {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  if (!t) return null;
  if (ISO.test(t)) return validIso(t) ? t : null;

  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(t);
  if (compact) return toIso(+compact[1], +compact[2], +compact[3]);

  const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/.exec(t);
  if (!m) return null;
  const year = m[3].length === 2 ? expandYear(+m[3]) : +m[3];
  return toIso(year, +m[2], +m[1]);
}

export function frDate(iso) {
  const m = ISO.exec(iso);
  return m ? m[3] + '.' + m[2] + '.' + m[1] : iso;
}

const MONTHS = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
export const MONTHS_SHORT = ['jan','fév','mar','avr','mai','juin','juil','août','sep','oct','nov','déc'];

export function monthLabel(period) {
  const [y, m] = period.split('-');
  return MONTHS[+m - 1] + ' ' + y;
}

/**
 * Premier et dernier jour du mois `AAAA-MM`, bornes comprises. Rend `null` sur
 * un mois qui n'existe pas : c'est ce retour qui sert de garde-fou aux
 * appelants, un `2026-13` accepté en silence irait se ranger dans la base.
 */
export function monthBounds(period) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(period));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { start: period + '-01', end: period + '-' + String(last).padStart(2, '0') };
}

/**
 * Décale un mois `AAAA-MM` de `delta` mois, dans un sens ou dans l'autre.
 *
 * Le passage d'année se fait par arithmétique sur les mois plutôt que par un
 * objet Date : `new Date(2026, -1)` fonctionne, mais fait dépendre le résultat
 * du fuseau de la machine — un budget arrêté le 1er janvier à Fribourg ne doit
 * pas basculer en décembre parce que le navigateur est en UTC.
 *
 * Rend `null` sur un mois qui n'existe pas, comme `monthBounds`.
 */
export function shiftMonth(period, delta) {
  if (!monthBounds(period)) return null;
  const [year, month] = period.split('-').map(Number);
  const total = year * 12 + (month - 1) + delta;
  if (total < 0) return null;
  return `${String(Math.floor(total / 12)).padStart(4, '0')}-${String((total % 12) + 1).padStart(2, '0')}`;
}

export function dayGap(a, b) {
  return Math.abs(Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000;
}
