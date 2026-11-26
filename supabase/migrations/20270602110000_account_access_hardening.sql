-- Account access, hardened (Nov 26 2026).
--
-- 1. Coaches reach only the clients assigned to them. The audit of every policy and definer
--    function that trusts the bare coach role found these still open to any coach (or to a
--    suspended one): the clients table itself (matched on a coach record id with no Active
--    check), progress (water, consents) through user_can_access_progress, account photos of
--    members, League points and achievements, member programs, birthday drafts (date of birth),
--    broadcast and recipe recipients, chat reports, the League's review tools, and progress
--    media in storage (a policy that compared a coach record id with the login, so it matched
--    nothing). No coach login exists today, so nothing anyone uses changes.
-- 2. Opening an account ("View as") no longer asks why: admin_pov_start's reason is optional,
--    the view opens view-only, and edits are one tap (a fresh two-step only for accounts that
--    aren't active coaching clients, as before).
-- 3. The access record is complete and admin-only: the staff member's role, when the view was
--    last alive, how it ended (completed, expired, interrupted when the tab stopped reporting,
--    revoked when access was taken away), every change made with its before and after values
--    (a trigger on the account's data, never a password, token or signature), and every refused
--    attempt (admin_access_denials). Both tables are append-only; only definer functions write.
-- 4. Taking a client away from a coach ends that coach's open view of them at once.

/* ─────────────────────────── 1. Coaches reach only their own clients ─────────────────────────── */

-- The signed-in coach's coach record, only while it's Active (current_coach_id has no status check).
CREATE OR REPLACE FUNCTION public.active_coach_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT co.id FROM public.coaches co
   WHERE co.user_id = auth.uid() AND co.archived = false AND co.status = 'Active'
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.active_coach_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.active_coach_id() TO authenticated;

DROP POLICY IF EXISTS "Coach read assigned clients" ON public.clients;
CREATE POLICY "Coach read assigned clients" ON public.clients FOR SELECT TO authenticated
  USING (id IN (SELECT public.coached_client_ids()));
DROP POLICY IF EXISTS "Coach update assigned clients" ON public.clients;
CREATE POLICY "Coach update assigned clients" ON public.clients FOR UPDATE TO authenticated
  USING (assigned_coach_id IS NOT NULL AND assigned_coach_id = (SELECT public.active_coach_id()))
  WITH CHECK (assigned_coach_id IS NOT NULL AND assigned_coach_id = (SELECT public.active_coach_id()));

-- Water, consents and the rest of progress: the person, an admin, or their Active coach.
CREATE OR REPLACE FUNCTION public.user_can_access_progress(_target_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT auth.uid() = _target_user
      OR public.has_role(auth.uid(), 'admin')
      OR _target_user IN (SELECT public.coached_client_user_ids())
$$;

-- Account photos (the verification photo): an admin or the admin view login any; a coach only
-- their own clients' (members included: never a member who isn't theirs).
CREATE OR REPLACE FUNCTION public.avatar_staff_can_read(_name text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_folder text := (storage.foldername(_name))[1];
BEGIN
  IF v_uid IS NULL THEN RETURN false; END IF;
  IF public.has_role(v_uid, 'admin'::app_role) OR public.is_admin_viewer() THEN RETURN true; END IF;
  IF NOT public.is_coach_or_admin(v_uid) THEN RETURN false; END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.clients c
     WHERE c.user_id::text = v_folder AND c.id IN (SELECT public.coached_client_ids()));
END $$;

-- League points and achievements: the athlete, an admin, their coach.
DROP POLICY IF EXISTS "Athletes read own achievements" ON public.athlete_achievements;
CREATE POLICY "Athletes read own achievements" ON public.athlete_achievements FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.clients c WHERE c.id = athlete_achievements.client_id AND c.user_id = (SELECT auth.uid()))
    OR (SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role))
    OR client_id IN (SELECT public.coached_client_ids()));
DROP POLICY IF EXISTS "Athletes read own xp" ON public.athlete_xp_events;
CREATE POLICY "Athletes read own xp" ON public.athlete_xp_events FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.clients c WHERE c.id = athlete_xp_events.client_id AND c.user_id = (SELECT auth.uid()))
    OR (SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role))
    OR client_id IN (SELECT public.coached_client_ids()));

-- Programs people build: their own, an admin, their coach, and staff moderating shared ones.
DROP POLICY IF EXISTS "Own athlete programs" ON public.athlete_programs;
CREATE POLICY "Own athlete programs" ON public.athlete_programs FOR SELECT TO authenticated
  USING (
    owner_id = (SELECT auth.uid())
    OR (SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role))
    OR owner_id IN (SELECT public.coached_client_user_ids())
    OR (visibility = 'community' AND (SELECT public.is_community_staff())));

-- Birthday drafts carry a date of birth: an admin, or the athlete's own coach.
DROP POLICY IF EXISTS "Staff read birthday posts" ON public.community_birthday_posts;
CREATE POLICY "Staff read birthday posts" ON public.community_birthday_posts FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)) OR client_id IN (SELECT public.coached_client_ids()));

CREATE OR REPLACE FUNCTION public.community_birthdays_next(_limit integer DEFAULT 3)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  tz constant text := 'America/Winnipeg';
  v_admin boolean := public.has_role(auth.uid(), 'admin');
