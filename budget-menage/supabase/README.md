# Supabase — schéma et sécurité

Ce dossier est la **source de vérité versionnée** du schéma et des règles d'accès. Les
définir uniquement dans le tableau de bord Supabase, c'est n'avoir aucun moyen de les
reconstruire si elles sont modifiées par erreur, ni de savoir ce qui est réellement autorisé
sans se reconnecter.

## Contenu

- `schema.sql` — la table `budget_state` (un document JSON par compte).
- `policies.sql` — les quatre policies RLS.

## Mise en place, une seule fois

Dans le SQL Editor du projet Supabase, exécuter `schema.sql` puis `policies.sql`.

## Ce que garantit la règle d'accès

`auth.uid() = user_id`, sur les quatre opérations. Concrètement :

- la clé `anon` publiée dans le bundle **ne donne accès à rien** tant qu'aucune session n'est
  ouverte : sans `auth.uid()`, aucune ligne ne satisfait la condition ;
- une session ouverte ne voit que sa propre ligne, jamais celle d'un autre compte ;
- la suppression du compte (`auth.users`) emporte la ligne, par la clé étrangère `on delete
  cascade`.

**Aucune policy pour le rôle `anon`, volontairement.** C'est la différence essentielle avec
Cat's Eyes, qui doit ouvrir une lecture anonyme pour sa page de réservation publique. Ici,
tout ajout d'une telle policy exposerait des relevés bancaires ; il n'y a aucun usage qui le
justifie.

## Vérifier que ce fichier est à jour

```sql
select tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where tablename = 'budget_state'
order by policyname;
```

Le résultat doit correspondre à `policies.sql`. En cas d'écart, c'est ce dossier qu'il faut
corriger — il reste la référence.

## La clé `service_role` n'a rien à faire ici

L'application n'a aucune fonction serveur : tout se fait depuis le navigateur avec la session
de l'utilisateur. La clé `service_role` contourne la RLS ; elle ne doit **jamais** être
ajoutée aux variables du projet, et encore moins avec un préfixe `VITE_`, qui la ferait entrer
dans le bundle envoyé à chaque visiteur.
