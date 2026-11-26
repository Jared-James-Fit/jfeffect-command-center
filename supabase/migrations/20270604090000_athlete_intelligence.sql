-- Athlete Intelligence (Nov 26 2026): information about an athlete that people
-- upload or type (training logs and programs, meet results, their own coach's
-- notes, warm-ups, attempt plans, technical cues, footage), read into checked
-- facts that point back to their source, and fed into Competition
-- Intelligence, the gameplan and Cleo. Reusable for any athlete: a coaching
-- client, a handled athlete with an outside coach, a future client.
--
--  * athlete_intel_sources    each upload or typed note: who it came from (never
--                             assumed to be the uploader), what it's for, the
--                             file (private bucket athlete-intel), its status
--                             (queued → reading → ready, waiting for AI
--                             permission, failed with why), versions (a replace
--                             links old and new), Recently deleted (30 days).
--  * athlete_intel_facts      what was read: one row per fact, traceable to its
--                             source, location and words; deduped by content;
--                             which one is current in a slot is worked out again
--                             whenever a source changes (src/lib/athlete-intel).
--  * athlete_intel_questions  the rare question worth asking, its answer, and
--                             that it's never asked twice.
--  * athlete_intel_links      an athlete-specific link for their own coach or the
--                             athlete to add information without an account
--                             (only its hash is kept).
--  * athlete_intel_events     append-only record.
--
-- Staff read their own clients' rows (admins all; a handler only during the
-- handling's access window, through coached_client_ids()). Every write goes
-- through the server after a staff check. Athletes and outside coaches never
-- read these tables.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.athlete_intel_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients (id) ON DELETE CASCADE,
  competition_id uuid REFERENCES public.competitions (id) ON DELETE SET NULL,
  role text NOT NULL CHECK (role IN ('primary_coach', 'athlete', 'other_coach')),
  name text CHECK (name IS NULL OR char_length(name) <= 120),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  nonce text NOT NULL CHECK (char_length(nonce) BETWEEN 8 AND 40),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  opened_at timestamptz,
  last_used_at timestamptz,
  uploads integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS athlete_intel_links_client_idx ON public.athlete_intel_links (client_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.athlete_intel_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients (id) ON DELETE CASCADE,
  competition_id uuid REFERENCES public.competitions (id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('xlsx', 'csv', 'docx', 'pdf', 'image', 'video', 'text', 'manual')),
  file_name text CHECK (file_name IS NULL OR char_length(file_name) <= 200),
  file_path text UNIQUE CHECK (file_path IS NULL OR char_length(file_path) <= 400),
  mime text CHECK (mime IS NULL OR char_length(mime) <= 120),
  bytes bigint CHECK (bytes IS NULL OR bytes BETWEEN 0 AND 524288000),
  content_hash text CHECK (content_hash IS NULL OR content_hash ~ '^[0-9a-f]{64}$'),
  -- who it originally came from, and their name (never who uploaded it)
  provider text NOT NULL DEFAULT 'unknown' CHECK (provider IN ('primary_coach', 'athlete', 'handler', 'other_coach', 'other', 'unknown')),
  provider_name text CHECK (provider_name IS NULL OR char_length(provider_name) <= 120),
  purposes text[] NOT NULL DEFAULT '{}',
  detected_purposes text[] NOT NULL DEFAULT '{}',
  context text CHECK (context IS NULL OR char_length(context) <= 1000),
  -- what the phone read out of a spreadsheet, document or text (cells as shown)
  source_text text CHECK (source_text IS NULL OR char_length(source_text) <= 200000),
  sheets jsonb CHECK (sheets IS NULL OR jsonb_typeof(sheets) = 'array'),
  -- answers that settle how the file is read
  start_date date,
  unit_answer text CHECK (unit_answer IS NULL OR unit_answer IN ('kg', 'lb')),
  completion_answer text CHECK (completion_answer IS NULL OR completion_answer IN ('completed', 'prescribed')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('uploading', 'queued', 'reading', 'waiting_consent', 'waiting_ai', 'ready', 'stored', 'failed', 'replaced', 'deleted')),
  status_before_delete text,
  error text CHECK (error IS NULL OR char_length(error) <= 600),
  attempts integer NOT NULL DEFAULT 0,
  retry_at timestamptz,
  progress jsonb,
  summary jsonb,
  method text CHECK (method IS NULL OR method IN ('parsed', 'ai', 'both', 'none')),
  replaces_id uuid REFERENCES public.athlete_intel_sources (id) ON DELETE SET NULL,
  replaced_by uuid,
  uploaded_by uuid,
  via_link_id uuid REFERENCES public.athlete_intel_links (id) ON DELETE SET NULL,
  rights_text text CHECK (rights_text IS NULL OR char_length(rights_text) <= 600),
  rights_confirmed_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid,
  analyzed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS athlete_intel_sources_client_idx ON public.athlete_intel_sources (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS athlete_intel_sources_queue_idx ON public.athlete_intel_sources (updated_at)
  WHERE status IN ('queued', 'reading', 'waiting_ai');
CREATE INDEX IF NOT EXISTS athlete_intel_sources_hash_idx ON public.athlete_intel_sources (client_id, content_hash)
  WHERE content_hash IS NOT NULL AND status NOT IN ('deleted', 'replaced');

CREATE TABLE IF NOT EXISTS public.athlete_intel_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients (id) ON DELETE CASCADE,
  -- null: about the athlete (long-term); set: about that competition
  competition_id uuid REFERENCES public.competitions (id) ON DELETE CASCADE,
  source_id uuid REFERENCES public.athlete_intel_sources (id) ON DELETE CASCADE,
  -- other sources that said exactly the same thing
  also_sources uuid[] NOT NULL DEFAULT '{}',
  kind text NOT NULL CHECK (kind IN ('training', 'meet', 'attempt_plan', 'warmup', 'cue', 'technique', 'instruction', 'equipment', 'preference', 'bodyweight', 'risk', 'taper', 'note')),
  lift text CHECK (lift IS NULL OR lift IN ('squat', 'bench', 'deadlift')),
  date date,
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  quote text CHECK (quote IS NULL OR char_length(quote) <= 400),
  location text CHECK (location IS NULL OR char_length(location) <= 120),
  confidence text NOT NULL DEFAULT 'medium' CHECK (confidence IN ('high', 'medium', 'low')),
  scope text NOT NULL DEFAULT 'athlete' CHECK (scope IN ('athlete', 'meet')),
  provider text NOT NULL DEFAULT 'unknown' CHECK (provider IN ('primary_coach', 'athlete', 'handler', 'other_coach', 'other', 'unknown')),
  provider_name text CHECK (provider_name IS NULL OR char_length(provider_name) <= 120),
  basis text NOT NULL DEFAULT 'source' CHECK (basis IN ('source', 'coach', 'answer')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'dismissed')),
  status_reason text CHECK (status_reason IS NULL OR char_length(status_reason) <= 200),
  corrects_id uuid REFERENCES public.athlete_intel_facts (id) ON DELETE SET NULL,
  dedupe_key text NOT NULL CHECK (char_length(dedupe_key) <= 600),
  received_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS athlete_intel_facts_client_idx ON public.athlete_intel_facts (client_id, kind, date DESC);
CREATE INDEX IF NOT EXISTS athlete_intel_facts_source_idx ON public.athlete_intel_facts (source_id);

CREATE TABLE IF NOT EXISTS public.athlete_intel_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients (id) ON DELETE CASCADE,
  competition_id uuid NOT NULL REFERENCES public.competitions (id) ON DELETE CASCADE,
  key text NOT NULL CHECK (char_length(key) <= 300),
  fingerprint text NOT NULL CHECK (char_length(fingerprint) <= 40),
  area text NOT NULL CHECK (area IN ('attempts', 'safety', 'logistics', 'conflict', 'performance')),
  text text NOT NULL CHECK (char_length(text) <= 600),
  why text CHECK (why IS NULL OR char_length(why) <= 400),
  answer_spec jsonb NOT NULL DEFAULT '{}'::jsonb,
  ask_who text[] NOT NULL DEFAULT '{}',
  priority integer NOT NULL DEFAULT 0,
  visible_from date,
  source_id uuid REFERENCES public.athlete_intel_sources (id) ON DELETE SET NULL,
  fact_ids uuid[] NOT NULL DEFAULT '{}',
  lift text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'dismissed', 'resolved')),
  answer jsonb,
  answered_by uuid,
  answered_role text CHECK (answered_role IS NULL OR answered_role IN ('handler', 'athlete', 'primary_coach', 'other_coach')),
  answered_at timestamptz,
  asked_via text CHECK (asked_via IS NULL OR asked_via IN ('athlete_chat', 'coach_link', 'athlete_link')),
  asked_at timestamptz,
  raised_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  notified_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS athlete_intel_questions_key ON public.athlete_intel_questions (client_id, competition_id, key);
