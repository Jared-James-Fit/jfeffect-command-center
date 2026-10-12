-- Program history: a restore point taken before every program or nutrition
-- change Cleo makes, so any of them can be undone (from the card, or by asking
-- Cleo). Rows are written with the service key only after the caller is
-- checked; restores run with the restorer's own session (same RLS as the app).
-- Logged workouts are never touched by a restore: a day the client has since
-- started or logged stays as trained.
create table if not exists public.pl_program_versions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  block_id uuid,
  kind text not null,
  summary text not null,
  payload jsonb not null default '{}'::jsonb,
  source text not null default 'cleo',
  cleo_action_id uuid references public.cleo_actions (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  restored_at timestamptz,
  restored_by uuid references auth.users (id) on delete set null,
  restore_note text
);

create index if not exists pl_program_versions_client_idx on public.pl_program_versions (client_id, created_at desc);
create index if not exists pl_program_versions_action_idx on public.pl_program_versions (cleo_action_id);

alter table public.pl_program_versions enable row level security;
grant select on public.pl_program_versions to authenticated;
grant all on public.pl_program_versions to service_role;

drop policy if exists "program versions: admins read" on public.pl_program_versions;
create policy "program versions: admins read" on public.pl_program_versions
  for select to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role));
