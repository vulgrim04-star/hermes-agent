import { Hono } from 'hono';

import { getDatabase } from '../db/connection.js';
import { annualSummary, availableYears } from '../domain/annual.js';
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

dashboard.get('/annuel', (context) => {
  const db = getDatabase();
  const years = availableYears(db);
  const requested = context.req.query('annee');
  const year = Number(requested ?? years[0] ?? new Date().getUTCFullYear());

  if (!Number.isInteger(year) || year < 1900 || year > 2200) {
    return context.json({ message: 'Année attendue au format AAAA.' }, 400);
  }

  return context.json({ ...annualSummary(db, year), availableYears: years });
});
