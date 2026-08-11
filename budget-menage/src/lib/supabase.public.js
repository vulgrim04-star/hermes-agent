/**
 * Identifiants **publics** du projet Supabase du ménage.
 *
 * Ces deux valeurs sont publiques par construction : elles partent dans le
 * bundle que télécharge chaque visiteur, quel que soit l'endroit où on les
 * range. Les cacher dans un secret de dépôt ne protégerait donc rien — ce qui
 * protège les données, c'est la RLS : `auth.uid() = user_id`, sur les quatre
 * opérations, sans lecture anonyme (voir `supabase/policies.sql`).
 *
 * Le corollaire mérite d'être écrit noir sur blanc : **tant que
 * `schema.sql` et `policies.sql` n'ont pas été exécutés, cette clé ouvre une
 * table sans règle.** `schema.sql` active la RLS dans la même transaction que
 * la création de la table, ce qui ferme l'accès à tous par défaut ; les
 * policies l'ouvrent ensuite au seul titulaire.
 *
 * Ce qui n'a rien à faire ici : la clé `service_role` (ancien format) ou une
 * clé `sb_secret_…` (nouveau format). Toutes deux contournent la RLS. La
 * construction les refuse — voir le garde-fou de `vite.config.js`.
 *
 * Ces valeurs ne sont qu'un défaut : une variable de construction
 * (`SUPABASE_URL`, `VITE_SUPABASE_URL`…) l'emporte, ce qui permet de pointer
 * un autre projet sans toucher au code.
 */

export const PUBLIC_SUPABASE_URL = 'https://nndzwflgkzejldncanjv.supabase.co';

/** Clé « publishable » — le format qui remplace l'ancienne clé « anon ». */
export const PUBLIC_SUPABASE_KEY = 'sb_publishable_d_3MqS8h7s7joJmhnNVGXQ_dF1Hrl7_';
