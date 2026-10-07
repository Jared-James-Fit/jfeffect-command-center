-- Workout version history ("restore to an earlier point", like Google Sheets).
--
-- A version is a full copy of ONE workout instance — its logged sets, warm-ups,
-- review and completion state — taken:
--   * automatically before the first edit in each 15-minute window of logging
--     (so a session gets a handful of restore points, not one per tap);
--   * before every status change, reset and restore (explicit, never coalesced).
-- Restoring always saves the current state first, so a restore is itself
-- undoable and nothing is ever lost.
--
-- Cheap by construction: capture is one indexed lookup per set write and a
-- small jsonb copy at most every 15 minutes per workout; identical states are
-- not stored twice; each workout keeps its 30 newest versions for 45 days.
-- Capturing can never block or fail a set save (errors are swallowed).
-- The app lists versions as summaries only; payloads stay on the server.
--
-- Builds on 20261007220000 (workout_set_status / workout_undo_status), whose
-- snapshots become versions. Completion rows are still cleared/restored in
-- place, never deleted (XP is keyed to their id).

ALTER TABLE IF EXISTS public.workout_status_snapshots RENAME TO workout_versions;
ALTER INDEX IF EXISTS public.workout_status_snapshots_scope_idx RENAME TO workout_versions_scope_idx;
ALTER TABLE public.workout_versions ADD COLUMN IF NOT EXISTS reason text NOT NULL DEFAULT 'status';
ALTER TABLE public.workout_versions ADD COLUMN IF NOT EXISTS summary jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.workout_versions ADD COLUMN IF NOT EXISTS payload_hash text;
ALTER TABLE public.workout_versions ALTER COLUMN from_status DROP NOT NULL;
ALTER TABLE public.workout_versions ALTER COLUMN to_status DROP NOT NULL;
UPDATE public.workout_versions SET reason = 'reset' WHERE reset AND reason = 'status';
CREATE INDEX IF NOT EXISTS workout_versions_instance_idx
  ON public.workout_versions (client_id, day_id, scheduled_workout_id, created_at DESC);

