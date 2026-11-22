-- Cleo capability levels and recovery automation (Nov 22 2026).
--
-- 1. Capability levels. What Cleo may do for a person is decided here, by
--    their immutable account id, never a name, an email or a screen:
--      assist      every coach and admin, for their own clients: recovery
--                  analysis, message drafts on request, program suggestions.
--                  The coach does every action.
--      automation  a future paid tier, granted per account (plan, account,
--                  trial or promo) in cleo_entitlement_grants: drafts queued
--                  for approval, routine messages sent automatically, follow-
--                  ups. Nobody has a grant today; nothing here sells it.
--      owner       the business owner only (business_owners), never grantable:
--                  automated messages in the owner's private voice and
--                  examples, follow-ups timed to the athlete's training,
--                  automation oversight and capability management.
--    A grant can never hold an owner feature (a trigger refuses it), so no
--    purchase, plan or promo can reach the owner level. The owner holds every
--    level. `cleo_feature(key)` answers for the signed-in person (with their
--    two-step sign-in, caller_mfa_ok); `cleo_has_feature(uid, key)` is the
--    server's and the background job's.
--
-- 2. Recovery automation. When a coaching client reports pain in a workout
--    review, the client's coach (when their level allows it) gets a reply
--    drafted and, per their settings, kept as a draft (manual), queued for
--    approval, or sent automatically when the report is routine. Follow-ups
--    are planned before the next session that loads the area. Settings are per
--    coach and per category, with per-client overrides; the default is
--    approval, so nothing is ever sent automatically until the coach chooses
--    it. Every item is idempotent (dedupe_key), every step is audited
--    (coach_automation_events, append-only), and only the server writes items.
--    Weekly check-in pain stays in the check-in's own reply.
--
-- Rollback: docs/rollback/2026-11-22-recovery-automation-rollback.sql

SET lock_timeout = '3s';

-- ── 1. The capability catalog ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cleo_features (
  key text PRIMARY KEY CHECK (key ~ '^(assist|automation|owner)\.[a-z_]{2,40}$'),
  level text NOT NULL CHECK (level IN ('assist', 'automation', 'owner')),
  label text NOT NULL,
  description text NOT NULL,
  sort smallint NOT NULL DEFAULT 0,
  CHECK (split_part(key, '.', 1) = level)
);

INSERT INTO public.cleo_features (key, level, label, description, sort) VALUES
  ('assist.recovery_analysis', 'assist', 'Recovery reports', 'Structured pain reports, their history, trends, warning signs and what to consider.', 10),
  ('assist.message_drafts', 'assist', 'Message drafts', 'A reply drafted on request for the coach to edit and send.', 20),
  ('assist.program_suggestions', 'assist', 'Program suggestions', 'Proposed changes to a program, reviewed and applied by the coach.', 30),
  ('automation.approval_queue', 'automation', 'Approval queue', 'Replies drafted as reports come in, waiting for the coach''s approval.', 40),
  ('automation.auto_send', 'automation', 'Automatic routine messages', 'Routine, low-risk replies sent automatically under the coach''s rules.', 50),
  ('automation.follow_ups', 'automation', 'Follow-ups', 'A short follow-up a few days after a report.', 60),
  ('owner.voice', 'owner', 'Private voice', 'Automated messages written in the owner''s own voice and approved examples.', 70),
  ('owner.training_aware', 'owner', 'Training-aware follow-ups', 'Follow-ups timed before the athlete''s next session that loads the area, with their program read in.', 80),
  ('owner.controls', 'owner', 'Automation oversight', 'Capability management, audit history, pause and rollback controls.', 90)
ON CONFLICT (key) DO UPDATE SET level = EXCLUDED.level, label = EXCLUDED.label, description = EXCLUDED.description, sort = EXCLUDED.sort;

ALTER TABLE public.cleo_features ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff read the capability catalog" ON public.cleo_features;
CREATE POLICY "Staff read the capability catalog" ON public.cleo_features FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)) OR (SELECT public.has_role((SELECT auth.uid()), 'coach'::public.app_role)));
REVOKE ALL ON public.cleo_features FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.cleo_features FROM authenticated;
GRANT SELECT ON public.cleo_features TO authenticated;
GRANT ALL ON public.cleo_features TO service_role;

