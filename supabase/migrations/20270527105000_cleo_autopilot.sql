-- Cleo Autopilot (Nov 25 2026): one weekly assessment per coaching client,
-- composed from the reads that already exist (weight management's decide(),
-- cardio's recovery read, the coordinated check-in recommendation, the
-- program and pain reads), stored as versioned change records, with
-- proposals landing as real drafts in the existing builders (Edit with AI,
-- the cardio draft, Change it with AI on the nutrition plan) and the coach's
-- autonomy settings deciding what, if anything, may publish by itself.
--
-- Safe by default: every client and domain is Draft Only and in shadow mode
-- until the coach changes it, and nothing publishes for a client whose
-- autopilot (or the global one) is paused.
--
--   * autopilot_settings        global row + per-client rows: mode per domain, locks,
--                               permitted ranges, pause, shadow
--   * autopilot_decisions       one versioned change record per assessment (never
--                               deleted; a new assessment supersedes the open one)
--   * autopilot_reply_versions  the check-in reply's wordings (Re-create keeps every
--                               unsent one; a sent one is never rewritten)
--
-- All three are written only by the server (service role) after a staff check
-- through the caller's own login; staff read their own clients' rows. Clients
-- never see any of it: they see only what is published (their plan and one
-- system card in their coach chat).

CREATE TABLE IF NOT EXISTS public.autopilot_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('global', 'client')),
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  -- null on a client row = inherit the global row
  mode_training text CHECK (mode_training IS NULL OR mode_training IN ('draft', 'smart', 'advanced')),
  mode_nutrition text CHECK (mode_nutrition IS NULL OR mode_nutrition IN ('draft', 'smart', 'advanced')),
  mode_cardio text CHECK (mode_cardio IS NULL OR mode_cardio IN ('draft', 'smart', 'advanced')),
  locked_domains text[] NOT NULL DEFAULT '{}',
  -- permitted ranges for a change that may publish by itself: {"nutrition_kcal": 100, "cardio_minutes": 15}
  ranges jsonb NOT NULL DEFAULT '{}'::jsonb,
  paused boolean NOT NULL DEFAULT false,
  paused_until date,
  shadow boolean,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT autopilot_settings_scope_client CHECK ((scope = 'global') = (client_id IS NULL)),
  CONSTRAINT autopilot_settings_domains CHECK (locked_domains <@ ARRAY['training', 'nutrition', 'cardio']::text[])
);
CREATE UNIQUE INDEX IF NOT EXISTS autopilot_settings_global_one ON public.autopilot_settings ((true)) WHERE scope = 'global';
CREATE UNIQUE INDEX IF NOT EXISTS autopilot_settings_client_one ON public.autopilot_settings (client_id) WHERE scope = 'client';

-- the global row, Draft Only and shadow for everyone
INSERT INTO public.autopilot_settings (scope, mode_training, mode_nutrition, mode_cardio, shadow)
SELECT 'global', 'draft', 'draft', 'draft', true
WHERE NOT EXISTS (SELECT 1 FROM public.autopilot_settings WHERE scope = 'global');

