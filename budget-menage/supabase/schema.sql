-- Budget du ménage — schéma applicatif.
--
-- Une seule table : le journal entier d'un compte tient dans un document JSON.
-- Ce parti est celui de Cat's Eyes (`app_state`) et il vaut ici pour la même
-- raison : l'application lit et écrit son état d'un bloc, la sauvegarde et la
-- restauration sont triviales, et il n'y a qu'une règle d'accès à tenir juste.
--
-- À exécuter une fois dans le SQL Editor du tableau de bord Supabase.

create table if not exists public.budget_state (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Sans cette ligne, la table serait lisible par n'importe quel porteur de la
-- clé « anon » — c'est-à-dire par n'importe qui, la clé étant dans le bundle.
alter table public.budget_state enable row level security;
