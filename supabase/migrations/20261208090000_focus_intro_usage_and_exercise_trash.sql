-- 1) Focus (workout_view_prefs.view = 'story'): who has tried it, and the intro
--    that invites people to until they do.
--    tried_at: the first time they used the List / Focus switch (the intro stops then).
--    intro_shown / intro_dismissed: how often the intro appeared / was closed.
ALTER TABLE public.workout_view_prefs
  ADD COLUMN IF NOT EXISTS tried_at timestamptz,
  ADD COLUMN IF NOT EXISTS intro_shown integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS intro_dismissed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS intro_last_at timestamptz;

-- Everyone with a row so far got it from the switch.
UPDATE public.workout_view_prefs SET tried_at = updated_at WHERE tried_at IS NULL AND intro_shown = 0;

-- The switch: saves the view and stamps the first try (never moves it later).
CREATE OR REPLACE FUNCTION public.workout_view_set(_view text)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  INSERT INTO public.workout_view_prefs (user_id, view, updated_at, tried_at)
  VALUES ((SELECT auth.uid()), _view, now(), now())
  ON CONFLICT (user_id) DO UPDATE
    SET view = excluded.view, updated_at = now(),
        tried_at = coalesce(public.workout_view_prefs.tried_at, now());
$$;

-- The intro: counts a showing or a "Not now" (never touches the saved view).
CREATE OR REPLACE FUNCTION public.workout_view_intro(_event text)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  INSERT INTO public.workout_view_prefs (user_id, intro_shown, intro_dismissed, intro_last_at)
  VALUES ((SELECT auth.uid()),
          CASE WHEN _event = 'shown' THEN 1 ELSE 0 END,
          CASE WHEN _event = 'dismissed' THEN 1 ELSE 0 END,
          now())
  ON CONFLICT (user_id) DO UPDATE
    SET intro_shown = public.workout_view_prefs.intro_shown + CASE WHEN _event = 'shown' THEN 1 ELSE 0 END,
        intro_dismissed = public.workout_view_prefs.intro_dismissed + CASE WHEN _event = 'dismissed' THEN 1 ELSE 0 END,
        intro_last_at = now();
$$;

