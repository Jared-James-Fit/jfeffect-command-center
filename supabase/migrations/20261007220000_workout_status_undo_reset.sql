-- Workout status: one server-side path with undo, and "Not Started" = reset.
--
--  * workout_set_status() snapshots the workout instance, then applies the new
--    status in one transaction. Not Started also clears that instance's logged
--    sets, warm-ups and review (a "reset"). Returns the snapshot id for undo.
--  * workout_undo_status() restores a snapshot exactly — refused if new sets
--    were logged since, or a newer change exists, so undo never destroys work.
--
-- Scope is ONE workout instance: (scheduled_workout_id) or, for legacy days,
-- (client_id, day_id, scheduled_workout_id IS NULL) — the same identity the
-- logger writes. Other weeks of a repeating program day are never touched.
--
-- The completion row is cleared/restored in place, never deleted: workout XP is
-- keyed to its id (workout_completed:<id>), so delete + re-create would let a
-- workout be completed again for fresh points, and deleting it would cascade
-- away community posts and link reviews.

-- Warm-up sets belong to one workout instance, exactly like pl_row_results.
ALTER TABLE public.pl_warmup_sets
  ADD COLUMN IF NOT EXISTS scheduled_workout_id uuid
  REFERENCES public.pl_scheduled_workouts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS pl_warmup_sets_row_client_instance_idx
  ON public.pl_warmup_sets (row_id, client_id, scheduled_workout_id);

CREATE TABLE IF NOT EXISTS public.workout_status_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  day_id uuid NOT NULL,
  scheduled_workout_id uuid,
  from_status text NOT NULL,
  to_status text NOT NULL,
  reset boolean NOT NULL DEFAULT false,
  payload jsonb NOT NULL,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  restored_at timestamptz
);
CREATE INDEX IF NOT EXISTS workout_status_snapshots_scope_idx
  ON public.workout_status_snapshots (client_id, day_id, created_at DESC);
-- No policies on purpose: only the SECURITY DEFINER functions below touch it.
ALTER TABLE public.workout_status_snapshots ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.workout_can_act_for_client(_client_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = _client_id AND c.user_id = auth.uid())
      OR public.has_role(auth.uid(), 'admin')
      OR public.is_assigned_coach(_client_id)
$fn$;

