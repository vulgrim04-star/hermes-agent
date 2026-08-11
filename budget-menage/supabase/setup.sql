-- Budget du ménage — installation complète, en un bloc.
--
-- Réunit `schema.sql` et `policies.sql`, et les rend **rejouables** : les
-- policies telles quelles échoueraient au second passage sur « policy already
-- exists ». Une installation qu'on n'ose pas relancer est une installation
-- qu'on n'ose pas vérifier.
--
-- L'ordre n'est pas indifférent. La RLS est activée dans le même souffle que la
-- création de la table : entre les deux, il n'existe aucun instant où la table
-- serait lisible par le premier venu muni de la clé publique — et cette clé est
-- dans le bundle de chaque visiteur, par construction.
--
-- À exécuter dans le SQL Editor du projet, ou par le workflow
-- `.github/workflows/supabase-setup.yml`, qui poste ce fichier tel quel.

create table if not exists public.budget_state (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.budget_state enable row level security;

-- Un seul principe, et aucune exception : **une ligne, un propriétaire**.
-- Aucun rôle `anon`, aucune lecture partagée. Ce sont des relevés bancaires.

drop policy if exists select_own on public.budget_state;
create policy select_own on public.budget_state
  for select
  using (auth.uid() = user_id);

drop policy if exists insert_own on public.budget_state;
create policy insert_own on public.budget_state
  for insert
  with check (auth.uid() = user_id);

drop policy if exists update_own on public.budget_state;
create policy update_own on public.budget_state
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists delete_own on public.budget_state;
create policy delete_own on public.budget_state
  for delete
  using (auth.uid() = user_id);

-- PostgREST tient un cache du schéma. Il se recharge seul sur un changement de
-- structure, mais le lui dire coûte une ligne et évite d'attribuer à une table
-- absente ce qui n'est qu'un cache en retard.
notify pgrst, 'reload schema';
