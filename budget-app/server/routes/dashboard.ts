import { Hono } from 'hono';

import { getDatabase } from '../db/connection.js';
import { availableMonths, monthlySummary } from '../domain/dashboard.js';

export const dashboard = new Hono();

dashboard.get('/mensuel', (context) => {
  const months = availableMonths(getDatabase());
  const requested = context.req.query('mois');
  const month = requested ?? months[0] ?? new Date().toISOString().slice(0, 7);

  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return context.json({ message: 'Mois attendu au format AAAA-MM.' }, 400);
  }

  return context.json({ ...monthlySummary(getDatabase(), month), availableMonths: months });
});
