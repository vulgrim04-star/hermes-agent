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
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      {(title !== undefined || actions !== undefined) && (
        <header className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-3">
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

const VARIANTS: Record<Variant, string> = {
  default: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
  primary: 'bg-slate-900 text-white hover:bg-slate-700',
  danger: 'border border-red-300 bg-white text-red-700 hover:bg-red-50',
  ghost: 'text-slate-500 hover:bg-slate-100',
};

const CONTROL =
  'inline-block rounded-md px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50';

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

export const inputClass =
  'rounded-md border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-slate-500';

/** Montant aligné et coloré selon le sens : rouge en sortie, vert en entrée. */
export function Amount({ cents, className = '' }: { cents: number; className?: string }) {
  const tone = cents < 0 ? 'text-red-700' : cents > 0 ? 'text-emerald-700' : 'text-slate-500';
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
    neutral: 'bg-slate-100 text-slate-600',
    ok: 'bg-emerald-100 text-emerald-800',
    warn: 'bg-amber-100 text-amber-800',
    error: 'bg-red-100 text-red-800',
  };
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="py-8 text-center text-sm text-slate-500">{children}</p>;
}
