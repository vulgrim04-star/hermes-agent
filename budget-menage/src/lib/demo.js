/**
 * Mode démonstration.
 *
 * `?demo=1` donne accès à l'application sans compte : les écritures restent
 * dans ce navigateur et ne rejoignent aucun serveur. Deux usages :
 * essayer l'application avant d'avoir branché Supabase, et travailler sur un
 * poste où l'on ne veut rien déposer en ligne.
 *
 * Le drapeau est retenu pour la session de l'onglet, sinon la première
 * navigation interne le perdrait.
 */

const KEY = 'budget-demo';

export function isDemo() {
  if (typeof window === 'undefined') return false;
  try {
    if (new URLSearchParams(window.location.search).get('demo') === '1') {
      sessionStorage.setItem(KEY, '1');
      return true;
    }
    return sessionStorage.getItem(KEY) === '1';
  } catch {
    // Stockage refusé (navigation privée verrouillée) : le paramètre seul fait foi.
    return new URLSearchParams(window.location.search).get('demo') === '1';
  }
}

export function leaveDemo() {
  try { sessionStorage.removeItem(KEY); } catch { /* rien à nettoyer */ }
  window.location.href = '/';
}

export const DEMO_STORAGE_KEY = 'budget-demo-data';
