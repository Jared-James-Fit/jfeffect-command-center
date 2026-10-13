-- Recognition that says what it was for: "Vicky and 2 others celebrated your
-- Belt Squat PR", not "reacted to your workout".
--
-- community_posts.win_label: the moment a workout post is about, in a few
-- words, the same order the cards use (pickWorkoutWin): a PR ("Belt Squat
-- PR"), else a monthly milestone ("10th session this month"), else a 3rd+
-- session of the week ("4th session this week"). '' = nothing special (so
-- it's never worked out twice). Worked out once per post, the first time
-- someone reacts (community_workout_stats is too heavy to run per bell row),
-- and read by the bell and the push.
ALTER TABLE public.community_posts ADD COLUMN IF NOT EXISTS win_label text;

CREATE OR REPLACE FUNCTION public.community_ordinal(_n int)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT _n::text || CASE WHEN _n % 100 BETWEEN 11 AND 13 THEN 'th'
                          WHEN _n % 10 = 1 THEN 'st' WHEN _n % 10 = 2 THEN 'nd' WHEN _n % 10 = 3 THEN 'rd' ELSE 'th' END
$function$;

CREATE OR REPLACE FUNCTION public.community_win_label(_completion_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  st jsonb := public.community_workout_stats(_completion_id);
  m int;
  w int;
BEGIN
  IF st IS NULL THEN RETURN ''; END IF;
  IF jsonb_array_length(coalesce(st->'prs', '[]'::jsonb)) > 0 THEN
    RETURN left(st->'prs'->0->>'exercise_name', 60) || ' PR';
  END IF;
  m := coalesce((st->>'month_sessions')::int, 0);
  IF m IN (5, 10, 15, 20, 25, 30) THEN RETURN public.community_ordinal(m) || ' session this month'; END IF;
  w := coalesce((st->>'week_sessions')::int, 0);
  IF w >= 3 THEN RETURN public.community_ordinal(w) || ' session this week'; END IF;
  RETURN '';
END;
$function$;
REVOKE ALL ON FUNCTION public.community_win_label(uuid) FROM public, anon, authenticated;

-- Fill a post's label (once) the first time it gets a reaction.
CREATE OR REPLACE FUNCTION public.community_fill_win_label(_post_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.community_posts p
     SET win_label = public.community_win_label(p.completion_id)
   WHERE p.id = _post_id AND p.win_label IS NULL
     AND p.kind = 'workout' AND p.completion_id IS NOT NULL AND p.locked_in_at IS NULL;
EXCEPTION WHEN others THEN
  RAISE WARNING 'community_fill_win_label: %', sqlerrm;
END;
$function$;
REVOKE ALL ON FUNCTION public.community_fill_win_label(uuid) FROM public, anon, authenticated;

DO $$
DECLARE def text;
BEGIN
  -- the reaction trigger fills the label before the notification is written
  def := pg_get_functiondef('public.community_notify_on_reaction()'::regprocedure);
  IF position('community_fill_win_label' in def) = 0 THEN
    def := replace(def,
      $r$      SELECT p.author_user_id INTO v_author FROM public.community_posts p WHERE p.id = NEW.post_id;$r$,
      $r$      PERFORM public.community_fill_win_label(NEW.post_id);
      SELECT p.author_user_id INTO v_author FROM public.community_posts p WHERE p.id = NEW.post_id;$r$);
    IF position('community_fill_win_label' in def) = 0 THEN RAISE EXCEPTION 'community_notify_on_reaction: anchor not found'; END IF;
    EXECUTE def;
  END IF;

  -- the bell and the push carry it
  def := pg_get_functiondef('public.community_my_notifications()'::regprocedure);
  IF position($r$'win', nullif(p.win_label$r$ in def) = 0 THEN
    def := replace(def,
      $r$      'post_kind', CASE WHEN p.kind = 'note' THEN 'post'$r$,
      $r$      'win', nullif(p.win_label, ''),
      'post_kind', CASE WHEN p.kind = 'note' THEN 'post'$r$);
    IF position($r$'win', nullif(p.win_label$r$ in def) = 0 THEN RAISE EXCEPTION 'community_my_notifications: anchor not found'; END IF;
    EXECUTE def;
  END IF;

  def := pg_get_functiondef('public.community_claim_pushes(uuid)'::regprocedure);
  IF position($r$'win', nullif(p.win_label$r$ in def) = 0 THEN
    def := replace(def,
      $r$      'post_kind', CASE WHEN p.kind = 'note' THEN 'post'$r$,
      $r$      'win', nullif(p.win_label, ''),
      'post_kind', CASE WHEN p.kind = 'note' THEN 'post'$r$);
    IF position($r$'win', nullif(p.win_label$r$ in def) = 0 THEN RAISE EXCEPTION 'community_claim_pushes: anchor not found'; END IF;
    EXECUTE def;
  END IF;
END $$;

-- The last month's workout posts that people have reacted to get theirs now.
UPDATE public.community_posts p
   SET win_label = public.community_win_label(p.completion_id)
 WHERE p.win_label IS NULL AND p.kind = 'workout' AND p.completion_id IS NOT NULL AND p.locked_in_at IS NULL
   AND p.created_at > now() - interval '30 days'
   AND EXISTS (SELECT 1 FROM public.community_reactions r WHERE r.post_id = p.id);
