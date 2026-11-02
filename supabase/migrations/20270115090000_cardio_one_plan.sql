-- One cardio plan, everywhere.
--
-- The client's cardio plan is `cardio_targets` (set by their nutrition plan or
-- the coach) and what they did is `cardio_completions`. Until now a workout
-- program could also carry its own cardio as exercise rows ("Treadmill Walk 10
-- min") logged in pl_row_results, with nothing linking the two: Marc's program
-- said 10 minutes while his plan said 15, and logging one never checked off the
-- other.
--
-- From here:
--   * On training days the plan's cardio is the last exercise of every upcoming
--     workout, linked to its target (`pl_exercise_rows.cardio_target_id`), and it
--     follows the plan: change the plan and the upcoming workouts change.
--   * Logging that exercise in the workout is the day's cardio done
--     (`cardio_completions`, completion_target 'workout'), so the cardio card on
--     Workouts and Nutrition shows it done; the card points into the workout.
--   * Program first: a client with cardio in their program but no cardio plan
--     gets a plan made from the program (source 'program_rows', the rows stay as
--     written) until their nutrition plan sets one.
--   * Priority: the nutrition plan > the coach's own targets > a plan proposed
--     with a generated program ('program') > one read from the program's rows.
--     A logged or started workout is never changed.

-- 1. Where a target came from, and which workout row is the plan's cardio.
ALTER TABLE public.cardio_targets ADD COLUMN IF NOT EXISTS source text;
COMMENT ON COLUMN public.cardio_targets.source IS
  'nutrition (the nutrition plan), coach (set by hand; null = legacy, same), program (proposed with a generated training program), program_rows (read from the cardio already in the program). The nutrition plan replaces any of them.';

ALTER TABLE public.pl_exercise_rows
  ADD COLUMN IF NOT EXISTS cardio_target_id uuid REFERENCES public.cardio_targets(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.pl_exercise_rows.cardio_target_id IS
  'This row is the cardio plan''s session for its workout (program_cardio_sync); logging it completes that day''s cardio.';
CREATE INDEX IF NOT EXISTS pl_exercise_rows_cardio_target_idx
  ON public.pl_exercise_rows (cardio_target_id) WHERE cardio_target_id IS NOT NULL;

ALTER TABLE public.cardio_completions
  DROP CONSTRAINT IF EXISTS cardio_completions_completion_target_check,
  ADD CONSTRAINT cardio_completions_completion_target_check
    CHECK (completion_target IS NULL OR completion_target IN ('time', 'steps', 'calories', 'manual', 'workout'));

-- 2. Helpers.
-- Steady cardio done for time (mirror of isTimedCardio in next-program.ts).
CREATE OR REPLACE FUNCTION public.is_timed_cardio_name(p_name text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT coalesce(p_name, '') ~* '\m(treadmill|walk|walking|bike|biking|cycling|cycle|elliptical|stairmaster|stair climber|stepper|rowing machine|rower|erg|jog|jogging|run|running|cardio|airbike|assault)\M'
     AND coalesce(p_name, '') !~* '(lunge|farmer|carry|gorilla|walkout|walk-?over|band walk|plank|crunch|kettlebell|^\s*air bike\s*$)';
$$;

-- Training / high / non-training from a target's day type.
CREATE OR REPLACE FUNCTION public.cardio_day_kind(p_day_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN lower(coalesce(p_day_type, '')) ~ '^\s*(training( day)?)\s*$' THEN 'training'
    WHEN lower(coalesce(p_day_type, '')) ~ '^\s*(high( day)?)\s*$' THEN 'high'
    WHEN lower(coalesce(p_day_type, '')) ~ '(non.?training|rest)' THEN 'non_training'
    ELSE 'other'
  END;
$$;

-- The library exercise a plan's cardio is logged as.
CREATE OR REPLACE FUNCTION public.cardio_exercise_for(p_type text, p_custom text, p_machine text)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  WITH t AS (SELECT lower(concat_ws(' ', p_type, p_custom, p_machine)) AS s)
  SELECT e.id
    FROM t, public.exercises e
   WHERE coalesce(e.archived, false) = false
     AND e.name = CASE
       WHEN t.s ~ '(run|sprint)' THEN 'Treadmill Running'
       WHEN t.s ~ 'jog' THEN 'Treadmill Jogging'
       WHEN t.s ~ '(bike|cycl|spin)' THEN 'Stationary Exercise Bike'
       WHEN t.s ~ 'elliptical' THEN 'Gym Elliptical Machine Normal Speed'
       WHEN t.s ~ '(rower|rowing)' THEN 'Gym Rowing Machine Normal Speed'
       WHEN t.s ~ '(treadmill|incline)' THEN 'Treadmill Walk'
       WHEN t.s ~ 'walk' THEN 'Walking Fast'
       ELSE 'Cardio'
     END
   ORDER BY e.created_at NULLS LAST
   LIMIT 1;
$$;

-- What the workout row says about the session (from the plan).
CREATE OR REPLACE FUNCTION public.cardio_row_notes(t public.cardio_targets)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT concat_ws(' ',
    nullif(concat_ws(' · ',
      CASE WHEN t.incline IS NOT NULL THEN 'Incline ' || trim_scale(t.incline)::text || '%' END,
      CASE WHEN t.speed_min_mph IS NOT NULL AND t.speed_max_mph IS NOT NULL AND t.speed_max_mph <> t.speed_min_mph
             THEN trim_scale(t.speed_min_mph)::text || '–' || trim_scale(t.speed_max_mph)::text || ' mph'
           WHEN coalesce(t.speed_min_mph, t.speed_max_mph) IS NOT NULL
             THEN trim_scale(coalesce(t.speed_min_mph, t.speed_max_mph))::text || ' mph' END,
      nullif(trim(coalesce(t.heart_rate_zone, '')), '')
    ), '') || '.',
    nullif(left(trim(coalesce(t.client_notes, '')), 220), ''),
    'Your cardio plan''s session for today: log it here and today''s cardio is done.'
  );
$$;

-- 3. The sync: the plan's cardio onto every upcoming workout.
CREATE OR REPLACE FUNCTION public.program_cardio_sync(p_client uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_client record;
  v_today date;
  v_train public.cardio_targets;
  v_high public.cardio_targets;
  v_target public.cardio_targets;
  v_ex uuid;
  v_notes text;
  v_derive record;
  d record;
  v_linked uuid;
  v_cand uuid;
  n_ins int := 0;
  n_upd int := 0;
  n_adopt int := 0;
  n_del int := 0;
  n_derived int := 0;
BEGIN
  SELECT c.id, c.timezone, c.committed_training_days, c.preferred_high_days, c.archived, c.status
    INTO v_client FROM public.clients c WHERE c.id = p_client;
  IF v_client.id IS NULL THEN RETURN jsonb_build_object('skipped', 'no client'); END IF;
  v_today := public.pt_local_today(coalesce(nullif(v_client.timezone, ''), 'America/Winnipeg'));

  PERFORM set_config('jf.cardio_sync', 'on', true);

  -- the plan's training-day (and high-day) session: active, shown, not a multi-week cardio program
  SELECT t.* INTO v_train FROM public.cardio_targets t
   WHERE t.client_id = p_client AND t.status = 'Active' AND t.enabled AND t.visible_to_client
     AND t.program_name IS NULL AND public.cardio_day_kind(t.day_type) = 'training'
     AND coalesce(t.duration_minutes, 0) > 0
     AND (t.start_date IS NULL OR t.start_date <= v_today + 28) AND (t.end_date IS NULL OR t.end_date >= v_today)
   ORDER BY (t.source = 'program_rows') NULLS FIRST, t.start_date DESC NULLS LAST, t.updated_at DESC
   LIMIT 1;
  SELECT t.* INTO v_high FROM public.cardio_targets t
   WHERE t.client_id = p_client AND t.status = 'Active' AND t.enabled AND t.visible_to_client
     AND t.program_name IS NULL AND public.cardio_day_kind(t.day_type) = 'high'
     AND coalesce(t.duration_minutes, 0) > 0
     AND (t.end_date IS NULL OR t.end_date >= v_today)
   ORDER BY t.start_date DESC NULLS LAST, t.updated_at DESC
   LIMIT 1;

  -- Program first: no cardio plan for training days, but the program has cardio in it.
  IF v_train.id IS NULL AND coalesce(v_client.archived, false) = false THEN
    SELECT coalesce(e.name, r.exercise_name_override) AS name,
           round(percentile_disc(0.5) WITHIN GROUP (ORDER BY r.duration_seconds) / 60.0)::int AS minutes,
           count(DISTINCT r.day_id) AS days
      INTO v_derive
      FROM public.pl_exercise_rows r
      JOIN public.pl_days dd ON dd.id = r.day_id AND dd.archived = false AND dd.deleted_at IS NULL
      JOIN public.pl_weeks w ON w.id = dd.week_id AND w.deleted_at IS NULL
      JOIN public.pl_blocks b ON b.id = w.block_id
      LEFT JOIN public.exercises e ON e.id = r.exercise_id
     WHERE b.client_id = p_client AND b.client_visible AND coalesce(b.archived, false) = false
       AND coalesce(b.status, '') <> 'Archived'
       AND coalesce(b.source_template_block_key, '') NOT IN ('at_home_backup_definitions_v1', 'at_home_backup_sessions_v1')
       AND coalesce(dd.scheduled_date, v_today) >= v_today
       AND r.cardio_target_id IS NULL AND coalesce(r.duration_seconds, 0) > 0
       AND public.is_timed_cardio_name(coalesce(e.name, r.exercise_name_override))
     GROUP BY 1
     ORDER BY count(*) DESC
     LIMIT 1;
    IF v_derive.name IS NOT NULL AND coalesce(v_derive.minutes, 0) > 0 THEN
      INSERT INTO public.cardio_targets (
        client_id, day_type, cardio_type, duration_minutes, frequency_per_week, scheduled_weekdays,
        status, enabled, visible_to_client, start_date, completion_rule, source, client_notes, last_updated_at
      ) VALUES (
        p_client, 'Training Day', v_derive.name, v_derive.minutes,
        greatest(1, coalesce(cardinality(v_client.committed_training_days), 0)),
        coalesce(v_client.committed_training_days, '{}'::text[]),
        'Active', true, true, v_today, 'any_target', 'program_rows',
        'The cardio in your training program. Your nutrition plan will set it when it''s made.', now()
      ) RETURNING * INTO v_train;
      n_derived := 1;
    END IF;
  END IF;

  FOR d IN
    SELECT dd.id AS day_id,
           coalesce((SELECT min(sw.scheduled_date) FROM public.pl_scheduled_workouts sw WHERE sw.source_day_id = dd.id), dd.scheduled_date) AS on_date
      FROM public.pl_days dd
      JOIN public.pl_weeks w ON w.id = dd.week_id AND w.deleted_at IS NULL
      JOIN public.pl_blocks b ON b.id = w.block_id
     WHERE b.client_id = p_client AND b.client_visible AND coalesce(b.archived, false) = false
       AND coalesce(b.status, '') <> 'Archived'
       AND coalesce(b.source_template_block_key, '') NOT IN ('at_home_backup_definitions_v1', 'at_home_backup_sessions_v1')
       AND dd.archived = false AND dd.deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.pl_day_completions dc
                        WHERE dc.day_id = dd.id AND (dc.completed_at IS NOT NULL OR dc.started_at IS NOT NULL OR dc.in_progress_at IS NOT NULL))
  LOOP
    CONTINUE WHEN d.on_date IS NULL OR d.on_date < v_today;
    -- a high day takes the plan's high-day session when it has one
    v_target := CASE
      WHEN v_high.id IS NOT NULL AND trim(to_char(d.on_date, 'Day')) = ANY (coalesce(v_client.preferred_high_days, '{}'::text[])) THEN v_high
      ELSE v_train END;

    SELECT r.id INTO v_linked FROM public.pl_exercise_rows r
     WHERE r.day_id = d.day_id AND r.cardio_target_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.pl_row_results rr WHERE rr.row_id = r.id)
     ORDER BY r.sort_order LIMIT 1;

    IF v_target.id IS NULL THEN
      -- cardio taken off the plan: its unlogged workout rows go
      WITH gone AS (
        DELETE FROM public.pl_exercise_rows r
         WHERE r.day_id = d.day_id AND r.cardio_target_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM public.pl_row_results rr WHERE rr.row_id = r.id)
        RETURNING 1)
      SELECT n_del + count(*) INTO n_del FROM gone;
      CONTINUE;
    END IF;

    IF v_linked IS NULL THEN
      -- cardio the program already has that day (a coach's or an older generator's walk) becomes the plan's
      SELECT r.id INTO v_cand FROM public.pl_exercise_rows r LEFT JOIN public.exercises e ON e.id = r.exercise_id
       WHERE r.day_id = d.day_id AND r.cardio_target_id IS NULL
         AND public.is_timed_cardio_name(coalesce(e.name, r.exercise_name_override))
         AND NOT EXISTS (SELECT 1 FROM public.pl_row_results rr WHERE rr.row_id = r.id)
       ORDER BY r.sort_order DESC LIMIT 1;
    ELSE
      v_cand := NULL;
    END IF;

    IF v_target.source = 'program_rows' THEN
      -- the plan was read from the program: the program's rows stay as written, they're only linked
      IF v_cand IS NOT NULL THEN
        UPDATE public.pl_exercise_rows SET cardio_target_id = v_target.id WHERE id = v_cand;
        n_adopt := n_adopt + 1;
      ELSIF v_linked IS NOT NULL THEN
        UPDATE public.pl_exercise_rows SET cardio_target_id = v_target.id WHERE id = v_linked AND cardio_target_id IS DISTINCT FROM v_target.id;
      END IF;
      CONTINUE;
    END IF;

    v_ex := public.cardio_exercise_for(v_target.cardio_type, v_target.custom_type, v_target.machine_preference);
    v_notes := public.cardio_row_notes(v_target);

    IF coalesce(v_linked, v_cand) IS NOT NULL THEN
      UPDATE public.pl_exercise_rows r
         SET cardio_target_id = v_target.id,
             exercise_id = coalesce(v_ex, r.exercise_id),
             exercise_name_override = CASE WHEN v_ex IS NULL THEN coalesce(v_target.custom_type, v_target.cardio_type) ELSE NULL END,
             sets = 1, reps_text = NULL, rpe = NULL, rest_seconds = 0,
             measurement_type = 'time', tracking_type = 'time', time_profile = 'conditioning',
             duration_seconds = v_target.duration_minutes * 60,
             notes = v_notes, purpose_label = 'Cardio'
       WHERE r.id = coalesce(v_linked, v_cand)
         AND (r.cardio_target_id IS DISTINCT FROM v_target.id
              OR r.exercise_id IS DISTINCT FROM coalesce(v_ex, r.exercise_id)
              OR r.duration_seconds IS DISTINCT FROM v_target.duration_minutes * 60
              OR r.notes IS DISTINCT FROM v_notes
              OR r.measurement_type IS DISTINCT FROM 'time'
              OR r.sets IS DISTINCT FROM 1);
      IF FOUND THEN
        IF v_linked IS NULL THEN n_adopt := n_adopt + 1; ELSE n_upd := n_upd + 1; END IF;
      END IF;
    ELSE
      INSERT INTO public.pl_exercise_rows (
        day_id, sort_order, exercise_id, exercise_name_override, sets, rest_seconds,
        measurement_type, tracking_type, time_profile, duration_seconds, notes, purpose_label, cardio_target_id
      ) VALUES (
        d.day_id,
        coalesce((SELECT max(x.sort_order) FROM public.pl_exercise_rows x WHERE x.day_id = d.day_id), -1) + 1,
        v_ex, CASE WHEN v_ex IS NULL THEN coalesce(v_target.custom_type, v_target.cardio_type) END,
        1, 0, 'time', 'time', 'conditioning', v_target.duration_minutes * 60, v_notes, 'Cardio', v_target.id
      );
      n_ins := n_ins + 1;
    END IF;
  END LOOP;

  PERFORM set_config('jf.cardio_sync', 'off', true);
  RETURN jsonb_build_object('added', n_ins, 'updated', n_upd, 'adopted', n_adopt, 'removed', n_del, 'plan_from_program', n_derived);
END;
$function$;

REVOKE ALL ON FUNCTION public.program_cardio_sync(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.program_cardio_sync(uuid) TO service_role;

-- 4. Keep it in step: any change to a client's cardio plan, and a program becoming theirs.
CREATE OR REPLACE FUNCTION public.tg_cardio_targets_program_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF coalesce(current_setting('jf.cardio_sync', true), 'off') = 'on' THEN
    RETURN NULL;
  END IF;
  PERFORM public.program_cardio_sync(coalesce(NEW.client_id, OLD.client_id));
  RETURN NULL;
END;
$function$;

-- a deleted target takes its unlogged upcoming workout rows with it (the FK would only unlink them)
CREATE OR REPLACE FUNCTION public.tg_cardio_targets_before_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM public.pl_exercise_rows r
   WHERE r.cardio_target_id = OLD.id
     AND NOT EXISTS (SELECT 1 FROM public.pl_row_results rr WHERE rr.row_id = r.id)
     AND NOT EXISTS (SELECT 1 FROM public.pl_day_completions dc
                      WHERE dc.day_id = r.day_id AND (dc.completed_at IS NOT NULL OR dc.started_at IS NOT NULL OR dc.in_progress_at IS NOT NULL));
  RETURN OLD;
END;
$function$;

DROP TRIGGER IF EXISTS cardio_targets_program_sync ON public.cardio_targets;
CREATE TRIGGER cardio_targets_program_sync
  AFTER INSERT OR UPDATE OR DELETE ON public.cardio_targets
  FOR EACH ROW EXECUTE FUNCTION public.tg_cardio_targets_program_sync();
DROP TRIGGER IF EXISTS cardio_targets_before_delete ON public.cardio_targets;
CREATE TRIGGER cardio_targets_before_delete
  BEFORE DELETE ON public.cardio_targets
  FOR EACH ROW EXECUTE FUNCTION public.tg_cardio_targets_before_delete();

CREATE OR REPLACE FUNCTION public.tg_pl_blocks_program_cardio_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.client_id IS NOT NULL AND NEW.client_visible THEN
    PERFORM public.program_cardio_sync(NEW.client_id);
  END IF;
  RETURN NULL;
END;
$function$;
DROP TRIGGER IF EXISTS pl_blocks_program_cardio_sync ON public.pl_blocks;
CREATE TRIGGER pl_blocks_program_cardio_sync
  AFTER UPDATE OF client_visible, status, start_date ON public.pl_blocks
  FOR EACH ROW
  WHEN (NEW.client_visible AND (OLD.client_visible IS DISTINCT FROM NEW.client_visible
        OR OLD.status IS DISTINCT FROM NEW.status OR OLD.start_date IS DISTINCT FROM NEW.start_date))
  EXECUTE FUNCTION public.tg_pl_blocks_program_cardio_sync();

REVOKE ALL ON FUNCTION public.tg_cardio_targets_program_sync() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_cardio_targets_before_delete() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_pl_blocks_program_cardio_sync() FROM PUBLIC, anon, authenticated;

-- 5. Logging the workout's cardio is the day's cardio done.
CREATE OR REPLACE FUNCTION public.tg_pl_row_results_cardio_done()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row_id uuid := coalesce(NEW.row_id, OLD.row_id);
  v_sw uuid := coalesce(NEW.scheduled_workout_id, OLD.scheduled_workout_id);
  v_row record;
  v_t public.cardio_targets;
  v_date date;
  v_secs int;
  v_logged boolean;
  v_rpe numeric;
  v_cal int;
BEGIN
  SELECT r.id, r.day_id, r.cardio_target_id INTO v_row FROM public.pl_exercise_rows r WHERE r.id = v_row_id;
  IF v_row.cardio_target_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_t FROM public.cardio_targets WHERE id = v_row.cardio_target_id;
  IF v_t.id IS NULL THEN RETURN NULL; END IF;

  v_date := coalesce(
    (SELECT sw.scheduled_date FROM public.pl_scheduled_workouts sw WHERE sw.id = v_sw),
    (SELECT min(sw.scheduled_date) FROM public.pl_scheduled_workouts sw WHERE sw.source_day_id = v_row.day_id),
    (SELECT dd.scheduled_date FROM public.pl_days dd WHERE dd.id = v_row.day_id),
    public.pt_local_today(coalesce((SELECT nullif(c.timezone, '') FROM public.clients c WHERE c.id = v_t.client_id), 'America/Winnipeg'))
  );

  SELECT coalesce(sum(rr.completed_duration_seconds) FILTER (WHERE rr.completed_duration_seconds > 0), 0),
         coalesce(bool_or(rr.completed_duration_seconds > 0 OR rr.completed_at IS NOT NULL), false),
         max(rr.actual_rpe_num),
         sum(rr.actual_calories)
    INTO v_secs, v_logged, v_rpe, v_cal
    FROM public.pl_row_results rr WHERE rr.row_id = v_row.id;

  IF v_logged THEN
    INSERT INTO public.cardio_completions (
      client_id, cardio_target_id, completed_date, completed, skipped, duration_minutes,
      cardio_type, rpe, calories, incline, day_type, completion_target
    ) VALUES (
      v_t.client_id, v_t.id, v_date, true, false,
      CASE WHEN v_secs > 0 THEN greatest(1, round(v_secs / 60.0)::int) ELSE v_t.duration_minutes END,
      coalesce(nullif(v_t.custom_type, ''), v_t.cardio_type), v_rpe, v_cal, v_t.incline, v_t.day_type, 'workout'
    )
    ON CONFLICT (client_id, cardio_target_id, completed_date) DO UPDATE
      SET completed = true, skipped = false,
          duration_minutes = EXCLUDED.duration_minutes,
          rpe = coalesce(EXCLUDED.rpe, public.cardio_completions.rpe),
          calories = coalesce(EXCLUDED.calories, public.cardio_completions.calories),
          completion_target = 'workout',
          updated_at = now();
  ELSE
    DELETE FROM public.cardio_completions
     WHERE client_id = v_t.client_id AND cardio_target_id = v_t.id
       AND completed_date = v_date AND completion_target = 'workout';
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.tg_pl_row_results_cardio_done() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS pl_row_results_cardio_done ON public.pl_row_results;
CREATE TRIGGER pl_row_results_cardio_done
  AFTER INSERT OR UPDATE OR DELETE ON public.pl_row_results
  FOR EACH ROW EXECUTE FUNCTION public.tg_pl_row_results_cardio_done();

-- 6. Programs assigned by other paths (library, builder, Cleo) are picked up within the hour.
CREATE OR REPLACE FUNCTION public.program_cardio_sync_all()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  c record;
  n int := 0;
BEGIN
  FOR c IN
    SELECT cl.id FROM public.clients cl
     WHERE coalesce(cl.archived, false) = false
       AND coalesce(cl.status, '') NOT IN ('Deactivated', 'Archived')
       AND (EXISTS (SELECT 1 FROM public.cardio_targets t WHERE t.client_id = cl.id AND t.status = 'Active' AND t.enabled)
            OR EXISTS (SELECT 1 FROM public.pl_blocks b WHERE b.client_id = cl.id AND b.client_visible AND coalesce(b.archived, false) = false
                        AND coalesce(b.end_date, b.start_date, current_date) >= current_date))
  LOOP
    PERFORM public.program_cardio_sync(c.id);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$function$;
REVOKE ALL ON FUNCTION public.program_cardio_sync_all() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.program_cardio_sync_all() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'program-cardio-sync';
    PERFORM cron.schedule('program-cardio-sync', '17 * * * *', 'SELECT public.program_cardio_sync_all();');
  END IF;
END
$$;

-- 7. Bring every client's upcoming workouts in line with their plan now.
SELECT public.program_cardio_sync_all();
