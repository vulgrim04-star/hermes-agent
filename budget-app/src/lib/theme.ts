/**
 * Thème clair / sombre — même contrat que l'application en ligne.
 *
 * Trois états et non deux : « automatique » ne stampe rien et laisse
 * `prefers-color-scheme` décider ; « clair » et « sombre » posent `data-theme`
 * et l'emportent sur le réglage du système.
 */

const KEY = 'budget-theme';

export const THEMES = ['auto', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_LABELS: [Theme, string][] = [
  ['auto', 'Automatique'],
  ['light', 'Clair'],
  ['dark', 'Sombre'],
];

function isTheme(value: string | null): value is Theme {
  return value !== null && (THEMES as readonly string[]).includes(value);
}

export function getTheme(): Theme {
  try {
    const stored = localStorage.getItem(KEY);
    return isTheme(stored) ? stored : 'auto';
  } catch {
    return 'auto';
  }
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

export function setTheme(theme: Theme): Theme {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* stockage refusé : le choix ne vaudra que pour cette visite */
  }
  applyTheme(theme);
  return theme;
}

/** À appeler une fois au démarrage. */
export function initTheme(): Theme {
  const theme = getTheme();
  applyTheme(theme);
  window
    .matchMedia?.('(prefers-color-scheme: dark)')
    .addEventListener?.('change', () => {
      if (getTheme() === 'auto') applyTheme('auto');
    });
  return theme;
}