/** The full state of one workout instance, as stored in a version. */
CREATE OR REPLACE FUNCTION public.workout_instance_state(_client_id uuid, _day_id uuid, _scheduled_workout_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  comp public.pl_day_completions;
  row_ids uuid[];
BEGIN
  SELECT * INTO comp FROM public.pl_day_completions dc
   WHERE dc.client_id = _client_id
     AND CASE WHEN _scheduled_workout_id IS NOT NULL
              THEN dc.scheduled_workout_id = _scheduled_workout_id
              ELSE dc.day_id = _day_id AND dc.scheduled_workout_id IS NULL END;
  SELECT coalesce(array_agg(er.id), '{}') INTO row_ids FROM public.pl_exercise_rows er WHERE er.day_id = _day_id;
  RETURN jsonb_build_object(
    'completion', CASE WHEN comp.id IS NULL THEN NULL ELSE jsonb_strip_nulls(to_jsonb(comp)) END,
    'results', coalesce((
      SELECT jsonb_agg(jsonb_strip_nulls(to_jsonb(r)) ORDER BY r.id) FROM public.pl_row_results r
       WHERE r.client_id = _client_id AND r.row_id = ANY (row_ids)
         AND r.scheduled_workout_id IS NOT DISTINCT FROM _scheduled_workout_id), '[]'::jsonb),
    'warmups', coalesce((
      SELECT jsonb_agg(jsonb_strip_nulls(to_jsonb(w)) ORDER BY w.id) FROM public.pl_warmup_sets w
       WHERE w.client_id = _client_id AND w.row_id = ANY (row_ids)
         AND w.scheduled_workout_id IS NOT DISTINCT FROM _scheduled_workout_id), '[]'::jsonb),
    'feedback', coalesce((
      SELECT jsonb_agg(jsonb_strip_nulls(to_jsonb(f)) ORDER BY f.id) FROM public.pl_workout_feedback f
       WHERE comp.id IS NOT NULL AND f.completion_id = comp.id), '[]'::jsonb));
END
$fn$;

/**
 * Save a version of one workout instance. 'edit' versions are coalesced (none
 * if any version exists in the last 15 minutes); explicit reasons always save
 * unless the state is identical to the newest version. Returns the version id
 * that represents the current state (possibly an existing one), or NULL when an
 * 'edit' capture was coalesced away.
 */
CREATE OR REPLACE FUNCTION public.workout_capture_version(
  _client_id uuid, _day_id uuid, _scheduled_workout_id uuid, _reason text,
  _from_status text DEFAULT NULL, _to_status text DEFAULT NULL
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  latest public.workout_versions;
  state jsonb;
  h text;
  vid uuid;
BEGIN
  SELECT * INTO latest FROM public.workout_versions v
   WHERE v.client_id = _client_id AND v.day_id = _day_id
     AND v.scheduled_workout_id IS NOT DISTINCT FROM _scheduled_workout_id
   ORDER BY v.created_at DESC LIMIT 1;
  IF _reason = 'edit' AND latest.id IS NOT NULL AND latest.created_at > now() - interval '15 minutes' THEN
    RETURN NULL;
  END IF;

  state := public.workout_instance_state(_client_id, _day_id, _scheduled_workout_id);
  h := md5(state::text);
  IF latest.id IS NOT NULL AND latest.payload_hash = h AND _reason = 'edit' THEN
    RETURN latest.id;
  END IF;

  INSERT INTO public.workout_versions
    (client_id, day_id, scheduled_workout_id, from_status, to_status, reset, reason, payload, payload_hash, summary)
  VALUES (
    _client_id, _day_id, _scheduled_workout_id, _from_status, _to_status, _reason = 'reset', _reason, state, h,
    jsonb_build_object(
      'status', CASE
        WHEN state #>> '{completion,completed_at}' IS NOT NULL THEN 'completed'
        WHEN state #>> '{completion,in_progress_at}' IS NOT NULL OR state #>> '{completion,started_at}' IS NOT NULL
          OR jsonb_array_length(state -> 'results') > 0 THEN 'in_progress'
        ELSE 'not_started' END,
      'sets', jsonb_array_length(state -> 'results'),
      'done_sets', (SELECT count(*) FROM jsonb_array_elements(state -> 'results') e WHERE e ? 'completed_at'),
      'warmups', jsonb_array_length(state -> 'warmups'),
      'review', jsonb_array_length(state -> 'feedback') > 0))
  RETURNING id INTO vid;

  -- Retention: 30 newest per workout, nothing older than 45 days.
  DELETE FROM public.workout_versions v
   WHERE v.client_id = _client_id AND v.day_id = _day_id
     AND v.scheduled_workout_id IS NOT DISTINCT FROM _scheduled_workout_id
     AND v.id NOT IN (
       SELECT k.id FROM public.workout_versions k
        WHERE k.client_id = _client_id AND k.day_id = _day_id
          AND k.scheduled_workout_id IS NOT DISTINCT FROM _scheduled_workout_id
        ORDER BY k.created_at DESC LIMIT 30);
  DELETE FROM public.workout_versions v
   WHERE v.client_id = _client_id AND v.created_at < now() - interval '45 days';
  RETURN vid;
END
$fn$;

/** Auto-save: a version before the first change in each 15-minute window. Never blocks the write. */
CREATE OR REPLACE FUNCTION public.workout_version_on_edit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  rec record;
  d uuid;
BEGIN
  BEGIN
    IF TG_OP = 'DELETE' THEN rec := OLD; ELSE rec := NEW; END IF;
    IF TG_TABLE_NAME = 'pl_day_completions' THEN
      d := rec.day_id;
    ELSE
      SELECT er.day_id INTO d FROM public.pl_exercise_rows er WHERE er.id = rec.row_id;
    END IF;
    IF d IS NOT NULL AND rec.client_id IS NOT NULL THEN
      PERFORM public.workout_capture_version(rec.client_id, d, rec.scheduled_workout_id, 'edit');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'workout_version_on_edit: %', SQLERRM;
  END;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS workout_version_on_edit_trg ON public.pl_row_results;
CREATE TRIGGER workout_version_on_edit_trg
  BEFORE INSERT OR UPDATE OR DELETE ON public.pl_row_results
  FOR EACH ROW EXECUTE FUNCTION public.workout_version_on_edit();
DROP TRIGGER IF EXISTS workout_version_on_edit_trg ON public.pl_warmup_sets;
CREATE TRIGGER workout_version_on_edit_trg
  BEFORE INSERT OR UPDATE OR DELETE ON public.pl_warmup_sets
  FOR EACH ROW EXECUTE FUNCTION public.workout_version_on_edit();
-- Completion rows change constantly (activity timestamps); only lifecycle
-- changes are worth a version.
DROP TRIGGER IF EXISTS workout_version_on_edit_trg ON public.pl_day_completions;
CREATE TRIGGER workout_version_on_edit_trg
  BEFORE UPDATE ON public.pl_day_completions
  FOR EACH ROW
  WHEN (OLD.completed_at IS DISTINCT FROM NEW.completed_at
     OR OLD.started_at IS DISTINCT FROM NEW.started_at
     OR OLD.in_progress_at IS DISTINCT FROM NEW.in_progress_at)
  EXECUTE FUNCTION public.workout_version_on_edit();

/** Put one workout instance back to a version. Saves the current state first. */
CREATE OR REPLACE FUNCTION public.workout_restore_version(_version_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  v public.workout_versions;
  cur public.pl_day_completions;
  c public.pl_day_completions;
  row_ids uuid[];
  before_id uuid;
BEGIN
  SELECT * INTO v FROM public.workout_versions WHERE id = _version_id FOR UPDATE;
  IF v.id IS NULL OR NOT public.workout_can_act_for_client(v.client_id) THEN
    RAISE EXCEPTION 'That version is no longer available' USING ERRCODE = 'P0002';
  END IF;

  before_id := public.workout_capture_version(v.client_id, v.day_id, v.scheduled_workout_id, 'restore');
  SELECT coalesce(array_agg(er.id), '{}') INTO row_ids FROM public.pl_exercise_rows er WHERE er.day_id = v.day_id;
  SELECT * INTO cur FROM public.pl_day_completions dc
   WHERE dc.client_id = v.client_id
     AND CASE WHEN v.scheduled_workout_id IS NOT NULL
              THEN dc.scheduled_workout_id = v.scheduled_workout_id
              ELSE dc.day_id = v.day_id AND dc.scheduled_workout_id IS NULL END
   FOR UPDATE;

  -- Sets and warm-ups (versions saved before history existed may hold only
  -- the completion; those leave sets alone).
  IF v.payload ? 'results' THEN
    DELETE FROM public.pl_row_results r
     WHERE r.client_id = v.client_id AND r.row_id = ANY (row_ids)
       AND r.scheduled_workout_id IS NOT DISTINCT FROM v.scheduled_workout_id;
    DELETE FROM public.pl_warmup_sets w
     WHERE w.client_id = v.client_id AND w.row_id = ANY (row_ids)
       AND w.scheduled_workout_id IS NOT DISTINCT FROM v.scheduled_workout_id;
    INSERT INTO public.pl_row_results
      SELECT * FROM jsonb_populate_recordset(NULL::public.pl_row_results, v.payload -> 'results');
    INSERT INTO public.pl_warmup_sets
      SELECT * FROM jsonb_populate_recordset(NULL::public.pl_warmup_sets, coalesce(v.payload -> 'warmups', '[]'::jsonb));
  END IF;

  -- Completion: restore its fields in place (never delete — XP is keyed to the id).
  IF v.payload -> 'completion' IS NULL OR jsonb_typeof(v.payload -> 'completion') = 'null' THEN
    IF cur.id IS NOT NULL THEN
      UPDATE public.pl_day_completions SET
        started_at = NULL, in_progress_at = NULL, completed_at = NULL,
        actual_duration_min = NULL, client_notes = NULL, completion_method = NULL,
        session_rating = NULL, session_weight_total = NULL, session_weight_unit = NULL,
        last_activity_at = NULL, elapsed_duration_seconds = NULL, active_duration_seconds = NULL,
        required_sets_count = NULL, logged_sets_count = NULL, skipped_exercises_count = NULL,
        logging_percentage = NULL, logging_quality = NULL, completed_with_missing_logs = NULL,
        completion_source = NULL
       WHERE id = cur.id;
    END IF;
  ELSE
    c := jsonb_populate_record(NULL::public.pl_day_completions, v.payload -> 'completion');
    IF cur.id IS NULL THEN
      INSERT INTO public.pl_day_completions SELECT c.*;
      cur := c;
    ELSE
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
       WHERE id = cur.id;
    END IF;
  END IF;

  -- Review, attached to whichever completion row exists now.
  IF v.payload ? 'feedback' AND cur.id IS NOT NULL THEN
    DELETE FROM public.pl_workout_feedback f WHERE f.completion_id = cur.id;
    INSERT INTO public.pl_workout_feedback
      SELECT * FROM jsonb_populate_recordset(NULL::public.pl_workout_feedback, (
        SELECT coalesce(jsonb_agg(f || jsonb_build_object('completion_id', cur.id)), '[]'::jsonb)
          FROM jsonb_array_elements(v.payload -> 'feedback') f));
  END IF;

  RETURN jsonb_build_object(
    'before_version_id', before_id,
    'status', v.summary ->> 'status',
    'restored_sets', coalesce(jsonb_array_length(v.payload -> 'results'), 0));
END
$fn$;

/** Versions of one workout instance, newest first — summaries only, never payloads. */
CREATE OR REPLACE FUNCTION public.workout_list_versions(_client_id uuid, _day_id uuid, _scheduled_workout_id uuid)
 RETURNS TABLE (id uuid, created_at timestamptz, reason text, to_status text, summary jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
BEGIN
  IF NOT public.workout_can_act_for_client(_client_id) THEN
    RAISE EXCEPTION 'You can''t view this workout''s history' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT v.id, v.created_at, v.reason, v.to_status, v.summary
      FROM public.workout_versions v
     WHERE v.client_id = _client_id AND v.day_id = _day_id
       AND v.scheduled_workout_id IS NOT DISTINCT FROM _scheduled_workout_id
       AND v.created_at > now() - interval '45 days'
     ORDER BY v.created_at DESC
     LIMIT 30;
END
$fn$;

-- Status change / reset: same behaviour as before, now saving a full version first.
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

  snap_id := public.workout_capture_version(
    _client_id, _day_id, _scheduled_workout_id,
    CASE WHEN _status = 'not_started' THEN 'reset' ELSE 'status' END, from_status, _status);

  SELECT coalesce(array_agg(er.id), '{}') INTO row_ids FROM public.pl_exercise_rows er WHERE er.day_id = _day_id;

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

-- Undo (the toast) = restore the version saved just before the change. The
-- current state is saved first, so undo never loses anything either.
CREATE OR REPLACE FUNCTION public.workout_undo_status(_snapshot_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  v public.workout_versions;
  res jsonb;
BEGIN
  SELECT * INTO v FROM public.workout_versions WHERE id = _snapshot_id FOR UPDATE;
  IF v.id IS NULL OR NOT public.workout_can_act_for_client(v.client_id) THEN
    RAISE EXCEPTION 'Nothing to undo' USING ERRCODE = 'P0002';
  END IF;
  IF v.restored_at IS NOT NULL THEN
    RAISE EXCEPTION 'Already undone' USING ERRCODE = 'P0001';
  END IF;
  res := public.workout_restore_version(_snapshot_id);
  UPDATE public.workout_versions SET restored_at = now() WHERE id = _snapshot_id;
  RETURN res;
END
$fn$;

REVOKE ALL ON FUNCTION public.workout_instance_state(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.workout_capture_version(uuid, uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.workout_version_on_edit() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.workout_restore_version(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.workout_list_versions(uuid, uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.workout_set_status(uuid, uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.workout_undo_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workout_restore_version(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.workout_list_versions(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.workout_set_status(uuid, uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.workout_undo_status(uuid) TO authenticated;
