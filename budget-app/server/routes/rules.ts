import { Hono } from 'hono';

import { isOwner } from '../../shared/model.js';
import { getDatabase } from '../db/connection.js';
import { applyRules, compileRegex, countMatches, suggestPattern } from '../domain/rules.js';
import type { CategoryRule, Direction, MatchType } from '../domain/rules.js';

export const rules = new Hono();

interface RuleBody {
  pattern?: string;
  matchType?: string;
  categoryId?: number | null;
  owner?: string | null;
  direction?: string;
  accountId?: number | null;
  priority?: number;
  isActive?: boolean;
}

/** Normalise et valide le corps d'une requête, ou rend le motif du refus. */
function readRule(body: RuleBody): { rule: Omit<CategoryRule, 'id'> } | { error: string } {
  const pattern = (body.pattern ?? '').trim();
  if (pattern === '') return { error: 'Le motif est obligatoire.' };

  const matchType: MatchType = body.matchType === 'regex' ? 'regex' : 'contient';
  // Une expression invalide est refusée ici plutôt que d'être silencieusement
  // sans effet à chaque application.
  if (matchType === 'regex' && compileRegex(pattern) === null) {
    return { error: 'Expression régulière invalide.' };
  }
  if (body.categoryId === undefined || body.categoryId === null) {
    return { error: 'La catégorie cible est obligatoire.' };
  }

  const direction: Direction =
    body.direction === 'debit' || body.direction === 'credit' ? body.direction : 'tout';

  return {
    rule: {
      pattern,
      match_type: matchType,
      category_id: body.categoryId,
      owner: isOwner(body.owner) ? body.owner : null,
      direction,
      account_id: body.accountId ?? null,
      priority: Number.isFinite(body.priority) ? Number(body.priority) : 100,
      is_active: body.isActive === false ? 0 : 1,
    },
  };
}

rules.get('/', (context) => {
  const rows = getDatabase()
    .prepare(
      `SELECT r.*, c.name AS category_name, p.name AS category_parent_name, a.label AS account_label
         FROM category_rules r
         LEFT JOIN categories c ON c.id = r.category_id
         LEFT JOIN categories p ON p.id = c.parent_id
         LEFT JOIN accounts a ON a.id = r.account_id
        ORDER BY r.priority, r.id`,
    )
    .all();
  return context.json(rows);
});

/** Motif proposé pour un libellé, sans rien créer. */
rules.get('/suggestion', (context) => {
  const label = context.req.query('libelle') ?? '';
  return context.json({ pattern: suggestPattern(label) });
});

/**
 * Chiffre ce qu'une règle prendrait avant qu'elle n'existe : une règle trop
 * large doit se voir avant d'être posée, pas après.
 */
rules.post('/simuler', async (context) => {
  const parsed = readRule((await context.req.json()) as RuleBody);
  if ('error' in parsed) return context.json({ message: parsed.error }, 400);
  return context.json({ count: countMatches(getDatabase(), parsed.rule) });
});

rules.post('/', async (context) => {
  const body = (await context.req.json()) as RuleBody & { apply?: boolean };
  const parsed = readRule(body);
  if ('error' in parsed) return context.json({ message: parsed.error }, 400);

  const db = getDatabase();
  const info = db
    .prepare(
      `INSERT INTO category_rules (pattern, match_type, category_id, owner, direction, account_id, priority, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      parsed.rule.pattern,
      parsed.rule.match_type,
      parsed.rule.category_id,
      parsed.rule.owner,
      parsed.rule.direction,
      parsed.rule.account_id,
      parsed.rule.priority,
      parsed.rule.is_active,
    );

  // Une règle apprise comble les vides : elle rattrape les écritures non
  // catégorisées déjà en base, sans jamais défaire un classement manuel.
  const applied = body.apply === false ? { updated: 0 } : applyRules(db);
  return context.json({ id: Number(info.lastInsertRowid), applied: applied.updated }, 201);
});

rules.patch('/:id', async (context) => {
  const body = (await context.req.json()) as RuleBody;
  const db = getDatabase();

  if (body.pattern !== undefined || body.matchType !== undefined) {
    const parsed = readRule(body);
    if ('error' in parsed) return context.json({ message: parsed.error }, 400);
  }

  const changes = db
    .prepare(
      `UPDATE category_rules
          SET pattern = COALESCE(?, pattern),
              match_type = COALESCE(?, match_type),
              category_id = COALESCE(?, category_id),
              direction = COALESCE(?, direction),
              priority = COALESCE(?, priority),
              is_active = COALESCE(?, is_active),
              owner = CASE WHEN ? THEN ? ELSE owner END,
              account_id = CASE WHEN ? THEN ? ELSE account_id END
        WHERE id = ?`,
    )
    .run(
      body.pattern ?? null,
      body.matchType ?? null,
      body.categoryId ?? null,
      body.direction ?? null,
      body.priority ?? null,
      body.isActive === undefined ? null : body.isActive ? 1 : 0,
      body.owner === undefined ? 0 : 1,
      isOwner(body.owner) ? body.owner : null,
      body.accountId === undefined ? 0 : 1,
      body.accountId ?? null,
      context.req.param('id'),
    ).changes;

  return changes > 0
    ? context.json({ ok: true })
    : context.json({ message: 'Règle introuvable.' }, 404);
});

rules.delete('/:id', (context) => {
  const changes = getDatabase()
    .prepare('DELETE FROM category_rules WHERE id = ?')
    .run(context.req.param('id')).changes;
  return changes > 0
    ? context.json({ ok: true })
    : context.json({ message: 'Règle introuvable.' }, 404);
});

/** Rejoue toutes les règles sur les écritures non catégorisées. */
rules.post('/appliquer', (context) => context.json(applyRules(getDatabase())));