CREATE OR REPLACE FUNCTION public.workout_set_status(
  _client_id uuid,
  _day_id uuid,
  _scheduled_workout_id uuid,
  _status text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  comp public.pl_day_completions;
  from_status text;
  row_ids uuid[];
  snap jsonb;
  snap_id uuid;
  n_sets integer := 0;
  n_warmups integer := 0;
  ts timestamptz := now();
BEGIN
  IF _status NOT IN ('not_started', 'in_progress', 'completed') THEN
    RAISE EXCEPTION 'Unknown workout status "%"', _status USING ERRCODE = '22023';
  END IF;
  IF NOT public.workout_can_act_for_client(_client_id) THEN
    RAISE EXCEPTION 'You can''t change this workout' USING ERRCODE = '42501';
  END IF;
  IF _scheduled_workout_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.pl_scheduled_workouts s WHERE s.id = _scheduled_workout_id AND s.client_id = _client_id
  ) THEN
    RAISE EXCEPTION 'Workout not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO comp FROM public.pl_day_completions dc
   WHERE dc.client_id = _client_id
     AND CASE WHEN _scheduled_workout_id IS NOT NULL
              THEN dc.scheduled_workout_id = _scheduled_workout_id
              ELSE dc.day_id = _day_id AND dc.scheduled_workout_id IS NULL END
   FOR UPDATE;

  from_status := CASE
    WHEN comp.completed_at IS NOT NULL THEN 'completed'
    WHEN comp.in_progress_at IS NOT NULL OR comp.started_at IS NOT NULL THEN 'in_progress'
    ELSE 'not_started' END;

  SELECT coalesce(array_agg(er.id), '{}') INTO row_ids FROM public.pl_exercise_rows er WHERE er.day_id = _day_id;

  snap := jsonb_build_object('completion', CASE WHEN comp.id IS NULL THEN NULL ELSE to_jsonb(comp) END);
  IF _status = 'not_started' THEN
    snap := snap || jsonb_build_object(
      'results', coalesce((
        SELECT jsonb_agg(to_jsonb(r)) FROM public.pl_row_results r
         WHERE r.client_id = _client_id AND r.row_id = ANY (row_ids)
           AND r.scheduled_workout_id IS NOT DISTINCT FROM _scheduled_workout_id), '[]'::jsonb),
      'warmups', coalesce((
        SELECT jsonb_agg(to_jsonb(w)) FROM public.pl_warmup_sets w
         WHERE w.client_id = _client_id AND w.row_id = ANY (row_ids)
           AND w.scheduled_workout_id IS NOT DISTINCT FROM _scheduled_workout_id), '[]'::jsonb),
      'feedback', coalesce((
        SELECT jsonb_agg(to_jsonb(f)) FROM public.pl_workout_feedback f
         WHERE comp.id IS NOT NULL AND f.completion_id = comp.id), '[]'::jsonb));
  END IF;

  INSERT INTO public.workout_status_snapshots (client_id, day_id, scheduled_workout_id, from_status, to_status, reset, payload)
  VALUES (_client_id, _day_id, _scheduled_workout_id, from_status, _status, _status = 'not_started', snap)
  RETURNING id INTO snap_id;
  -- Undo is a short-lived safety net; keep a week of snapshots, no more.
  DELETE FROM public.workout_status_snapshots
   WHERE client_id = _client_id AND created_at < ts - interval '7 days';

  IF _status = 'not_started' THEN
    DELETE FROM public.pl_row_results r
     WHERE r.client_id = _client_id AND r.row_id = ANY (row_ids)
       AND r.scheduled_workout_id IS NOT DISTINCT FROM _scheduled_workout_id;
    GET DIAGNOSTICS n_sets = ROW_COUNT;
    DELETE FROM public.pl_warmup_sets w
     WHERE w.client_id = _client_id AND w.row_id = ANY (row_ids)
       AND w.scheduled_workout_id IS NOT DISTINCT FROM _scheduled_workout_id;
    GET DIAGNOSTICS n_warmups = ROW_COUNT;
    IF comp.id IS NOT NULL THEN
      DELETE FROM public.pl_workout_feedback f WHERE f.completion_id = comp.id;
      UPDATE public.pl_day_completions SET
        started_at = NULL, in_progress_at = NULL, completed_at = NULL,
        actual_duration_min = NULL, client_notes = NULL, completion_method = NULL,
        session_rating = NULL, session_weight_total = NULL, session_weight_unit = NULL,
        last_activity_at = NULL, elapsed_duration_seconds = NULL, active_duration_seconds = NULL,
        required_sets_count = NULL, logged_sets_count = NULL, skipped_exercises_count = NULL,
        logging_percentage = NULL, logging_quality = NULL, completed_with_missing_logs = NULL,
        completion_source = NULL
       WHERE id = comp.id;
    END IF;
  ELSIF comp.id IS NOT NULL THEN
    UPDATE public.pl_day_completions SET
      started_at = coalesce(started_at, ts),
      in_progress_at = CASE WHEN _status = 'completed' THEN coalesce(in_progress_at, ts) ELSE ts END,
      completed_at = CASE WHEN _status = 'completed' THEN ts END,
      last_activity_at = ts
     WHERE id = comp.id;
  ELSE
    INSERT INTO public.pl_day_completions (client_id, day_id, scheduled_workout_id, started_at, in_progress_at, completed_at, last_activity_at)
    VALUES (_client_id, _day_id, _scheduled_workout_id, ts, ts, CASE WHEN _status = 'completed' THEN ts END, ts);
  END IF;

  RETURN jsonb_build_object(
    'snapshot_id', snap_id, 'from_status', from_status, 'to_status', _status,
    'cleared_sets', n_sets, 'cleared_warmups', n_warmups);
END
$fn$;

