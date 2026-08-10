import { Hono } from 'hono';

import { getDatabase } from '../db/connection.js';
import {
  applyExternalCategories,
  listExternalCategories,
  saveExternalCategory,
} from '../domain/external-categories.js';
import type { TreatAs } from '../domain/external-categories.js';

export const externalCategories = new Hono();

const TREATMENTS: TreatAs[] = ['categorie', 'transfert-interne', 'ignorer'];

externalCategories.get('/', (context) => context.json(listExternalCategories(getDatabase())));

externalCategories.put('/', async (context) => {
  const body = (await context.req.json()) as {
    externalLabel?: string;
    categoryId?: number | null;
    treatAs?: string;
  };

  const label = (body.externalLabel ?? '').trim();
  if (label === '') return context.json({ message: 'Libellé de la banque manquant.' }, 400);

  const treatAs = TREATMENTS.includes(body.treatAs as TreatAs)
    ? (body.treatAs as TreatAs)
    : 'categorie';

  saveExternalCategory(getDatabase(), {
    externalLabel: label,
    categoryId: typeof body.categoryId === 'number' ? body.categoryId : null,
    treatAs,
  });
  return context.json({ ok: true });
});

/**
 * Application rétroactive.
 *
 * Utile après avoir complété la table : les écritures déjà importées et restées
 * sans catégorie sont reprises, celles qui en ont une ne bougent pas.
 */
externalCategories.post('/appliquer', (context) =>
  context.json(applyExternalCategories(getDatabase())),
);
