import { CHART_INK, SERIES_COLORS } from '../lib/viz.js';
import { formatCents } from '../../shared/money.js';

export interface Series {
  key: string;
  name: string;
  /** Une valeur par point, en centimes. */
  values: number[];
  /** Indice de teinte catégorielle ; l'ordre du jeu est fixe et jamais recyclé. */
  hue?: number;
  /** Trait interrompu : une valeur reportée, pas relevée. */
  dashed?: boolean;
}

/**
 * Courbe en SVG, sans dépendance.
 *
 * La charte `dataviz` s'applique telle quelle : teintes catégorielles dans leur
 * ordre fixe, gris réservé, et **la couleur ne porte jamais l'information à
 * elle seule** — chaque série est nommée en légende, les valeurs extrêmes sont
 * chiffrées sur l'axe, et le tableau sous le graphique reprend les mêmes
 * nombres. Trois séries au plus : au-delà, les paires de teintes ne sont plus
 * toutes validées en comparaison directe.
 */
export function LineChart({
  series,
  labels,
  height = 220,
  zeroLine = true,
}: {
  series: Series[];
  labels: string[];
  height?: number;
  zeroLine?: boolean;
}) {
  const width = 720;
  const padding = { top: 16, right: 16, bottom: 28, left: 76 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;

  const all = series.flatMap((entry) => entry.values);
  if (all.length === 0 || labels.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-500">Aucune donnée à tracer.</p>;
  }

  const rawMax = Math.max(...all, 0);
  const rawMin = Math.min(...all, 0);
  const { min, max, ticks } = niceScale(rawMin, rawMax);

  const x = (index: number) =>
    labels.length === 1
      ? padding.left + innerWidth / 2
      : padding.left + (index / (labels.length - 1)) * innerWidth;
  const y = (value: number) =>
    padding.top + innerHeight - ((value - min) / (max - min || 1)) * innerHeight;

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        role="img"
        aria-label={`Évolution mensuelle : ${series.map((entry) => entry.name).join(', ')}`}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={y(tick)}
              y2={y(tick)}
              stroke={tick === 0 && zeroLine ? CHART_INK.baseline : CHART_INK.grid}
              strokeWidth={tick === 0 && zeroLine ? 1.5 : 1}
            />
            <text
              x={padding.left - 8}
              y={y(tick) + 4}
              textAnchor="end"
              fontSize="11"
              fill={CHART_INK.secondary}
            >
              {formatCents(tick)}
            </text>
          </g>
        ))}

        {labels.map((label, index) => (
          <text
            key={label}
            x={x(index)}
            y={height - 8}
            textAnchor="middle"
            fontSize="11"
            fill={CHART_INK.secondary}
          >
            {label}
          </text>
        ))}

        {series.map((entry, order) => {
          const color = SERIES_COLORS[entry.hue ?? order] ?? CHART_INK.muted;
          const path = entry.values
            .map((value, index) => `${index === 0 ? 'M' : 'L'} ${x(index)} ${y(value)}`)
            .join(' ');
          return (
            <g key={entry.key}>
              <path
                d={path}
                fill="none"
                stroke={color}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeDasharray={entry.dashed === true ? '5 4' : undefined}
              />
              {entry.values.map((value, index) => (
                <circle
                  key={`${entry.key}-${index}`}
                  cx={x(index)}
                  cy={y(value)}
                  r="2.5"
                  fill={color}
                />
              ))}
            </g>
          );
        })}
      </svg>

      <figcaption className="mt-2 flex flex-wrap gap-4 text-xs text-slate-600">
        {series.map((entry, order) => (
          <span key={entry.key} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: SERIES_COLORS[entry.hue ?? order] ?? CHART_INK.muted }}
            />
            {entry.name}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

/** Échelle arrondie à un pas lisible, incluant toujours le zéro. */
function niceScale(rawMin: number, rawMax: number): { min: number; max: number; ticks: number[] } {
  const min = Math.min(rawMin, 0);
  const max = Math.max(rawMax, 0);
  const span = max - min || 100;
  const rough = span / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((value) => value >= rough) ?? magnitude * 10;

  const from = Math.floor(min / step) * step;
  const to = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = from; value <= to + step / 2; value += step) ticks.push(Math.round(value));
  return { min: from, max: to, ticks };
}
