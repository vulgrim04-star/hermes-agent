/**
 * Camembert en anneau.
 *
 * Teintes catégorielles dans un ordre fixe, jamais recyclé — c'est l'ordre qui
 * garantit la lisibilité pour les daltonismes. Le gris est réservé au non
 * catégorisé et au repli « Autres » : jamais une catégorie du ménage. Six parts
 * au plus, au-delà desquelles les parts voisines ne se distinguent plus. La
 * couleur ne porte jamais l'information seule : chaque part est nommée et
 * chiffrée dans la légende.
 */

/*
 * Teintes système d'Apple, choisies pour ne rien dire d'autre que « ceci est
 * une part » : ni le bleu, qui ne désigne que ce qui est actionnable, ni le
 * vert, qui ne désigne qu'un crédit. Confondre une part de camembert avec un
 * bouton, ou un poste de dépense avec une rentrée, coûterait plus cher qu'une
 * palette moins riche.
 */
export const SERIES = ['#ff9500', '#5856d6', '#00c7be', '#ff2d55', '#af52de', '#ffcc00'];
export const OTHER = '#8e8e93';

export function foldSlices(entries, limit = SERIES.length) {
  const sorted = entries.filter((e) => e.value > 0).sort((a, b) => b.value - a.value);
  const total = sorted.reduce((sum, e) => sum + e.value, 0);
  if (!total) return [];

  const kept = sorted.slice(0, sorted.length > limit ? limit - 1 : limit);
  const rest = sorted.slice(kept.length);
  let hue = 0;

  const slices = kept.map((e) => ({
    name: e.name,
    value: e.value,
    share: e.value / total,
    color: e.reserved ? OTHER : SERIES[hue++ % SERIES.length],
  }));

  if (rest.length) {
    const value = rest.reduce((sum, e) => sum + e.value, 0);
    slices.push({ name: `Autres (${rest.length})`, value, share: value / total, color: OTHER });
  }
  return slices;
}

export default function Donut({ slices, size = 168, centre, caption }) {
  if (!slices.length) return null;
  const R = size / 2;
  const inner = R - size * 0.22;
  const mid = (R + inner) / 2;
  const gap = 2 / mid; // le vide entre les parts, constant en pixels

  let angle = -Math.PI / 2;
  const paths = slices.map((slice, index) => {
    const span = slice.share * Math.PI * 2;
    // Une part plus fine que le vide serait effacée par lui : on la dessine pleine.
    const trimmed = span > gap * 1.5 ? span - gap : span;
    const start = angle + (span - trimmed) / 2;
    const end = start + trimmed;
    angle += span;

    const point = (r, t) => `${(r * Math.cos(t)).toFixed(2)} ${(r * Math.sin(t)).toFixed(2)}`;
    const large = end - start > Math.PI ? 1 : 0;

    const d =
      end - start >= Math.PI * 2 - 1e-6
        ? `M ${R} 0 A ${R} ${R} 0 1 1 ${-R} 0 A ${R} ${R} 0 1 1 ${R} 0 M ${inner} 0 A ${inner} ${inner} 0 1 0 ${-inner} 0 A ${inner} ${inner} 0 1 0 ${inner} 0 Z`
        : `M ${point(R, start)} A ${R} ${R} 0 ${large} 1 ${point(R, end)} L ${point(inner, end)} A ${inner} ${inner} 0 ${large} 0 ${point(inner, start)} Z`;

    return <path key={index} d={d} fill={slice.color} />;
  });

  return (
    <svg
      className="ring"
      viewBox={`${-R} ${-R} ${size} ${size}`}
      width={size}
      height={size}
      role="img"
      aria-label="Répartition des dépenses par poste"
    >
      {paths}
      {/* Le creux de l'anneau ne doit pas rester vide : le total y répond à la
          question que pose le dessin — « tout ça, ça fait combien ? ». */}
      {centre && (
        <text
          className="hole"
          x="0"
          y="0"
          textAnchor="middle"
          fill="currentColor"
          fontSize={size * 0.13}
          fontWeight="600"
          letterSpacing="-0.03em"
          dy={caption ? '0' : '0.34em'}
        >
          {centre}
        </text>
      )}
      {caption && (
        <text
          x="0"
          y="0"
          dy="1.5em"
          textAnchor="middle"
          fill="currentColor"
          opacity="0.55"
          fontSize={size * 0.075}
        >
          {caption}
        </text>
      )}
    </svg>
  );
}
