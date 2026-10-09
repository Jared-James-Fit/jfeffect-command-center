-- Client file notes: notes staff keep on a client's profile.
--   * Written on the profile directly, or synced from a Quick Note (Task Manager) that was
--     linked to the client. A synced note keeps `quick_note_id` (the Quick Note's local id)
--     so edits flow both ways.
--   * Nothing is lost: when the linked Quick Note is deleted / moved to the matrix, the
--     client copy is archived (archive_reason = 'quick_note_removed'), never deleted. Restoring
--     the Quick Note un-archives it. Staff can also archive / restore by hand.
--   * Staff only: admins, or the client's assigned coach. Clients never see these.

create table if not exists public.client_file_notes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  author_id uuid not null default auth.uid(),
  title text not null default '',
  body text not null default '',
  pinned boolean not null default false,
  source text not null default 'client_file' check (source in ('client_file', 'quick_note')),
  quick_note_id text,
  archived_at timestamptz,
  archived_by uuid,
  archive_reason text check (archive_reason is null or archive_reason in ('manual', 'quick_note_removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  -- One synced copy per Quick Note per author (Quick Notes ids are per author/device).
  constraint client_file_notes_quick_note_key unique (author_id, quick_note_id)
);

create index if not exists idx_client_file_notes_client
  on public.client_file_notes (client_id, archived_at, pinned desc, updated_at desc);

grant select, insert, update, delete on public.client_file_notes to authenticated;
grant all on public.client_file_notes to service_role;
alter table public.client_file_notes enable row level security;

drop policy if exists "Staff read client file notes" on public.client_file_notes;
create policy "Staff read client file notes" on public.client_file_notes for select to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role) or public.is_assigned_coach(client_id));

drop policy if exists "Staff add client file notes" on public.client_file_notes;
create policy "Staff add client file notes" on public.client_file_notes for insert to authenticated
  with check (
    author_id = auth.uid()
    and (public.has_role(auth.uid(), 'admin'::public.app_role) or public.is_assigned_coach(client_id))
  );

drop policy if exists "Staff edit client file notes" on public.client_file_notes;
create policy "Staff edit client file notes" on public.client_file_notes for update to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role) or public.is_assigned_coach(client_id))
  with check (public.has_role(auth.uid(), 'admin'::public.app_role) or public.is_assigned_coach(client_id));

-- Hard delete is admin-only; the app archives instead.
drop policy if exists "Admins delete client file notes" on public.client_file_notes;
create policy "Admins delete client file notes" on public.client_file_notes for delete to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role));

create or replace function public.client_file_notes_touch()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  -- author / origin never change after insert
  new.author_id := old.author_id;
  new.created_at := old.created_at;
  return new;
end;
$$;

drop trigger if exists trg_client_file_notes_touch on public.client_file_notes;
create trigger trg_client_file_notes_touch
  before update on public.client_file_notes
  for each row execute function public.client_file_notes_touch();
