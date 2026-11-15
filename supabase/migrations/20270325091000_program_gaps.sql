-- Missing program data (Nov 15 2026): what the coach's clients are about to
-- train that the athlete can't follow yet. One read for Messages' "Program
-- data" filter, a chat row's line, the client's Brief, the Training tab and
-- the Missing program data page (src/lib/program-gaps.ts decides).
--
-- It returns, for the caller's coaching clients (an admin: every coaching
-- client; a coach: coached_client_ids()), on their live programs (visible,
-- dated, not finished, never the at-home backup blocks) and only on workouts
-- nothing has touched (pl_day_touched, in the client's own time zone):
--   * rows: every row that might be missing something (no exercise, no sets,
--     no reps or time, no RPE / RIR / weight, or a % of a training max or 1RM
--     that needs a max on file). The app decides with rowProblems, the
--     builder's own rule, so a % the app can read never counts as missing;
--   * days: the workouts those rows are on, and the live workouts with no date;
--   * maxes: the active maxes of clients with a % of a max, for the logger's
--     own lookup (computeRowLoad: its own max by name, else its lift's);
--   * clients: who has any of it, with their training days (none set on a
--     live program is its own gap).
-- Read-only; never names anything a client can't already see.

CREATE OR REPLACE FUNCTION public.program_gaps(_client uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_admin boolean;
  v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501';
  END IF;
  v_admin := public.has_role(v_uid, 'admin');
  IF NOT v_admin AND NOT public.has_role(v_uid, 'coach') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  WITH cl AS (
    SELECT c.id, c.full_name, c.first_name, c.profile_picture_url, c.committed_training_days,
           public.pt_local_today(coalesce(nullif(c.timezone, ''), 'America/Winnipeg')) AS today
      FROM public.clients c
     WHERE c.service_tier = 'coaching'
       AND NOT coalesce(c.archived, false)
       AND coalesce(c.status, '') NOT IN ('Deactivated', 'Deleted', 'Archived', 'Lead')
       AND (_client IS NULL OR c.id = _client)
       AND (v_admin OR c.id IN (SELECT public.coached_client_ids()))
  ),
  bl AS (
    SELECT b.id, b.client_id, b.name, b.start_date, coalesce(b.week_duration_days, 7) AS dur
      FROM public.pl_blocks b
      JOIN cl ON cl.id = b.client_id
     WHERE NOT b.archived
       AND b.client_visible
       AND b.start_date IS NOT NULL
       AND coalesce(b.status, '') NOT IN ('Completed', 'Archived')
       AND coalesce(b.source_template_block_key, '') NOT IN ('at_home_backup_definitions_v1', 'at_home_backup_sessions_v1')
  ),
  dy AS (
    SELECT d.id, d.scheduled_date, d.day_index, d.is_optional,
           coalesce(nullif(btrim(d.subtitle), ''), d.title) AS title,
           w.week_index, bl.id AS block_id, bl.client_id
      FROM bl
      JOIN public.pl_weeks w ON w.block_id = bl.id
      JOIN public.pl_days d ON d.week_id = w.id
      JOIN cl ON cl.id = bl.client_id
     WHERE NOT d.archived
       AND d.deleted_at IS NULL
       AND (d.scheduled_date >= cl.today
            -- an undated workout counts while its week isn't over
            OR (d.scheduled_date IS NULL
                AND bl.start_date + (greatest(coalesce(w.week_index, 1), 1) - 1) * bl.dur + bl.dur - 1 >= cl.today))
       AND NOT public.pl_day_touched(d.id, d.scheduled_date, cl.today)
  ),
  rw AS (
    SELECT r.id, r.day_id, r.sort_order, r.exercise_id,
           coalesce(nullif(btrim(r.exercise_name_override), ''), e.name) AS exercise,
           r.exercise_name_override, r.sets, r.reps_text, r.rpe, r.rir, r.percentage, r.percentage_basis,
           r.load_kg, r.load_lb, r.measurement_type, r.duration_seconds, r.movement_family,
           e.competition_lift_type, e.movement_family AS exercise_family, dy.client_id
      FROM dy
      JOIN public.pl_exercise_rows r ON r.day_id = dy.id
      LEFT JOIN public.exercises e ON e.id = r.exercise_id
     WHERE (r.exercise_id IS NULL AND nullif(btrim(r.exercise_name_override), '') IS NULL)
        OR r.sets IS NULL
        OR (r.measurement_type = 'time' AND coalesce(r.duration_seconds, 0) <= 0 AND nullif(btrim(r.reps_text), '') IS NULL)
        OR (r.measurement_type <> 'time' AND nullif(btrim(r.reps_text), '') IS NULL)
        OR (r.measurement_type <> 'time' AND nullif(btrim(r.rpe), '') IS NULL AND nullif(btrim(r.rir), '') IS NULL
            AND r.load_kg IS NULL AND r.load_lb IS NULL
            AND NOT (r.percentage IS NOT NULL AND r.percentage_basis IN ('training_max', '1rm', 'est_1rm', 'top_set', 'prev_set')))
        OR (r.percentage IS NOT NULL AND r.percentage_basis IN ('training_max', '1rm'))
  ),
  days_out AS (
    SELECT dy.* FROM dy WHERE dy.scheduled_date IS NULL OR dy.id IN (SELECT day_id FROM rw)
  ),
  max_clients AS (
    SELECT DISTINCT client_id FROM rw WHERE percentage IS NOT NULL AND percentage_basis IN ('training_max', '1rm')
  ),
  no_days AS (
    SELECT cl.id FROM cl
     WHERE coalesce(array_length(cl.committed_training_days, 1), 0) = 0
       AND EXISTS (SELECT 1 FROM dy WHERE dy.client_id = cl.id)
  ),
  who AS (
    SELECT client_id AS id FROM days_out
    UNION SELECT id FROM no_days
  )
  SELECT jsonb_build_object(
    'clients', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', cl.id, 'name', cl.full_name, 'first_name', cl.first_name, 'photo', cl.profile_picture_url,
               'training_days', to_jsonb(coalesce(cl.committed_training_days, '{}'::text[])),
               'today', cl.today, 'no_training_days', cl.id IN (SELECT id FROM no_days)))
        FROM cl WHERE cl.id IN (SELECT id FROM who)), '[]'::jsonb),
    'blocks', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', bl.id, 'client_id', bl.client_id, 'name', bl.name, 'start_date', bl.start_date))
        FROM bl WHERE bl.id IN (SELECT block_id FROM days_out)), '[]'::jsonb),
    'days', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', d.id, 'block_id', d.block_id, 'client_id', d.client_id, 'week_index', d.week_index,
               'day_index', d.day_index, 'title', d.title, 'date', d.scheduled_date, 'optional', d.is_optional))
        FROM days_out d), '[]'::jsonb),
    'rows', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', r.id, 'day_id', r.day_id, 'sort_order', r.sort_order, 'exercise_id', r.exercise_id,
               'exercise', r.exercise, 'exercise_name_override', r.exercise_name_override, 'sets', r.sets,
               'reps_text', r.reps_text, 'rpe', r.rpe, 'rir', r.rir, 'percentage', r.percentage,
               'percentage_basis', r.percentage_basis, 'load_kg', r.load_kg, 'load_lb', r.load_lb,
               'measurement_type', r.measurement_type, 'duration_seconds', r.duration_seconds,
               'movement_family', r.movement_family, 'competition_lift_type', r.competition_lift_type,
               'exercise_family', r.exercise_family))
        FROM rw r), '[]'::jsonb),
    'maxes', coalesce((
      SELECT jsonb_agg(to_jsonb(m))
        FROM public.pl_client_maxes m
       WHERE m.client_id IN (SELECT client_id FROM max_clients) AND m.active), '[]'::jsonb)
  ) INTO v_out;
  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.program_gaps(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.program_gaps(uuid) TO authenticated;