BEGIN
  IF NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(s.j ORDER BY s.day) FROM (
      SELECT b.day, jsonb_build_object(
               'client_id', c.id,
               'birthday', b.day,
               'days', b.day - l.ld,
               'draft_at', ((b.day - 1)::timestamp + time '17:00') AT TIME ZONE tz,
               'person', jsonb_build_object(
                 'name', coalesce(nullif(btrim(c.preferred_name), ''), nullif(btrim(c.first_name), ''), 'Client'),
                 'full_name', coalesce(nullif(btrim(c.full_name), ''), btrim(concat_ws(' ', c.first_name, c.last_name))),
                 'avatar_url', public.community_author(c.user_id) ->> 'avatar_url')) AS j
        FROM public.clients c
        CROSS JOIN LATERAL (SELECT (now() AT TIME ZONE coalesce(nullif(c.timezone, ''), tz))::date AS ld) l
        CROSS JOIN LATERAL (
          SELECT CASE WHEN public.community_birthday_on(c.date_of_birth, extract(year FROM l.ld)::int) >= l.ld
                      THEN public.community_birthday_on(c.date_of_birth, extract(year FROM l.ld)::int)
                      ELSE public.community_birthday_on(c.date_of_birth, extract(year FROM l.ld)::int + 1) END AS day) b
       WHERE c.date_of_birth IS NOT NULL AND c.user_id IS NOT NULL
         AND (v_admin OR c.id IN (SELECT public.coached_client_ids()))
         AND coalesce(c.archived, false) = false AND c.archived_at IS NULL
         AND coalesce(c.status, '') <> 'Archived' AND coalesce(c.portal_access_disabled, false) = false
         AND NOT EXISTS (SELECT 1 FROM public.community_birthday_posts p WHERE p.client_id = c.id AND p.birthday_year = extract(year FROM b.day)::int)
         AND NOT EXISTS (SELECT 1 FROM public.client_birthday_wishes w WHERE w.client_id = c.id AND w.birthday_year = extract(year FROM b.day)::int)
         AND NOT EXISTS (SELECT 1 FROM public.client_birthday_cards bc WHERE bc.client_id = c.id AND bc.enabled = false)
       ORDER BY b.day, c.id
       LIMIT greatest(1, least(coalesce(_limit, 3), 10))) s), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.community_birthday_draft_now(_client_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  tz constant text := 'America/Winnipeg';
  c public.clients;
  v_ctz text;
  v_ld date;
  v_day date;
  v_yr int;
  v_facts jsonb;
  v_slot int;
  v_comp jsonb;
  b public.community_birthday_posts;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' AND NOT (
       public.has_role(auth.uid(), 'admin')
       OR (public.is_community_staff() AND _client_id IN (SELECT public.coached_client_ids()))) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public.clients WHERE id = _client_id;
  IF NOT FOUND OR c.date_of_birth IS NULL THEN RAISE EXCEPTION 'No birthday on file'; END IF;
  IF c.user_id IS NULL THEN RAISE EXCEPTION 'They aren''t on the app yet'; END IF;
  v_ctz := coalesce(nullif(c.timezone, ''), tz);
  v_ld := (now() AT TIME ZONE v_ctz)::date;
  v_day := CASE WHEN public.community_birthday_on(c.date_of_birth, extract(year FROM v_ld)::int) >= v_ld
                THEN public.community_birthday_on(c.date_of_birth, extract(year FROM v_ld)::int)
                ELSE public.community_birthday_on(c.date_of_birth, extract(year FROM v_ld)::int + 1) END;
  v_yr := extract(year FROM v_day)::int;

  SELECT * INTO b FROM public.community_birthday_posts WHERE client_id = c.id AND birthday_year = v_yr;
  IF FOUND THEN RETURN public.community_birthday_json(b); END IF;

  v_facts := public.community_birthday_facts(c.id);
  v_slot := abs(hashtext(c.id::text || v_yr)) % 997;
  v_comp := public.community_birthday_compose(c.id, v_slot, v_facts);
  INSERT INTO public.community_birthday_posts (client_id, birthday_year, birthday, body, dm_body, slot, facts, post_at, ready_pushed_at)
  VALUES (c.id, v_yr, v_day, v_comp ->> 'body', v_comp ->> 'dm_body', v_slot, v_facts,
          (v_day::timestamp + time '08:00') AT TIME ZONE v_ctz, now())
  ON CONFLICT (client_id, birthday_year) DO NOTHING
  RETURNING * INTO b;
  IF b.id IS NULL THEN
    SELECT * INTO b FROM public.community_birthday_posts WHERE client_id = c.id AND birthday_year = v_yr;
  END IF;
  RETURN public.community_birthday_json(b);
END;
$$;

CREATE OR REPLACE FUNCTION public.community_birthday_act(_id uuid, _action text, _body text DEFAULT NULL::text, _dm_body text DEFAULT NULL::text, _media jsonb DEFAULT NULL::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  uid uuid := auth.uid();
  b public.community_birthday_posts;
  v_body text := nullif(btrim(coalesce(_body, '')), '');
  v_dm text := nullif(btrim(coalesce(_dm_body, '')), '');
  v_comp jsonb;
  v_media jsonb;
BEGIN
  IF NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF _action NOT IN ('save', 'reroll', 'approve', 'post_now', 'unschedule', 'skip') THEN RAISE EXCEPTION 'Unknown action'; END IF;
  SELECT * INTO b FROM public.community_birthday_posts WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not found'; END IF;
  IF NOT (public.has_role(uid, 'admin') OR b.client_id IN (SELECT public.coached_client_ids())) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF b.status = 'posted' THEN RAISE EXCEPTION 'Already posted'; END IF;
  IF v_body IS NOT NULL AND char_length(v_body) > 1200 THEN RAISE EXCEPTION 'Post is too long'; END IF;
  IF v_dm IS NOT NULL AND char_length(v_dm) > 1000 THEN RAISE EXCEPTION 'Message is too long'; END IF;
  v_media := CASE WHEN _media IS NULL THEN b.media ELSE public.community_clean_media(_media, uid, b.media) END;

  IF _action = 'reroll' THEN
    v_comp := public.community_birthday_compose(b.client_id, b.slot + 1, nullif(b.facts, '{}'::jsonb));
    UPDATE public.community_birthday_posts
       SET slot = b.slot + 1, body = v_comp ->> 'body', dm_body = v_comp ->> 'dm_body', updated_at = now()
     WHERE id = _id RETURNING * INTO b;
  ELSIF _action = 'skip' THEN
    UPDATE public.community_birthday_posts SET status = 'skipped', updated_at = now() WHERE id = _id RETURNING * INTO b;
  ELSIF _action = 'unschedule' THEN
    UPDATE public.community_birthday_posts SET status = 'ready', approved_by = NULL, approved_at = NULL, updated_at = now()
     WHERE id = _id RETURNING * INTO b;
  ELSE
    UPDATE public.community_birthday_posts
       SET body = coalesce(v_body, body), dm_body = coalesce(v_dm, dm_body), media = v_media, updated_at = now(),
           status = CASE WHEN _action IN ('approve', 'post_now') THEN 'scheduled' ELSE status END,
           approved_by = CASE WHEN _action IN ('approve', 'post_now') THEN uid ELSE approved_by END,
           approved_at = CASE WHEN _action IN ('approve', 'post_now') THEN now() ELSE approved_at END
     WHERE id = _id RETURNING * INTO b;
    IF _action = 'post_now' OR (_action = 'approve' AND b.post_at <= now()) THEN
      b := public.community_birthday_publish_row(_id);
    END IF;
  END IF;
  RETURN public.community_birthday_json(b);
END;
$$;

-- Broadcast and recipe recipients name clients: an admin, or the client's coach.
DROP POLICY IF EXISTS "Admins manage broadcast recipients" ON public.broadcast_recipients;
CREATE POLICY "Admins manage broadcast recipients" ON public.broadcast_recipients FOR ALL TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)) OR client_id IN (SELECT public.coached_client_ids()))
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)) OR client_id IN (SELECT public.coached_client_ids()));
DROP POLICY IF EXISTS "Admins read broadcast seen" ON public.broadcast_seen;
CREATE POLICY "Admins read broadcast seen" ON public.broadcast_seen FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)) OR user_id IN (SELECT public.coached_client_user_ids()));
DROP POLICY IF EXISTS "Admins manage recipe access" ON public.recipe_client_access;
CREATE POLICY "Admins manage recipe access" ON public.recipe_client_access FOR ALL TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)) OR client_id IN (SELECT public.coached_client_ids()))
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)) OR client_id IN (SELECT public.coached_client_ids()));
DROP POLICY IF EXISTS "Admins read recipe notifications" ON public.recipe_notifications;
CREATE POLICY "Admins read recipe notifications" ON public.recipe_notifications FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)) OR user_id IN (SELECT public.coached_client_user_ids()));

