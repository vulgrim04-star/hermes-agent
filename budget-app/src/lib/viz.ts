/**
 * Charte des graphiques.
 *
 * Les teintes catégorielles sont posées **dans un ordre fixe, jamais recyclé** :
 * c'est l'ordre lui-même qui garantit la lisibilité pour les daltonismes, et le
 * jeu a été validé sur la surface blanche de l'application (bandes de clarté,
 * plancher de chroma, séparation CVD, plancher en vision normale).
 *
 * Trois teintes passent sous le rapport de contraste 3:1 : la règle de relief
 * s'applique, et elle est tenue — toute part porte son libellé et son montant en
 * légende, et le tableau budget contre réel reprend les mêmes chiffres. La
 * couleur ne porte jamais l'information à elle seule.
 *
 * Le camembert est limité à six parts, au-delà desquelles les parts adjacentes
 * ne se distinguent plus ; le reste est replié dans « Autres ».
 */

/** Teintes catégorielles, dans l'ordre. */
export const SERIES_COLORS = [
  '#2a78d6', // bleu
  '#eb6834', // orange
  '#1baf7a', // aigue-marine
  '#eda100', // jaune
  '#e87ba4', // magenta
  '#008300', // vert
] as const;

/** Gris réservé au repli « Autres » et au non catégorisé : jamais une série. */
export const OTHER_COLOR = '#898781';

export const CHART_INK = {
  surface: '#ffffff',
  primary: '#0b0b0b',
  secondary: '#52514e',
  muted: '#898781',
  grid: '#e1e0d9',
  baseline: '#c3c2b7',
} as const;

/** Statuts, distincts des séries et toujours accompagnés d'un libellé. */
export const STATUS_COLORS = {
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
} as const;

export interface Slice {
  key: string;
  name: string;
  value: number;
  color: string;
  share: number;
}

/**
 * Replie une répartition sur six parts au plus. Ce qui dépasse rejoint
 * « Autres » : au-delà, les parts voisines cessent d'être distinguables et le
 * camembert ment sur sa propre précision.
 */
export function foldSlices(
  entries: readonly { key: string; name: string; value: number; reserved?: boolean }[],
  limit = SERIES_COLORS.length,
): Slice[] {
  const sorted = [...entries].filter((entry) => entry.value > 0).sort((a, b) => b.value - a.value);
  const total = sorted.reduce((sum, entry) => sum + entry.value, 0);
  if (total === 0) return [];

  const kept = sorted.slice(0, sorted.length > limit ? limit - 1 : limit);
  const rest = sorted.slice(kept.length);

  // Une part réservée (le non catégorisé) porte le gris : ce n'est pas une
  // catégorie du ménage, elle ne doit pas emprunter une teinte de série.
  let hue = 0;
  const slices: Slice[] = kept.map((entry) => ({
    key: entry.key,
    name: entry.name,
    value: entry.value,
    color: entry.reserved === true ? OTHER_COLOR : (SERIES_COLORS[hue++] as string),
    share: entry.value / total,
  }));

  if (rest.length > 0) {
    const value = rest.reduce((sum, entry) => sum + entry.value, 0);
    slices.push({
      key: 'autres',
      name: `Autres (${rest.length})`,
      value,
      color: OTHER_COLOR,
      share: value / total,
    });
  }

  return slices;
}

export interface Arc {
  slice: Slice;
  path: string;
}

/**
 * Découpe un anneau en arcs, séparés par un vide de 2 px dans la couleur de la
 * surface — c'est le vide qui sépare les parts, pas un contour.
 */
export function donutArcs(
  slices: readonly Slice[],
  radius: number,
  thickness: number,
  gapPx = 2,
): Arc[] {
  const outer = radius;
  const inner = radius - thickness;
  const mid = (outer + inner) / 2;
  const gap = gapPx / mid; // le vide en radians, constant en pixels

  let angle = -Math.PI / 2; // départ à midi
  const arcs: Arc[] = [];

  for (const slice of slices) {
    const span = slice.share * Math.PI * 2;
    // Une part plus fine que le vide serait effacée par lui : on la dessine
    // pleine plutôt que de la faire disparaître.
    const trimmed = span > gap * 1.5 ? span - gap : span;
    const start = angle + (span - trimmed) / 2;
    const end = start + trimmed;
    angle += span;

    arcs.push({ slice, path: ringPath(start, end, outer, inner) });
  }

  return arcs;
}

function ringPath(start: number, end: number, outer: number, inner: number): string {
  // Un arc de cercle complet ne peut pas s'écrire d'un seul trait : on le ferme.
  if (end - start >= Math.PI * 2 - 1e-6) {
    return [
      `M ${outer} 0`,
      `A ${outer} ${outer} 0 1 1 ${-outer} 0`,
      `A ${outer} ${outer} 0 1 1 ${outer} 0`,
      `M ${inner} 0`,
      `A ${inner} ${inner} 0 1 0 ${-inner} 0`,
      `A ${inner} ${inner} 0 1 0 ${inner} 0`,
      'Z',
    ].join(' ');
  }

  const large = end - start > Math.PI ? 1 : 0;
  const [x1, y1] = polar(outer, start);
  const [x2, y2] = polar(outer, end);
  const [x3, y3] = polar(inner, end);
  const [x4, y4] = polar(inner, start);

  return [
    `M ${x1} ${y1}`,
    `A ${outer} ${outer} 0 ${large} 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${inner} ${inner} 0 ${large} 0 ${x4} ${y4}`,
    'Z',
  ].join(' ');
}

function polar(radius: number, angle: number): [number, number] {
  return [
    Number((radius * Math.cos(angle)).toFixed(3)),
    Number((radius * Math.sin(angle)).toFixed(3)),
  ];
}
