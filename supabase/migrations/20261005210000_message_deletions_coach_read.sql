-- The deleted-message log is visible to the client's coach as well as admins
-- (clients and members never see it). Deleting stays admin-only.
drop policy if exists "Admins read message deletions" on public.message_deletions;
drop policy if exists "Staff read message deletions" on public.message_deletions;
create policy "Staff read message deletions" on public.message_deletions
  for select using (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    or (client_id is not null and public.is_assigned_coach(client_id))
    or (group_id is not null and public.has_role(auth.uid(), 'coach'::public.app_role))
  );