-- Reports from member chats: an admin, or the coach of the person who reported.
DROP POLICY IF EXISTS chat_reports_staff_read ON public.chat_reports;
CREATE POLICY chat_reports_staff_read ON public.chat_reports FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)) OR reporter_client_id IN (SELECT public.coached_client_ids()));
DROP POLICY IF EXISTS chat_reports_staff_update ON public.chat_reports;
CREATE POLICY chat_reports_staff_update ON public.chat_reports FOR UPDATE TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)) OR reporter_client_id IN (SELECT public.coached_client_ids()))
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)) OR reporter_client_id IN (SELECT public.coached_client_ids()));

-- The League's review tools read and change every athlete's records: the admin's.
CREATE OR REPLACE FUNCTION public.league_is_staff()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT auth.uid() IS NOT NULL AND public.has_role(auth.uid(), 'admin'::public.app_role)
$$;

-- Progress photos and videos in storage: the client's own coach (the old policy compared a coach
-- record id with the login and so matched nothing).
DROP POLICY IF EXISTS "Coach read assigned progress-media objects" ON storage.objects;
CREATE POLICY "Coach read assigned progress-media objects" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'progress-media'
         AND (storage.foldername(name))[1] IN (SELECT u::text FROM public.coached_client_user_ids() u));

/* ─────────────────────────── 2. Who may reach an account, for anyone ─────────────────────────── */

/**
 * May this staff login reach this client record? The rule coached_client_ids() applies to the
 * signed-in caller, for any login (the triggers below need it for someone else): an admin any;
 * a coach (with the role) the clients assigned to their Active coach record, or whose meet they
 * handle while that access runs.
 */
CREATE OR REPLACE FUNCTION public._staff_can_reach(_staff uuid, _client uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT _staff IS NOT NULL AND _client IS NOT NULL AND (
    public.has_role(_staff, 'admin')
    OR (public.has_role(_staff, 'coach') AND (
      EXISTS (SELECT 1 FROM public.clients c JOIN public.coaches co ON co.id = c.assigned_coach_id
               WHERE c.id = _client AND co.user_id = _staff AND co.archived = false AND co.status = 'Active')
      OR EXISTS (SELECT 1 FROM public.competition_handling h JOIN public.coaches co ON co.user_id = h.handler_user_id
                  WHERE h.client_id = _client AND h.handler_user_id = _staff
                    AND co.archived = false AND co.status = 'Active' AND h.status <> 'cancelled'
                    AND (h.access_starts_on IS NULL OR h.access_starts_on <= (now() AT TIME ZONE 'UTC')::date + 1)
                    AND (h.access_ends_on IS NULL OR h.access_ends_on >= (now() AT TIME ZONE 'UTC')::date - 1)))))
$$;
REVOKE ALL ON FUNCTION public._staff_can_reach(uuid, uuid) FROM PUBLIC, anon, authenticated;

/** A login's role, for the record: admin, coach, admin_viewer, finance or client. */
CREATE OR REPLACE FUNCTION public._staff_role_word(_uid uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN public.has_role(_uid, 'admin') THEN 'admin'
    WHEN public.has_role(_uid, 'coach') THEN 'coach'
    WHEN EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _uid AND ur.role::text = 'finance') THEN 'finance'
    WHEN EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _uid AND ur.role::text NOT IN ('client')) THEN
      (SELECT ur.role::text FROM public.user_roles ur WHERE ur.user_id = _uid AND ur.role::text NOT IN ('client') LIMIT 1)
    ELSE 'client' END
$$;
REVOKE ALL ON FUNCTION public._staff_role_word(uuid) FROM PUBLIC, anon, authenticated;

/* ─────────────────────────── 3. The access record ─────────────────────────── */

ALTER TABLE public.admin_pov_sessions ALTER COLUMN reason DROP NOT NULL;
ALTER TABLE public.admin_pov_sessions DROP CONSTRAINT IF EXISTS admin_pov_sessions_reason_check;
ALTER TABLE public.admin_pov_sessions ADD CONSTRAINT admin_pov_sessions_reason_check
  CHECK (reason IS NULL OR char_length(reason) BETWEEN 1 AND 300);
