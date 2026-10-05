-- Task Manager: Quick Notes, assignee list and quadrant names/colors lived only
-- in each browser's localStorage, so desktop and iPhone never matched. They now
-- live in the database (the app keeps a local copy as a cache + offline buffer).
--
-- * task_quick_notes: one row per note. The id is generated on the client so an
--   existing local note keeps its id when it is uploaded. `edited_at` is the
--   user-visible "last edited" time (client-driven so imports keep old times);
--   `deleted_at` is the 30-day "Recently Deleted" trash stamp; `version` is bumped
--   by a trigger and used for optimistic concurrency, so one device can't
--   silently overwrite another device's newer edit.
-- * task_preferences: one row per owner+scope holding the assignee list and the
--   quadrant labels/colors. NULL means "never customised".
-- Both tables are private to their owner.

create or replace function public.bump_task_sync_row()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  new.version := coalesce(old.version, 0) + 1;
  if tg_table_name = 'task_preferences' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create table if not exists public.task_quick_notes (
  id uuid primary key,
  owner_id uuid not null default auth.uid(),
  scope text not null default 'admin' check (scope in ('admin', 'media')),
  title text not null default '',
  body text not null default '',
  edited_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now()
);

create index if not exists idx_task_quick_notes_owner_scope
  on public.task_quick_notes (owner_id, scope);

alter table public.task_quick_notes enable row level security;
grant select, insert, update, delete on public.task_quick_notes to authenticated;
grant all on public.task_quick_notes to service_role;

create policy "task_quick_notes owner select" on public.task_quick_notes
  for select to authenticated using (owner_id = auth.uid());
create policy "task_quick_notes owner insert" on public.task_quick_notes
  for insert to authenticated with check (owner_id = auth.uid());
create policy "task_quick_notes owner update" on public.task_quick_notes
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "task_quick_notes owner delete" on public.task_quick_notes
  for delete to authenticated using (owner_id = auth.uid());

create trigger trg_task_quick_notes_version
  before update on public.task_quick_notes
  for each row execute function public.bump_task_sync_row();

create table if not exists public.task_preferences (
  owner_id uuid not null default auth.uid(),
  scope text not null check (scope in ('admin', 'media')),
  assignees jsonb,
  quadrant_styles jsonb,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key (owner_id, scope)
);

alter table public.task_preferences enable row level security;
grant select, insert, update, delete on public.task_preferences to authenticated;
grant all on public.task_preferences to service_role;

create policy "task_preferences owner select" on public.task_preferences
  for select to authenticated using (owner_id = auth.uid());
create policy "task_preferences owner insert" on public.task_preferences
  for insert to authenticated with check (owner_id = auth.uid());
create policy "task_preferences owner update" on public.task_preferences
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "task_preferences owner delete" on public.task_preferences
  for delete to authenticated using (owner_id = auth.uid());

create trigger trg_task_preferences_version
  before update on public.task_preferences
  for each row execute function public.bump_task_sync_row();

-- Realtime so a change on one device reaches the others. FULL identity lets
-- DELETE events carry owner_id for the realtime filter.
alter table public.task_quick_notes replica identity full;
alter table public.task_preferences replica identity full;
do $$
begin
  alter publication supabase_realtime add table public.task_quick_notes;
exception when duplicate_object then null; when undefined_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.task_preferences;
exception when duplicate_object then null; when undefined_object then null;
end $$;