CREATE OR REPLACE FUNCTION public.workout_undo_status(_snapshot_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  s public.workout_status_snapshots;
  c public.pl_day_completions;
  row_ids uuid[];
BEGIN
  SELECT * INTO s FROM public.workout_status_snapshots WHERE id = _snapshot_id FOR UPDATE;
  IF s.id IS NULL OR NOT public.workout_can_act_for_client(s.client_id) THEN
    RAISE EXCEPTION 'Nothing to undo' USING ERRCODE = 'P0002';
  END IF;
  IF s.restored_at IS NOT NULL THEN
    RAISE EXCEPTION 'Already undone' USING ERRCODE = 'P0001';
  END IF;
  IF s.created_at < now() - interval '1 day' THEN
    RAISE EXCEPTION 'Too late to undo this change' USING ERRCODE = 'P0001';
  END IF;
  -- Only the latest change on this workout can be undone (an older snapshot
  -- would silently overwrite what came after it).
  IF EXISTS (
    SELECT 1 FROM public.workout_status_snapshots o
     WHERE o.client_id = s.client_id AND o.day_id = s.day_id
       AND o.scheduled_workout_id IS NOT DISTINCT FROM s.scheduled_workout_id
       AND o.created_at > s.created_at AND o.restored_at IS NULL
  ) THEN
    RAISE EXCEPTION 'This workout changed again since — undo the latest change first' USING ERRCODE = 'P0001';
  END IF;

  SELECT coalesce(array_agg(er.id), '{}') INTO row_ids FROM public.pl_exercise_rows er WHERE er.day_id = s.day_id;

  IF s.reset THEN
    IF EXISTS (
      SELECT 1 FROM public.pl_row_results r
       WHERE r.client_id = s.client_id AND r.row_id = ANY (row_ids)
         AND r.scheduled_workout_id IS NOT DISTINCT FROM s.scheduled_workout_id
    ) OR EXISTS (
      SELECT 1 FROM public.pl_warmup_sets w
       WHERE w.client_id = s.client_id AND w.row_id = ANY (row_ids)
         AND w.scheduled_workout_id IS NOT DISTINCT FROM s.scheduled_workout_id
    ) THEN
      RAISE EXCEPTION 'New sets were logged after the reset — undo would overwrite them' USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO public.pl_row_results
      SELECT * FROM jsonb_populate_recordset(NULL::public.pl_row_results, s.payload -> 'results');
    INSERT INTO public.pl_warmup_sets
      SELECT * FROM jsonb_populate_recordset(NULL::public.pl_warmup_sets, s.payload -> 'warmups');
  END IF;

  IF s.payload -> 'completion' IS NULL OR jsonb_typeof(s.payload -> 'completion') = 'null' THEN
    -- There was no completion before the change: clear the one it created
    -- (kept, not deleted — see header).
    UPDATE public.pl_day_completions dc SET
      started_at = NULL, in_progress_at = NULL, completed_at = NULL, last_activity_at = NULL
     WHERE dc.client_id = s.client_id
       AND CASE WHEN s.scheduled_workout_id IS NOT NULL
                THEN dc.scheduled_workout_id = s.scheduled_workout_id
                ELSE dc.day_id = s.day_id AND dc.scheduled_workout_id IS NULL END;
  ELSE
    c := jsonb_populate_record(NULL::public.pl_day_completions, s.payload -> 'completion');
    UPDATE public.pl_day_completions SET
      started_at = c.started_at, in_progress_at = c.in_progress_at, completed_at = c.completed_at,
      actual_duration_min = c.actual_duration_min, client_notes = c.client_notes,
      completion_method = c.completion_method, session_rating = c.session_rating,
      session_weight_total = c.session_weight_total, session_weight_unit = c.session_weight_unit,
      last_activity_at = c.last_activity_at, elapsed_duration_seconds = c.elapsed_duration_seconds,
      active_duration_seconds = c.active_duration_seconds, required_sets_count = c.required_sets_count,
      logged_sets_count = c.logged_sets_count, skipped_exercises_count = c.skipped_exercises_count,
      logging_percentage = c.logging_percentage, logging_quality = c.logging_quality,
      completed_with_missing_logs = c.completed_with_missing_logs, completion_source = c.completion_source
     WHERE id = c.id;
  END IF;

  IF s.reset THEN
    INSERT INTO public.pl_workout_feedback
      SELECT * FROM jsonb_populate_recordset(NULL::public.pl_workout_feedback, s.payload -> 'feedback');
  END IF;

  UPDATE public.workout_status_snapshots SET restored_at = now() WHERE id = s.id;
  RETURN jsonb_build_object(
    'status', s.from_status,
    'restored_sets', coalesce(jsonb_array_length(s.payload -> 'results'), 0));
END
$fn$;

REVOKE ALL ON FUNCTION public.workout_can_act_for_client(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.workout_set_status(uuid, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.workout_undo_status(uuid) FROM PUBLIC;
-- Supabase grants new functions to anon by default; signed-in users only.
REVOKE ALL ON FUNCTION public.workout_can_act_for_client(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.workout_set_status(uuid, uuid, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.workout_undo_status(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.workout_can_act_for_client(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.workout_set_status(uuid, uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.workout_undo_status(uuid) TO authenticated;
