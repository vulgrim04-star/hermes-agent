import type React from 'react';

import { formatCents } from '../../shared/money.js';

export function Card({
  title,
  description,
  children,
  actions,
}: {
  title?: string;
  description?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section className="rounded-lg bg-white shadow-[0_1px_2px_rgb(0_0_0/6%),0_4px_16px_rgb(0_0_0/4%)]">
      {(title !== undefined || actions !== undefined) && (
        <header className="flex flex-wrap items-center gap-3 px-5 pt-4">
          <div>
            {title !== undefined && <h2 className="font-semibold">{title}</h2>}
            {description !== undefined && (
              <p className="text-sm text-slate-500">{description}</p>
            )}
          </div>
          {actions !== undefined && <div className="ml-auto flex gap-2">{actions}</div>}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

type Variant = 'default' | 'primary' | 'danger' | 'ghost';

/*
 * Le bleu ne désigne qu'une chose : ce sur quoi on peut appuyer. Le bouton
 * ordinaire est donc un fond neutre et un libellé bleu, le bouton principal un
 * aplat bleu — la hiérarchie tient à la surface, pas à la teinte.
 */
const VARIANTS: Record<Variant, string> = {
  default: 'bg-slate-100 text-blue-600 hover:bg-slate-200',
  primary: 'bg-blue-600 on-accent hover:brightness-110',
  danger: 'text-red-700 hover:bg-red-50',
  ghost: 'text-blue-600 hover:bg-slate-100',
};

/* 44 px de haut : la plus petite cible qu'un pouce vise sans se tromper. */
const CONTROL =
  'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-md px-4 text-[15px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40';

export function Button({
  variant = 'default',
  className = '',
  ...props
}: React.ComponentProps<'button'> & { variant?: Variant }) {
  return (
    <button type="button" {...props} className={`${CONTROL} ${VARIANTS[variant]} ${className}`} />
  );
}

/**
 * Lien de téléchargement présenté comme un bouton.
 *
 * Un `<button>` glissé dans un `<a>` est du HTML invalide, et le téléchargement
 * n'y est alors pas garanti : c'est l'ancre elle-même qui porte le style.
 */
export function DownloadLink({
  variant = 'default',
  className = '',
  ...props
}: React.ComponentProps<'a'> & { variant?: Variant }) {
  return <a download {...props} className={`${CONTROL} ${VARIANTS[variant]} ${className}`} />;
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}

/* 16 px au minimum : en deçà, Safari zoome la page à la mise au point du champ. */
export const inputClass =
  'min-h-[44px] rounded-md border border-slate-200 bg-white px-3 text-[16px] outline-none focus:border-blue-600';

/**
 * Montant aligné, et coloré seulement quand la couleur dit quelque chose.
 *
 * Le vert marque un crédit — ils sont rares, on les cherche. Un débit garde la
 * couleur du texte : c'est le cas ordinaire d'un relevé, et le peindre en rouge
 * userait le rouge jusqu'à ce qu'il ne signale plus rien. Le rouge reste pour
 * ce qui ne va pas : un rapprochement qui ne boucle pas, une fortune négative.
 */
export function Amount({ cents, className = '' }: { cents: number; className?: string }) {
  const tone = cents > 0 ? 'text-emerald-700 font-medium' : cents === 0 ? 'text-slate-400' : '';
  return <span className={`tabular ${tone} ${className}`}>{formatCents(cents)}</span>;
}

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'ok' | 'warn' | 'error';
  children: React.ReactNode;
}) {
  const tones: Record<string, string> = {
    neutral: 'bg-slate-100 text-slate-500',
    ok: 'bg-emerald-100 text-emerald-800',
    warn: 'bg-amber-100 text-amber-800',
    error: 'bg-red-100 text-red-800',
  };
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-[13px] font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="py-8 text-center text-sm text-slate-500">{children}</p>;
}