ALTER TABLE public.admin_pov_sessions ADD COLUMN IF NOT EXISTS staff_role text;
ALTER TABLE public.admin_pov_sessions ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
UPDATE public.admin_pov_sessions SET last_seen_at = coalesce(last_seen_at, started_at) WHERE last_seen_at IS NULL;
CREATE INDEX IF NOT EXISTS admin_pov_sessions_staff_idx ON public.admin_pov_sessions (staff_user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS admin_pov_sessions_started_idx ON public.admin_pov_sessions (started_at DESC);

ALTER TABLE public.admin_pov_events DROP CONSTRAINT IF EXISTS admin_pov_events_kind_check;
ALTER TABLE public.admin_pov_events ADD CONSTRAINT admin_pov_events_kind_check
  CHECK (kind IN ('start', 'view', 'edit_on', 'edit_off', 'write', 'blocked', 'change', 'end', 'expired', 'interrupted', 'revoked'));

-- Admin-only: nobody else reads the record, not even the staff member it's about.
DROP POLICY IF EXISTS "Admins read account views; staff their own" ON public.admin_pov_sessions;
DROP POLICY IF EXISTS "Admins read account views" ON public.admin_pov_sessions;
CREATE POLICY "Admins read account views" ON public.admin_pov_sessions FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)));
DROP POLICY IF EXISTS "Read events of readable account views" ON public.admin_pov_events;
CREATE POLICY "Read events of readable account views" ON public.admin_pov_events FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)));

/** Refused attempts to reach an account: who, whose, where from. */
CREATE TABLE IF NOT EXISTS public.admin_access_denials (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  staff_user_id uuid NOT NULL,
  staff_role text,
  client_id uuid,
  source text NOT NULL CHECK (char_length(source) BETWEEN 1 AND 60),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS admin_access_denials_at_idx ON public.admin_access_denials (at DESC);
CREATE INDEX IF NOT EXISTS admin_access_denials_staff_idx ON public.admin_access_denials (staff_user_id, at DESC);
CREATE INDEX IF NOT EXISTS admin_access_denials_client_idx ON public.admin_access_denials (client_id, at DESC);
ALTER TABLE public.admin_access_denials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_access_denials FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.admin_access_denials TO authenticated;
DROP POLICY IF EXISTS "Admins read access denials" ON public.admin_access_denials;
CREATE POLICY "Admins read access denials" ON public.admin_access_denials FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)));

-- Append-only: the events and denials never change; a session only ends, once, and never moves.
CREATE OR REPLACE FUNCTION public.tg_access_record_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF coalesce(current_setting('jf.allow_history_delete', true), '') = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION 'The account access record can''t be changed' USING ERRCODE = '42501';
END $$;
DROP TRIGGER IF EXISTS admin_pov_events_append_only ON public.admin_pov_events;
CREATE TRIGGER admin_pov_events_append_only BEFORE UPDATE OR DELETE ON public.admin_pov_events
  FOR EACH ROW EXECUTE FUNCTION public.tg_access_record_append_only();
DROP TRIGGER IF EXISTS admin_access_denials_append_only ON public.admin_access_denials;
CREATE TRIGGER admin_access_denials_append_only BEFORE UPDATE OR DELETE ON public.admin_access_denials
  FOR EACH ROW EXECUTE FUNCTION public.tg_access_record_append_only();

CREATE OR REPLACE FUNCTION public.tg_admin_pov_sessions_keep()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF coalesce(current_setting('jf.allow_history_delete', true), '') = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'The account access record can''t be deleted' USING ERRCODE = '42501';
  END IF;
  IF NEW.staff_user_id IS DISTINCT FROM OLD.staff_user_id OR NEW.client_id IS DISTINCT FROM OLD.client_id
     OR NEW.target_user_id IS DISTINCT FROM OLD.target_user_id OR NEW.started_at IS DISTINCT FROM OLD.started_at
     OR NEW.reason IS DISTINCT FROM OLD.reason OR NEW.staff_role IS DISTINCT FROM OLD.staff_role
     OR (OLD.ended_at IS NOT NULL AND (NEW.ended_at IS DISTINCT FROM OLD.ended_at OR NEW.end_reason IS DISTINCT FROM OLD.end_reason)) THEN
    RAISE EXCEPTION 'The account access record can''t be changed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS admin_pov_sessions_keep ON public.admin_pov_sessions;
CREATE TRIGGER admin_pov_sessions_keep BEFORE UPDATE OR DELETE ON public.admin_pov_sessions
  FOR EACH ROW EXECUTE FUNCTION public.tg_admin_pov_sessions_keep();

/** Note a refused attempt (one a minute per person, account and source). */
CREATE OR REPLACE FUNCTION public._log_access_denial(_staff uuid, _client uuid, _source text, _detail jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF _staff IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.admin_access_denials d
              WHERE d.staff_user_id = _staff AND d.client_id IS NOT DISTINCT FROM _client
                AND d.source = left(coalesce(_source, 'unknown'), 60) AND d.at > now() - interval '1 minute') THEN
    RETURN;
  END IF;
  INSERT INTO public.admin_access_denials (staff_user_id, staff_role, client_id, source, detail)
  VALUES (_staff, public._staff_role_word(_staff), _client, left(coalesce(nullif(btrim(_source), ''), 'unknown'), 60),
          jsonb_strip_nulls(coalesce(_detail, '{}'::jsonb)));
