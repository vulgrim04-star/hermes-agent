/**
 * Thème.
 *
 * **L'application est sombre par défaut**, quel que soit le réglage du
 * téléphone : c'est un parti pris d'identité, comme chez Finary, et non une
 * conséquence des préférences système. Trois choix restent offerts —
 * « sombre » (le défaut), « clair », et « comme le téléphone » pour qui veut
 * que l'application suive son mode nuit.
 *
 * Conséquence importante pour la feuille de style : l'état **non stampé** de la
 * racine est le thème sombre. Le clair ne s'applique que sous
 * `[data-theme="light"]`, et c'est ce script — jamais une requête média — qui
 * pose l'attribut, y compris en mode « comme le téléphone ». Aucune couleur ne
 * dépend donc de `prefers-color-scheme`, et il n'existe aucun état où le texte
 * d'un thème se poserait sur le fond de l'autre.
 *
 * Le choix est retenu dans ce navigateur seulement : c'est une préférence
 * d'affichage, elle n'a rien à faire dans le journal comptable synchronisé.
 */

const KEY = 'budget-theme';
export const THEMES = ['dark', 'light', 'auto'];

export const THEME_LABELS = { dark: 'Sombre', light: 'Clair', auto: 'Téléphone' };

export function getTheme() {
  try {
    const stored = localStorage.getItem(KEY);
    return THEMES.includes(stored) ? stored : 'dark';
  } catch {
    return 'dark';
  }
}

/** Le thème effectivement rendu : « auto » se résout ici, pas dans le CSS. */
function resolve(theme) {
  if (theme === 'light') return 'light';
  if (theme === 'auto') {
    return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return 'dark';
}

export function applyTheme(theme) {
  const root = document.documentElement;
  const rendu = resolve(theme);
  if (rendu === 'light') root.setAttribute('data-theme', 'light');
  else root.removeAttribute('data-theme');

  // La barre d'état d'iOS se teinte d'après cette méta : sans mise à jour, elle
  // resterait claire au-dessus d'une application passée en sombre.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', rendu === 'light' ? '#f4f4f7' : '#0a0a0d');
  return rendu;
}

export function setTheme(theme) {
  const next = THEMES.includes(theme) ? theme : 'dark';
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
  // En mode « comme le téléphone », suivre celui qui bascule en cours de route.
  window
    .matchMedia?.('(prefers-color-scheme: light)')
    .addEventListener?.('change', () => {
      if (getTheme() === 'auto') applyTheme('auto');
    });
  return theme;
}

/* ------------------------------------------------------------- discrétion */

const MASQUE = 'budget-masque';

/**
 * Masquage des montants — l'œil de l'en-tête, pour consulter dans un train.
 *
 * Le masque est un attribut sur la racine, et le flou est posé par la feuille
 * de style sur les classes qui portent des chiffres. Aucun composant n'a à
 * s'en soucier : un montant ne peut donc pas rester lisible parce qu'on aurait
 * oublié de l'envelopper quelque part.
 */
export function getMasque() {
  try {
    return localStorage.getItem(MASQUE) === '1';
  } catch {
    return false;
  }
}

export function applyMasque(masque) {
  const root = document.documentElement;
  if (masque) root.setAttribute('data-masque', '1');
  else root.removeAttribute('data-masque');
}

export function setMasque(masque) {
  try {
    localStorage.setItem(MASQUE, masque ? '1' : '0');
  } catch {
    /* stockage refusé : le masque ne vaudra que pour cette visite */
  }
  applyMasque(masque);
  return masque;
}

export function initMasque() {
  const masque = getMasque();
  applyMasque(masque);
  return masque;
}
