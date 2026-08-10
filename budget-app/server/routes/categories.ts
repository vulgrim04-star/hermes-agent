import { Hono } from 'hono';

import { getDatabase } from '../db/connection.js';

export const categories = new Hono();

categories.get('/', (context) => {
  const rows = getDatabase()
    .prepare(
      `SELECT c.*, p.name AS parent_name
         FROM categories c
         LEFT JOIN categories p ON p.id = c.parent_id
        ORDER BY COALESCE(p.sort_order, c.sort_order), p.name, c.sort_order, c.name`,
    )
    .all();
  return context.json(rows);
});

categories.post('/', async (context) => {
  const body = (await context.req.json()) as {
    name?: string;
    kind?: string;
    parentId?: number | null;
    sortOrder?: number;
  };
  if (!body.name || !body.kind) {
    return context.json({ message: 'Le nom et le type de mouvement sont obligatoires.' }, 400);
  }

  try {
    const info = getDatabase()
      .prepare('INSERT INTO categories (parent_id, name, kind, sort_order) VALUES (?, ?, ?, ?)')
      .run(body.parentId ?? null, body.name, body.kind, body.sortOrder ?? 999);
    return context.json({ id: Number(info.lastInsertRowid) }, 201);
  } catch (error) {
    return context.json({ message: (error as Error).message }, 400);
  }
});

categories.patch('/:id', async (context) => {
  const body = (await context.req.json()) as { name?: string; sortOrder?: number };
  const changes = getDatabase()
    .prepare('UPDATE categories SET name = COALESCE(?, name), sort_order = COALESCE(?, sort_order) WHERE id = ?')
    .run(body.name ?? null, body.sortOrder ?? null, context.req.param('id')).changes;
  return changes > 0
    ? context.json({ ok: true })
    : context.json({ message: 'Catégorie introuvable.' }, 404);
});

categories.delete('/:id', (context) => {
  const changes = getDatabase()
    .prepare('DELETE FROM categories WHERE id = ?')
    .run(context.req.param('id')).changes;
  return changes > 0
    ? context.json({ ok: true })
    : context.json({ message: 'Catégorie introuvable.' }, 404);
});
