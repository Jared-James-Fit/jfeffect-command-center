-- Block types: what a training block is for, as structured metadata
-- (src/lib/block-types.ts). The built-in types live in code; this table holds
-- a coach's own types and the team's renames / colours of the built-in ones
-- (a row with builtin_key). Blocks carry their type and the coach's words for
-- it: pl_blocks.block_type / block_meta here, a template's blocks in their v2
-- payload. Nothing reads a colour to decide anything: Cleo and Program Check
-- read the metadata.

-- pl_blocks is read on every workout: never wait long for its lock.
set lock_timeout = '5s';

create table if not exists public.program_block_types (
  id uuid primary key default gen_random_uuid(),
  -- set only on a team override of a built-in type ("hypertrophy", "peaking"…)
  builtin_key text check (builtin_key is null or builtin_key ~ '^[a-z_]{2,32}$'),
  name text not null check (char_length(btrim(name)) between 1 and 40),
  color text not null default 'stone' check (color in ('slate','stone','sky','blue','cyan','teal','emerald','lime','yellow','orange','rose','pink')),
  purpose text check (purpose is null or char_length(purpose) <= 400),
  emphasis text check (emphasis is null or char_length(emphasis) <= 400),
  progression text check (progression is null or char_length(progression) <= 400),
  intensity text check (intensity is null or intensity in ('low','moderate','high','very_high')),
  volume text check (volume is null or volume in ('low','moderate','high','very_high')),
  based_on text check (based_on is null or based_on ~ '^[a-z_]{2,32}$'),
  archived boolean not null default false,
  sort_order integer,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists program_block_types_builtin_uidx on public.program_block_types (builtin_key) where builtin_key is not null;

create or replace function public.program_block_types_touch()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists program_block_types_touch on public.program_block_types;
create trigger program_block_types_touch before update on public.program_block_types for each row execute function public.program_block_types_touch();

alter table public.program_block_types enable row level security;
grant select, insert, update, delete on public.program_block_types to authenticated;
grant all on public.program_block_types to service_role;

-- The coaching team reads the whole library (it's shared vocabulary, never a client's data).
drop policy if exists "Coaches read block types" on public.program_block_types;
create policy "Coaches read block types" on public.program_block_types
  for select to authenticated
  using ((select public.has_role((select auth.uid()), 'admin'::app_role)) or (select public.has_role((select auth.uid()), 'coach'::app_role)));

-- A coach adds and edits their own types; renaming or recolouring a built-in type is an admin's.
drop policy if exists "Coaches write own block types" on public.program_block_types;
create policy "Coaches write own block types" on public.program_block_types
  for all to authenticated
  using (
    (select public.has_role((select auth.uid()), 'admin'::app_role))
    or (builtin_key is null and owner_id = (select auth.uid()) and (select public.has_role((select auth.uid()), 'coach'::app_role)))
  )
  with check (
    (select public.has_role((select auth.uid()), 'admin'::app_role))
    or (builtin_key is null and owner_id = (select auth.uid()) and (select public.has_role((select auth.uid()), 'coach'::app_role)))
  );

-- A client's block: its type key (built-in key or a program_block_types id) and the coach's words.
alter table public.pl_blocks add column if not exists block_type text check (block_type is null or char_length(block_type) <= 64);
alter table public.pl_blocks add column if not exists block_meta jsonb check (block_meta is null or (jsonb_typeof(block_meta) = 'object' and pg_column_size(block_meta) <= 4000));

comment on column public.pl_blocks.block_type is 'Block type key: a built-in key (src/lib/block-types.ts) or a program_block_types id. Null = read from the block''s name / phase.';
comment on column public.pl_blocks.block_meta is 'The coach''s words for this block: {purpose, emphasis, progression}. Each falls back to its type''s.';
