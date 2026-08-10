/**
 * Serveur d'API local.
 *
 * Lié à `127.0.0.1` et à rien d'autre : ce sont des données bancaires, elles ne
 * doivent pas être joignables depuis le réseau local, ni a fortiori au-delà.
 * Aucune requête sortante n'est émise par ce serveur.
 */

import { serve } from '@hono/node-server';
import { Hono } from 'hono';

import { API_PORT } from '../shared/ports.js';
import { DATABASE_FILE, getDatabase } from './db/connection.js';
import { accounts } from './routes/accounts.js';
import { budgets } from './routes/budgets.js';
import { categories } from './routes/categories.js';
import { dashboard } from './routes/dashboard.js';
import { backups, exports_ } from './routes/exports.js';
import { externalCategories } from './routes/external-categories.js';
import { imports } from './routes/imports.js';
import { networth } from './routes/networth.js';
import { review } from './routes/review.js';
import { rules } from './routes/rules.js';
import { transactions } from './routes/transactions.js';

const app = new Hono();

app.get('/api/sante', (context) =>
  context.json({
    ok: true,
    base: DATABASE_FILE,
    version: getDatabase().pragma('user_version', { simple: true }),
  }),
);

app.get('/api/parametres', (context) => {
  const rows = getDatabase().prepare('SELECT key, value FROM settings').all() as {
    key: string;
    value: string;
  }[];
  return context.json(Object.fromEntries(rows.map((row) => [row.key, row.value])));
});

app.patch('/api/parametres', async (context) => {
  const body = (await context.req.json()) as Record<string, string>;
  const statement = getDatabase().prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
  );
  for (const [key, value] of Object.entries(body)) statement.run(key, String(value));
  return context.json({ ok: true });
});

app.route('/api/comptes', accounts);
app.route('/api/categories', categories);
app.route('/api/transactions', transactions);
app.route('/api/imports', imports);
app.route('/api/regles', rules);
app.route('/api/revision', review);
app.route('/api/budgets', budgets);
app.route('/api/tableau-de-bord', dashboard);
app.route('/api/categories-banque', externalCategories);
app.route('/api/patrimoine', networth);
app.route('/api/export', exports_);
app.route('/api/sauvegardes', backups);

app.onError((error, context) => {
  console.error('[api]', error);
  return context.json({ message: error.message }, 500);
});

getDatabase();

serve({ fetch: app.fetch, port: API_PORT, hostname: '127.0.0.1' }, (info) => {
  console.log(`API budget sur http://127.0.0.1:${info.port} — base ${DATABASE_FILE}`);
});