-- ── 2. Grants (future plans, single accounts, trials, promotions) ───────────
CREATE TABLE IF NOT EXISTS public.cleo_entitlement_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  feature_key text NOT NULL REFERENCES public.cleo_features(key),
  source text NOT NULL CHECK (source IN ('plan', 'account', 'trial', 'promo')),
  plan_key text CHECK (plan_key IS NULL OR plan_key ~ '^[a-z0-9_]{2,40}$'),
  starts_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  granted_by uuid,
  note text CHECK (char_length(note) <= 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at IS NULL OR expires_at > starts_at)
);
CREATE INDEX IF NOT EXISTS cleo_entitlement_grants_user ON public.cleo_entitlement_grants (user_id) WHERE revoked_at IS NULL;

-- An owner capability is never a grant, whoever writes it (the server included).
CREATE OR REPLACE FUNCTION public.tg_cleo_grant_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF split_part(NEW.feature_key, '.', 1) = 'owner' THEN
    RAISE EXCEPTION 'Owner capabilities can''t be granted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.feature_key IS DISTINCT FROM OLD.feature_key) THEN
    RAISE EXCEPTION 'A grant''s person and capability never change; revoke it and grant again' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS cleo_grant_guard ON public.cleo_entitlement_grants;
CREATE TRIGGER cleo_grant_guard BEFORE INSERT OR UPDATE ON public.cleo_entitlement_grants
  FOR EACH ROW EXECUTE FUNCTION public.tg_cleo_grant_guard();

ALTER TABLE public.cleo_entitlement_grants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "People read their own grants" ON public.cleo_entitlement_grants;
CREATE POLICY "People read their own grants" ON public.cleo_entitlement_grants FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
REVOKE ALL ON public.cleo_entitlement_grants FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.cleo_entitlement_grants FROM authenticated;
GRANT SELECT ON public.cleo_entitlement_grants TO authenticated;
GRANT ALL ON public.cleo_entitlement_grants TO service_role;

-- ── 3. Who has what ─────────────────────────────────────────────────────────
-- The server's and the job's: any person, no session involved.
CREATE OR REPLACE FUNCTION public.cleo_has_feature(_uid uuid, _key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH f AS (SELECT level FROM public.cleo_features WHERE key = _key),
  who AS (
    SELECT
      _uid IS NOT NULL AND EXISTS (SELECT 1 FROM public.business_owners b WHERE b.user_id = _uid) AS owner,
      _uid IS NOT NULL AND (
        EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _uid AND r.role = 'admin'::public.app_role)
        OR EXISTS (
          SELECT 1 FROM public.user_roles r
            JOIN public.coaches co ON co.user_id = r.user_id
           WHERE r.user_id = _uid AND r.role = 'coach'::public.app_role
             AND co.status = 'Active' AND NOT coalesce(co.archived, false)
        )
      ) AS staff
  )
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM f) THEN false
    WHEN (SELECT owner FROM who) THEN true
    WHEN (SELECT level FROM f) = 'owner' THEN false
    WHEN NOT (SELECT staff FROM who) THEN false
    WHEN (SELECT level FROM f) = 'assist' THEN true
    ELSE EXISTS (
      SELECT 1 FROM public.cleo_entitlement_grants g
       WHERE g.user_id = _uid AND g.feature_key = _key AND g.revoked_at IS NULL
         AND g.starts_at <= now() AND (g.expires_at IS NULL OR g.expires_at > now())
    )
  END
