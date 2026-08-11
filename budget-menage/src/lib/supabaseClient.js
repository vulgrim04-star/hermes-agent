import { createClient } from '@supabase/supabase-js';

/*
 * Les identifiants sont résolus à la construction (voir vite.config.js) : cela
 * permet à l'intégration Supabase de Vercel de fonctionner telle quelle, sans
 * recopier les deux valeurs à la main — c'est justement l'étape où l'on se
 * trompe. `import.meta.env` reste consulté pour le développement local.
 */
/* global __SUPABASE_URL__, __SUPABASE_ANON_KEY__ */
const url =
  (typeof __SUPABASE_URL__ === 'string' && __SUPABASE_URL__) || import.meta.env.VITE_SUPABASE_URL || '';
const key =
  (typeof __SUPABASE_ANON_KEY__ === 'string' && __SUPABASE_ANON_KEY__) ||
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  '';

/** Dit clairement ce qui manque plutôt que d'échouer sur un `undefined`. */
export const configured = Boolean(url && key);

export const supabase = configured ? createClient(url, key) : null;
