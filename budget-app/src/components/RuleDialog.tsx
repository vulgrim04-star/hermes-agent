import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { apiGet, apiSend } from '../lib/api.js';
import type { Category, Owner } from '../lib/api.js';
import { OWNER_ORDER, ownerLabel } from '../lib/labels.js';
import { Badge, Button, Field, inputClass } from './ui.js';
import { Dialog } from './Dialog.js';

/**
 * Apprentissage : proposer la règle correspondant à l'écriture qu'on vient de
 * classer.
 *
 * Le motif proposé est modifiable, et le nombre d'écritures qu'il prendrait est
 * recalculé à chaque frappe : une règle trop large se voit **avant** d'être
 * posée, pas après. La règle ne touche que les écritures non catégorisées.
 */
export function RuleDialog({
  transaction,
  categories,
  onClose,
  onCreated,
}: {
  transaction: { id: number; label: string; amount_cents: number };
  categories: Category[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [pattern, setPattern] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [owner, setOwner] = useState<Owner | ''>('');
  const [direction, setDirection] = useState<'tout' | 'debit' | 'credit'>(
    transaction.amount_cents < 0 ? 'debit' : 'credit',
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const suggestion = useQuery({
    queryKey: ['rule-suggestion', transaction.id],
    queryFn: () =>
      apiGet<{ pattern: string }>(
        `/regles/suggestion?libelle=${encodeURIComponent(transaction.label)}`,
      ),
  });

  useEffect(() => {
    if (suggestion.data !== undefined && pattern === '') setPattern(suggestion.data.pattern);
  }, [suggestion.data, pattern]);

  const [impact, setImpact] = useState<number | null>(null);
  useEffect(() => {
    if (pattern.trim() === '' || categoryId === '') {
      setImpact(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void apiSend<{ count: number }>('/regles/simuler', 'POST', {
        pattern,
        categoryId: Number(categoryId),
        direction,
      })
        .then((result) => {
          if (!cancelled) setImpact(result.count);
        })
        .catch(() => {
          if (!cancelled) setImpact(null);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pattern, categoryId, direction]);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const result = await apiSend<{ applied: number }>('/regles', 'POST', {
        pattern,
        categoryId: Number(categoryId),
        owner: owner === '' ? null : owner,
        direction,
      });
      // La règle vient d'être appliquée : l'écriture d'origine est classée avec
      // les autres, il n'y a rien de plus à faire ici.
      void result;
      onCreated();
    } catch (cause) {
      setError((cause as Error).message);
      setBusy(false);
    }
  }

  return (
    <Dialog
      title="Créer la règle correspondante"
      description={transaction.label}
      onClose={onClose}
      footer={
        <>
          <Button
            variant="primary"
            disabled={pattern.trim() === '' || categoryId === '' || busy}
            onClick={() => void create()}
          >
            Créer et appliquer
          </Button>
          <Button onClick={onClose}>Annuler</Button>
          <span className="ml-auto text-sm text-slate-600">
            {impact === null ? (
              'Choisissez une catégorie pour chiffrer la portée.'
            ) : (
              <>
                Cette règle classerait <strong>{impact}</strong> écriture
                {impact > 1 ? 's' : ''} non catégorisée{impact > 1 ? 's' : ''}.
              </>
            )}
          </span>
        </>
      }
    >
      <div className="flex flex-wrap gap-4">
        <Field label="Motif du libellé (contenu)">
          <input
            className={`${inputClass} w-72`}
            value={pattern}
            onChange={(event) => setPattern(event.target.value)}
          />
        </Field>
        <Field label="Catégorie">
          <select
            className={`${inputClass} w-72`}
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
          >
            <option value="">Choisir…</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.parent_name === null
                  ? category.name
                  : `${category.parent_name} › ${category.name}`}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Sens du mouvement">
          <select
            className={inputClass}
            value={direction}
            onChange={(event) =>
              setDirection(event.target.value as 'tout' | 'debit' | 'credit')
            }
          >
            <option value="tout">Indifférent</option>
            <option value="debit">Débits seulement</option>
            <option value="credit">Crédits seulement</option>
          </select>
        </Field>
        <Field label="Attribuer à">
          <select
            className={inputClass}
            value={owner}
            onChange={(event) => setOwner(event.target.value as Owner | '')}
          >
            <option value="">Ne rien changer</option>
            {OWNER_ORDER.map((value) => (
              <option key={value} value={value}>
                {ownerLabel(value)}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <p className="mt-4 text-xs text-slate-500">
        Le motif est comparé au libellé sans tenir compte de la casse, des accents ni de la
        ponctuation. La règle comble les vides : elle ne défait jamais une catégorie posée à la
        main, ni une écriture déjà découpée.
      </p>
      {error !== null && (
        <p className="mt-3">
          <Badge tone="error">{error}</Badge>
        </p>
      )}
    </Dialog>
  );
}
