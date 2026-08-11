/**
 * Thème clair / sombre.
 *
 * Trois états, pas deux. « Automatique » ne stampe rien sur la racine et laisse
 * `prefers-color-scheme` décider ; « clair » et « sombre » posent
 * `data-theme` et l'emportent sur le réglage du téléphone. La feuille de style
 * définit les trois cas, dans cet ordre exact — sans quoi le choix manuel ne
 * pourrait pas contredire le système.
 *
 * Le choix est retenu dans ce navigateur seulement : c'est une préférence
 * d'affichage, elle n'a rien à faire dans le journal comptable synchronisé.
 */

const KEY = 'budget-theme';
export const THEMES = ['auto', 'light', 'dark'];

export function getTheme() {
  try {
    const stored = localStorage.getItem(KEY);
    return THEMES.includes(stored) ? stored : 'auto';
  } catch {
    return 'auto';
  }
}

export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);

  // La barre d'état d'iOS se teinte d'après cette méta : sans mise à jour, elle
  // resterait claire au-dessus d'une application passée en sombre.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const dark =
      theme === 'dark' ||
      (theme === 'auto' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
    meta.setAttribute('content', dark ? '#000000' : '#f2f2f7');
  }
}

export function setTheme(theme) {
  const next = THEMES.includes(theme) ? theme : 'auto';
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* stockage refusé : le choix ne vaudra que pour cette visite */
  }
  applyTheme(next);
  return next;
}

/** À appeler une fois au démarrage. */
export function initTheme() {
  const theme = getTheme();
  applyTheme(theme);
  // En automatique, suivre le téléphone qui bascule en cours de route.
  window
    .matchMedia?.('(prefers-color-scheme: dark)')
    .addEventListener?.('change', () => {
      if (getTheme() === 'auto') applyTheme('auto');
    });
  return theme;
}
