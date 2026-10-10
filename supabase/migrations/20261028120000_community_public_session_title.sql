-- What a shared session is called in the community (cards baked into photos,
-- the feed, tiles, lock-ins). Never the coach's day or block names: those are
-- written for the coach ("Upper Girly Pop", "3-Day Glute / Girly Pop") and
-- weren't meant to go public. Instead, where the client is in the program:
-- "Block 5 · Week 1" (the block's place among their blocks, by start date;
-- the week inside it). Outside a program block: the weekday ("Friday session").
CREATE OR REPLACE FUNCTION public.community_public_session_title(_day_id uuid, _client_id uuid, _at timestamptz)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT coalesce(
    (SELECT 'Block ' || (SELECT count(*) FROM public.pl_blocks b2
                          WHERE b2.client_id = b.client_id AND NOT coalesce(b2.archived, false)
                            AND (coalesce(b2.start_date, '9999-12-31'::date), b2.created_at) <= (coalesce(b.start_date, '9999-12-31'::date), b.created_at))
            || CASE WHEN w.week_index IS NOT NULL AND w.week_index > 0 THEN ' · Week ' || w.week_index ELSE '' END
       FROM public.pl_days d
       JOIN public.pl_weeks w ON w.id = d.week_id
       JOIN public.pl_blocks b ON b.id = w.block_id
      WHERE d.id = _day_id AND NOT coalesce(b.archived, false)),
    to_char(coalesce(_at, now()) AT TIME ZONE coalesce((SELECT nullif(btrim(c.timezone), '') FROM public.clients c WHERE c.id = _client_id), 'America/Winnipeg'), 'FMDay') || ' session');
$function$;
REVOKE ALL ON FUNCTION public.community_public_session_title(uuid, uuid, timestamptz) FROM public, anon, authenticated;

-- For the lock-in camera (its card is drawn on the phone before posting):
-- the signed-in client's own day only.
CREATE OR REPLACE FUNCTION public.community_my_session_title(_day_id uuid)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.community_public_session_title(_day_id, c.id, now())
    FROM public.pl_days d
    JOIN public.pl_weeks w ON w.id = d.week_id
    JOIN public.pl_blocks b ON b.id = w.block_id
    JOIN public.clients c ON c.id = b.client_id
   WHERE d.id = _day_id AND c.user_id = auth.uid();
$function$;
REVOKE ALL ON FUNCTION public.community_my_session_title(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.community_my_session_title(uuid) TO authenticated;

-- community_workout_stats: 'workout_title' (every card and post) and
-- community_post_json: 'session_title' (lock-ins) now use it. Rebuilt from
-- the live definitions with only that expression swapped.
DO $$
DECLARE def text;
BEGIN
  def := pg_get_functiondef('public.community_workout_stats(uuid)'::regprocedure);
  def := replace(def,
    $r$SELECT coalesce(nullif(btrim(d.title), ''), nullif(btrim(d.focus), ''), 'Workout')
    INTO v_title FROM public.pl_days d WHERE d.id = pc.day_id;$r$,
    $r$v_title := public.community_public_session_title(pc.day_id, pc.client_id, pc.completed_at);$r$);
  IF position('community_public_session_title' in def) = 0 THEN RAISE EXCEPTION 'community_workout_stats: title expression not found'; END IF;
  EXECUTE def;

  def := pg_get_functiondef('public.community_post_json(uuid, uuid)'::regprocedure);
  def := replace(def,
    $r$'session_title', CASE WHEN n.kind = 'workout' THEN coalesce(nullif(btrim(d.title), ''), nullif(btrim(d.focus), ''), 'Workout') END,$r$,
    $r$'session_title', CASE WHEN n.kind = 'workout' THEN public.community_public_session_title(pc.day_id, pc.client_id, coalesce(pc.completed_at, n.locked_in_at, n.created_at)) END,$r$);
  IF position('community_public_session_title' in def) = 0 THEN RAISE EXCEPTION 'community_post_json: session_title expression not found'; END IF;
  EXECUTE def;
END $$;

-- The workout recap's shareable story (drawn on the phone): the same title
-- for the signed-in client's own finished session.
CREATE OR REPLACE FUNCTION public.community_my_completion_title(_completion_id uuid)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.community_public_session_title(pc.day_id, pc.client_id, coalesce(pc.completed_at, now()))
    FROM public.pl_day_completions pc
    JOIN public.clients c ON c.id = pc.client_id
   WHERE pc.id = _completion_id AND c.user_id = auth.uid();
$function$;
REVOKE ALL ON FUNCTION public.community_my_completion_title(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.community_my_completion_title(uuid) TO authenticated;
