-- JF Athlete Records: permanent powerlifting meet history + competition résumé.
create table if not exists public.athlete_powerlifting_results (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete set null,
  athlete_name text not null,
  sex text not null check (sex in ('male','female')),
  bodyweight_kg numeric not null check (bodyweight_kg > 0),
  squat_kg numeric not null default 0 check (squat_kg >= 0),
  bench_kg numeric not null default 0 check (bench_kg >= 0),
  deadlift_kg numeric not null default 0 check (deadlift_kg >= 0),
  total_kg numeric generated always as (squat_kg + bench_kg + deadlift_kg) stored,
  points numeric,
  points_system text not null default 'DOTS' check (points_system in ('DOTS','GL')),
  meet_name text,
  meet_location text,
  meet_date date,
  competition_level text check (competition_level in ('local','provincial','regional','national','international')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists athlete_powerlifting_results_points_idx on public.athlete_powerlifting_results(points desc);
create index if not exists athlete_powerlifting_results_client_idx on public.athlete_powerlifting_results(client_id);
alter table public.athlete_powerlifting_results enable row level security;

drop policy if exists "Authenticated read athlete records" on public.athlete_powerlifting_results;
create policy "Authenticated read athlete records" on public.athlete_powerlifting_results
for select to authenticated using (true);

drop policy if exists "Admin manages athlete records" on public.athlete_powerlifting_results;
create policy "Admin manages athlete records" on public.athlete_powerlifting_results
for all to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

grant select on public.athlete_powerlifting_results to authenticated;
grant insert,update,delete on public.athlete_powerlifting_results to authenticated;

create or replace function public.get_powerlifting_rankings()
returns table(id uuid, client_id uuid, athlete_name text, sex text, bodyweight_kg numeric, squat_kg numeric, bench_kg numeric, deadlift_kg numeric, total_kg numeric, points numeric, points_system text, meet_name text, meet_location text, meet_date date, competition_level text)
language sql stable security definer set search_path=public as $$
 select r.id,r.client_id,r.athlete_name,r.sex,r.bodyweight_kg,r.squat_kg,r.bench_kg,r.deadlift_kg,r.total_kg,r.points,r.points_system,r.meet_name,r.meet_location,r.meet_date,r.competition_level
 from public.athlete_powerlifting_results r
 where auth.uid() is not null
 order by r.points desc nulls last, r.total_kg desc;
$$;
revoke execute on function public.get_powerlifting_rankings() from public,anon;
grant execute on function public.get_powerlifting_rankings() to authenticated;