CREATE TABLE IF NOT EXISTS public.autopilot_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  version integer NOT NULL,
  supersedes_id uuid REFERENCES public.autopilot_decisions(id) ON DELETE SET NULL,
  trigger text NOT NULL CHECK (trigger IN ('checkin', 'scheduled', 'manual')),
  checkin_id uuid,
  recommendation_id uuid,
  week_of date NOT NULL,
  category text NOT NULL CHECK (category IN ('maintain', 'optimize', 'accelerate', 'extend', 'intervene', 'investigate')),
  headline text NOT NULL,
  rationale text NOT NULL DEFAULT '',
  expected_outcome text,
  reassess_on date,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  protected jsonb NOT NULL DEFAULT '[]'::jsonb,
  missing jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- per domain: the decision, how autonomy routed it, the draft it became, before / after, publish state
  domains jsonb NOT NULL DEFAULT '{}'::jsonb,
  bucket text NOT NULL CHECK (bucket IN ('requires_attention', 'awaiting_approval', 'auto_updated', 'missing_info', 'on_track')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'approved', 'publishing', 'published', 'rejected', 'deferred', 'rolled_back', 'superseded', 'failed')),
  shadow boolean NOT NULL DEFAULT true,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  input_hash text NOT NULL,
  deferred_until date,
  publish_after timestamptz,
  published_at timestamptz,
  message_id uuid,
  outcome jsonb,
  outcome_checked_at timestamptz,
  cost jsonb NOT NULL DEFAULT '{"calls": 0, "input_tokens": 0, "output_tokens": 0}'::jsonb,
  coach_note text,
  decided_by uuid,
  decided_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT autopilot_decisions_version UNIQUE (client_id, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS autopilot_decisions_checkin_one ON public.autopilot_decisions (checkin_id) WHERE checkin_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS autopilot_decisions_client_idx ON public.autopilot_decisions (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS autopilot_decisions_open_idx ON public.autopilot_decisions (bucket, created_at DESC) WHERE status IN ('open', 'approved', 'publishing', 'deferred');
CREATE INDEX IF NOT EXISTS autopilot_decisions_outcome_idx ON public.autopilot_decisions (reassess_on) WHERE outcome IS NULL;

-- a change record is never rewritten: what was decided, from what, stays as it was
CREATE OR REPLACE FUNCTION public.tg_autopilot_decisions_keep()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.client_id IS DISTINCT FROM OLD.client_id
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.category IS DISTINCT FROM OLD.category
     OR NEW.headline IS DISTINCT FROM OLD.headline
     OR NEW.rationale IS DISTINCT FROM OLD.rationale
     OR NEW.evidence IS DISTINCT FROM OLD.evidence
     OR NEW.input_hash IS DISTINCT FROM OLD.input_hash
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'An autopilot decision record is never rewritten; record a new version instead';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS autopilot_decisions_keep ON public.autopilot_decisions;
CREATE TRIGGER autopilot_decisions_keep BEFORE UPDATE ON public.autopilot_decisions
  FOR EACH ROW EXECUTE FUNCTION public.tg_autopilot_decisions_keep();

CREATE TABLE IF NOT EXISTS public.autopilot_reply_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  checkin_id uuid NOT NULL,
  decision_id uuid REFERENCES public.autopilot_decisions(id) ON DELETE SET NULL,
  version_no integer NOT NULL,
  style text NOT NULL DEFAULT 'initial' CHECK (style IN ('initial', 'shorter', 'like_me', 'direct', 'supportive', 'custom', 'redo')),
  custom_note text,
  body text NOT NULL,
  words integer NOT NULL DEFAULT 0,
  model text,
  input_tokens integer,
  output_tokens integer,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'discarded')),
  sent_message_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT autopilot_reply_versions_no UNIQUE (checkin_id, version_no)
);
CREATE INDEX IF NOT EXISTS autopilot_reply_versions_checkin_idx ON public.autopilot_reply_versions (checkin_id, version_no DESC);

-- sent history is never altered
CREATE OR REPLACE FUNCTION public.tg_autopilot_reply_versions_keep_sent()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.status = 'sent' AND (NEW.body IS DISTINCT FROM OLD.body OR NEW.status IS DISTINCT FROM OLD.status OR NEW.sent_message_id IS DISTINCT FROM OLD.sent_message_id) THEN
    RAISE EXCEPTION 'A sent reply is never rewritten';
  END IF;
  IF NEW.body IS DISTINCT FROM OLD.body THEN
    RAISE EXCEPTION 'A reply version is never rewritten; Re-create adds a new one';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS autopilot_reply_versions_keep_sent ON public.autopilot_reply_versions;
CREATE TRIGGER autopilot_reply_versions_keep_sent BEFORE UPDATE ON public.autopilot_reply_versions
  FOR EACH ROW EXECUTE FUNCTION public.tg_autopilot_reply_versions_keep_sent();

CREATE OR REPLACE FUNCTION public.tg_autopilot_no_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  -- a client being deleted takes their records with them (the cascade); nothing else deletes one
  IF EXISTS (SELECT 1 FROM public.clients WHERE id = OLD.client_id) THEN
    RAISE EXCEPTION 'Autopilot records are kept';
  END IF;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS autopilot_decisions_no_delete ON public.autopilot_decisions;
