-- A coach reads (and can fix) the weigh-ins their clients log in the app.
--
-- The client's profile → Progress showed Marc's bodyweight as 162.5 lb on
-- Aug 17 with "No bodyweight entries in this range", while he'd weighed in
-- almost every morning since (156.6 lb on Nov 9): the coach's panel read only
-- progress_metrics, which nothing has written since Aug 19 2026, and the app
-- logs to progress_bodyweight. The panel now reads both (loadClientBodyweight,
-- client-bodyweight.ts); this lets a coach who isn't an admin do the same.
--
-- Every "Coach … assigned" rule on the progress tables compared
-- clients.assigned_coach_id (a coaches row id) with the login id, which never
-- matches (coaches.id is never the login), so a coach who isn't an admin saw no
-- weigh-ins, measurements, check-in schedules, progress photos / videos or
-- reviews for anyone. They now go through the coach's sets
-- (coached_client_ids / coached_client_user_ids / coached_progress_submission_ids),
-- checked once per query, like progress_metrics' "Coach manage assigned" rule.
-- The save / delete RPCs let the client's assigned coach through too, so the
-- coach's Add weigh-in / edit / delete work for them as well as for an admin.

DO $$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE proname = 'save_progress_bodyweight' AND pronamespace = 'public'::regnamespace)
       IS DISTINCT FROM '20575773ebb3435dc1f4da3b75490805'
  OR (SELECT md5(prosrc) FROM pg_proc WHERE proname = 'delete_progress_bodyweight' AND pronamespace = 'public'::regnamespace)
       IS DISTINCT FROM '56fcf4dccf2583ef077fc0c982114c77' THEN
    RAISE EXCEPTION 'save/delete_progress_bodyweight changed since this migration was written';
  END IF;
END $$;

-- The logins of the clients the signed-in coach is assigned (active coach record).
CREATE OR REPLACE FUNCTION public.coached_client_user_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT c.user_id
    FROM public.clients c
    JOIN public.coaches co ON co.id = c.assigned_coach_id
   WHERE co.user_id = auth.uid()
     AND co.archived = false
     AND co.status = 'Active'
     AND c.user_id IS NOT NULL
$function$;

-- Their progress check-ins (photos / videos), for the media and review tables.
CREATE OR REPLACE FUNCTION public.coached_progress_submission_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT s.id
    FROM public.progress_submissions s
   WHERE s.client_id IN (SELECT public.coached_client_ids())
$function$;

REVOKE ALL ON FUNCTION public.coached_client_user_ids() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.coached_progress_submission_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coached_client_user_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.coached_progress_submission_ids() TO authenticated, service_role;

DROP POLICY IF EXISTS "Coach read assigned bodyweight" ON public.progress_bodyweight;
CREATE POLICY "Coach read assigned bodyweight" ON public.progress_bodyweight
  FOR SELECT TO authenticated
  USING (user_id IN (SELECT public.coached_client_user_ids()));

DROP POLICY IF EXISTS "Coach read assigned measurements" ON public.progress_measurements;
CREATE POLICY "Coach read assigned measurements" ON public.progress_measurements
  FOR SELECT TO authenticated
  USING (user_id IN (SELECT public.coached_client_user_ids()));

DROP POLICY IF EXISTS "Coach read assigned schedules" ON public.progress_check_in_schedules;
CREATE POLICY "Coach read assigned schedules" ON public.progress_check_in_schedules
  FOR SELECT TO authenticated
  USING (user_id IN (SELECT public.coached_client_user_ids()));

DROP POLICY IF EXISTS "Coach read assigned submissions" ON public.progress_submissions;
CREATE POLICY "Coach read assigned submissions" ON public.progress_submissions
  FOR SELECT TO authenticated
  USING (client_id IN (SELECT public.coached_client_ids()));

DROP POLICY IF EXISTS "Coach update assigned submissions" ON public.progress_submissions;
CREATE POLICY "Coach update assigned submissions" ON public.progress_submissions
  FOR UPDATE TO authenticated
  USING (client_id IN (SELECT public.coached_client_ids()))
  WITH CHECK (client_id IN (SELECT public.coached_client_ids()));

