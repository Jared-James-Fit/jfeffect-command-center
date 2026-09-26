create table if not exists public.powerlifting_athletes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid unique references public.clients(id) on delete set null,
  athlete_name text not null,
  sex text not null check (sex in ('male','female')),
  openpowerlifting_url text,
  jf_start_date date,
  jf_end_date date,
  auto_sync boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.athlete_powerlifting_results add column if not exists athlete_id uuid references public.powerlifting_athletes(id) on delete cascade;
alter table public.athlete_powerlifting_results add column if not exists source text not null default 'manual';
alter table public.athlete_powerlifting_results add column if not exists source_key text;
alter table public.athlete_powerlifting_results add column if not exists weight_class_kg text;
alter table public.athlete_powerlifting_results add column if not exists federation text;
create unique index if not exists athlete_powerlifting_source_key_idx on public.athlete_powerlifting_results(athlete_id,source,source_key) where source_key is not null;
create index if not exists athlete_powerlifting_athlete_idx on public.athlete_powerlifting_results(athlete_id);
