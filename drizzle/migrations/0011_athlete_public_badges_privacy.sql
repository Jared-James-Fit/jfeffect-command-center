-- Public athlete comparison v2: expose earned badge IDs, never raw workout counts.
-- Badge derivation uses only non-sensitive athlete XP history.

create or replace function public.get_athlete_public_profile(_client_id uuid)
returns table (
  client_id uuid,
  display_name text,
  avatar_url text,
  xp bigint,
  public_badge_ids text[],
  is_me boolean
)
language sql stable security definer set search_path = public as $$
  with athlete as (
    select c.id, c.user_id,
      coalesce(nullif(trim(coalesce(c.first_name,'') || ' ' || left(coalesce(c.last_name,''),1)), ''), split_part(coalesce(c.full_name,'Athlete'),' ',1)) as display_name,
      p.avatar_url
    from public.clients c
    left join public.profiles p on p.id=c.user_id
    where auth.uid() is not null
      and c.id=_client_id
      and (c.user_id=auth.uid() or (
        coalesce(c.archived,false)=false
        and c.archived_at is null
        and coalesce(c.status,'') <> 'Archived'
      ))
  ),
  stats as (
    select a.id, a.user_id, a.display_name, a.avatar_url,
      coalesce(sum(e.xp),0)::bigint as xp,
      count(*) filter (where e.event_type='workout_completed')::bigint as wc,
      count(*) filter (where e.event_type='workout_fully_logged')::bigint as fl
    from athlete a
    left join public.athlete_xp_events e on e.client_id=a.id
    group by a.id,a.user_id,a.display_name,a.avatar_url
  )
  select s.id,s.display_name,s.avatar_url,s.xp,
    array_remove(array[
      case when s.wc>=1 then 'first-rep' end,
      case when s.wc>=10 then 'w10' end,
      case when s.wc>=25 then 'w25' end,
      case when s.wc>=50 then 'w50' end,
      case when s.wc>=100 then 'w100' end,
      case when s.wc>=250 then 'w250' end,
      case when s.fl>=10 then 'log10' end,
      case when s.fl>=50 then 'log50' end,
      case when s.xp>=1500 then 'trained' end,
      case when s.xp>=4500 then 'advanced' end,
      case when s.xp>=9000 then 'elite' end,
      case when s.xp>=18000 then 'legend' end
    ],null)::text[],
    (s.user_id=auth.uid())
  from stats s;
$$;

revoke execute on function public.get_athlete_public_profile(uuid) from public, anon;
grant execute on function public.get_athlete_public_profile(uuid) to authenticated;