DROP POLICY IF EXISTS "Coach read assigned media" ON public.progress_media;
CREATE POLICY "Coach read assigned media" ON public.progress_media
  FOR SELECT TO authenticated
  USING (submission_id IN (SELECT public.coached_progress_submission_ids()));

DROP POLICY IF EXISTS "Coach manage assigned review responses" ON public.progress_review_responses;
CREATE POLICY "Coach manage assigned review responses" ON public.progress_review_responses
  FOR ALL TO authenticated
  USING (submission_id IN (SELECT public.coached_progress_submission_ids()))
  WITH CHECK (
    reviewer_id = (SELECT auth.uid())
    AND submission_id IN (SELECT public.coached_progress_submission_ids())
  );

CREATE OR REPLACE FUNCTION public.save_progress_bodyweight(p_user_id uuid, p_weight_value numeric, p_weight_unit text, p_logged_date date, p_note text DEFAULT NULL::text, p_entry_id uuid DEFAULT NULL::uuid)
 RETURNS progress_bodyweight
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_is_admin boolean := false;
  v_existing public.progress_bodyweight;
  v_result public.progress_bodyweight;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501'; END IF;
  SELECT public.has_role(v_actor, 'admin') INTO v_is_admin;
  IF p_user_id IS NULL OR (p_user_id <> v_actor AND NOT COALESCE(v_is_admin, false)
       AND NOT EXISTS (SELECT 1 FROM public.coached_client_user_ids() u WHERE u = p_user_id)) THEN
    RAISE EXCEPTION 'Forbidden.' USING ERRCODE = '42501';
  END IF;
  IF p_logged_date IS NULL OR p_weight_unit NOT IN ('kg', 'lb') OR p_weight_value IS NULL OR p_weight_value <= 0 OR p_weight_value = 'NaN'::numeric THEN RAISE EXCEPTION 'A positive bodyweight in kg or lb and a date are required.' USING ERRCODE = '22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_logged_date::text, 0));
  IF p_entry_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.progress_bodyweight WHERE id = p_entry_id FOR UPDATE;
    IF NOT FOUND OR v_existing.user_id <> p_user_id THEN RAISE EXCEPTION 'Bodyweight entry not found.' USING ERRCODE = 'P0002'; END IF;
    IF EXISTS (SELECT 1 FROM public.progress_bodyweight WHERE user_id = p_user_id AND logged_date = p_logged_date AND id <> p_entry_id) THEN RAISE EXCEPTION 'A bodyweight entry already exists for this date.' USING ERRCODE = '23505'; END IF;
    UPDATE public.progress_bodyweight SET weight_value = p_weight_value, weight_unit = p_weight_unit, logged_date = p_logged_date, note = p_note WHERE id = p_entry_id RETURNING * INTO v_result;
    RETURN v_result;
  END IF;
  SELECT * INTO v_existing FROM public.progress_bodyweight WHERE user_id = p_user_id AND logged_date = p_logged_date ORDER BY created_at DESC, id DESC LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    UPDATE public.progress_bodyweight SET weight_value = p_weight_value, weight_unit = p_weight_unit, note = p_note WHERE id = v_existing.id RETURNING * INTO v_result;
  ELSE
    INSERT INTO public.progress_bodyweight (user_id, weight_value, weight_unit, logged_date, note) VALUES (p_user_id, p_weight_value, p_weight_unit, p_logged_date, p_note) RETURNING * INTO v_result;
  END IF;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_progress_bodyweight(p_user_id uuid, p_entry_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_is_admin boolean := false;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501'; END IF;
  SELECT public.has_role(v_actor, 'admin') INTO v_is_admin;
  IF p_user_id IS NULL OR (p_user_id <> v_actor AND NOT COALESCE(v_is_admin, false)
       AND NOT EXISTS (SELECT 1 FROM public.coached_client_user_ids() u WHERE u = p_user_id)) THEN
    RAISE EXCEPTION 'Forbidden.' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.progress_bodyweight WHERE id = p_entry_id AND user_id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bodyweight entry not found.' USING ERRCODE = 'P0002'; END IF;
END;
$function$;
