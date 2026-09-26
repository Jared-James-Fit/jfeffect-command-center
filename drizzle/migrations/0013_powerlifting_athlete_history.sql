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


alter table public.powerlifting_athletes enable row level security;
create policy "Authenticated read powerlifting athletes" on public.powerlifting_athletes for select to authenticated using (true);
create policy "Admin manages powerlifting athletes" on public.powerlifting_athletes for all to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));
grant select,insert,update,delete on public.powerlifting_athletes to authenticated;

insert into public.powerlifting_athletes(client_id,athlete_name,sex)
select distinct on (client_id) client_id,athlete_name,sex from public.athlete_powerlifting_results
where client_id is not null and not exists (select 1 from public.powerlifting_athletes a where a.client_id=athlete_powerlifting_results.client_id)
order by client_id,created_at;

insert into public.powerlifting_athletes(athlete_name,sex)
select distinct on (lower(athlete_name),sex) athlete_name,sex from public.athlete_powerlifting_results r
where client_id is null and not exists (select 1 from public.powerlifting_athletes a where a.client_id is null and lower(a.athlete_name)=lower(r.athlete_name) and a.sex=r.sex)
order by lower(athlete_name),sex,created_at;

update public.athlete_powerlifting_results r set athlete_id=a.id
from public.powerlifting_athletes a
where r.athlete_id is null and ((r.client_id is not null and a.client_id=r.client_id) or (r.client_id is null and a.client_id is null and lower(a.athlete_name)=lower(r.athlete_name) and a.sex=r.sex));

create or replace function public.get_powerlifting_rankings()
returns table(id uuid,athlete_id uuid,client_id uuid,athlete_name text,sex text,bodyweight_kg numeric,squat_kg numeric,bench_kg numeric,deadlift_kg numeric,total_kg numeric,points numeric,points_system text,meet_name text,meet_location text,meet_date date,competition_level text,weight_class_kg text,federation text)
language sql stable security definer set search_path=public as $$
 select r.id,r.athlete_id,r.client_id,r.athlete_name,r.sex,r.bodyweight_kg,r.squat_kg,r.bench_kg,r.deadlift_kg,r.total_kg,r.points,r.points_system,r.meet_name,r.meet_location,r.meet_date,r.competition_level,r.weight_class_kg,r.federation
 from public.athlete_powerlifting_results r join public.powerlifting_athletes a on a.id=r.athlete_id
 where auth.uid() is not null and (a.jf_start_date is null or r.meet_date>=a.jf_start_date) and (a.jf_end_date is null or r.meet_date<=a.jf_end_date)
 order by r.points desc nulls last,r.total_kg desc;
$$;
grant execute on function public.get_powerlifting_rankings() to authenticated;


create or replace function public.attach_powerlifting_athlete() returns trigger language plpgsql set search_path=public as $$
begin
 if new.athlete_id is null then
   select a.id into new.athlete_id from public.powerlifting_athletes a
   where (new.client_id is not null and a.client_id=new.client_id)
      or (new.client_id is null and a.client_id is null and lower(a.athlete_name)=lower(new.athlete_name) and a.sex=new.sex)
   order by (a.client_id is not null) desc limit 1;
 end if;
 return new;
end $$;
drop trigger if exists attach_powerlifting_athlete_trigger on public.athlete_powerlifting_results;
create trigger attach_powerlifting_athlete_trigger before insert or update on public.athlete_powerlifting_results for each row execute function public.attach_powerlifting_athlete();