CREATE INDEX IF NOT EXISTS athlete_intel_questions_open_idx ON public.athlete_intel_questions (client_id) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS public.athlete_intel_events (
  id bigserial PRIMARY KEY,
  client_id uuid NOT NULL,
  competition_id uuid,
  source_id uuid,
  fact_id uuid,
  question_id uuid,
  actor_id uuid,
  actor text NOT NULL CHECK (actor IN ('coach', 'athlete', 'contributor', 'system', 'cleo')),
  action text NOT NULL CHECK (char_length(action) <= 60),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS athlete_intel_events_client_idx ON public.athlete_intel_events (client_id, at DESC);

CREATE OR REPLACE FUNCTION public.tg_athlete_intel_events_keep()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  -- the record goes only with its client (cascade from a deleted account)
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public.clients WHERE id = OLD.client_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'The athlete intelligence record is append-only';
END;
$$;
REVOKE ALL ON FUNCTION public.tg_athlete_intel_events_keep() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS athlete_intel_events_keep ON public.athlete_intel_events;
CREATE TRIGGER athlete_intel_events_keep BEFORE UPDATE OR DELETE ON public.athlete_intel_events
  FOR EACH ROW EXECUTE FUNCTION public.tg_athlete_intel_events_keep();

-- A deleted source's file is removed from storage by the worker (SQL can't remove storage objects).
CREATE TABLE IF NOT EXISTS public.athlete_intel_file_tombstones (
  path text PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION public.tg_athlete_intel_source_gone()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF OLD.file_path IS NOT NULL THEN
    INSERT INTO public.athlete_intel_file_tombstones (path) VALUES (OLD.file_path) ON CONFLICT DO NOTHING;
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_athlete_intel_source_gone() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS athlete_intel_source_gone ON public.athlete_intel_sources;
CREATE TRIGGER athlete_intel_source_gone AFTER DELETE ON public.athlete_intel_sources
  FOR EACH ROW EXECUTE FUNCTION public.tg_athlete_intel_source_gone();

-- touch updated_at
CREATE OR REPLACE FUNCTION public.tg_athlete_intel_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_athlete_intel_touch() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS athlete_intel_facts_touch ON public.athlete_intel_facts;
CREATE TRIGGER athlete_intel_facts_touch BEFORE UPDATE ON public.athlete_intel_facts FOR EACH ROW EXECUTE FUNCTION public.tg_athlete_intel_touch();
DROP TRIGGER IF EXISTS athlete_intel_questions_touch ON public.athlete_intel_questions;
CREATE TRIGGER athlete_intel_questions_touch BEFORE UPDATE ON public.athlete_intel_questions FOR EACH ROW EXECUTE FUNCTION public.tg_athlete_intel_touch();

-- ── Access: staff read their own clients'; the server writes ───────────────
ALTER TABLE public.athlete_intel_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.athlete_intel_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.athlete_intel_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.athlete_intel_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.athlete_intel_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.athlete_intel_file_tombstones ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['athlete_intel_links', 'athlete_intel_sources', 'athlete_intel_facts', 'athlete_intel_questions', 'athlete_intel_events'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Staff read %1$s" ON public.%1$I', t);
    EXECUTE format(
      'CREATE POLICY "Staff read %1$s" ON public.%1$I FOR SELECT TO authenticated USING ((SELECT public.has_role((SELECT auth.uid()), ''admin''::app_role)) OR client_id IN (SELECT public.coached_client_ids()))',
      t
    );
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON public.%I FROM authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;
REVOKE ALL ON public.athlete_intel_file_tombstones FROM anon, authenticated;
GRANT ALL ON public.athlete_intel_file_tombstones TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.athlete_intel_events_id_seq TO service_role;
-- a link's nonce is the server's to work the link out again: nobody reads the links table directly
-- (the coach's screens list them through the server)
REVOKE ALL ON public.athlete_intel_links FROM authenticated;

-- ── The files: private; uploaded only through a link the server signs ──────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('athlete-intel', 'athlete-intel', false, 209715200,
        ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
              'text/plain', 'text/csv',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'video/mp4', 'video/quicktime', 'video/webm'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ── The queue: a queued source wakes the hook at once; pg_cron catches the rest
CREATE OR REPLACE FUNCTION public.athlete_intel_queue_run()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF new.status = 'queued'
     AND (tg_op = 'INSERT' OR old.status IS DISTINCT FROM 'queued') THEN
    BEGIN
      PERFORM net.http_post(
        url := 'https://project--5f1f340c-5afa-4262-90c8-1f9406568c6c.lovable.app/api/public/hooks/athlete-intel-tick',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-hook-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_hook_secret' LIMIT 1)
        ),
        body := jsonb_build_object('sourceId', new.id),
        timeout_milliseconds := 300000
      );
    EXCEPTION WHEN others THEN
      -- never fail the write that queued it; the cron picks it up
      NULL;
    END;
  END IF;
  RETURN new;
END;
$$;
REVOKE ALL ON FUNCTION public.athlete_intel_queue_run() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS athlete_intel_queue_run ON public.athlete_intel_sources;
CREATE TRIGGER athlete_intel_queue_run
  AFTER INSERT OR UPDATE OF status ON public.athlete_intel_sources
  FOR EACH ROW EXECUTE FUNCTION public.athlete_intel_queue_run();

-- Is there anything for the worker: a source waiting, one cut off mid-read, one
-- waiting on AI whose retry is due, a file to remove, a deleted source past 30 days.
CREATE OR REPLACE FUNCTION public.athlete_intel_due()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.athlete_intel_sources
                  WHERE (status = 'queued' AND updated_at > now() - interval '3 days')
                     OR (status = 'reading' AND updated_at < now() - interval '4 minutes' AND updated_at > now() - interval '3 days')
                     OR (status = 'waiting_ai' AND coalesce(retry_at, updated_at) <= now() AND updated_at > now() - interval '7 days')
                     OR (status = 'deleted' AND deleted_at < now() - interval '30 days'))
      OR EXISTS (SELECT 1 FROM public.athlete_intel_file_tombstones);
$$;
REVOKE ALL ON FUNCTION public.athlete_intel_due() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.athlete_intel_due() TO service_role, postgres;

DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'athlete-intel-tick';
  PERFORM cron.schedule(
    'athlete-intel-tick',
    '1-59/3 * * * *',
    $cmd$
    SELECT net.http_post(
      url := 'https://project--5f1f340c-5afa-4262-90c8-1f9406568c6c.lovable.app/api/public/hooks/athlete-intel-tick',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-hook-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_hook_secret' LIMIT 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 300000
    ) AS request_id
    WHERE EXISTS (SELECT 1 WHERE public.athlete_intel_due());
    $cmd$
  );
EXCEPTION
  WHEN undefined_table OR undefined_function OR invalid_schema_name THEN
    NULL;
END
$$;

COMMENT ON TABLE public.athlete_intel_sources IS
  'Information about an athlete someone uploaded or typed (src/lib/athlete-intel): who it came from, what it is for, its file, how far it has been read. Staff read their own clients''; written by the server.';
COMMENT ON TABLE public.athlete_intel_facts IS
  'Checked facts read from athlete_intel_sources (or entered and corrected by the coach), each traceable to its source, location and words. Which fact is current in a slot is worked out again whenever a source changes.';

SELECT public.rls_evaluate_once('athlete_intel_links');
SELECT public.rls_evaluate_once('athlete_intel_sources');
SELECT public.rls_evaluate_once('athlete_intel_facts');
SELECT public.rls_evaluate_once('athlete_intel_questions');
SELECT public.rls_evaluate_once('athlete_intel_events');