CREATE TRIGGER autopilot_decisions_no_delete BEFORE DELETE ON public.autopilot_decisions
  FOR EACH ROW EXECUTE FUNCTION public.tg_autopilot_no_delete();
DROP TRIGGER IF EXISTS autopilot_reply_versions_no_delete ON public.autopilot_reply_versions;
CREATE TRIGGER autopilot_reply_versions_no_delete BEFORE DELETE ON public.autopilot_reply_versions
  FOR EACH ROW EXECUTE FUNCTION public.tg_autopilot_no_delete();

-- Who reads them: staff for the clients they coach (the global settings row: any staff); nobody writes but the server.
ALTER TABLE public.autopilot_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.autopilot_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.autopilot_reply_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff read autopilot settings" ON public.autopilot_settings;
CREATE POLICY "Staff read autopilot settings" ON public.autopilot_settings
  FOR SELECT TO authenticated
  USING (
    (SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role))
    OR (scope = 'global' AND (SELECT public.has_role((SELECT auth.uid()), 'coach'::app_role)))
    OR client_id IN (SELECT public.coached_client_ids())
  );

DROP POLICY IF EXISTS "Staff read autopilot decisions" ON public.autopilot_decisions;
CREATE POLICY "Staff read autopilot decisions" ON public.autopilot_decisions
  FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)) OR client_id IN (SELECT public.coached_client_ids()));

DROP POLICY IF EXISTS "Staff read autopilot reply versions" ON public.autopilot_reply_versions;
CREATE POLICY "Staff read autopilot reply versions" ON public.autopilot_reply_versions
  FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)) OR client_id IN (SELECT public.coached_client_ids()));

REVOKE INSERT, UPDATE, DELETE ON public.autopilot_settings, public.autopilot_decisions, public.autopilot_reply_versions FROM anon, authenticated;
REVOKE ALL ON public.autopilot_settings, public.autopilot_decisions, public.autopilot_reply_versions FROM anon;
GRANT SELECT ON public.autopilot_settings, public.autopilot_decisions, public.autopilot_reply_versions TO authenticated;
GRANT ALL ON public.autopilot_settings, public.autopilot_decisions, public.autopilot_reply_versions TO service_role;
REVOKE ALL ON FUNCTION public.tg_autopilot_decisions_keep() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_autopilot_reply_versions_keep_sent() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_autopilot_no_delete() FROM PUBLIC, anon, authenticated;

-- The schedule: hourly, the autopilot pass (coach-automation-tick with {"scan":"autopilot"}): a
-- weekly assessment for any coaching client whose week went without one (a missed check-in),
-- drafts still being written, publishing what the coach allowed, and each decision's outcome on
-- its reassessment date. Only while there's something it could do.
CREATE OR REPLACE FUNCTION public.autopilot_due()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clients c
     WHERE coalesce(c.archived, false) = false
       AND c.archived_at IS NULL
       AND coalesce(c.status, '') NOT IN ('Archived', 'Deactivated')
       AND c.user_id IS NOT NULL
     LIMIT 1
  );
$$;
REVOKE ALL ON FUNCTION public.autopilot_due() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'cleo-autopilot-hourly';
  -- minute 23: away from the other hourly jobs
  PERFORM cron.schedule(
    'cleo-autopilot-hourly',
    '23 * * * *',
    $cmd$
    SELECT net.http_post(
      url := 'https://project--5f1f340c-5afa-4262-90c8-1f9406568c6c.lovable.app/api/public/hooks/coach-automation-tick',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-hook-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_hook_secret' LIMIT 1)
      ),
      body := '{"scan":"autopilot"}'::jsonb,
      timeout_milliseconds := 120000
    ) AS request_id
    WHERE public.autopilot_due();
    $cmd$
  );
EXCEPTION
  WHEN undefined_table OR undefined_function OR invalid_schema_name THEN
    RAISE NOTICE 'pg_cron / pg_net not available; cleo-autopilot-hourly not scheduled';
END $$;
