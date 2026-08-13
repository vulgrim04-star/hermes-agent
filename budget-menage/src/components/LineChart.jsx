import { fmt } from '../lib/money.js';

/**
 * Courbe simple, une seule série.
 *
 * Une seule teinte, donc pas de légende : ce qui est tracé est dit par le titre
 * de la carte. Le zéro est toujours dans l'échelle — une courbe de patrimoine
 * qui part de 480'000 et monte à 495'000 sur une échelle serrée donne
 * l'illusion d'un doublement.
 *
 * Le viewBox est fixe et la largeur fluide : sur téléphone, le SVG se réduit
 * sans que les libellés se chevauchent, parce que leur nombre est calculé et
 * non subi.
 */
export default function LineChart({ points, aria, teinte = '#2a78d6', zeroDansEchelle = true }) {
  if (points.length < 2) return null;

  const width = 720;
  const height = 200;
  const pad = { top: 14, right: 14, bottom: 26, left: 84 };
  const valeurs = points.map((p) => p.value);
  const min = Math.min(...(zeroDansEchelle ? [0, ...valeurs] : valeurs));
  const max = Math.max(...(zeroDansEchelle ? [0, ...valeurs] : valeurs));
  const span = max - min || 100;

  const x = (i) => pad.left + (i / (points.length - 1)) * (width - pad.left - pad.right);
  const y = (v) => pad.top + (1 - (v - min) / span) * (height - pad.top - pad.bottom);

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
  const stride = Math.ceil(points.length / 6);

  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label={aria}>
        {[min, (min + max) / 2, max].map((tick) => (
          <g key={tick}>
            <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)}
              stroke="var(--rule)" strokeWidth="1" />
            <text x={pad.left - 8} y={y(tick) + 4} textAnchor="end" fontSize="11" fill="var(--ink-3)">
              {fmt(tick)}
            </text>
          </g>
        ))}
        {points.map((p, i) =>
          i % stride === 0 || i === points.length - 1 ? (
            <text key={p.label} x={x(i)} y={height - 7} textAnchor="middle" fontSize="10.5" fill="var(--ink-3)">
              {p.label}
            </text>
          ) : null)}
        <path d={path} fill="none" stroke={teinte} strokeWidth="2" strokeLinejoin="round" />
        {points.map((p, i) => <circle key={p.label} cx={x(i)} cy={y(p.value)} r="2.5" fill={teinte} />)}
      </svg>
    </figure>
  );
}
