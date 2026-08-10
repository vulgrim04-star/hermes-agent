import { useEffect } from 'react';
import type React from 'react';

/** Boîte de dialogue modale : fond assombri, fermeture par Échap ou par le fond. */
export function Dialog({
  title,
  description,
  onClose,
  children,
  footer,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    }
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-8"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-3xl rounded-lg border border-slate-200 bg-white shadow-xl">
        <header className="border-b border-slate-100 px-5 py-3">
          <h2 className="font-semibold">{title}</h2>
          {description !== undefined && <p className="text-sm text-slate-500">{description}</p>}
        </header>
        <div className="p-5">{children}</div>
        {footer !== undefined && (
          <footer className="flex flex-wrap items-center gap-3 border-t border-slate-100 px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
