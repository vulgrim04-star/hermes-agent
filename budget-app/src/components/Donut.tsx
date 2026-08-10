import { useState } from 'react';

import { formatCents } from '../../shared/money.js';
import { CHART_INK, donutArcs, foldSlices } from '../lib/viz.js';

const SIZE = 200;
const RADIUS = 92;
const THICKNESS = 34;

/**
 * Répartition en anneau.
 *
 * La légende porte le nom, le montant et la part de chaque tranche : l'identité
 * ne dépend jamais de la couleur seule — trois teintes de la charte passent sous
 * le rapport de contraste 3:1, et c'est cette règle de relief qui les rachète.
 */
export function Donut({
  entries,
  total,
  emptyLabel = 'Aucune dépense sur la période.',
}: {
  entries: readonly { key: string; name: string; value: number; reserved?: boolean }[];
  total?: number;
  emptyLabel?: string;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const slices = foldSlices(entries);

  if (slices.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-500">{emptyLabel}</p>;
  }

  const arcs = donutArcs(slices, RADIUS, THICKNESS);
  const sum = total ?? slices.reduce((acc, slice) => acc + slice.value, 0);
  const active = slices.find((slice) => slice.key === hovered) ?? null;

  return (
    <div className="flex flex-wrap items-center gap-8">
      <svg
        viewBox={`${-SIZE / 2} ${-SIZE / 2} ${SIZE} ${SIZE}`}
        className="h-52 w-52 shrink-0"
        role="img"
        aria-label="Répartition des dépenses par catégorie"
      >
        {arcs.map((arc) => (
          <path
            key={arc.slice.key}
            d={arc.path}
            fill={arc.slice.color}
            opacity={hovered === null || hovered === arc.slice.key ? 1 : 0.35}
            onMouseEnter={() => setHovered(arc.slice.key)}
            onMouseLeave={() => setHovered(null)}
          >
            <title>{`${arc.slice.name} — ${formatCents(arc.slice.value)} (${percent(arc.slice.share)})`}</title>
          </path>
        ))}

        {/* Le centre porte le total, ou le détail de la part survolée. */}
        <text
          textAnchor="middle"
          y={-4}
          className="text-[11px]"
          fill={CHART_INK.muted}
          style={{ fontSize: 11 }}
        >
          {active === null ? 'Total' : truncate(active.name)}
        </text>
        <text
          textAnchor="middle"
          y={16}
          fill={CHART_INK.primary}
          style={{ fontSize: 17, fontWeight: 600 }}
        >
          {formatCents(active === null ? sum : active.value)}
        </text>
      </svg>

      <ul className="flex min-w-64 flex-1 flex-col gap-1.5 text-sm">
        {slices.map((slice) => (
          <li
            key={slice.key}
            className="flex items-center gap-2.5"
            onMouseEnter={() => setHovered(slice.key)}
            onMouseLeave={() => setHovered(null)}
          >
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ background: slice.color }}
            />
            <span className="truncate text-slate-700">{slice.name}</span>
            <span className="ml-auto tabular text-slate-500">{percent(slice.share)}</span>
            <span className="w-24 text-right tabular font-medium">{formatCents(slice.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function percent(share: number): string {
  return `${(share * 100).toFixed(1).replace('.', ',')} %`;
}

function truncate(text: string): string {
  return text.length > 22 ? `${text.slice(0, 21)}…` : text;
}
