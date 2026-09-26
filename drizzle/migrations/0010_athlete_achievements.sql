-- Athlete achievements: public earned badges + private owner progress.
-- Awarding is derived from completed workout history and is idempotent.

create table if not exists public.athlete_achievements (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  badge_key text not null,
  earned_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (client_id, badge_key)
);

create index if not exists athlete_achievements_client_earned_idx
  on public.athlete_achievements(client_id, earned_at desc);

alter table public.athlete_achievements enable row level security;
grant select on public.athlete_achievements to authenticated;
grant all on public.athlete_achievements to service_role;

drop policy if exists "Athletes read own achievements" on public.athlete_achievements;
create policy "Athletes read own achievements"
on public.athlete_achievements for select to authenticated
using (
  exists (select 1 from public.clients c where c.id = client_id and c.user_id = auth.uid())
  or public.has_role(auth.uid(), 'admin')
  or public.has_role(auth.uid(), 'coach')
);

create or replace function public.award_workout_milestone_badges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  workout_count integer;
  milestone record;
begin
  if new.completed_at is null or new.client_id is null then return new; end if;

  select count(*)::integer into workout_count
  from public.pl_day_completions
  where client_id = new.client_id and completed_at is not null;

  for milestone in
    select * from (values
      ('first_workout'::text, 1),
      ('workouts_10'::text, 10),
      ('workouts_25'::text, 25),
      ('workouts_50'::text, 50),
      ('workouts_100'::text, 100),
      ('workouts_250'::text, 250)
    ) v(badge_key, required_count)
  loop
    if workout_count >= milestone.required_count then
      insert into public.athlete_achievements(client_id, badge_key, earned_at, metadata)
      values (
        new.client_id,
        milestone.badge_key,
        new.completed_at,
        jsonb_build_object('workout_count_at_award', workout_count)
      )
      on conflict (client_id, badge_key) do nothing;
    end if;
  end loop;
  return new;
exception when others then
  raise warning 'award_workout_milestone_badges failed: %', sqlerrm;
  return new;
end;
$$;

revoke execute on function public.award_workout_milestone_badges() from public, anon, authenticated;

drop trigger if exists trg_award_workout_milestone_badges on public.pl_day_completions;
create trigger trg_award_workout_milestone_badges
after insert or update of completed_at on public.pl_day_completions
for each row execute function public.award_workout_milestone_badges();

-- Historical backfill. earned_at is the completion timestamp of the milestone workout.
with milestones(badge_key, required_count) as (
  values ('first_workout',1),('workouts_10',10),('workouts_25',25),
         ('workouts_50',50),('workouts_100',100),('workouts_250',250)
),
ranked as (
  select client_id, completed_at,
         row_number() over(partition by client_id order by completed_at, id) as n
  from public.pl_day_completions
  where completed_at is not null and client_id is not null
)
insert into public.athlete_achievements(client_id,badge_key,earned_at,metadata)
select r.client_id,m.badge_key,r.completed_at,jsonb_build_object('workout_count_at_award',m.required_count)
from milestones m
join ranked r on r.n=m.required_count
on conflict (client_id,badge_key) do nothing;

-- Safe public comparison RPC: exposes only earned badge keys/dates.
create or replace function public.get_public_athlete_achievements(_client_id uuid)
returns table(badge_key text, earned_at timestamptz)
language sql stable security definer set search_path = public
as $$
  select a.badge_key, a.earned_at
  from public.athlete_achievements a
  join public.clients c on c.id=a.client_id
  where auth.uid() is not null
    and a.client_id=_client_id
    and coalesce(c.archived,false)=false
    and c.archived_at is null
    and coalesce(c.status,'') <> 'Archived'
  order by a.earned_at desc;
$$;

revoke execute on function public.get_public_athlete_achievements(uuid) from public, anon;
grant execute on function public.get_public_athlete_achievements(uuid) to authenticated;

-- Private progress RPC. Only the athlete (or coach/admin) can inspect progress.
create or replace function public.get_my_achievement_progress()
returns table(client_id uuid, completed_workouts bigint)
language sql stable security definer set search_path = public
as $$
  select c.id,
    (select count(*) from public.pl_day_completions d where d.client_id=c.id and d.completed_at is not null)
  from public.clients c
  where c.user_id=auth.uid()
  limit 1;
$$;

revoke execute on function public.get_my_achievement_progress() from public, anon;
grant execute on function public.get_my_achievement_progress() to authenticated;
