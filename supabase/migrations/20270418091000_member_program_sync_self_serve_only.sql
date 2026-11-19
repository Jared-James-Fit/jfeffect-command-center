-- Saving a program you built updates the copy running on your calendar
-- (athlete_program_sync_running), but only for a self-managed member with
-- access, the same people who can start one (athlete_program_start).
--
-- Why: a member moved to coaching keeps the blocks they started, and their
-- coach may change them; a later save of the member's own program must never
-- overwrite what the coach wrote. A member whose access is paused saves the
-- program; their calendar isn't changed until they have access again.
-- The function is otherwise exactly 20270418090000's.

CREATE OR REPLACE FUNCTION public.athlete_program_sync_running(_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  p public.athlete_programs%ROWTYPE;
  v_client uuid;
  v_tz text;
  v_today date;
  v_start date;
  v_blocks uuid[];
  v_last uuid;
  v_prep uuid;
  v_total int;
  v_have int;
  v_lastidx int;
  v_next date;
  v_day uuid;
  v_wend date;
  v_days jsonb;
  v_per int;
  rw record;
  dy record;
  d jsonb;
  n int;
  i int;
  s int;
  v_bid uuid;
  v_updated int := 0;
  v_added int := 0;
  v_removed int := 0;
  v_kept int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO p FROM public.athlete_programs WHERE id = _id AND owner_id = v_uid AND archived_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Program not found' USING ERRCODE = 'P0002'; END IF;
  -- only a member's own self-managed calendar follows their edits: a client a
  -- coach took on (Move to coaching) keeps what the coach writes, and a member
  -- without access saves the program but their calendar waits
  SELECT c.id, c.timezone INTO v_client, v_tz FROM public.clients c
   WHERE c.user_id = v_uid AND c.service_tier = 'self_serve' AND coalesce(c.archived, false) = false LIMIT 1;
  IF v_client IS NULL OR NOT public.member_can_consume(v_uid) THEN RETURN NULL; END IF;

  SELECT array_agg(b.id ORDER BY b.start_date NULLS LAST, b.sort_order, b.created_at), max(b.prep_id::text)::uuid
    INTO v_blocks, v_prep
    FROM public.pl_blocks b
   WHERE b.client_id = v_client AND b.created_by = v_uid AND b.source_athlete_program_id = _id AND b.archived = false;
  IF v_blocks IS NULL THEN RETURN NULL; END IF;
  v_last := v_blocks[array_length(v_blocks, 1)];

  v_today := public.pt_local_today(coalesce(v_tz, 'America/Winnipeg'));
  SELECT min(b.start_date) INTO v_start FROM public.pl_blocks b WHERE b.id = ANY (v_blocks);
  v_start := coalesce(v_start, v_today);
  SELECT count(*), coalesce(max(jsonb_array_length(x.days)), 0) INTO v_total, v_per
    FROM public.athlete_program_weeks(p.plan, p.days, p.weeks, p.title) x;
  IF v_total = 0 OR v_per = 0 THEN RAISE EXCEPTION 'Add a training day first' USING ERRCODE = '22023'; END IF;

  -- weeks the program grew by go on the end of its last block
  SELECT count(*) INTO v_have
    FROM public.pl_weeks w
   WHERE w.block_id = ANY (v_blocks) AND coalesce(w.archived, false) = false AND w.deleted_at IS NULL;
  IF v_have < v_total THEN
    SELECT coalesce(max(w.week_index), 0), max(w.end_date) INTO v_lastidx, v_next
      FROM public.pl_weeks w
     WHERE w.block_id = v_last AND coalesce(w.archived, false) = false AND w.deleted_at IS NULL;
    v_next := coalesce(v_next + 1, v_start + v_have * 7);
    FOR i IN 1..(v_total - v_have) LOOP
      INSERT INTO public.pl_weeks (block_id, week_index, start_date, end_date)
      VALUES (v_last, v_lastidx + i, v_next + (i - 1) * 7, v_next + (i - 1) * 7 + 6);
    END LOOP;
  END IF;

  FOR rw IN
    SELECT w.id, w.block_id, w.week_index, w.start_date, w.end_date,
           row_number() OVER (ORDER BY array_position(v_blocks, w.block_id), w.week_index)::int AS g
      FROM public.pl_weeks w
     WHERE w.block_id = ANY (v_blocks) AND coalesce(w.archived, false) = false AND w.deleted_at IS NULL
     ORDER BY array_position(v_blocks, w.block_id), w.week_index
  LOOP
    SELECT x.days INTO v_days FROM public.athlete_program_weeks(p.plan, p.days, p.weeks, p.title) x WHERE x.g = rw.g;
    n := CASE WHEN v_days IS NULL THEN 0 ELSE jsonb_array_length(v_days) END;
    FOR dy IN
      SELECT x.id, x.day_index, x.scheduled_date FROM public.pl_days x
       WHERE x.week_id = rw.id AND coalesce(x.archived, false) = false AND x.deleted_at IS NULL
       ORDER BY x.day_index
    LOOP
      IF public.pl_day_touched(dy.id, dy.scheduled_date, v_today) THEN
        v_kept := v_kept + 1;
        CONTINUE;
      END IF;
      IF rw.g > v_total OR dy.day_index > n THEN
        DELETE FROM public.pl_days WHERE id = dy.id;
        v_removed := v_removed + 1;
        CONTINUE;
      END IF;
      d := v_days -> (dy.day_index - 1);
      UPDATE public.pl_days
         SET title = coalesce(nullif(d->>'title', ''), 'Day ' || dy.day_index),
             focus = nullif(d->>'focus', ''),
             updated_at = now()
       WHERE id = dy.id;
      -- the cardio plan's row stays (program_cardio_sync owns it), after the new exercises
      DELETE FROM public.pl_exercise_rows WHERE day_id = dy.id AND cardio_target_id IS NULL;
      s := public.athlete_program_insert_rows(dy.id, d->'exercises');
      UPDATE public.pl_exercise_rows SET sort_order = s WHERE day_id = dy.id AND cardio_target_id IS NOT NULL;
      v_updated := v_updated + 1;
    END LOOP;

    IF rw.g <= v_total THEN
      -- workouts the week gained, in a week that isn't over yet
      v_wend := coalesce(rw.end_date, v_start + rw.g * 7 - 1);
      IF v_wend >= v_today THEN
        FOR i IN 1..n LOOP
          CONTINUE WHEN EXISTS (SELECT 1 FROM public.pl_days x
                                 WHERE x.week_id = rw.id AND x.day_index = i
                                   AND coalesce(x.archived, false) = false AND x.deleted_at IS NULL);
          d := v_days -> (i - 1);
          INSERT INTO public.pl_days (week_id, day_index, title, focus, scheduled_date, schedule_source)
          VALUES (rw.id, i, coalesce(nullif(d->>'title', ''), 'Day ' || i), nullif(d->>'focus', ''),
                  greatest(coalesce(rw.start_date, v_start + (rw.g - 1) * 7) + public.pl_week_day_offset(i, n), v_today),
                  'builder_assignment')
          RETURNING id INTO v_day;
          PERFORM public.athlete_program_insert_rows(v_day, d->'exercises');
          v_added := v_added + 1;
        END LOOP;
      END IF;
    ELSIF NOT EXISTS (SELECT 1 FROM public.pl_days x WHERE x.week_id = rw.id) THEN
      -- a week past the program's new length with nothing left in it
      DELETE FROM public.pl_weeks WHERE id = rw.id;
    END IF;
  END LOOP;

  -- each block's length, dates and name (several blocks: the plan block its first week falls in)
  FOREACH v_bid IN ARRAY v_blocks LOOP
    UPDATE public.pl_blocks b
       SET weeks = greatest(coalesce(x.cnt, 1), 1),
           start_date = coalesce(x.first_start, b.start_date),
           end_date = coalesce(x.last_end, b.end_date),
           name = CASE WHEN array_length(v_blocks, 1) = 1 THEN p.title ELSE coalesce(x.plan_block, b.name) END,
           goal = coalesce(p.goal, b.goal),
           updated_at = now()
      FROM (SELECT count(*) AS cnt, min(w.start_date) AS first_start, max(w.end_date) AS last_end,
                   (SELECT y.block_name FROM public.athlete_program_weeks(p.plan, p.days, p.weeks, p.title) y
                     WHERE y.g = (SELECT count(*) + 1 FROM public.pl_weeks w2
                                   WHERE w2.block_id = ANY (v_blocks)
                                     AND coalesce(w2.archived, false) = false AND w2.deleted_at IS NULL
                                     AND (array_position(v_blocks, w2.block_id) < array_position(v_blocks, v_bid)))) AS plan_block
              FROM public.pl_weeks w
             WHERE w.block_id = v_bid AND coalesce(w.archived, false) = false AND w.deleted_at IS NULL) x
     WHERE b.id = v_bid;
  END LOOP;
  IF v_prep IS NOT NULL THEN
    UPDATE public.pl_preps pr
       SET title = p.title,
           total_weeks = v_total,
           end_date = (SELECT max(b.end_date) FROM public.pl_blocks b WHERE b.id = ANY (v_blocks)),
           updated_at = now()
     WHERE pr.id = v_prep AND pr.created_by = v_uid;
  END IF;

  RETURN jsonb_build_object('block_id', v_blocks[1], 'client_id', v_client, 'updated', v_updated, 'added', v_added,
                            'removed', v_removed, 'kept', v_kept, 'days_per_week', v_per);
END;
$$;
REVOKE ALL ON FUNCTION public.athlete_program_sync_running(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.athlete_program_sync_running(uuid) TO authenticated;