GRANT EXECUTE ON FUNCTION public.workout_view_set(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.workout_view_intro(text) TO authenticated;

-- 2) Is Focus useful? One row per person per workout, added to as they log:
--    time on screen in each view, sets logged in each, switches, where they finished.
CREATE TABLE IF NOT EXISTS public.workout_view_sessions (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day_id uuid NOT NULL,
  client_id uuid,
  opened_in text CHECK (opened_in IN ('list', 'story')),
  focus_ms bigint NOT NULL DEFAULT 0,
  list_ms bigint NOT NULL DEFAULT 0,
  sets_focus integer NOT NULL DEFAULT 0,
  sets_list integer NOT NULL DEFAULT 0,
  to_focus integer NOT NULL DEFAULT 0,
  to_list integer NOT NULL DEFAULT 0,
  finished_in text CHECK (finished_in IN ('list', 'story')),
  first_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day_id)
);
CREATE INDEX IF NOT EXISTS workout_view_sessions_updated ON public.workout_view_sessions (updated_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.workout_view_sessions TO authenticated;
GRANT ALL ON public.workout_view_sessions TO service_role;
ALTER TABLE public.workout_view_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Own workout view sessions - read" ON public.workout_view_sessions;
CREATE POLICY "Own workout view sessions - read" ON public.workout_view_sessions FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "Own workout view sessions - insert" ON public.workout_view_sessions;
CREATE POLICY "Own workout view sessions - insert" ON public.workout_view_sessions FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "Own workout view sessions - update" ON public.workout_view_sessions;
CREATE POLICY "Own workout view sessions - update" ON public.workout_view_sessions FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

-- Adds what happened since the last save (the app sends deltas, so visits add up).
CREATE OR REPLACE FUNCTION public.workout_view_session_add(
  _day_id uuid, _client_id uuid, _opened_in text,
  _focus_ms bigint, _list_ms bigint, _sets_focus integer, _sets_list integer,
  _to_focus integer, _to_list integer, _finished_in text
)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  INSERT INTO public.workout_view_sessions AS s
    (user_id, day_id, client_id, opened_in, focus_ms, list_ms, sets_focus, sets_list, to_focus, to_list, finished_in)
  VALUES ((SELECT auth.uid()), _day_id, _client_id, _opened_in,
          greatest(_focus_ms, 0), greatest(_list_ms, 0), greatest(_sets_focus, 0), greatest(_sets_list, 0),
          greatest(_to_focus, 0), greatest(_to_list, 0), _finished_in)
  ON CONFLICT (user_id, day_id) DO UPDATE
    SET client_id = coalesce(s.client_id, excluded.client_id),
        opened_in = coalesce(s.opened_in, excluded.opened_in),
        focus_ms = s.focus_ms + excluded.focus_ms,
        list_ms = s.list_ms + excluded.list_ms,
        sets_focus = s.sets_focus + excluded.sets_focus,
        sets_list = s.sets_list + excluded.sets_list,
        to_focus = s.to_focus + excluded.to_focus,
        to_list = s.to_list + excluded.to_list,
        finished_in = coalesce(excluded.finished_in, s.finished_in),
        updated_at = now();
$$;
GRANT EXECUTE ON FUNCTION public.workout_view_session_add(uuid, uuid, text, bigint, bigint, integer, integer, integer, integer, text) TO authenticated;

-- The coach's read-out (Training Intel → Focus usage). Admins only.
CREATE OR REPLACE FUNCTION public.workout_focus_report(_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  since timestamptz := now() - make_interval(days => greatest(_days, 1));
  v_out jsonb;
BEGIN
  IF NOT (SELECT public.has_role((SELECT auth.uid()), 'admin')) THEN
    RAISE EXCEPTION 'Admins only' USING ERRCODE = '42501';
  END IF;
  SELECT jsonb_build_object(
    'days', greatest(_days, 1),
    'intro_people', (SELECT count(*) FROM workout_view_prefs WHERE intro_shown > 0),
    'intro_shown', (SELECT coalesce(sum(intro_shown), 0) FROM workout_view_prefs),
    'intro_dismissed', (SELECT coalesce(sum(intro_dismissed), 0) FROM workout_view_prefs),
    'tried', (SELECT count(*) FROM workout_view_prefs WHERE tried_at IS NOT NULL),
    'tried_after_intro', (SELECT count(*) FROM workout_view_prefs WHERE tried_at IS NOT NULL AND intro_shown > 0),
    'on_focus_now', (SELECT count(*) FROM workout_view_prefs WHERE view = 'story'),
    'workouts', (SELECT count(*) FROM workout_view_sessions WHERE updated_at >= since),
    'workouts_with_focus', (SELECT count(*) FROM workout_view_sessions WHERE updated_at >= since AND (sets_focus > 0 OR focus_ms > 60000)),
    'finished_in_focus', (SELECT count(*) FROM workout_view_sessions WHERE updated_at >= since AND finished_in = 'story'),
    'finished_in_list', (SELECT count(*) FROM workout_view_sessions WHERE updated_at >= since AND finished_in = 'list'),
    'sets_focus', (SELECT coalesce(sum(sets_focus), 0) FROM workout_view_sessions WHERE updated_at >= since),
    'sets_list', (SELECT coalesce(sum(sets_list), 0) FROM workout_view_sessions WHERE updated_at >= since),
    'switch_backs', (SELECT coalesce(sum(to_list), 0) FROM workout_view_sessions WHERE updated_at >= since),
    'people_using', (SELECT count(DISTINCT user_id) FROM workout_view_sessions WHERE updated_at >= since AND sets_focus > 0),
    'people_logging', (SELECT count(DISTINCT user_id) FROM workout_view_sessions WHERE updated_at >= since AND (sets_focus + sets_list) > 0)
  ) INTO v_out;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.workout_focus_report(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workout_focus_report(integer) TO authenticated;

-- 3) Removing an exercise from a workout is reversible. The row and everything
--    hanging off it (logged sets and the coach's reviews of them, notes, warm-ups,
--    set blocks, % references) is
--    kept here and put back exactly by Undo / Restore. Only that one workout is
--    touched; the program's other days and the template never are.
CREATE TABLE IF NOT EXISTS public.pl_exercise_row_trash (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  row_id uuid NOT NULL,
  day_id uuid NOT NULL,
  removed_by uuid,
  removed_at timestamptz NOT NULL DEFAULT now(),
  restored_at timestamptz,
  row_data jsonb NOT NULL,
  results jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes jsonb NOT NULL DEFAULT '[]'::jsonb,
  blocks jsonb NOT NULL DEFAULT '[]'::jsonb,
  block_set_rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  block_drop_stages jsonb NOT NULL DEFAULT '[]'::jsonb,
  reviews jsonb NOT NULL DEFAULT '[]'::jsonb,
  warmups jsonb NOT NULL DEFAULT '[]'::jsonb,
  basis_refs uuid[] NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS pl_exercise_row_trash_open ON public.pl_exercise_row_trash (day_id, removed_at DESC) WHERE restored_at IS NULL;
-- Server only (quick-swap.functions.ts checks the caller can see the workout first).
ALTER TABLE public.pl_exercise_row_trash ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pl_exercise_row_trash FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.pl_exercise_row_trash TO service_role;

-- Re-inserts rows saved as JSON into a table (its own columns only, so a column
-- added later never breaks a restore).
CREATE OR REPLACE FUNCTION public.pl_trash_reinsert(_tbl regclass, _rows jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE cols text;
BEGIN
  IF _rows IS NULL OR jsonb_typeof(_rows) <> 'array' OR jsonb_array_length(_rows) = 0 THEN RETURN; END IF;
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO cols
    FROM pg_attribute WHERE attrelid = _tbl AND attnum > 0 AND NOT attisdropped AND attgenerated = '';
  EXECUTE format('INSERT INTO %s (%s) SELECT %s FROM jsonb_populate_recordset(NULL::%s, $1) ON CONFLICT DO NOTHING', _tbl, cols, cols, _tbl)
    USING _rows;
END;
$$;

CREATE OR REPLACE FUNCTION public.pl_trash_exercise_row(_day_id uuid, _row_id uuid, _by uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.pl_exercise_rows;
  v_id uuid;
BEGIN
  SELECT * INTO v_row FROM public.pl_exercise_rows WHERE id = _row_id AND day_id = _day_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Exercise is no longer in this workout' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.pl_exercise_row_trash
    (row_id, day_id, removed_by, row_data, results, notes, blocks, block_set_rows, block_drop_stages, reviews, warmups, basis_refs)
  VALUES (
    _row_id, _day_id, _by, to_jsonb(v_row),
    coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM public.pl_row_results x WHERE x.row_id = _row_id), '[]'::jsonb),
    coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM public.pl_exercise_notes x WHERE x.row_id = _row_id), '[]'::jsonb),
    coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM public.pl_exercise_blocks x WHERE x.row_id = _row_id), '[]'::jsonb),
    coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM public.pl_block_set_rows x
               WHERE x.block_id IN (SELECT b.id FROM public.pl_exercise_blocks b WHERE b.row_id = _row_id)), '[]'::jsonb),
    coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM public.pl_block_drop_stages x
               WHERE x.block_id IN (SELECT b.id FROM public.pl_exercise_blocks b WHERE b.row_id = _row_id)), '[]'::jsonb),
    coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM public.strength_board_reviews x
               WHERE x.result_id IN (SELECT r.id FROM public.pl_row_results r WHERE r.row_id = _row_id)), '[]'::jsonb),
    coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM public.pl_warmup_sets x WHERE x.row_id = _row_id), '[]'::jsonb),
    coalesce((SELECT array_agg(x.id) FROM public.pl_exercise_rows x WHERE x.basis_row_id = _row_id), '{}')
  )
  RETURNING id INTO v_id;
  -- Its sets go to the trash with it (kept, restorable), so the history guard
  -- on the row itself has nothing left to protect.
  DELETE FROM public.pl_row_results WHERE row_id = _row_id;
  DELETE FROM public.pl_exercise_notes WHERE row_id = _row_id;
  DELETE FROM public.pl_exercise_rows WHERE id = _row_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.pl_restore_exercise_row(_trash_id uuid, _day_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE t public.pl_exercise_row_trash;
BEGIN
  SELECT * INTO t FROM public.pl_exercise_row_trash WHERE id = _trash_id AND day_id = _day_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nothing to restore' USING ERRCODE = 'P0002';
  END IF;
  IF t.restored_at IS NOT NULL THEN
    RETURN t.row_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pl_days WHERE id = _day_id) THEN
    RAISE EXCEPTION 'This workout no longer exists' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.pl_trash_reinsert('public.pl_exercise_rows', jsonb_build_array(t.row_data));
  PERFORM public.pl_trash_reinsert('public.pl_exercise_blocks', t.blocks);
  PERFORM public.pl_trash_reinsert('public.pl_block_set_rows', t.block_set_rows);
  PERFORM public.pl_trash_reinsert('public.pl_block_drop_stages', t.block_drop_stages);
  PERFORM public.pl_trash_reinsert('public.pl_row_results', t.results);
  PERFORM public.pl_trash_reinsert('public.strength_board_reviews', t.reviews);
  PERFORM public.pl_trash_reinsert('public.pl_exercise_notes', t.notes);
  PERFORM public.pl_trash_reinsert('public.pl_warmup_sets', t.warmups);
  UPDATE public.pl_exercise_rows SET basis_row_id = t.row_id
   WHERE id = ANY (t.basis_refs) AND basis_row_id IS NULL;
  UPDATE public.pl_exercise_row_trash SET restored_at = now() WHERE id = t.id;
  RETURN t.row_id;
END;
$$;

REVOKE ALL ON FUNCTION public.pl_trash_reinsert(regclass, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pl_trash_exercise_row(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pl_restore_exercise_row(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pl_trash_reinsert(regclass, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.pl_trash_exercise_row(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.pl_restore_exercise_row(uuid, uuid) TO service_role;
