import { copyFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Résolution des identifiants Supabase au moment de la construction.
 *
 * `import.meta.env` n'expose au navigateur que les variables préfixées
 * `VITE_`. Or l'intégration Supabase de Vercel, elle, injecte `SUPABASE_URL` et
 * `SUPABASE_ANON_KEY` — parfois préfixées du nom du projet
 * (`Monprojet_SUPABASE_URL`). Sans ce pont, installer l'intégration ne suffirait
 * pas et il faudrait recopier les deux valeurs à la main, ce qui est justement
 * l'étape où l'on se trompe.
 *
 * On accepte donc plusieurs noms, et on refuse de construire si la clé trouvée
 * n'est pas la clé publique.
 */
function pick(env, suffix) {
  const candidates = Object.keys(env).filter(
    (key) => key.endsWith(suffix) && !/SERVICE_ROLE/i.test(key) && env[key],
  );
  // `VITE_…` d'abord : une valeur posée explicitement l'emporte sur celle
  // qu'une intégration a devinée.
  candidates.sort((a, b) => (a.startsWith('VITE_') ? -1 : b.startsWith('VITE_') ? 1 : 0));
  return candidates.length ? env[candidates[0]] : '';
}

/**
 * Garde-fou : la clé `service_role` contourne toutes les règles d'accès. Elle
 * n'a rien à faire dans un bundle envoyé à chaque visiteur, et une variable mal
 * nommée suffirait à l'y mettre. On lit le rôle dans le jeton et on arrête la
 * construction plutôt que de publier ça.
 */
function assertAnonKey(key) {
  if (!key) return '';
  const parts = key.split('.');
  if (parts.length !== 3) return key; // pas un JWT : rien à vérifier
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
    if (payload.role && payload.role !== 'anon') {
      throw new Error(
        `Clé Supabase de rôle « ${payload.role} » : refusé. Seule la clé « anon » peut entrer ` +
          'dans le bundle — la clé service_role contourne toutes les règles d’accès.',
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Clé Supabase')) throw error;
    // Charge utile illisible : on laisse passer, Supabase rejettera la clé.
  }
  return key;
}

/**
 * GitHub Pages n'a pas de réécriture : une URL profonde comme `/ecritures`
 * tomberait sur son 404. Servir la même page en 404.html fait démarrer
 * l'application, qui reprend alors la route demandée.
 */
function spaFallback() {
  return {
    name: 'spa-fallback-404',
    closeBundle() {
      const from = resolve('dist/index.html');
      if (existsSync(from)) copyFileSync(from, resolve('dist/404.html'));
    },
  };
}

export default defineConfig(() => {
  const url = pick(process.env, 'SUPABASE_URL');
  const key = assertAnonKey(pick(process.env, 'SUPABASE_ANON_KEY'));

  return {
    // GitHub Pages sert un dépôt de projet sous `/<dépôt>/` ; Vercel sert à la
    // racine. La base se règle donc à la construction plutôt que d'être figée.
    base: process.env.BASE_PATH || '/',
    plugins: [react(), spaFallback()],
    define: {
      __SUPABASE_URL__: JSON.stringify(url),
      __SUPABASE_ANON_KEY__: JSON.stringify(key),
    },
  };
});
