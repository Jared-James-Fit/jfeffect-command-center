-- A member manages the program on their calendar.
--
-- A JF member's program (a JF Effect plan they started, or one they built or
-- copied from the crew) is pl_blocks they own (created_by), but the table only
-- lets coaches and admins change blocks, so once a program was on a member's
-- calendar they had no way to end it, and editing a program they built
-- changed the saved program but never the workouts already on their calendar.
--
-- 1. pl_blocks.source_athlete_program_id: which of their own programs a block
--    was started from (athlete_program_start), so the app can say where it
--    came from and "Edit program" can reach it. Older starts are linked by
--    title, newest program first; deleting the program unlinks it.
-- 2. member_program_end(_block_id, _confirm): ends the program the block
--    belongs to (its pl_preps siblings too). Asked without _confirm it only
--    reports what would happen. Workouts with anything logged are kept: a
--    block with history is archived (its sets, PRs and history stay), one with
--    nothing logged is removed. Only the member who owns the block.
-- 3. athlete_program_sync_running(_id): after a member edits a program they're
--    running, the workouts on their calendar they haven't touched follow it
--    (title, exercises, days added or removed, weeks added or removed). A
--    workout that's past, started or has anything logged never changes. The
--    cardio plan's row on a workout stays where it is.

ALTER TABLE public.pl_blocks
  ADD COLUMN IF NOT EXISTS source_athlete_program_id uuid
    REFERENCES public.athlete_programs(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS pl_blocks_source_athlete_program_idx
  ON public.pl_blocks (source_athlete_program_id) WHERE source_athlete_program_id IS NOT NULL;

-- Older starts: a member's block with no library template, named like one of
-- their own programs made before it.
UPDATE public.pl_blocks b
   SET source_athlete_program_id = (
         SELECT p.id FROM public.athlete_programs p
          WHERE p.owner_id = b.created_by
            AND p.title = b.name
            AND p.archived_at IS NULL
            AND p.created_at <= b.created_at
          ORDER BY p.created_at DESC
          LIMIT 1)
 WHERE b.source_athlete_program_id IS NULL
   AND b.source_template_id IS NULL
   AND b.created_by IS NOT NULL
   AND EXISTS (SELECT 1 FROM public.clients c WHERE c.id = b.client_id AND c.user_id = b.created_by);

-- Deleting a program (it's archived) unlinks the copy on their calendar: that
-- keeps running as it is, with nothing left to edit it from.
CREATE OR REPLACE FUNCTION public.athlete_program_delete(_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  UPDATE public.athlete_programs
     SET archived_at = now(), visibility = 'private', updated_at = now()
   WHERE id = _id AND owner_id = auth.uid() AND archived_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Program not found' USING ERRCODE = 'P0002'; END IF;
  UPDATE public.pl_blocks SET source_athlete_program_id = NULL
   WHERE source_athlete_program_id = _id AND created_by = auth.uid();
END;
$$;
REVOKE ALL ON FUNCTION public.athlete_program_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.athlete_program_delete(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Starting a program records where it came from (otherwise as before).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.athlete_program_start(_id uuid, _start date)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  p public.athlete_programs%ROWTYPE;
  v_client uuid;
  v_tz text;
  v_today date;
  v_block uuid;
  v_week uuid;
  v_day uuid;
  v_start date;
  v_old uuid[];
  v_new int;
  w int;
  d jsonb;
  e jsonb;
  i int;
  n int;
  s int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO p FROM public.athlete_programs WHERE id = _id AND owner_id = v_uid AND archived_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Program not found' USING ERRCODE = 'P0002'; END IF;
  SELECT c.id, c.timezone INTO v_client, v_tz FROM public.clients c
   WHERE c.user_id = v_uid AND c.service_tier = 'self_serve' AND coalesce(c.archived, false) = false;
  IF v_client IS NULL THEN
    RAISE EXCEPTION 'Your coach writes your program, so it can''t be started here.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.member_can_consume(v_uid) THEN
    RAISE EXCEPTION 'Your account doesn''t have access right now.' USING ERRCODE = '42501';
  END IF;
  v_today := public.pt_local_today(coalesce(v_tz, 'America/Winnipeg'));
  v_start := coalesce(_start, v_today);
  IF v_start < v_today - 1 THEN
    RAISE EXCEPTION 'Pick a start date from today on' USING ERRCODE = '22023';
  END IF;
  n := jsonb_array_length(p.days);
  IF n = 0 THEN RAISE EXCEPTION 'Add a training day first' USING ERRCODE = '22023'; END IF;
  IF (SELECT count(*) FROM public.pl_blocks b
       WHERE b.client_id = v_client AND b.created_by = v_uid AND b.created_at > now() - interval '1 day') >= 10 THEN
    RAISE EXCEPTION 'You''ve started 10 programs today. Try again tomorrow.' USING ERRCODE = '54000';
  END IF;

  -- the program they ran before makes way: archived, never deleted (its logs stay)
  SELECT array_agg(b.id) INTO v_old FROM public.pl_blocks b
   WHERE b.client_id = v_client AND b.created_by = v_uid AND b.archived = false
     AND coalesce(b.source_template_block_key, '') NOT LIKE 'at_home_backup%';
  IF v_old IS NOT NULL THEN
    UPDATE public.pl_blocks SET status = 'Archived', archived = true, archived_at = now(), archived_by = v_uid
     WHERE id = ANY (v_old);
    UPDATE public.pl_preps SET status = 'Archived', archived = true, archived_at = now(), archived_by = v_uid
     WHERE created_by = v_uid AND archived = false
       AND id IN (SELECT b.prep_id FROM public.pl_blocks b WHERE b.id = ANY (v_old) AND b.prep_id IS NOT NULL);
  END IF;

  INSERT INTO public.pl_blocks (client_id, name, weeks, goal, status, client_visible, start_date, end_date, sort_order,
                                created_by, source_athlete_program_id)
  VALUES (v_client, p.title, p.weeks, p.goal, 'Active', true, v_start, v_start + (p.weeks * 7 - 1), 0, v_uid, p.id)
  RETURNING id INTO v_block;

  FOR w IN 1..p.weeks LOOP
    INSERT INTO public.pl_weeks (block_id, week_index, start_date, end_date)
    VALUES (v_block, w, v_start + (w - 1) * 7, v_start + (w * 7 - 1))
    RETURNING id INTO v_week;
    i := 0;
    FOR d IN SELECT x FROM jsonb_array_elements(p.days) WITH ORDINALITY t(x, o) ORDER BY o LOOP
      i := i + 1;
      INSERT INTO public.pl_days (week_id, day_index, title, focus, scheduled_date, schedule_source)
      VALUES (v_week, i, coalesce(nullif(d->>'title', ''), 'Day ' || i), nullif(d->>'focus', ''),
              v_start + (w - 1) * 7 + public.pl_week_day_offset(i, n), 'builder_assignment')
      RETURNING id INTO v_day;
      s := 0;
      FOR e IN SELECT x FROM jsonb_array_elements(coalesce(d->'exercises', '[]'::jsonb)) WITH ORDINALITY t(x, o) ORDER BY o LOOP
        INSERT INTO public.pl_exercise_rows (day_id, sort_order, exercise_id, sets, reps_text, rpe, rest_seconds, notes,
                                             time_profile, measurement_type, tracking_type)
        VALUES (v_day, s, (e->>'exercise_id')::uuid, (e->>'sets')::int, e->>'reps', nullif(e->>'rpe', ''),
                nullif(e->>'rest_seconds', '')::int, nullif(e->>'notes', ''),
                'accessory_compound', 'reps', 'reps_weight');
        s := s + 1;
      END LOOP;
    END LOOP;
  END LOOP;

  -- "started by N people": each person once, on the program and the original it was copied from
  INSERT INTO public.athlete_program_starts (program_id, user_id) VALUES (p.id, v_uid) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_new = ROW_COUNT;
  IF v_new > 0 THEN
    UPDATE public.athlete_programs SET start_count = start_count + 1 WHERE id = p.id;
  END IF;
  IF p.forked_from IS NOT NULL AND p.forked_from_owner IS DISTINCT FROM v_uid THEN
    INSERT INTO public.athlete_program_starts (program_id, user_id)
    SELECT p.forked_from, v_uid WHERE EXISTS (SELECT 1 FROM public.athlete_programs o WHERE o.id = p.forked_from)
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_new = ROW_COUNT;
    IF v_new > 0 THEN
      UPDATE public.athlete_programs SET start_count = start_count + 1 WHERE id = p.forked_from;
    END IF;
  END IF;
  RETURN jsonb_build_object('block_id', v_block, 'client_id', v_client, 'replaced', coalesce(array_length(v_old, 1), 0));
END;
$$;
REVOKE ALL ON FUNCTION public.athlete_program_start(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.athlete_program_start(uuid, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- A workout that's already part of their history: its day has passed, it was
-- opened or finished, or a set was logged. Those never change or go.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pl_day_touched(_day_id uuid, _scheduled date, _today date)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT (_scheduled IS NOT NULL AND _scheduled < _today)
      OR EXISTS (SELECT 1 FROM public.pl_day_completions c WHERE c.day_id = _day_id)
      OR EXISTS (SELECT 1 FROM public.pl_exercise_rows r JOIN public.pl_row_results x ON x.row_id = r.id
                  WHERE r.day_id = _day_id);
$$;
REVOKE ALL ON FUNCTION public.pl_day_touched(uuid, date, date) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- End the program a block belongs to.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.member_program_end(_block_id uuid, _confirm boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_client uuid;
  v_tz text;
  v_today date;
  b public.pl_blocks%ROWTYPE;
  v_ids uuid[];
  v_name text;
  v_logged int;
  v_upcoming int;
  v_id uuid;
  v_archived int := 0;
  v_deleted int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT c.id, c.timezone INTO v_client, v_tz FROM public.clients c
   WHERE c.user_id = v_uid AND coalesce(c.archived, false) = false LIMIT 1;
  SELECT * INTO b FROM public.pl_blocks
   WHERE id = _block_id AND client_id = v_client AND created_by = v_uid AND archived = false;
  IF v_client IS NULL OR NOT FOUND THEN
    RAISE EXCEPTION 'This program isn''t yours to end. Your coach manages it.' USING ERRCODE = '42501';
  END IF;
  v_today := public.pt_local_today(coalesce(v_tz, 'America/Winnipeg'));

  -- the whole program: a JF Effect plan with several blocks shares one pl_preps record
  SELECT array_agg(x.id ORDER BY x.start_date NULLS LAST, x.sort_order, x.created_at) INTO v_ids
    FROM public.pl_blocks x
   WHERE x.client_id = v_client AND x.created_by = v_uid AND x.archived = false
     AND (x.id = b.id OR (b.prep_id IS NOT NULL AND x.prep_id = b.prep_id));
  v_name := coalesce((SELECT nullif(btrim(pr.title), '') FROM public.pl_preps pr WHERE pr.id = b.prep_id), b.name);

  SELECT count(*) FILTER (WHERE public.pl_day_logged(d.id)),
         count(*) FILTER (WHERE NOT public.pl_day_logged(d.id) AND (d.scheduled_date IS NULL OR d.scheduled_date >= v_today))
    INTO v_logged, v_upcoming
    FROM public.pl_weeks w JOIN public.pl_days d ON d.week_id = w.id
   WHERE w.block_id = ANY (v_ids)
     AND coalesce(w.archived, false) = false AND w.deleted_at IS NULL
     AND coalesce(d.archived, false) = false AND d.deleted_at IS NULL;

  IF NOT coalesce(_confirm, false) THEN
    RETURN jsonb_build_object('name', v_name, 'blocks', coalesce(array_length(v_ids, 1), 0),
                              'logged', coalesce(v_logged, 0), 'upcoming', coalesce(v_upcoming, 0),
                              'outcome', CASE WHEN coalesce(v_logged, 0) > 0 THEN 'archive' ELSE 'delete' END,
                              'ended', false);
  END IF;

  FOREACH v_id IN ARRAY v_ids LOOP
    IF EXISTS (SELECT 1 FROM public.pl_weeks w JOIN public.pl_days d ON d.week_id = w.id
                WHERE w.block_id = v_id AND public.pl_day_logged(d.id)) THEN
      UPDATE public.pl_blocks SET status = 'Archived', archived = true, archived_at = now(), archived_by = v_uid
       WHERE id = v_id;
      v_archived := v_archived + 1;
    ELSE
      BEGIN
        DELETE FROM public.pl_blocks WHERE id = v_id;
        v_deleted := v_deleted + 1;
      EXCEPTION WHEN others THEN
        -- anything that won't let go is archived instead: never a half-ended program
        UPDATE public.pl_blocks SET status = 'Archived', archived = true, archived_at = now(), archived_by = v_uid
         WHERE id = v_id;
        v_archived := v_archived + 1;
      END;
    END IF;
  END LOOP;

  IF b.prep_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.pl_blocks x WHERE x.prep_id = b.prep_id) THEN
      UPDATE public.pl_preps SET status = 'Archived', archived = true, archived_at = now(), archived_by = v_uid
       WHERE id = b.prep_id AND created_by = v_uid AND archived = false
         AND NOT EXISTS (SELECT 1 FROM public.pl_blocks x WHERE x.prep_id = b.prep_id AND x.archived = false);
    ELSE
      BEGIN
        DELETE FROM public.pl_preps WHERE id = b.prep_id AND created_by = v_uid;
      EXCEPTION WHEN others THEN
        UPDATE public.pl_preps SET status = 'Archived', archived = true, archived_at = now(), archived_by = v_uid
         WHERE id = b.prep_id AND created_by = v_uid;
      END;
    END IF;
  END IF;

  RETURN jsonb_build_object('name', v_name, 'blocks', coalesce(array_length(v_ids, 1), 0),
                            'logged', coalesce(v_logged, 0), 'upcoming', coalesce(v_upcoming, 0),
                            'outcome', CASE WHEN v_archived > 0 THEN 'archive' ELSE 'delete' END,
                            'archived', v_archived, 'deleted', v_deleted, 'ended', true);
END;
$$;
REVOKE ALL ON FUNCTION public.member_program_end(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_program_end(uuid, boolean) TO authenticated;

-- ---------------------------------------------------------------------------
-- The running copy of a program follows the member's edits.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.athlete_program_sync_running(_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  p public.athlete_programs%ROWTYPE;
  b public.pl_blocks%ROWTYPE;
  v_client uuid;
  v_tz text;
  v_today date;
  v_start date;
  v_have int;
  v_weeks int;
  v_end date;
  v_week uuid;
  v_day uuid;
  v_wend date;
  v_cardio int;
  wk record;
  dy record;
  d jsonb;
  e jsonb;
  n int;
  i int;
  s int;
  v_updated int := 0;
  v_added int := 0;
  v_removed int := 0;
  v_kept int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO p FROM public.athlete_programs WHERE id = _id AND owner_id = v_uid AND archived_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Program not found' USING ERRCODE = 'P0002'; END IF;
  SELECT c.id, c.timezone INTO v_client, v_tz FROM public.clients c
   WHERE c.user_id = v_uid AND coalesce(c.archived, false) = false LIMIT 1;
  IF v_client IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO b FROM public.pl_blocks
   WHERE client_id = v_client AND created_by = v_uid AND source_athlete_program_id = _id AND archived = false
   ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  n := jsonb_array_length(p.days);
  IF n = 0 THEN RAISE EXCEPTION 'Add a training day first' USING ERRCODE = '22023'; END IF;
  v_today := public.pt_local_today(coalesce(v_tz, 'America/Winnipeg'));
  v_start := coalesce(b.start_date, v_today);

  -- weeks the program grew by go on the end
  SELECT coalesce(max(week_index), 0) INTO v_have FROM public.pl_weeks
   WHERE block_id = b.id AND coalesce(archived, false) = false AND deleted_at IS NULL;
  IF v_have < p.weeks THEN
    FOR i IN (v_have + 1)..p.weeks LOOP
      INSERT INTO public.pl_weeks (block_id, week_index, start_date, end_date)
      VALUES (b.id, i, v_start + (i - 1) * 7, v_start + (i * 7 - 1));
    END LOOP;
  END IF;

  FOR wk IN
    SELECT w.id, w.week_index, w.start_date, w.end_date FROM public.pl_weeks w
     WHERE w.block_id = b.id AND coalesce(w.archived, false) = false AND w.deleted_at IS NULL
     ORDER BY w.week_index
  LOOP
    FOR dy IN
      SELECT x.id, x.day_index, x.scheduled_date FROM public.pl_days x
       WHERE x.week_id = wk.id AND coalesce(x.archived, false) = false AND x.deleted_at IS NULL
       ORDER BY x.day_index
    LOOP
      IF public.pl_day_touched(dy.id, dy.scheduled_date, v_today) THEN
        v_kept := v_kept + 1;
        CONTINUE;
      END IF;
      IF wk.week_index > p.weeks OR dy.day_index > n THEN
        DELETE FROM public.pl_days WHERE id = dy.id;
        v_removed := v_removed + 1;
        CONTINUE;
      END IF;
      d := p.days -> (dy.day_index - 1);
      UPDATE public.pl_days
         SET title = coalesce(nullif(d->>'title', ''), 'Day ' || dy.day_index),
             focus = nullif(d->>'focus', ''),
             updated_at = now()
       WHERE id = dy.id;
      -- the cardio plan's row stays (program_cardio_sync owns it), after the new exercises
      DELETE FROM public.pl_exercise_rows WHERE day_id = dy.id AND cardio_target_id IS NULL;
      s := 0;
      FOR e IN SELECT x FROM jsonb_array_elements(coalesce(d->'exercises', '[]'::jsonb)) WITH ORDINALITY t(x, o) ORDER BY o LOOP
        INSERT INTO public.pl_exercise_rows (day_id, sort_order, exercise_id, sets, reps_text, rpe, rest_seconds, notes,
                                             time_profile, measurement_type, tracking_type)
        VALUES (dy.id, s, (e->>'exercise_id')::uuid, (e->>'sets')::int, e->>'reps', nullif(e->>'rpe', ''),
                nullif(e->>'rest_seconds', '')::int, nullif(e->>'notes', ''),
                'accessory_compound', 'reps', 'reps_weight');
        s := s + 1;
      END LOOP;
      UPDATE public.pl_exercise_rows SET sort_order = s WHERE day_id = dy.id AND cardio_target_id IS NOT NULL;
      v_updated := v_updated + 1;
    END LOOP;

    IF wk.week_index <= p.weeks THEN
      -- workouts the program gained, in a week that isn't over yet
      v_wend := coalesce(wk.end_date, v_start + wk.week_index * 7 - 1);
      IF v_wend >= v_today THEN
        FOR i IN 1..n LOOP
          CONTINUE WHEN EXISTS (SELECT 1 FROM public.pl_days x
                                 WHERE x.week_id = wk.id AND x.day_index = i
                                   AND coalesce(x.archived, false) = false AND x.deleted_at IS NULL);
          d := p.days -> (i - 1);
          INSERT INTO public.pl_days (week_id, day_index, title, focus, scheduled_date, schedule_source)
          VALUES (wk.id, i, coalesce(nullif(d->>'title', ''), 'Day ' || i), nullif(d->>'focus', ''),
                  greatest(coalesce(wk.start_date, v_start + (wk.week_index - 1) * 7) + public.pl_week_day_offset(i, n), v_today),
                  'builder_assignment')
          RETURNING id INTO v_day;
          s := 0;
          FOR e IN SELECT x FROM jsonb_array_elements(coalesce(d->'exercises', '[]'::jsonb)) WITH ORDINALITY t(x, o) ORDER BY o LOOP
            INSERT INTO public.pl_exercise_rows (day_id, sort_order, exercise_id, sets, reps_text, rpe, rest_seconds, notes,
                                                 time_profile, measurement_type, tracking_type)
            VALUES (v_day, s, (e->>'exercise_id')::uuid, (e->>'sets')::int, e->>'reps', nullif(e->>'rpe', ''),
                    nullif(e->>'rest_seconds', '')::int, nullif(e->>'notes', ''),
                    'accessory_compound', 'reps', 'reps_weight');
            s := s + 1;
          END LOOP;
          v_added := v_added + 1;
        END LOOP;
      END IF;
    ELSIF NOT EXISTS (SELECT 1 FROM public.pl_days x WHERE x.week_id = wk.id) THEN
      -- a week past the program's new length with nothing left in it
      DELETE FROM public.pl_weeks WHERE id = wk.id;
    END IF;
  END LOOP;

  SELECT count(*), max(coalesce(w.end_date, v_start + w.week_index * 7 - 1)) INTO v_weeks, v_end
    FROM public.pl_weeks w
   WHERE w.block_id = b.id AND coalesce(w.archived, false) = false AND w.deleted_at IS NULL;
  UPDATE public.pl_blocks
     SET name = p.title,
         goal = coalesce(p.goal, goal),
         weeks = greatest(coalesce(v_weeks, 1), 1),
         end_date = coalesce(v_end, end_date),
         updated_at = now()
   WHERE id = b.id;

  RETURN jsonb_build_object('block_id', b.id, 'client_id', v_client, 'updated', v_updated, 'added', v_added,
                            'removed', v_removed, 'kept', v_kept, 'days_per_week', n);
END;
$$;
REVOKE ALL ON FUNCTION public.athlete_program_sync_running(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.athlete_program_sync_running(uuid) TO authenticated;