$$;
REVOKE ALL ON FUNCTION public.cleo_has_feature(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleo_has_feature(uuid, text) TO service_role;

-- The signed-in person's, with their two-step sign-in.
CREATE OR REPLACE FUNCTION public.cleo_feature(_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT auth.uid() IS NOT NULL
     AND public.cleo_has_feature(auth.uid(), _key)
     AND public.caller_mfa_ok(auth.uid())
$$;
REVOKE ALL ON FUNCTION public.cleo_feature(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cleo_feature(text) TO authenticated, service_role;

-- Every capability the signed-in person has, and their level (for screens; the server checks again).
CREATE OR REPLACE FUNCTION public.cleo_my_capabilities()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH mine AS (
    SELECT f.key, f.level FROM public.cleo_features f
     WHERE auth.uid() IS NOT NULL AND public.caller_mfa_ok(auth.uid()) AND public.cleo_has_feature(auth.uid(), f.key)
  )
  SELECT jsonb_build_object(
    'level', CASE
      WHEN EXISTS (SELECT 1 FROM mine WHERE level = 'owner') THEN 'owner'
      WHEN EXISTS (SELECT 1 FROM mine WHERE level = 'automation') THEN 'automation'
      WHEN EXISTS (SELECT 1 FROM mine WHERE level = 'assist') THEN 'assist'
      ELSE 'none' END,
    'features', coalesce((SELECT jsonb_agg(key ORDER BY key) FROM mine), '[]'::jsonb)
  )
$$;
REVOKE ALL ON FUNCTION public.cleo_my_capabilities() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cleo_my_capabilities() TO authenticated, service_role;

-- The owner's overview: the catalog, every grant, every coach's level.
CREATE OR REPLACE FUNCTION public.cleo_capability_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.cleo_feature('owner.controls') THEN
    RAISE EXCEPTION 'Only the owner manages capabilities' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'features', (SELECT jsonb_agg(jsonb_build_object('key', key, 'level', level, 'label', label, 'description', description) ORDER BY sort) FROM public.cleo_features),
    'grants', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', g.id, 'user_id', g.user_id, 'name', coalesce(co.full_name, p.full_name, 'Someone'), 'feature_key', g.feature_key,
        'source', g.source, 'plan_key', g.plan_key, 'starts_at', g.starts_at, 'expires_at', g.expires_at, 'revoked_at', g.revoked_at
      ) ORDER BY g.created_at DESC)
      FROM public.cleo_entitlement_grants g
      LEFT JOIN public.coaches co ON co.user_id = g.user_id
      LEFT JOIN public.profiles p ON p.id = g.user_id
    ), '[]'::jsonb),
    'coaches', coalesce((
      SELECT jsonb_agg(jsonb_build_object('user_id', co.user_id, 'name', co.full_name,
        'automation', EXISTS (SELECT 1 FROM public.cleo_features f WHERE f.level = 'automation' AND public.cleo_has_feature(co.user_id, f.key))
      ) ORDER BY co.full_name)
      FROM public.coaches co
      WHERE co.user_id IS NOT NULL AND co.status = 'Active' AND NOT coalesce(co.archived, false)
        AND NOT EXISTS (SELECT 1 FROM public.business_owners b WHERE b.user_id = co.user_id)
    ), '[]'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.cleo_capability_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cleo_capability_overview() TO authenticated, service_role;

-- Grants: the owner's only, never an owner capability (the trigger), only to a coach or admin.
CREATE OR REPLACE FUNCTION public.cleo_entitlement_grant(_user uuid, _key text, _source text, _expires_at timestamptz DEFAULT NULL, _note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.cleo_feature('owner.controls') THEN
    RAISE EXCEPTION 'Only the owner manages capabilities' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user AND role IN ('admin'::public.app_role, 'coach'::public.app_role)) THEN
    RAISE EXCEPTION 'Capabilities go to coaches only' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.cleo_entitlement_grants (user_id, feature_key, source, expires_at, note, granted_by)
  VALUES (_user, _key, _source, _expires_at, left(_note, 300), auth.uid())
  RETURNING id INTO v_id;
  INSERT INTO public.coach_automation_events (coach_user_id, kind, actor, detail)
  VALUES (_user, 'capability_granted', auth.uid(), jsonb_build_object('feature', _key, 'source', _source, 'expires_at', _expires_at, 'grant_id', v_id));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cleo_entitlement_revoke(_grant uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE g public.cleo_entitlement_grants;
BEGIN
  IF NOT public.cleo_feature('owner.controls') THEN
    RAISE EXCEPTION 'Only the owner manages capabilities' USING ERRCODE = '42501';
  END IF;
  UPDATE public.cleo_entitlement_grants SET revoked_at = now() WHERE id = _grant AND revoked_at IS NULL RETURNING * INTO g;
  IF g.id IS NOT NULL THEN
    INSERT INTO public.coach_automation_events (coach_user_id, kind, actor, detail)
    VALUES (g.user_id, 'capability_revoked', auth.uid(), jsonb_build_object('feature', g.feature_key, 'grant_id', g.id));
  END IF;
END;
$$;

-- ── 4. Automation settings ──────────────────────────────────────────────────
-- Categories: recovery_reply (a reply to a pain report) and recovery_follow_up.
-- Modes: off · manual (a draft waits in their pain sheet) · approval (queued
-- for one-tap approval) · automatic (routine ones sent; the rest still wait).
CREATE OR REPLACE FUNCTION public.coach_automation_modes_valid(_modes jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_typeof(_modes) = 'object'
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_each(_modes) e
        WHERE e.key NOT IN ('recovery_reply', 'recovery_follow_up')
           OR jsonb_typeof(e.value) <> 'string'
           OR (e.value #>> '{}') NOT IN ('off', 'manual', 'approval', 'automatic')
     )
$$;

CREATE TABLE IF NOT EXISTS public.coach_automation_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  paused boolean NOT NULL DEFAULT false,
  modes jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (public.coach_automation_modes_valid(modes)),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

CREATE TABLE IF NOT EXISTS public.coach_automation_client_rules (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('recovery_reply', 'recovery_follow_up')),
  mode text NOT NULL CHECK (mode IN ('off', 'manual', 'approval', 'automatic')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, client_id, category)
);

ALTER TABLE public.coach_automation_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_automation_client_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Coaches read their own automation settings" ON public.coach_automation_settings;
CREATE POLICY "Coaches read their own automation settings" ON public.coach_automation_settings FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "Coaches read their own client rules" ON public.coach_automation_client_rules;
CREATE POLICY "Coaches read their own client rules" ON public.coach_automation_client_rules FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
REVOKE ALL ON public.coach_automation_settings, public.coach_automation_client_rules FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.coach_automation_settings, public.coach_automation_client_rules FROM authenticated;
GRANT SELECT ON public.coach_automation_settings, public.coach_automation_client_rules TO authenticated;
GRANT ALL ON public.coach_automation_settings, public.coach_automation_client_rules TO service_role;

-- What a mode needs.
CREATE OR REPLACE FUNCTION public.coach_automation_mode_allowed(_uid uuid, _category text, _mode text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN _mode = 'off' THEN true
    WHEN NOT public.cleo_has_feature(_uid, 'automation.approval_queue') THEN false
    WHEN _category = 'recovery_follow_up' AND NOT public.cleo_has_feature(_uid, 'automation.follow_ups') THEN false
    WHEN _mode = 'automatic' THEN public.cleo_has_feature(_uid, 'automation.auto_send')
    ELSE true
  END
$$;
REVOKE ALL ON FUNCTION public.coach_automation_mode_allowed(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.coach_automation_mode_allowed(uuid, text, text) TO service_role;

-- The mode that applies to one client: their rule, else the coach's setting,
-- else approval; whatever their level no longer allows steps down (automatic →
-- approval → off). Paused = off.
CREATE OR REPLACE FUNCTION public.coach_automation_mode_for(_uid uuid, _client uuid, _category text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_mode text;
  v_rule text;
  v_paused boolean;
BEGIN
  SELECT s.paused, s.modes ->> _category INTO v_paused, v_mode FROM public.coach_automation_settings s WHERE s.user_id = _uid;
  IF coalesce(v_paused, false) THEN RETURN 'off'; END IF;
  SELECT r.mode INTO v_rule FROM public.coach_automation_client_rules r
   WHERE r.user_id = _uid AND r.client_id = _client AND r.category = _category;
  v_mode := coalesce(v_rule, v_mode, 'approval');
  IF v_mode = 'automatic' AND NOT public.coach_automation_mode_allowed(_uid, _category, 'automatic') THEN v_mode := 'approval'; END IF;
  IF v_mode <> 'off' AND NOT public.coach_automation_mode_allowed(_uid, _category, v_mode) THEN v_mode := 'off'; END IF;
  RETURN v_mode;
END;
$$;
REVOKE ALL ON FUNCTION public.coach_automation_mode_for(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.coach_automation_mode_for(uuid, uuid, text) TO service_role;

-- ── 5. The queue and its record ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.coach_automation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('recovery_reply', 'recovery_follow_up')),
  -- once per thing: a review's reply, a follow-up to a reply
  dedupe_key text NOT NULL UNIQUE CHECK (char_length(dedupe_key) <= 200),
  source_kind text NOT NULL CHECK (source_kind IN ('review', 'follow_up')),
  source_id uuid,
  parent_id uuid REFERENCES public.coach_automation_items(id) ON DELETE SET NULL,
  regions text[] NOT NULL DEFAULT '{}',
  -- sending: taken for one send (the worker's or an approval's), so nothing else can touch it
  status text NOT NULL DEFAULT 'queued' CHECK (status IN (
    'queued', 'working', 'sending', 'draft', 'awaiting_approval', 'sent', 'dismissed', 'cancelled', 'failed')),
  mode text CHECK (mode IN ('manual', 'approval', 'automatic')),
  risk text CHECK (risk IN ('routine', 'review', 'urgent')),
  risk_reasons text[] NOT NULL DEFAULT '{}',
  due_at timestamptz NOT NULL DEFAULT now(),
  attempts smallint NOT NULL DEFAULT 0,
  locked_at timestamptz,
  draft text CHECK (char_length(draft) <= 2000),
  insights jsonb,
  context jsonb,
  why text CHECK (char_length(why) <= 400),
  model text,
  message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  decided_by uuid,
  decided_at timestamptz,
  sent_at timestamptz,
  error text CHECK (char_length(error) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS coach_automation_items_due ON public.coach_automation_items (due_at) WHERE status IN ('queued', 'working', 'sending', 'failed');
CREATE INDEX IF NOT EXISTS coach_automation_items_coach ON public.coach_automation_items (coach_user_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS coach_automation_items_client ON public.coach_automation_items (client_id, created_at DESC);

ALTER TABLE public.coach_automation_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Coaches read their own automation items" ON public.coach_automation_items;
CREATE POLICY "Coaches read their own automation items" ON public.coach_automation_items FOR SELECT TO authenticated
  USING (coach_user_id = (SELECT auth.uid()) AND (SELECT public.cleo_feature('automation.approval_queue')));
REVOKE ALL ON public.coach_automation_items FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.coach_automation_items FROM authenticated;
GRANT SELECT ON public.coach_automation_items TO authenticated;
GRANT ALL ON public.coach_automation_items TO service_role;

-- Append-only: who did what, when (no foreign keys, so it outlives what it's about).
CREATE TABLE IF NOT EXISTS public.coach_automation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid,
  coach_user_id uuid,
  client_id uuid,
  kind text NOT NULL CHECK (kind IN (
    'queued', 'drafted', 'awaiting_approval', 'escalated', 'approved', 'edited', 'sent', 'dismissed', 'cancelled', 'failed',
    'unsent', 'follow_up_planned', 'settings_changed', 'client_rule_changed', 'capability_granted', 'capability_revoked')),
  actor uuid,
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS coach_automation_events_coach ON public.coach_automation_events (coach_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS coach_automation_events_item ON public.coach_automation_events (item_id, created_at);

CREATE OR REPLACE FUNCTION public.tg_coach_automation_events_keep()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF current_setting('jf.allow_history_delete', true) = 'on' AND TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'The automation record is never changed' USING ERRCODE = '42501';
END;
$$;
DROP TRIGGER IF EXISTS coach_automation_events_keep ON public.coach_automation_events;
CREATE TRIGGER coach_automation_events_keep BEFORE UPDATE OR DELETE ON public.coach_automation_events
  FOR EACH ROW EXECUTE FUNCTION public.tg_coach_automation_events_keep();

ALTER TABLE public.coach_automation_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Coaches read their own automation record" ON public.coach_automation_events;
CREATE POLICY "Coaches read their own automation record" ON public.coach_automation_events FOR SELECT TO authenticated
  USING (coach_user_id = (SELECT auth.uid()) AND (SELECT public.cleo_feature('automation.approval_queue')));
REVOKE ALL ON public.coach_automation_events FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.coach_automation_events FROM authenticated;
GRANT SELECT ON public.coach_automation_events TO authenticated;
GRANT INSERT, SELECT ON public.coach_automation_events TO service_role;

-- ── 6. Settings writes (the coach's own, within their level) ────────────────
CREATE OR REPLACE FUNCTION public.coach_automation_settings_set(_paused boolean, _modes jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  e record;
BEGIN
  IF v_uid IS NULL OR NOT public.cleo_feature('automation.approval_queue') THEN
    RAISE EXCEPTION 'Automation isn''t part of your plan' USING ERRCODE = '42501';
  END IF;
  IF _modes IS NULL OR NOT public.coach_automation_modes_valid(_modes) THEN
    RAISE EXCEPTION 'Unknown automation setting' USING ERRCODE = '22023';
  END IF;
  FOR e IN SELECT key, value #>> '{}' AS mode FROM jsonb_each(_modes) LOOP
    IF NOT public.coach_automation_mode_allowed(v_uid, e.key, e.mode) THEN
      RAISE EXCEPTION 'That setting isn''t part of your plan' USING ERRCODE = '42501';
    END IF;
  END LOOP;
  INSERT INTO public.coach_automation_settings (user_id, paused, modes, updated_at, updated_by)
  VALUES (v_uid, coalesce(_paused, false), _modes, now(), v_uid)
  ON CONFLICT (user_id) DO UPDATE SET paused = EXCLUDED.paused, modes = EXCLUDED.modes, updated_at = now(), updated_by = v_uid;
  INSERT INTO public.coach_automation_events (coach_user_id, kind, actor, detail)
  VALUES (v_uid, 'settings_changed', v_uid, jsonb_build_object('paused', coalesce(_paused, false), 'modes', _modes));
  RETURN jsonb_build_object('paused', coalesce(_paused, false), 'modes', _modes);
END;
$$;
REVOKE ALL ON FUNCTION public.coach_automation_settings_set(boolean, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coach_automation_settings_set(boolean, jsonb) TO authenticated, service_role;

-- A client's own rule (null mode = back to the coach's setting); only for the coach's own clients.
CREATE OR REPLACE FUNCTION public.coach_automation_client_rule_set(_client uuid, _category text, _mode text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT public.cleo_feature('automation.approval_queue') THEN
    RAISE EXCEPTION 'Automation isn''t part of your plan' USING ERRCODE = '42501';
  END IF;
  IF _category NOT IN ('recovery_reply', 'recovery_follow_up') THEN
    RAISE EXCEPTION 'Unknown automation setting' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.clients c JOIN public.coaches co ON co.id = c.assigned_coach_id
     WHERE c.id = _client AND co.user_id = v_uid AND co.status = 'Active' AND NOT coalesce(co.archived, false)
  ) THEN
    RAISE EXCEPTION 'Not your client' USING ERRCODE = '42501';
  END IF;
  IF _mode IS NULL THEN
    DELETE FROM public.coach_automation_client_rules WHERE user_id = v_uid AND client_id = _client AND category = _category;
  ELSE
    IF _mode NOT IN ('off', 'manual', 'approval', 'automatic') OR NOT public.coach_automation_mode_allowed(v_uid, _category, _mode) THEN
      RAISE EXCEPTION 'That setting isn''t part of your plan' USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.coach_automation_client_rules (user_id, client_id, category, mode, updated_at)
    VALUES (v_uid, _client, _category, _mode, now())
    ON CONFLICT (user_id, client_id, category) DO UPDATE SET mode = EXCLUDED.mode, updated_at = now();
  END IF;
  INSERT INTO public.coach_automation_events (coach_user_id, client_id, kind, actor, detail)
  VALUES (v_uid, _client, 'client_rule_changed', v_uid, jsonb_build_object('category', _category, 'mode', _mode));
END;
$$;
REVOKE ALL ON FUNCTION public.coach_automation_client_rule_set(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coach_automation_client_rule_set(uuid, text, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.cleo_entitlement_grant(uuid, text, text, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cleo_entitlement_grant(uuid, text, text, timestamptz, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.cleo_entitlement_revoke(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cleo_entitlement_revoke(uuid) TO authenticated, service_role;

-- ── 7. A pain report from a workout review queues its reply ─────────────────
-- Only for a coaching client whose coach's level and settings want it; two
-- minutes of quiet first (an athlete fixing their review moves it along), and
-- one reply per review whatever they edit later (their card shows it live).
CREATE OR REPLACE FUNCTION public.tg_pain_reports_queue_reply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_coach uuid;
  v_mode text;
BEGIN
  IF NEW.source <> 'review' OR NEW.feedback_id IS NULL THEN RETURN NEW; END IF;
  -- only a report made in the last day: saving or tidying an old review (or a link to it
  -- clearing) never queues a reply about pain from weeks ago
  IF NEW.reported_at < now() - interval '1 day' THEN RETURN NEW; END IF;
  SELECT co.user_id INTO v_coach
    FROM public.clients c JOIN public.coaches co ON co.id = c.assigned_coach_id
   WHERE c.id = NEW.client_id AND c.service_tier = 'coaching' AND NOT coalesce(c.archived, false)
     AND co.status = 'Active' AND NOT coalesce(co.archived, false);
  IF v_coach IS NULL THEN RETURN NEW; END IF;
  v_mode := public.coach_automation_mode_for(v_coach, NEW.client_id, 'recovery_reply');
  IF v_mode = 'off' THEN RETURN NEW; END IF;
  INSERT INTO public.coach_automation_items (coach_user_id, client_id, category, dedupe_key, source_kind, source_id, regions, status, due_at)
  VALUES (v_coach, NEW.client_id, 'recovery_reply', 'recovery_reply:review:' || NEW.feedback_id, 'review', NEW.feedback_id,
          ARRAY[NEW.region], 'queued', now() + interval '2 minutes')
  ON CONFLICT (dedupe_key) DO UPDATE
    SET due_at = greatest(coach_automation_items.due_at, now() + interval '2 minutes'),
        regions = (SELECT array_agg(DISTINCT r) FROM unnest(coach_automation_items.regions || EXCLUDED.regions) r),
        updated_at = now()
    WHERE coach_automation_items.status = 'queued';
  RETURN NEW;
EXCEPTION WHEN others THEN
  -- never fail the athlete's review because of automation
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_pain_reports_queue_reply() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS pain_reports_queue_reply ON public.pain_reports;
CREATE TRIGGER pain_reports_queue_reply AFTER INSERT OR UPDATE ON public.pain_reports
  FOR EACH ROW EXECUTE FUNCTION public.tg_pain_reports_queue_reply();

-- The worker claims one item at a time (no double sends across overlapping runs).
-- An item a run was cut off in (working or sending for 10 minutes) is tried again,
-- three tries in all; after that it's failed, never retried forever.
CREATE OR REPLACE FUNCTION public.coach_automation_claim(_id uuid DEFAULT NULL)
RETURNS SETOF public.coach_automation_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.coach_automation_items
     SET status = 'failed', error = 'Stopped after three tries', locked_at = NULL, updated_at = now()
   WHERE status IN ('working', 'sending') AND locked_at < now() - interval '10 minutes' AND attempts >= 3;
  RETURN QUERY
  UPDATE public.coach_automation_items i
     SET status = 'working', locked_at = clock_timestamp(), attempts = i.attempts + 1, updated_at = now()
   WHERE i.id = (
     SELECT x.id FROM public.coach_automation_items x
      WHERE (_id IS NULL OR x.id = _id)
        AND x.due_at <= now()
        AND (x.status = 'queued'
          OR (x.status IN ('working', 'sending') AND x.locked_at < now() - interval '10 minutes' AND x.attempts < 3)
          OR (x.status = 'failed' AND x.attempts < 3 AND x.updated_at < now() - interval '10 minutes'))
      ORDER BY x.due_at
      LIMIT 1
      FOR UPDATE SKIP LOCKED
   )
  RETURNING i.*;
END;
$$;
REVOKE ALL ON FUNCTION public.coach_automation_claim(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.coach_automation_claim(uuid) TO service_role;

-- ── 8. The worker runs every minute while something is due ─────────────────
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'coach-automation-tick';
  PERFORM cron.schedule(
    'coach-automation-tick',
    '* * * * *',
    $cmd$
    SELECT net.http_post(
      url := 'https://project--5f1f340c-5afa-4262-90c8-1f9406568c6c.lovable.app/api/public/hooks/coach-automation-tick',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-hook-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_hook_secret' LIMIT 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    ) AS request_id
    WHERE EXISTS (
      SELECT 1 FROM public.coach_automation_items
       WHERE due_at <= now()
         AND (status = 'queued'
           OR (status IN ('working', 'sending') AND locked_at < now() - interval '10 minutes')
           OR (status = 'failed' AND attempts < 3 AND updated_at < now() - interval '10 minutes'))
    );
    $cmd$
  );
EXCEPTION
  WHEN undefined_table OR undefined_function OR invalid_schema_name THEN
    NULL;
END
$$;
