-- Smart filming reminders: footage accountability for coaching clients (Nov 25 2026, T17).
--
-- A coaching client who keeps training without logged footage is reminded, at
-- most once a rolling week and once a workout, deterministically and with the
-- state on the server (every phone agrees). What counts as footage: a
-- working-set video on a logged set (pl_set_videos, set_index > 0, on a logged
-- set's record), filmed or picked in the logger (origin 'set'), or a video sent
-- in the coach chat that the athlete or coach attached to the workout
-- (`attached_at`, set by set_video_attach_to_workout). Videos in chat that were
-- never attached, Crew posts and stories don't count.
--
-- The rule (mirrors src/lib/set-videos/filming-reminder.ts; keep them in step):
--   eligible   >= N days since the last logged footage (or since their first
--              workout) AND >= M completed workouts without logged footage
--              (standard 7 / 3, gentle 10 / 4, firm 5 / 2);
--   tiers      first-time (never logged footage) / initial / extended (14+ days,
--              gentle 18, firm 10) / continued (reminded before in this run);
--   21+ days   (gentle 28, firm 14): no reminder, the coach is flagged instead;
--   caps       one a rolling 7 days, one a workout; a coach's request for
--              footage lifts the eligibility and the 7-day cap once;
--   dismissed  twice without an upload: paused and the coach quietly flagged,
--              until the next upload or the coach resumes it.
-- Coaches set it per client: on/off, sensitivity, expectation, pause until,
-- Request footage, Resume.

ALTER TABLE public.pl_set_videos ADD COLUMN IF NOT EXISTS attached_at timestamptz;

CREATE TABLE IF NOT EXISTS public.filming_reminders (
  client_id        uuid PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  enabled          boolean NOT NULL DEFAULT true,
  sensitivity      text NOT NULL DEFAULT 'standard' CHECK (sensitivity IN ('gentle', 'standard', 'firm')),
  expectation      text NOT NULL DEFAULT 'main_lifts' CHECK (expectation IN ('main_lifts', 'one_per_workout', 'top_sets')),
  paused_until     timestamptz,
  auto_paused_at   timestamptz,
  dismissals       integer NOT NULL DEFAULT 0,
  shown_count      integer NOT NULL DEFAULT 0,
  last_shown_at    timestamptz,
  last_shown_day_id uuid,
  last_answer      text CHECK (last_answer IS NULL OR last_answer IN ('accept', 'dismiss')),
  requested_at     timestamptz,
  coach_flagged_at timestamptz,
  coach_flag_reason text CHECK (coach_flag_reason IS NULL OR coach_flag_reason IN ('dismissed', 'no_footage')),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.filming_reminders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.filming_reminders FROM anon, authenticated;
GRANT SELECT ON public.filming_reminders TO authenticated;
GRANT ALL ON public.filming_reminders TO service_role;
DROP POLICY IF EXISTS "Filming reminders: read" ON public.filming_reminders;
CREATE POLICY "Filming reminders: read" ON public.filming_reminders
  FOR SELECT TO authenticated
  USING (
    client_id IN (SELECT c.id FROM public.clients c WHERE c.user_id = (SELECT auth.uid()))
    OR client_id IN (SELECT public.coached_client_ids())
    OR (SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
  );
-- writes only through the functions below

/** Who may read a client's footage numbers: the client, their coach, an admin. Returns the client row. */
CREATE OR REPLACE FUNCTION public._filming_client(_client uuid, _coach_only boolean DEFAULT false)
RETURNS public.clients
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_uid uuid := (SELECT auth.uid()); c public.clients;
BEGIN
  SELECT * INTO c FROM public.clients WHERE id = _client;
  IF NOT FOUND OR v_uid IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF (NOT _coach_only AND c.user_id = v_uid)
     OR _client IN (SELECT public.coached_client_ids())
     OR public.has_role(v_uid, 'admin'::public.app_role) THEN
    RETURN c;
  END IF;
  RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
END
$$;
REVOKE ALL ON FUNCTION public._filming_client(uuid, boolean) FROM PUBLIC, anon, authenticated;

/** The footage numbers (no permission check: callers check). */
CREATE OR REPLACE FUNCTION public._filming_stats(_client uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH foot AS (
    SELECT v.day_id, v.created_at
      FROM public.pl_set_videos v
     WHERE v.client_id = _client AND v.deleted_at IS NULL AND coalesce(v.set_index, 0) > 0
       AND v.result_id IS NOT NULL AND (v.origin = 'set' OR v.attached_at IS NOT NULL)
  ), last AS (
    SELECT max(created_at) AS at FROM foot
  ), comp AS (
    SELECT c.day_id, c.completed_at, EXISTS (SELECT 1 FROM foot f WHERE f.day_id = c.day_id) AS filmed
      FROM public.pl_day_completions c
     WHERE c.client_id = _client AND c.completed_at IS NOT NULL AND c.completed_at <= now()
  )
  SELECT jsonb_build_object(
    'last_footage_at', (SELECT at FROM last),
    'first_workout_at', (SELECT min(completed_at) FROM comp),
    'workouts_without', (SELECT count(*) FROM comp WHERE NOT filmed AND completed_at > coalesce((SELECT at FROM last), '-infinity'::timestamptz)),
    'c7',  (SELECT count(*) FROM comp WHERE completed_at > now() - interval '7 days'),
    'f7',  (SELECT count(*) FROM comp WHERE filmed AND completed_at > now() - interval '7 days'),
    'c14', (SELECT count(*) FROM comp WHERE completed_at > now() - interval '14 days'),
    'f14', (SELECT count(*) FROM comp WHERE filmed AND completed_at > now() - interval '14 days'),
    'c30', (SELECT count(*) FROM comp WHERE completed_at > now() - interval '30 days'),
    'f30', (SELECT count(*) FROM comp WHERE filmed AND completed_at > now() - interval '30 days'),
    'now', now()
  )
$$;
REVOKE ALL ON FUNCTION public._filming_stats(uuid) FROM PUBLIC, anon, authenticated;

/**
 * A client's footage numbers and reminder state, for their logger, their coach's
 * card and the check-in line. Reads only; nothing is decided by a model.
 */
CREATE OR REPLACE FUNCTION public.filming_status(_client uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE c public.clients; r public.filming_reminders;
BEGIN
  c := public._filming_client(_client);
  SELECT * INTO r FROM public.filming_reminders WHERE client_id = _client;
  RETURN public._filming_stats(_client) || jsonb_build_object(
    'coaching', c.service_tier = 'coaching' AND NOT coalesce(c.archived, false) AND c.assigned_coach_id IS NOT NULL,
    'coach_first', (SELECT nullif(split_part(btrim(co.full_name), ' ', 1), '') FROM public.coaches co WHERE co.id = c.assigned_coach_id),
    'state', CASE WHEN r.client_id IS NULL THEN NULL ELSE to_jsonb(r) END);
END
$$;
REVOKE ALL ON FUNCTION public.filming_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.filming_status(uuid) TO authenticated;

/** The thresholds by sensitivity: days, workouts, extended days, coach-flag days. */
CREATE OR REPLACE FUNCTION public._filming_thresholds(_sensitivity text)
RETURNS int[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE _sensitivity WHEN 'gentle' THEN ARRAY[10, 4, 18, 28] WHEN 'firm' THEN ARRAY[5, 2, 10, 14] ELSE ARRAY[7, 3, 14, 21] END
$$;

/**
 * The reminder is on screen for this workout: recorded only when the rule
 * still allows it (any phone may have shown one meanwhile). Returns whether it
 * may show. The client themselves only.
 */
CREATE OR REPLACE FUNCTION public.filming_reminder_shown(_client uuid, _day uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE c public.clients; r public.filming_reminders; s jsonb; th int[]; days numeric; requested boolean;
BEGIN
  SELECT * INTO c FROM public.clients WHERE id = _client;
  IF NOT FOUND OR c.user_id IS DISTINCT FROM (SELECT auth.uid()) THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF c.service_tier IS DISTINCT FROM 'coaching' OR coalesce(c.archived, false) OR c.assigned_coach_id IS NULL THEN RETURN false; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(_client::text, 17));
  INSERT INTO public.filming_reminders (client_id) VALUES (_client) ON CONFLICT (client_id) DO NOTHING;
  SELECT * INTO r FROM public.filming_reminders WHERE client_id = _client FOR UPDATE;
  IF NOT r.enabled OR r.auto_paused_at IS NOT NULL OR (r.paused_until IS NOT NULL AND r.paused_until > now()) THEN RETURN false; END IF;
  IF r.last_shown_day_id = _day THEN RETURN false; END IF;
  requested := r.requested_at IS NOT NULL AND (r.last_shown_at IS NULL OR r.requested_at > r.last_shown_at);
  IF NOT requested AND r.last_shown_at IS NOT NULL AND r.last_shown_at > now() - interval '7 days' THEN RETURN false; END IF;
  IF NOT requested THEN
    s := public._filming_stats(_client);
    th := public._filming_thresholds(r.sensitivity);
    days := extract(epoch FROM now() - coalesce((s->>'last_footage_at')::timestamptz, (s->>'first_workout_at')::timestamptz, now())) / 86400;
    IF days < th[1] OR (s->>'workouts_without')::int < th[2] THEN RETURN false; END IF;
    -- long enough without footage that the coach should talk to them, not a pop-up
    IF (s->>'last_footage_at') IS NOT NULL AND days >= th[4] THEN
      UPDATE public.filming_reminders SET coach_flagged_at = coalesce(coach_flagged_at, now()), coach_flag_reason = coalesce(coach_flag_reason, 'no_footage'), updated_at = now()
       WHERE client_id = _client;
      RETURN false;
    END IF;
  END IF;
  UPDATE public.filming_reminders
     SET last_shown_at = now(), last_shown_day_id = _day, shown_count = shown_count + 1, updated_at = now(),
         requested_at = CASE WHEN requested THEN NULL ELSE requested_at END
   WHERE client_id = _client;
  RETURN true;
END
$$;
REVOKE ALL ON FUNCTION public.filming_reminder_shown(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.filming_reminder_shown(uuid, uuid) TO authenticated;

/** "Let's get some footage" or "Maybe later". Twice later without an upload: paused, the coach quietly flagged. */
CREATE OR REPLACE FUNCTION public.filming_reminder_answer(_client uuid, _answer text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE c public.clients;
BEGIN
  SELECT * INTO c FROM public.clients WHERE id = _client;
  IF NOT FOUND OR c.user_id IS DISTINCT FROM (SELECT auth.uid()) THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF _answer NOT IN ('accept', 'dismiss') THEN RAISE EXCEPTION 'Unknown answer' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.filming_reminders (client_id) VALUES (_client) ON CONFLICT (client_id) DO NOTHING;
  UPDATE public.filming_reminders
     SET last_answer = _answer,
         dismissals = CASE WHEN _answer = 'dismiss' THEN dismissals + 1 ELSE dismissals END,
         auto_paused_at = CASE WHEN _answer = 'dismiss' AND dismissals + 1 >= 2 THEN coalesce(auto_paused_at, now()) ELSE auto_paused_at END,
         coach_flagged_at = CASE WHEN _answer = 'dismiss' AND dismissals + 1 >= 2 THEN coalesce(coach_flagged_at, now()) ELSE coach_flagged_at END,
         coach_flag_reason = CASE WHEN _answer = 'dismiss' AND dismissals + 1 >= 2 THEN 'dismissed' ELSE coach_flag_reason END,
         updated_at = now()
   WHERE client_id = _client;
END
$$;
REVOKE ALL ON FUNCTION public.filming_reminder_answer(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.filming_reminder_answer(uuid, text) TO authenticated;

/**
 * The coach's controls for one client: `_patch` may hold enabled, sensitivity,
 * expectation, paused_until (null to resume), request (true: ask for footage
 * at their next workout), resume (true: lift the auto-pause and the flag).
 */
CREATE OR REPLACE FUNCTION public.filming_reminder_coach(_client uuid, _patch jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public._filming_client(_client, true);
  INSERT INTO public.filming_reminders (client_id) VALUES (_client) ON CONFLICT (client_id) DO NOTHING;
  UPDATE public.filming_reminders SET
    enabled = CASE WHEN _patch ? 'enabled' THEN coalesce((_patch->>'enabled')::boolean, enabled) ELSE enabled END,
    sensitivity = CASE WHEN _patch->>'sensitivity' IN ('gentle', 'standard', 'firm') THEN _patch->>'sensitivity' ELSE sensitivity END,
    expectation = CASE WHEN _patch->>'expectation' IN ('main_lifts', 'one_per_workout', 'top_sets') THEN _patch->>'expectation' ELSE expectation END,
    paused_until = CASE WHEN _patch ? 'paused_until' THEN (_patch->>'paused_until')::timestamptz ELSE paused_until END,
    requested_at = CASE WHEN coalesce((_patch->>'request')::boolean, false) THEN now() ELSE requested_at END,
    auto_paused_at = CASE WHEN coalesce((_patch->>'resume')::boolean, false) OR coalesce((_patch->>'request')::boolean, false) THEN NULL ELSE auto_paused_at END,
    dismissals = CASE WHEN coalesce((_patch->>'resume')::boolean, false) OR coalesce((_patch->>'request')::boolean, false) THEN 0 ELSE dismissals END,
    coach_flagged_at = CASE WHEN coalesce((_patch->>'resume')::boolean, false) THEN NULL ELSE coach_flagged_at END,
    coach_flag_reason = CASE WHEN coalesce((_patch->>'resume')::boolean, false) THEN NULL ELSE coach_flag_reason END,
    updated_at = now()
  WHERE client_id = _client;
END
$$;
REVOKE ALL ON FUNCTION public.filming_reminder_coach(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.filming_reminder_coach(uuid, jsonb) TO authenticated;

-- footage landed: the run without it is over (the dismissals, the pause they caused, the flag)
CREATE OR REPLACE FUNCTION public.tg_filming_footage_landed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.deleted_at IS NULL AND coalesce(NEW.set_index, 0) > 0
     AND (NEW.origin = 'set' OR NEW.attached_at IS NOT NULL)
     AND (TG_OP = 'INSERT' OR OLD.attached_at IS DISTINCT FROM NEW.attached_at) THEN
    UPDATE public.filming_reminders
       SET dismissals = 0, shown_count = 0, auto_paused_at = NULL, requested_at = NULL,
           coach_flagged_at = NULL, coach_flag_reason = NULL, updated_at = now()
     WHERE client_id = NEW.client_id
       AND (dismissals > 0 OR shown_count > 0 OR auto_paused_at IS NOT NULL OR requested_at IS NOT NULL OR coach_flagged_at IS NOT NULL);
  END IF;
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION public.tg_filming_footage_landed() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS pl_set_videos_filming_footage ON public.pl_set_videos;
CREATE TRIGGER pl_set_videos_filming_footage
  AFTER INSERT OR UPDATE OF attached_at ON public.pl_set_videos
  FOR EACH ROW EXECUTE FUNCTION public.tg_filming_footage_landed();

/** Mark a chat video's card as attached (its `set_video` gains attached: true), when it's in a message. */
CREATE OR REPLACE FUNCTION public._set_video_card_attached(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v public.pl_set_videos; cur jsonb;
BEGIN
  SELECT * INTO v FROM public.pl_set_videos WHERE id = _id;
  IF v.message_id IS NULL OR v.origin IS DISTINCT FROM 'chat' THEN RETURN; END IF;
  SELECT a -> 'set_video' INTO cur
    FROM public.messages m, jsonb_array_elements(CASE WHEN jsonb_typeof(m.attachments) = 'array' THEN m.attachments ELSE '[]'::jsonb END) a
   WHERE m.id = v.message_id AND a ->> 'storage_path' = v.storage_path AND a ->> 'type' = 'video'
   LIMIT 1;
  IF cur IS NULL OR jsonb_typeof(cur) <> 'object' THEN RETURN; END IF;
  PERFORM public._chat_lift_set_attachment(v.message_id, v.storage_path, cur || jsonb_build_object('attached', true));
END
$$;
REVOKE ALL ON FUNCTION public._set_video_card_attached(uuid) FROM PUBLIC, anon, authenticated;

/**
 * "Attach to workout" for a video the athlete sent in their coach chat: the
 * chat's lift video (chat_video_lift: never a new message) is put on the
 * workout nearest the message, and counted as the workout's footage once it's
 * on a set. Returns { id, day_id, linked }. The athlete, their coach or an admin.
 */
CREATE OR REPLACE FUNCTION public.set_video_attach_to_workout(_message_id uuid, _storage_path text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE m public.messages; v public.pl_set_videos; v_day uuid; out jsonb;
BEGIN
  SELECT * INTO m FROM public.messages WHERE id = _message_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'That message isn''t in the chat any more.' USING ERRCODE = '22023'; END IF;
  PERFORM public._filming_client(m.client_id);
  -- the workout it's from: one done in the 18 hours before it was sent (or just after), else the latest logged
  SELECT c.day_id INTO v_day FROM public.pl_day_completions c
   WHERE c.client_id = m.client_id AND c.completed_at BETWEEN m.created_at - interval '18 hours' AND m.created_at + interval '3 hours'
   ORDER BY abs(extract(epoch FROM c.completed_at - m.created_at)) LIMIT 1;
  IF v_day IS NULL THEN
    SELECT r.day_id INTO v_day FROM public.pl_row_results x JOIN public.pl_exercise_rows r ON r.id = x.row_id
     WHERE x.client_id = m.client_id AND x.completed_at BETWEEN m.created_at - interval '18 hours' AND m.created_at + interval '3 hours'
     ORDER BY x.completed_at DESC LIMIT 1;
  END IF;
  out := public.chat_video_lift(_message_id, _storage_path, NULL, NULL, v_day, NULL, 'athlete', NULL);
  SELECT * INTO v FROM public.pl_set_videos WHERE id = (out->>'id')::uuid;
  IF v.row_id IS NOT NULL AND v.set_index IS NOT NULL THEN
    UPDATE public.pl_set_videos SET attached_at = coalesce(attached_at, now()) WHERE id = v.id;
    PERFORM public._set_video_card_attached(v.id);
  END IF;
  RETURN jsonb_build_object('id', v.id, 'day_id', coalesce(v.day_id, v_day), 'linked', v.row_id IS NOT NULL AND v.set_index IS NOT NULL);
END
$$;
REVOKE ALL ON FUNCTION public.set_video_attach_to_workout(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_video_attach_to_workout(uuid, text) TO authenticated;

/** A chat video put on a set by a person (Yes, Pick the set, Attach to workout): it's the workout's footage. */
CREATE OR REPLACE FUNCTION public.set_video_mark_attached(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v public.pl_set_videos;
BEGIN
  SELECT * INTO v FROM public.pl_set_videos WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'That video isn''t there any more.' USING ERRCODE = '22023'; END IF;
  PERFORM public._filming_client(v.client_id);
  UPDATE public.pl_set_videos SET attached_at = coalesce(attached_at, now())
   WHERE id = _id AND deleted_at IS NULL AND row_id IS NOT NULL AND coalesce(set_index, 0) > 0;
  IF FOUND THEN PERFORM public._set_video_card_attached(_id); END IF;
END
$$;
REVOKE ALL ON FUNCTION public.set_video_mark_attached(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_video_mark_attached(uuid) TO authenticated;

SELECT public.rls_evaluate_once('filming_reminders');
