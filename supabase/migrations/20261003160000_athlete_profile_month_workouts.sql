-- Public athlete profile: add current-month workout counts so the league
-- profile can show lifetime vs this-month training. Month window matches
-- get_monthly_athlete_rankings (date_trunc('month', now())).
-- Return type changes, so the function is dropped and recreated.

drop function if exists public.get_athlete_public_profile(uuid);

create function public.get_athlete_public_profile(_client_id uuid)
returns table(
  client_id uuid,
  display_name text,
  avatar_url text,
  xp bigint,
  workouts_completed bigint,
  workouts_fully_logged bigint,
  first_workout_at timestamptz,
  is_me boolean,
  month_workouts_completed bigint,
  month_workouts_fully_logged bigint,
  last_workout_at timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select c.id,
    coalesce(nullif(trim(coalesce(c.first_name,'') || ' ' || left(coalesce(c.last_name,''),1)), ''), split_part(coalesce(c.full_name,'Athlete'),' ',1)),
    p.avatar_url,
    coalesce(sum(e.xp),0)::bigint,
    count(*) filter (where e.event_type = 'workout_completed'),
    count(*) filter (where e.event_type = 'workout_fully_logged'),
    min(e.occurred_at) filter (where e.event_type = 'workout_completed'),
    (c.user_id = auth.uid()),
    count(*) filter (where e.event_type = 'workout_completed'
      and e.occurred_at >= date_trunc('month', now())
      and e.occurred_at < date_trunc('month', now()) + interval '1 month'),
    count(*) filter (where e.event_type = 'workout_fully_logged'
      and e.occurred_at >= date_trunc('month', now())
      and e.occurred_at < date_trunc('month', now()) + interval '1 month'),
    max(e.occurred_at) filter (where e.event_type = 'workout_completed')
  from public.clients c
  left join public.profiles p on p.id = c.user_id
  left join public.athlete_xp_events e on e.client_id = c.id
  where auth.uid() is not null and c.id = _client_id
    and (c.user_id = auth.uid() or (coalesce(c.archived,false) = false and c.archived_at is null and coalesce(c.status,'') <> 'Archived'))
  group by c.id, p.avatar_url;
$$;

revoke all on function public.get_athlete_public_profile(uuid) from public, anon;
grant execute on function public.get_athlete_public_profile(uuid) to authenticated, service_role;
