import { Hono } from 'hono';

import { isOwner } from '../../shared/model.js';
import { getDatabase } from '../db/connection.js';
import {
  clearValuation,
  netWorthSeries,
  positionsAt,
  readAssets,
  setValuation,
} from '../domain/networth.js';
import { pillar3aStatus, setPillar3aCeiling, taxParameters } from '../domain/pillar3a.js';

export const networth = new Hono();

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7);
}

/** Positions à un mois donné, avec la série qui y mène. */
networth.get('/', (context) => {
  const db = getDatabase();
  const period = context.req.query('mois') ?? currentPeriod();
  if (!PERIOD.test(period)) {
    return context.json({ message: 'Mois attendu au format AAAA-MM.' }, 400);
  }

  const months = Number(context.req.query('mois_glissants') ?? 24);
  const from = shift(period, -(Number.isFinite(months) ? Math.max(1, Math.min(120, months)) : 24) + 1);

  return context.json({
    period,
    assets: readAssets(db),
    positions: positionsAt(db, period),
    series: netWorthSeries(db, from, period),
  });
});

networth.post('/positions', async (context) => {
  const body = (await context.req.json()) as {
    label?: string;
    kind?: string;
    isLiability?: boolean;
    accountId?: number | null;
    tracksQuantity?: boolean;
    owner?: string;
    notes?: string | null;
  };

  const label = (body.label ?? '').trim();
  if (label === '') return context.json({ message: 'Libellé manquant.' }, 400);

  const id = getDatabase()
    .prepare(
      `INSERT INTO assets (label, kind, is_liability, account_id, tracks_quantity, owner, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      label,
      body.kind ?? 'autre',
      body.isLiability === true ? 1 : 0,
      typeof body.accountId === 'number' ? body.accountId : null,
      body.tracksQuantity === true ? 1 : 0,
      isOwner(body.owner) ? body.owner : 'commun',
      body.notes ?? null,
    ).lastInsertRowid;

  return context.json({ id: Number(id) }, 201);
});

networth.delete('/positions/:id', (context) => {
  // Désactivée plutôt que supprimée : les valorisations passées restent
  // lisibles, et l'historique du patrimoine ne se réécrit pas.
  const changed = getDatabase()
    .prepare('UPDATE assets SET is_active = 0 WHERE id = ?')
    .run(Number(context.req.param('id'))).changes;
  return changed > 0
    ? context.json({ ok: true })
    : context.json({ message: 'Position introuvable.' }, 404);
});

networth.put('/positions/:id/valorisation', async (context) => {
  const body = (await context.req.json()) as {
    period?: string;
    valueCents?: number | null;
    quantityE8?: number | null;
    unitPriceCents?: number | null;
  };

  const outcome = setValuation(getDatabase(), {
    assetId: Number(context.req.param('id')),
    period: body.period ?? currentPeriod(),
    valueCents: body.valueCents ?? null,
    quantityE8: body.quantityE8 ?? null,
    unitPriceCents: body.unitPriceCents ?? null,
  });

  if (outcome.kind === 'mois-invalide') {
    return context.json({ message: 'Mois attendu au format AAAA-MM.' }, 400);
  }
  if (outcome.kind === 'valeur-manquante') {
    return context.json({ message: 'Indiquez une valeur, ou une quantité et un cours.' }, 400);
  }
  return context.json(outcome);
});

networth.delete('/positions/:id/valorisation/:period', (context) => {
  const cleared = clearValuation(
    getDatabase(),
    Number(context.req.param('id')),
    context.req.param('period'),
  );
  return cleared
    ? context.json({ ok: true })
    : context.json({ message: 'Aucune saisie pour ce mois.' }, 404);
});

// ------------------------------------------------------------- Pilier 3a

networth.get('/pilier-3a', (context) => {
  const year = Number(context.req.query('annee') ?? new Date().getUTCFullYear());
  if (!Number.isInteger(year)) {
    return context.json({ message: 'Année attendue au format AAAA.' }, 400);
  }
  return context.json({
    ...pillar3aStatus(getDatabase(), year),
    parameters: taxParameters(getDatabase()),
  });
});

networth.put('/pilier-3a/:year', async (context) => {
  const body = (await context.req.json()) as { ceilingCents?: number | null };
  const year = Number(context.req.param('year'));
  if (!Number.isInteger(year)) {
    return context.json({ message: 'Année attendue au format AAAA.' }, 400);
  }
  setPillar3aCeiling(
    getDatabase(),
    year,
    typeof body.ceilingCents === 'number' ? Math.round(body.ceilingCents) : null,
  );
  return context.json({ ok: true });
});

/** Décale un mois `AAAA-MM` de `delta` mois. */
function shift(period: string, delta: number): string {
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  const total = year * 12 + (month - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}
