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
export function assertAnonKey(key) {
  if (!key) return '';

  // Nouveau format de clés : `sb_publishable_…` est faite pour le navigateur,
  // `sb_secret_…` est son équivalent de la clé service_role et contourne la
  // RLS. Le rôle n'y est plus lisible dans le jeton — seul le préfixe le dit.
  if (/^sb_secret_/i.test(key)) {
    throw new Error(
      'Clé Supabase « sb_secret_… » : refusé. Elle contourne toutes les règles d’accès et ne ' +
        'doit jamais entrer dans un bundle. La clé du navigateur est « sb_publishable_… ».',
    );
  }
  if (/^sb_publishable_/i.test(key)) return key;

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

/**
 * Service worker : l'application doit s'ouvrir **sans réseau**.
 *
 * C'était une contradiction du produit : tout est calculé et rangé dans le
 * navigateur, aucune requête n'est nécessaire pour lire son budget — et
 * pourtant l'application, installée sur l'écran d'accueil, ne démarrait pas
 * dans un train. Le journal était local, le code ne l'était pas.
 *
 * La liste des fichiers à mettre en cache est **écrite à la construction** :
 * les noms portent une empreinte de contenu, et une liste tenue à la main
 * serait fausse dès le déploiement suivant. Le cache est nommé d'après cette
 * même empreinte, si bien qu'une nouvelle version n'hérite jamais des
 * fichiers de l'ancienne.
 */
function serviceWorker() {
  let base = '/';
  return {
    name: 'budget-service-worker',
    configResolved(config) { base = config.base; },
    generateBundle(_options, bundle) {
      const fichiers = Object.keys(bundle)
        .filter((f) => !f.endsWith('.map'))
        .map((f) => base + f);
      // `index.html` n'est pas dans le bundle des assets : il est émis à part.
      const shell = [base, base + 'index.html', base + 'manifest.webmanifest',
        base + 'icon-192.png', base + 'icon-512.png', base + 'icon.svg', base + 'favicon.svg'];
      const liste = [...new Set([...shell, ...fichiers])];
      const version = fichiers.find((f) => f.endsWith('.js')) || String(Date.now());

      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: `/* Généré à la construction — ne pas modifier à la main. */
const CACHE = 'budget-' + ${JSON.stringify(version)};
const PRECACHE = ${JSON.stringify(liste, null, 2)};

self.addEventListener('install', (e) => {
  // Chaque fichier est demandé séparément : un seul 404 ne doit pas faire
  // échouer l'installation entière et laisser l'application sans cache.
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(
    PRECACHE.map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => null)),
  )).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((cles) => Promise.all(cles.filter((c) => c !== CACHE).map((c) => caches.delete(c))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Rien de ce qui sort du site n'est mis en cache : ni Supabase, ni quoi que
  // ce soit d'autre. Un journal comptable n'a pas à traîner dans un cache HTTP.
  if (url.origin !== self.location.origin) return;

  // Une navigation retombe sur la coquille : l'application est une SPA, et
  // hors ligne il n'y a personne pour servir /ecritures.
  if (request.mode === 'navigate') {
    e.respondWith(fetch(request).catch(() => caches.match(${JSON.stringify(base + 'index.html')})
      .then((r) => r || caches.match(${JSON.stringify(base)}))));
    return;
  }

  // Les assets portent une empreinte : s'ils sont en cache, ils sont bons.
  e.respondWith(caches.match(request).then((hit) => hit || fetch(request).then((reponse) => {
    if (reponse && reponse.ok && reponse.type === 'basic') {
      const copie = reponse.clone();
      caches.open(CACHE).then((c) => c.put(request, copie));
    }
    return reponse;
  })));
});
`,
      });
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
    plugins: [react(), spaFallback(), serviceWorker()],
    define: {
      __SUPABASE_URL__: JSON.stringify(url),
      __SUPABASE_ANON_KEY__: JSON.stringify(key),
    },
  };
});
