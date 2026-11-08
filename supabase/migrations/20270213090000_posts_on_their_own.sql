-- Every automated post under the coach's name goes out on its own (his ask,
-- Nov 8 2026: "i want all posts scheduled and i can edit them anytime without
-- needing approval before post. The posts should be automatic."). He can
-- still open, edit, move or skip any of them before its time; nothing waits
-- for his OK.
--
--   1. Lessons post on their own (lesson_mode 'auto', the "Post on their own"
--      switch in Crew → Posts; "Review each one" is still there to switch
--      back to). A skipped lesson stays out.
--   2. Athlete Insights are never held for review: a post whose checks
--      didn't fully pass goes out at its time like any other (the maker still
--      remakes a failing picture or caption first, 3 concepts at most).
--   3. Birthday posts: a draft goes out at its time (8am their time) whether
--      or not it was approved, as the account coach posts go out as, unless
--      the coach skipped it or coach posts are paused.

-- ── 1. Lessons ──────────────────────────────────────────────────────────────
ALTER TABLE public.community_series_settings ALTER COLUMN lesson_mode SET DEFAULT 'auto';
UPDATE public.community_series_settings SET lesson_mode = 'auto', updated_at = now() WHERE lesson_mode IS DISTINCT FROM 'auto';

-- ── 2. Athlete Insights: nothing is held ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.community_daily_visual_held(r public.community_daily_visuals)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  -- posts go out on their own (Nov 8 2026); the coach edits any time before
  SELECT false
$$;
REVOKE ALL ON FUNCTION public.community_daily_visual_held(public.community_daily_visuals) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_daily_visual_held(public.community_daily_visuals) TO authenticated;

-- ── 3. Birthday posts go out at their time ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.community_birthdays_publish_due(_now timestamptz DEFAULT now())
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
  n int := 0;
  v_coach uuid;
  v_paused boolean;
BEGIN
  SELECT s.author_user_id, coalesce(s.paused, false) INTO v_coach, v_paused FROM public.community_series_settings s LIMIT 1;
  -- a draft nobody approved goes out as the account coach posts go out as (paused: it waits)
  IF v_coach IS NOT NULL AND NOT v_paused THEN
    UPDATE public.community_birthday_posts
       SET status = 'scheduled', approved_by = v_coach, approved_at = now(), updated_at = now()
     WHERE status = 'ready' AND approved_by IS NULL AND post_at <= _now AND post_at > _now - interval '20 hours';
  END IF;
  FOR r IN SELECT id FROM public.community_birthday_posts WHERE status = 'scheduled' AND post_at <= _now ORDER BY post_at LOOP
    PERFORM public.community_birthday_publish_row(r.id);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.community_birthdays_publish_due(timestamptz) FROM PUBLIC, anon, authenticated;

-- ── 4. Nothing to review in Crew's "Needs you" ──────────────────────────────
-- A birthday draft isn't waiting on the coach any more (it goes out on its
-- own), so the pulse no longer counts one as "to review". Lessons already
-- count only in review mode (community_lessons_waiting). One exact piece of
-- the live function is swapped; a piece that's gone stops the migration, one
-- already swapped is skipped, so it can run again.
DO $do$
DECLARE
  d text := pg_get_functiondef('public.community_admin_pulse'::regproc);
  v_old text := $o$'birthday_review', (SELECT count(*) FROM public.community_birthday_posts b WHERE b.status = 'ready' AND b.birthday >= current_date - 1),$o$;
  v_new text := $n$'birthday_review', 0, -- birthday posts go out on their own (Nov 8 2026)$n$;
BEGIN
  IF position(v_new IN d) > 0 THEN RETURN; END IF;
  IF position(v_old IN d) = 0 THEN RAISE EXCEPTION 'posts on their own: community_admin_pulse no longer has the birthday count'; END IF;
  EXECUTE replace(d, v_old, v_new || E'\n');
END;
$do$;