END $$;
REVOKE ALL ON FUNCTION public._log_access_denial(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._log_access_denial(uuid, uuid, text, jsonb) TO service_role;

/**
 * May the signed-in person reach this client record through a management tool? True for an
 * admin, the admin view login and the client's own coach; a refusal is noted (never for the
 * person's own record). Screens and server functions ask it where a staff tool opens an account.
 */
CREATE OR REPLACE FUNCTION public.account_access_check(_client_id uuid, _source text DEFAULT 'app')
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR _client_id IS NULL THEN RETURN false; END IF;
  IF public._staff_can_reach(v_uid, _client_id) OR public.is_admin_viewer() THEN RETURN true; END IF;
  IF EXISTS (SELECT 1 FROM public.clients c WHERE c.id = _client_id AND c.user_id = v_uid) OR _client_id = public.linked_client_id() THEN
    RETURN true;
  END IF;
  PERFORM public._log_access_denial(v_uid, _client_id, coalesce(_source, 'app'), '{}'::jsonb);
  RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.account_access_check(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.account_access_check(uuid, text) TO authenticated;

/* ─────────────────────────── 4. Account view sessions ─────────────────────────── */

CREATE OR REPLACE FUNCTION public._pov_state(_s public.admin_pov_sessions)
RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT jsonb_build_object(
    'status', CASE WHEN _s.ended_at IS NULL THEN 'ok' ELSE 'ended' END,
    'id', _s.id, 'client_id', _s.client_id, 'mode', _s.mode, 'edit_until', _s.edit_until,
    'expires_at', _s.expires_at, 'max_until', _s.max_until, 'ended_at', _s.ended_at, 'end_reason', _s.end_reason)
$$;

/**
 * Open an account as its person, view-only unless `_mode` is 'edit': an admin any client or
 * member record, a coach only the clients assigned to them. No reason is asked (one can be
 * given). Edits in an account that isn't an active coaching client need the sign-in confirmed
 * in the last 30 minutes. One open view per staff member: a new one ends the last. A refusal
 * is noted and answered 'forbidden'.
 */
DROP FUNCTION IF EXISTS public.admin_pov_start(uuid, text, text);
CREATE OR REPLACE FUNCTION public.admin_pov_start(_client_id uuid, _reason text DEFAULT NULL, _mode text DEFAULT 'view')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_reason text := nullif(left(btrim(coalesce(_reason, '')), 300), '');
  v_mode text := CASE WHEN _mode = 'edit' THEN 'edit' ELSE 'view' END;
  v_target uuid;
  v_step text;
  v_sid uuid;
  s public.admin_pov_sessions;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT c.user_id INTO v_target FROM public.clients c WHERE c.id = _client_id;
  IF NOT FOUND THEN
    PERFORM public._log_access_denial(v_uid, NULL, 'view_as', jsonb_build_object('why', 'not_found'));
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  IF NOT public._staff_can_reach(v_uid, _client_id) THEN
    PERFORM public._log_access_denial(v_uid, _client_id, 'view_as', jsonb_build_object('mode', v_mode));
    RETURN jsonb_build_object('status', 'forbidden');
  END IF;
  IF v_mode = 'edit' AND public._pov_needs_step_up(_client_id) THEN
    v_step := public._pov_step_up_state();
    IF v_step <> 'ok' THEN RETURN jsonb_build_object('status', v_step); END IF;
  END IF;
  BEGIN
    v_sid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  EXCEPTION WHEN others THEN v_sid := NULL;
  END;
  WITH ended AS (
    UPDATE public.admin_pov_sessions SET ended_at = now(), end_reason = 'replaced'
     WHERE staff_user_id = v_uid AND ended_at IS NULL
    RETURNING id)
  INSERT INTO public.admin_pov_events (session_id, kind, detail)
  SELECT id, 'end', '{"why":"replaced"}'::jsonb FROM ended;
  INSERT INTO public.admin_pov_sessions (staff_user_id, staff_role, client_id, target_user_id, reason, mode, edit_until,
                                         expires_at, max_until, auth_session_id, last_seen_at)
  VALUES (v_uid, public._staff_role_word(v_uid), _client_id, v_target, v_reason, v_mode,
          CASE WHEN v_mode = 'edit' THEN now() + interval '15 minutes' END,
          now() + interval '30 minutes', now() + interval '4 hours', v_sid, now())
  RETURNING * INTO s;
  INSERT INTO public.admin_pov_events (session_id, kind, detail)
  VALUES (s.id, 'start', jsonb_strip_nulls(jsonb_build_object('mode', v_mode, 'reason', v_reason)));
  IF v_mode = 'edit' THEN
    INSERT INTO public.admin_pov_events (session_id, kind, detail) VALUES (s.id, 'edit_on', '{}'::jsonb);
  END IF;
  RETURN public._pov_state(s);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_pov_start(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_pov_start(uuid, text, text) TO authenticated;

/** End a session (and say how), with its event. */
CREATE OR REPLACE FUNCTION public._pov_close(_id uuid, _why text)
RETURNS public.admin_pov_sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  s public.admin_pov_sessions;
  v_kind text := CASE _why WHEN 'expired' THEN 'expired' WHEN 'interrupted' THEN 'interrupted' WHEN 'revoked' THEN 'revoked' ELSE 'end' END;
BEGIN
  UPDATE public.admin_pov_sessions SET ended_at = now(), end_reason = left(_why, 40), mode = 'view', edit_until = NULL
   WHERE id = _id AND ended_at IS NULL RETURNING * INTO s;
  IF s.id IS NOT NULL THEN
    INSERT INTO public.admin_pov_events (session_id, kind, detail)
    VALUES (s.id, v_kind, CASE WHEN v_kind = 'end' THEN jsonb_build_object('why', left(_why, 40)) ELSE '{}'::jsonb END);
  ELSE
    SELECT * INTO s FROM public.admin_pov_sessions WHERE id = _id;
  END IF;
  RETURN s;
END $$;
REVOKE ALL ON FUNCTION public._pov_close(uuid, text) FROM PUBLIC, anon, authenticated;

/** Switch edits on (no reason needed; a fresh two-step for an account that isn't an active coaching client) or off. Edits last 15 minutes. */
CREATE OR REPLACE FUNCTION public.admin_pov_set_mode(_session uuid, _mode text, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_reason text := nullif(left(btrim(coalesce(_reason, '')), 300), '');
  v_step text;
  s public.admin_pov_sessions;
BEGIN
  SELECT * INTO s FROM public.admin_pov_sessions WHERE id = _session AND staff_user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF s.ended_at IS NOT NULL THEN RETURN public._pov_state(s); END IF;
  IF NOT public._staff_can_reach(v_uid, s.client_id) THEN
    s := public._pov_close(s.id, 'revoked');
    RETURN public._pov_state(s);
  END IF;
  IF s.max_until < now() THEN
    s := public._pov_close(s.id, 'expired');
    RETURN public._pov_state(s);
  END IF;
  IF s.expires_at < now() THEN
    s := public._pov_close(s.id, 'interrupted');
    RETURN public._pov_state(s);
  END IF;
  IF _mode = 'edit' THEN
    IF public._pov_needs_step_up(s.client_id) THEN
      v_step := public._pov_step_up_state();
      IF v_step <> 'ok' THEN RETURN jsonb_build_object('status', v_step); END IF;
    END IF;
    UPDATE public.admin_pov_sessions
       SET mode = 'edit', edit_until = least(now() + interval '15 minutes', max_until),
           expires_at = least(now() + interval '30 minutes', max_until), last_seen_at = now()
     WHERE id = s.id RETURNING * INTO s;
    INSERT INTO public.admin_pov_events (session_id, kind, detail)
    VALUES (s.id, 'edit_on', jsonb_strip_nulls(jsonb_build_object('reason', v_reason)));
  ELSE
    IF s.mode = 'edit' THEN
      UPDATE public.admin_pov_sessions SET mode = 'view', edit_until = NULL, last_seen_at = now() WHERE id = s.id RETURNING * INTO s;
      INSERT INTO public.admin_pov_events (session_id, kind, detail) VALUES (s.id, 'edit_off', '{}'::jsonb);
    END IF;
  END IF;
  RETURN public._pov_state(s);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_pov_set_mode(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_pov_set_mode(uuid, text, text) TO authenticated;

/**
 * Keep a view alive and record what was opened and changed: `_events` is up to 60 of
 * {kind: view|write|blocked, path?, method?, target?, at?}. A view whose access was taken away
 * ends here (revoked); one past its 4 hours expires; edits that ran out go back to view-only.
 */
CREATE OR REPLACE FUNCTION public.admin_pov_touch(_session uuid, _events jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  s public.admin_pov_sessions;
BEGIN
  SELECT * INTO s FROM public.admin_pov_sessions WHERE id = _session AND staff_user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(_events) = 'array' THEN
    INSERT INTO public.admin_pov_events (session_id, at, kind, detail)
    SELECT s.id,
           CASE WHEN e->>'at' ~ '^\d{4}-\d{2}-\d{2}T' THEN least(greatest((e->>'at')::timestamptz, s.started_at), now()) ELSE now() END,
           e->>'kind',
           jsonb_strip_nulls(jsonb_build_object(
             'path', left(e->>'path', 200), 'method', left(e->>'method', 10), 'target', left(e->>'target', 120)))
      FROM (SELECT e FROM jsonb_array_elements(_events) e LIMIT 60) x
     WHERE e->>'kind' IN ('view', 'write', 'blocked');
  END IF;
  IF s.ended_at IS NOT NULL THEN RETURN public._pov_state(s); END IF;
  IF NOT public._staff_can_reach(v_uid, s.client_id) THEN
    s := public._pov_close(s.id, 'revoked');
    RETURN public._pov_state(s);
  END IF;
  IF s.max_until < now() THEN
    s := public._pov_close(s.id, 'expired');
    RETURN public._pov_state(s);
  END IF;
  IF s.expires_at < now() THEN
    s := public._pov_close(s.id, 'interrupted');
    RETURN public._pov_state(s);
  END IF;
  IF s.mode = 'edit' AND (s.edit_until IS NULL OR s.edit_until < now()) THEN
    UPDATE public.admin_pov_sessions SET mode = 'view', edit_until = NULL WHERE id = s.id;
    INSERT INTO public.admin_pov_events (session_id, kind, detail) VALUES (s.id, 'edit_off', '{"why":"timed_out"}'::jsonb);
  END IF;
  UPDATE public.admin_pov_sessions SET expires_at = least(now() + interval '30 minutes', max_until), last_seen_at = now()
   WHERE id = s.id RETURNING * INTO s;
  RETURN public._pov_state(s);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_pov_touch(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_pov_touch(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_pov_end(_session uuid, _why text DEFAULT 'exit')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  s public.admin_pov_sessions;
  v_why text := CASE WHEN _why IN ('exit', 'switched', 'signed_out', 'closed', 'cancelled', 'refused', 'ended_elsewhere') THEN _why ELSE 'exit' END;
BEGIN
  SELECT * INTO s FROM public.admin_pov_sessions WHERE id = _session AND staff_user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF s.ended_at IS NULL THEN s := public._pov_close(s.id, v_why); END IF;
  RETURN public._pov_state(s);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_pov_end(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_pov_end(uuid, text) TO authenticated;

/**
 * Close views nobody closed: past their 4 hours (expired) or no longer reporting in, which is a
 * tab or app closed mid-view (interrupted), and any whose access was taken away (revoked).
 * pg_cron every 5 minutes.
 */
CREATE OR REPLACE FUNCTION public.admin_pov_sweep()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  r record;
  n integer := 0;
BEGIN
  FOR r IN SELECT id, staff_user_id, client_id, expires_at, max_until FROM public.admin_pov_sessions WHERE ended_at IS NULL LOOP
    IF NOT public._staff_can_reach(r.staff_user_id, r.client_id) THEN
      PERFORM public._pov_close(r.id, 'revoked'); n := n + 1;
    ELSIF r.max_until < now() THEN
      PERFORM public._pov_close(r.id, 'expired'); n := n + 1;
    ELSIF r.expires_at < now() THEN
      PERFORM public._pov_close(r.id, 'interrupted'); n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.admin_pov_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_pov_sweep() TO service_role;

/** Access taken away (a client reassigned, archived or removed; a coach suspended; a role removed): its open views end now. */
CREATE OR REPLACE FUNCTION public.tg_pov_revoke_unreachable()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id, staff_user_id, client_id FROM public.admin_pov_sessions WHERE ended_at IS NULL LOOP
    IF NOT public._staff_can_reach(r.staff_user_id, r.client_id) THEN
      PERFORM public._pov_close(r.id, 'revoked');
    END IF;
  END LOOP;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS clients_pov_revoke ON public.clients;
CREATE TRIGGER clients_pov_revoke AFTER UPDATE OF assigned_coach_id, archived, status OR DELETE ON public.clients
  FOR EACH STATEMENT EXECUTE FUNCTION public.tg_pov_revoke_unreachable();
DROP TRIGGER IF EXISTS coaches_pov_revoke ON public.coaches;
CREATE TRIGGER coaches_pov_revoke AFTER UPDATE OF status, archived, user_id OR DELETE ON public.coaches
  FOR EACH STATEMENT EXECUTE FUNCTION public.tg_pov_revoke_unreachable();
DROP TRIGGER IF EXISTS user_roles_pov_revoke ON public.user_roles;
CREATE TRIGGER user_roles_pov_revoke AFTER UPDATE OR DELETE ON public.user_roles
  FOR EACH STATEMENT EXECUTE FUNCTION public.tg_pov_revoke_unreachable();
DROP TRIGGER IF EXISTS competition_handling_pov_revoke ON public.competition_handling;
CREATE TRIGGER competition_handling_pov_revoke AFTER UPDATE OR DELETE ON public.competition_handling
  FOR EACH STATEMENT EXECUTE FUNCTION public.tg_pov_revoke_unreachable();

/* ─────────────────────────── 5. Changes made inside a view, with before and after ─────────────────────────── */

/** A value fit for the record: never a credential, never more than 160 characters. */
CREATE OR REPLACE FUNCTION public._pov_value(_key text, _v jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN _key ~* '(password|passcode|secret|token|hash|signature|otp|api_?key|private_key|card_number|account_number|_code$)'
      THEN to_jsonb('[hidden]'::text)
    WHEN _v IS NULL OR jsonb_typeof(_v) = 'null' THEN 'null'::jsonb
    WHEN jsonb_typeof(_v) IN ('object', 'array') AND length(_v::text) > 160 THEN to_jsonb('[long value]'::text)
    WHEN jsonb_typeof(_v) = 'string' AND char_length(_v #>> '{}') > 160 THEN to_jsonb(left(_v #>> '{}', 157) || '…')
    ELSE _v END
$$;

/**
 * A row changed by a staff login that has a view of this account open: record the table, what
 * happened, and the columns that changed with their old and new values (an insert or delete:
 * the row's values). Cheap for everyone else: one lookup on the open-views index.
 */
CREATE OR REPLACE FUNCTION public.tg_pov_record_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  s public.admin_pov_sessions;
  j_new jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  j_old jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  j jsonb := coalesce(j_new, j_old);
  v_client text;
  v_user text;
  v_changes jsonb;
  meta constant text[] := ARRAY['id', 'created_at', 'updated_at', 'last_updated_at', 'client_id', 'user_id'];
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO s FROM public.admin_pov_sessions WHERE staff_user_id = v_uid AND ended_at IS NULL LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_client := CASE WHEN TG_TABLE_NAME = 'clients' THEN j ->> 'id' ELSE j ->> 'client_id' END;
  v_user := coalesce(j ->> 'user_id', j ->> 'author_user_id', j ->> 'owner_user_id', j ->> 'owner_id');
  IF NOT (v_client = s.client_id::text OR (s.target_user_id IS NOT NULL AND v_user = s.target_user_id::text)) THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    SELECT jsonb_object_agg(n.key, jsonb_build_object('from', public._pov_value(n.key, o.value), 'to', public._pov_value(n.key, n.value)))
      INTO v_changes
      FROM jsonb_each(j_new) n JOIN jsonb_each(j_old) o USING (key)
     WHERE n.value IS DISTINCT FROM o.value AND NOT (n.key = ANY (meta));
    IF v_changes IS NULL THEN RETURN NULL; END IF;
  ELSE
    SELECT jsonb_object_agg(x.key, public._pov_value(x.key, x.value))
      INTO v_changes
      FROM (SELECT key, value FROM jsonb_each(j) WHERE NOT (key = ANY (meta)) AND jsonb_typeof(value) <> 'null' LIMIT 25) x;
  END IF;
  INSERT INTO public.admin_pov_events (session_id, kind, detail)
  VALUES (s.id, 'change', jsonb_strip_nulls(jsonb_build_object(
    'table', TG_TABLE_NAME, 'op', lower(TG_OP), 'row', j ->> 'id',
    'mode', CASE WHEN s.mode = 'edit' AND s.edit_until > now() THEN 'edit' ELSE 'view' END,
    'changes', coalesce(v_changes, '{}'::jsonb))));
  RETURN NULL;
END $$;

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'clients', 'client_goals_setup', 'client_goals', 'client_health_items', 'client_lifestyle', 'athlete_competition_profiles',
    'athlete_equipment', 'athlete_exercise_setups', 'athlete_gyms', 'pl_row_results', 'pl_warmup_sets', 'pl_day_completions',
    'pl_workout_feedback', 'pl_exercise_notes', 'pl_scheduled_workouts', 'pl_client_maxes', 'pl_set_videos', 'pl_blocks',
    'pain_reports', 'cardio_completions', 'cardio_targets', 'messages', 'pt_sessions', 'pt_session_change_requests',
    'session_requests', 'nutrition_targets', 'nf_submissions', 'messenger_checkins', 'progress_metrics', 'progress_submissions',
    'progress_bodyweight', 'progress_water_entries', 'documents', 'competitions', 'member_support_threads',
    'community_posts', 'community_comments', 'athlete_programs'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS pov_record_change ON public.%I', t);
      EXECUTE format('CREATE TRIGGER pov_record_change AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.tg_pov_record_change()', t);
    END IF;
  END LOOP;
END $$;

/* ─────────────────────────── 6. Reading the record (admin only) ─────────────────────────── */

/** One account's access history: an admin only. */
CREATE OR REPLACE FUNCTION public.admin_pov_log(_client_id uuid, _limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  RETURN public.admin_access_log(_client_id => _client_id, _limit => _limit);
END $$;

/**
 * The access record, newest first: every account view (who, their role, whose account, when it
 * opened and closed, how long, how it ended, edits, changes, blocked writes) and every refused
 * attempt, filtered by staff member, account, dates, kind and a name search. Admin only.
 * _kind: all | sessions | edits | changes | blocked | denied | active | interrupted | expired | revoked.
 */
CREATE OR REPLACE FUNCTION public.admin_access_log(
  _staff_user_id uuid DEFAULT NULL, _client_id uuid DEFAULT NULL, _from timestamptz DEFAULT NULL, _to timestamptz DEFAULT NULL,
  _kind text DEFAULT 'all', _search text DEFAULT NULL, _limit integer DEFAULT 50, _offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_kind text := coalesce(nullif(_kind, ''), 'all');
  v_q text := nullif(btrim(coalesce(_search, '')), '');
  v_lim int := least(greatest(coalesce(_limit, 50), 1), 200);
  v_off int := greatest(coalesce(_offset, 0), 0);
  v_out jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  WITH people AS (
    SELECT u AS id, coalesce(
      (SELECT nullif(btrim(co.full_name), '') FROM public.coaches co WHERE co.user_id = u LIMIT 1),
      (SELECT nullif(btrim(p.full_name), '') FROM public.profiles p WHERE p.id = u),
      'Staff') AS name
    FROM (SELECT DISTINCT staff_user_id u FROM public.admin_pov_sessions
          UNION SELECT DISTINCT staff_user_id FROM public.admin_access_denials) x
  ),
  sess AS (
    SELECT s.*,
           (SELECT count(*) FROM public.admin_pov_events e WHERE e.session_id = s.id AND e.kind = 'view') AS views,
           (SELECT count(*) FROM public.admin_pov_events e WHERE e.session_id = s.id AND e.kind IN ('change', 'write')) AS changes,
           (SELECT count(*) FROM public.admin_pov_events e WHERE e.session_id = s.id AND e.kind = 'blocked') AS blocked,
           (SELECT count(*) FROM public.admin_pov_events e WHERE e.session_id = s.id AND e.kind = 'edit_on') AS edits_on,
           CASE
             WHEN s.ended_at IS NULL AND s.expires_at > now() AND s.max_until > now() THEN 'active'
             WHEN s.ended_at IS NULL THEN 'interrupted'
             WHEN s.end_reason IN ('expired') THEN 'expired'
             WHEN s.end_reason IN ('interrupted', 'closed') THEN 'interrupted'
             WHEN s.end_reason = 'revoked' THEN 'revoked'
             ELSE 'completed' END AS status
      FROM public.admin_pov_sessions s
     WHERE (_staff_user_id IS NULL OR s.staff_user_id = _staff_user_id)
       AND (_client_id IS NULL OR s.client_id = _client_id)
       AND (_from IS NULL OR s.started_at >= _from)
       AND (_to IS NULL OR s.started_at < _to)
  ),
  entries AS (
    SELECT s.started_at AS at, jsonb_build_object(
             'type', 'session', 'id', s.id, 'at', s.started_at,
             'staff_user_id', s.staff_user_id, 'staff_name', sp.name, 'staff_role', coalesce(s.staff_role, public._staff_role_word(s.staff_user_id)),
             'client_id', s.client_id, 'client_name', coalesce(nullif(btrim(c.full_name), ''), 'Deleted account'),
             'reason', s.reason, 'started_at', s.started_at, 'ended_at', s.ended_at, 'end_reason', s.end_reason,
             'last_seen_at', s.last_seen_at, 'status', s.status, 'mode', s.mode,
             'seconds', extract(epoch FROM (coalesce(s.ended_at, least(now(), s.expires_at)) - s.started_at))::int,
             'views', s.views, 'changes', s.changes, 'blocked', s.blocked, 'edited', s.edits_on > 0) AS j,
           sp.name AS staff_name, c.full_name AS client_name,
           s.status AS status, s.edits_on > 0 AS edited, s.changes > 0 AS changed, s.blocked > 0 AS was_blocked, false AS denied
      FROM sess s
      LEFT JOIN people sp ON sp.id = s.staff_user_id
      LEFT JOIN public.clients c ON c.id = s.client_id
    UNION ALL
    SELECT d.at, jsonb_build_object(
             'type', 'denied', 'id', d.id::text, 'at', d.at,
             'staff_user_id', d.staff_user_id, 'staff_name', sp.name, 'staff_role', d.staff_role,
             'client_id', d.client_id, 'client_name', coalesce(nullif(btrim(c.full_name), ''), CASE WHEN d.client_id IS NULL THEN 'Unknown account' ELSE 'Deleted account' END),
             'source', d.source, 'detail', d.detail, 'status', 'denied'),
           sp.name, c.full_name, 'denied', false, false, false, true
      FROM public.admin_access_denials d
      LEFT JOIN people sp ON sp.id = d.staff_user_id
      LEFT JOIN public.clients c ON c.id = d.client_id
     WHERE (_staff_user_id IS NULL OR d.staff_user_id = _staff_user_id)
       AND (_client_id IS NULL OR d.client_id = _client_id)
       AND (_from IS NULL OR d.at >= _from)
       AND (_to IS NULL OR d.at < _to)
  ),
  picked AS (
    SELECT * FROM entries r
     WHERE CASE v_kind
             WHEN 'sessions' THEN NOT r.denied
             WHEN 'edits' THEN r.edited
             WHEN 'changes' THEN r.changed
             WHEN 'blocked' THEN r.was_blocked
             WHEN 'denied' THEN r.denied
             WHEN 'active' THEN r.status = 'active'
             WHEN 'interrupted' THEN r.status = 'interrupted'
             WHEN 'expired' THEN r.status = 'expired'
             WHEN 'revoked' THEN r.status = 'revoked'
             ELSE true END
       AND (v_q IS NULL OR r.staff_name ILIKE '%' || v_q || '%' OR r.client_name ILIKE '%' || v_q || '%')
  )
  SELECT jsonb_build_object(
           'total', (SELECT count(*) FROM picked),
           'rows', coalesce((SELECT jsonb_agg(p.j ORDER BY p.at DESC) FROM (SELECT * FROM picked ORDER BY at DESC LIMIT v_lim OFFSET v_off) p), '[]'::jsonb),
           'staff', coalesce((SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name) ORDER BY name) FROM people), '[]'::jsonb))
    INTO v_out;
  RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION public.admin_access_log(uuid, uuid, timestamptz, timestamptz, text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_access_log(uuid, uuid, timestamptz, timestamptz, text, text, integer, integer) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_pov_log(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_pov_log(uuid, integer) TO authenticated;

/** Everything that happened in one view, in order: an admin only. */
CREATE OR REPLACE FUNCTION public.admin_access_session(_session uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('at', e.at, 'kind', e.kind, 'detail', e.detail) ORDER BY e.at, e.id)
      FROM (SELECT * FROM public.admin_pov_events WHERE session_id = _session ORDER BY at, id LIMIT 500) e), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.admin_access_session(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_access_session(uuid) TO authenticated;

/* ─────────────────────────── 7. The sweep ─────────────────────────── */

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'admin-pov-sweep';
    PERFORM cron.schedule('admin-pov-sweep', '3-59/5 * * * *', 'SELECT public.admin_pov_sweep()');
  END IF;
END $$;
