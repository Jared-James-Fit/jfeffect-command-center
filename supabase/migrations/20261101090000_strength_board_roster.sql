-- Hall of Strength: everyone, not only the people with a ranked lift.
-- get_strength_board_roster() lists every client JF Effect has (current,
-- archived, deactivated) plus meet athletes not linked to a client, named and
-- tagged the same way as get_strength_board_all(). The app puts anyone who
-- isn't on the board being shown under "Not ranked yet" with what's missing
-- (a lift, a bodyweight, Men/Women), so nobody disappears from the Hall.
CREATE OR REPLACE FUNCTION public.get_strength_board_roster(_as_user uuid DEFAULT NULL::uuid)
RETURNS TABLE(person text, client_id uuid, display_name text, avatar_url text, is_me boolean, is_coach boolean, is_alumni boolean, sex text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  with viewer as (select public.portal_viewer_uid(_as_user) uid),
  people as (
    select 'c:' || c.id person, c.id client_id, c.user_id,
      coalesce(nullif(trim(trim(coalesce(c.first_name, '')) || ' ' || left(trim(coalesce(c.last_name, '')), 1)), ''),
        split_part(coalesce(c.full_name, 'Athlete'), ' ', 1)) display_name,
      coalesce(c.archived, false) or c.archived_at is not null or coalesce(c.status, '') in ('Archived', 'Deactivated') is_alumni,
      coalesce(c.sex, (select a.sex from public.powerlifting_athletes a where a.client_id = c.id order by a.created_at limit 1), '') sx
    from public.clients c
    union all
    select 'a:' || a.id, null, null,
      trim(split_part(trim(a.athlete_name), ' ', 1) || ' ' || left(regexp_replace(trim(a.athlete_name), '^.*\s', ''), 1)),
      lower(coalesce(a.status, 'active')) = 'retired',
      coalesce(a.sex, '')
    from public.powerlifting_athletes a
    where a.client_id is null
  )
  select p.person, p.client_id, p.display_name, pr.avatar_url,
    coalesce(p.user_id = v.uid, false), coalesce(public.community_is_coach(p.user_id), false), p.is_alumni,
    case when lower(p.sx) like 'f%' then 'female' when lower(p.sx) like 'm%' then 'male' end
  from people p
  left join public.profiles pr on pr.id = p.user_id
  cross join viewer v
  where v.uid is not null
  order by p.display_name
$function$;

REVOKE ALL ON FUNCTION public.get_strength_board_roster(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_strength_board_roster(uuid) TO authenticated;
