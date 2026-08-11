-- Budget du ménage — policies RLS.
--
-- Un seul principe, et aucune exception : **une ligne, un propriétaire**.
-- Contrairement à Cat's Eyes, qui ouvre une lecture anonyme restreinte pour sa
-- page de réservation publique, il n'y a ici aucun rôle `anon`, aucune lecture
-- partagée, aucun cas particulier. Ce sont des relevés bancaires : rien ne
-- justifierait qu'une autre session que celle du titulaire les lise.
--
-- À exécuter après schema.sql.

create policy select_own on public.budget_state
  for select
  using (auth.uid() = user_id);

create policy insert_own on public.budget_state
  for insert
  with check (auth.uid() = user_id);

create policy update_own on public.budget_state
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy delete_own on public.budget_state
  for delete
  using (auth.uid() = user_id);
