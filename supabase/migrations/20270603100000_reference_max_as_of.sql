-- Reference maxes as they stood, and which upcoming workouts read them
-- (Strength Intelligence, Nov 26 2026; max-history.ts).
--
-- 1. A finished workout keeps the max it was planned from: the logger reads
--    the changes made to a client's maxes since the workout was finished and
--    puts them back (`maxesAsOf`), so raising a 1RM after a block never makes
--    the block's past % loads read heavier than what was prescribed.
--    `pl_client_max_changes_since` hands those changes to whoever can see the
--    client's training (the athlete, their coach, an admin), with only the
--    numbers a load is worked out from: never the coach's notes or who
--    changed it. The history table itself stays staff-read.
-- 2. A coach changing a max mid-block is asked first (the maxes panel):
--    `pl_upcoming_percent_rows` lists the % sets on a client's running blocks
--    that nothing has touched yet, for the app to work out (computeRowLoad,
--    the logger's own rule) which ones the change would move.
-- 3. Changes are stamped with the moment they happen (clock_timestamp), so
--    two changes in one transaction keep their order.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.tg_pl_client_max_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.pl_client_max_history (max_id, client_id, op, before, after, changed_by, changed_at)
    VALUES (NEW.id, NEW.client_id, 'insert', NULL, to_jsonb(NEW), auth.uid(), clock_timestamp());
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    -- a save that changed nothing (only the timestamp) is no change
    IF (to_jsonb(OLD) - 'updated_at') = (to_jsonb(NEW) - 'updated_at') THEN
      RETURN NEW;
    END IF;
    INSERT INTO public.pl_client_max_history (max_id, client_id, op, before, after, changed_by, changed_at)
    VALUES (NEW.id, NEW.client_id, 'update', to_jsonb(OLD), to_jsonb(NEW), auth.uid(), clock_timestamp());
    RETURN NEW;
  ELSE
    -- removed by a cascade (the client or the block deleted): nothing to restore into
    IF pg_trigger_depth() > 1 THEN
      RETURN OLD;
    END IF;
    INSERT INTO public.pl_client_max_history (max_id, client_id, op, before, after, changed_by, changed_at)
    VALUES (OLD.id, OLD.client_id, 'delete', to_jsonb(OLD), NULL, auth.uid(), clock_timestamp());
    RETURN OLD;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_pl_client_max_history() FROM PUBLIC, anon, authenticated;

-- What a load is worked out from, and nothing else.
CREATE OR REPLACE FUNCTION public.pl_max_load_fields(_row jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE WHEN _row IS NULL THEN NULL ELSE jsonb_strip_nulls(jsonb_build_object(
    'id', _row -> 'id',
    'client_id', _row -> 'client_id',
    'lift', _row -> 'lift',
    'block_id', _row -> 'block_id',
    'one_rm', _row -> 'one_rm',
    'training_max', _row -> 'training_max',
    'estimated_1rm', _row -> 'estimated_1rm',
    'unit', _row -> 'unit',
    'active', _row -> 'active',
    'source', _row -> 'source',
    'tested_at', _row -> 'tested_at',
    'rounding_step', _row -> 'rounding_step',
    'rounding_mode', _row -> 'rounding_mode',
    'source_lift', _row -> 'source_lift',
    'variation_modifier', _row -> 'variation_modifier',
    'manual_override', _row -> 'manual_override',
    'exercise_id', _row -> 'exercise_id',
    'source_exercise_id', _row -> 'source_exercise_id'
  )) END
$$;

REVOKE ALL ON FUNCTION public.pl_max_load_fields(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pl_max_load_fields(jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pl_client_max_changes_since(_client_id uuid, _since timestamptz)
RETURNS TABLE(max_id uuid, op text, before jsonb, after jsonb, changed_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.can_view_client_training(_client_id) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT h.max_id, h.op, public.pl_max_load_fields(h.before), public.pl_max_load_fields(h.after), h.changed_at
      FROM public.pl_client_max_history h
     WHERE h.client_id = _client_id
       AND h.changed_at > _since
     ORDER BY h.changed_at, h.id
     LIMIT 1000;
END;
$$;

REVOKE ALL ON FUNCTION public.pl_client_max_changes_since(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pl_client_max_changes_since(uuid, timestamptz) TO authenticated;

-- The % sets on a client's running blocks that nothing has touched (the
-- untouched workouts program_gaps reads): staff only.
CREATE OR REPLACE FUNCTION public.pl_upcoming_percent_rows(_client_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_out jsonb;
BEGIN
  IF v_uid IS NULL
     OR NOT (public.has_role(v_uid, 'admin') OR _client_id IN (SELECT public.coached_client_ids())) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  WITH cl AS (
    SELECT c.id, public.pt_local_today(coalesce(nullif(c.timezone, ''), 'America/Winnipeg')) AS today
      FROM public.clients c
     WHERE c.id = _client_id
  ),
  -- running blocks only: a block that hasn't started yet takes the new max, as it should
  bl AS (
    SELECT b.id, b.name, b.start_date, coalesce(b.week_duration_days, 7) AS dur
      FROM public.pl_blocks b
      CROSS JOIN cl
     WHERE b.client_id = _client_id
       AND NOT b.archived
       AND b.client_visible
       AND b.start_date IS NOT NULL
       AND b.start_date <= cl.today
       AND coalesce(b.status, '') NOT IN ('Completed', 'Archived')
       AND coalesce(b.source_template_block_key, '') NOT IN ('at_home_backup_definitions_v1', 'at_home_backup_sessions_v1')
  ),
  dy AS (
    SELECT d.id, d.scheduled_date, bl.id AS block_id, bl.name AS block_name
      FROM bl
      JOIN public.pl_weeks w ON w.block_id = bl.id
      JOIN public.pl_days d ON d.week_id = w.id
      CROSS JOIN cl
     WHERE NOT d.archived
       AND d.deleted_at IS NULL
       AND (d.scheduled_date >= cl.today
            OR (d.scheduled_date IS NULL
                AND bl.start_date + (greatest(coalesce(w.week_index, 1), 1) - 1) * bl.dur + bl.dur - 1 >= cl.today))
       AND NOT public.pl_day_touched(d.id, d.scheduled_date, cl.today)
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'day_id', dy.id, 'date', dy.scheduled_date,
           'block_id', dy.block_id, 'block_name', dy.block_name,
           'exercise', coalesce(nullif(btrim(r.exercise_name_override), ''), e.name),
           'percentage', r.percentage, 'percentage_basis', r.percentage_basis,
           'movement_family', r.movement_family, 'competition_lift_type', e.competition_lift_type,
           'exercise_family', e.movement_family)), '[]'::jsonb)
    INTO v_out
    FROM dy
    JOIN public.pl_exercise_rows r ON r.day_id = dy.id
    LEFT JOIN public.exercises e ON e.id = r.exercise_id
   WHERE r.percentage IS NOT NULL
     AND r.percentage_basis IN ('training_max', '1rm', 'est_1rm')
     AND NOT coalesce(r.manual_override, false);
  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.pl_upcoming_percent_rows(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pl_upcoming_percent_rows(uuid) TO authenticated;
