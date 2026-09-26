create table if not exists public.athlete_achievement_views (
 client_id uuid not null references public.clients(id) on delete cascade,
 badge_key text not null references public.athlete_badge_catalog(badge_key) on delete cascade,
 seen_at timestamptz not null default now(),
 primary key(client_id,badge_key)
);
alter table public.athlete_achievement_views enable row level security;
drop policy if exists "Clients read own achievement views" on public.athlete_achievement_views;
create policy "Clients read own achievement views" on public.athlete_achievement_views for select to authenticated using (exists(select 1 from public.clients c where c.id=client_id and c.user_id=auth.uid()) or public.has_role(auth.uid(),'admin'));
drop policy if exists "Clients mark own achievement views" on public.athlete_achievement_views;
create policy "Clients mark own achievement views" on public.athlete_achievement_views for insert to authenticated with check (exists(select 1 from public.clients c where c.id=client_id and c.user_id=auth.uid()) or public.has_role(auth.uid(),'admin'));
drop policy if exists "Clients update own achievement views" on public.athlete_achievement_views;
create policy "Clients update own achievement views" on public.athlete_achievement_views for update to authenticated using (exists(select 1 from public.clients c where c.id=client_id and c.user_id=auth.uid()) or public.has_role(auth.uid(),'admin')) with check (exists(select 1 from public.clients c where c.id=client_id and c.user_id=auth.uid()) or public.has_role(auth.uid(),'admin'));
grant select,insert,update on public.athlete_achievement_views to authenticated;