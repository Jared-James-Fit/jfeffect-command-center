-- Coaching Session Intelligence (Nov 25 2026, docs/COACHING_SESSIONS.md).
--
-- One session engine for every client conversation. The records:
--   * coaching_sessions: one conversation (a call, a touch-base, or a meeting
--     added afterwards), what it's about, the coach's private notes, the
--     prepared read and agenda, what was noted in the call, the transcript's
--     private file and when it goes, the analysis, and the shared game plan
--     with whether it was sent.
--   * coaching_session_commitments: who does what by when, carried to the
--     next session until done or dropped.
--   * coaching_session_recommendations: a change Cleo suggests after a call,
--     with its evidence, and the coach's decision; an approval is applied
--     through the existing editor (Adjust program / Adjust plan / the cardio
--     draft), never from here.
--   * client_intelligence: lasting coaching knowledge, proposed until the
--     coach confirms it; only confirmed, unexpired rows reach Cleo.
--   * coaching_session_events: an append-only record of every step.
--
-- Clients read none of it: what reaches them is a chat message the coach
-- chose to send. Staff read their own clients' rows (coached_client_ids()),
-- admins all; every write is the server's after it checked who's asking
-- (assertStaffReachesClient), so no table grants insert, update or delete.

SET lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS public.coaching_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  coach_user_id uuid,
  pt_session_id uuid REFERENCES public.pt_sessions(id) ON DELETE SET NULL,
  competition_id uuid REFERENCES public.competitions(id) ON DELETE SET NULL,
  -- what it's about: { kind, title, date, location, phase, source, key, conflicts }
  event jsonb NOT NULL DEFAULT '{}'::jsonb,
  format text NOT NULL DEFAULT 'call' CHECK (format IN ('call', 'touch_base', 'retrospective')),
  status text NOT NULL DEFAULT 'preparing'
    CHECK (status IN ('preparing', 'ready', 'live', 'done', 'cancelled')),
  scheduled_at timestamptz,
  minutes integer CHECK (minutes IS NULL OR minutes BETWEEN 5 AND 120),
  -- the coach's own words: private, never on the athlete's screen
  coach_notes text CHECK (coach_notes IS NULL OR char_length(coach_notes) <= 4000),
  coach_priorities jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(coach_priorities) = 'array' AND jsonb_array_length(coach_priorities) <= 12),
  prep jsonb,
  agenda jsonb,
  -- Cleo's write-up of the prep (background), and where it is
  write_up jsonb,
  write_up_status text NOT NULL DEFAULT 'none'
    CHECK (write_up_status IN ('none', 'queued', 'running', 'ready', 'failed')),
  questionnaire jsonb,
  questionnaire_submission_id uuid,
  -- noted during the call: { notes, decisions[], tasks[], section }
  live jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- after the call: the transcript or notes (a private file), consent and retention
  transcript_path text,
  transcript_source text CHECK (transcript_source IS NULL OR transcript_source IN ('otter', 'notes', 'other')),
  transcript_consent_at timestamptz,
  transcript_retain_until date,
  transcript_deleted_at timestamptz,
  analysis jsonb,
  analysis_status text NOT NULL DEFAULT 'none'
    CHECK (analysis_status IN ('none', 'queued', 'running', 'ready', 'failed')),
  analysis_error text,
  -- staged model calls in flight (stagedCall), so a cut-off request resumes
  progress jsonb,
  locked_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  game_plan jsonb,
  shared_message_id uuid,
  shared_at timestamptz,
  held_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS coaching_sessions_client_idx ON public.coaching_sessions (client_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS coaching_sessions_one_per_booking
  ON public.coaching_sessions (pt_session_id) WHERE pt_session_id IS NOT NULL AND status <> 'cancelled';
CREATE INDEX IF NOT EXISTS coaching_sessions_work_idx
  ON public.coaching_sessions (write_up_status, analysis_status)
  WHERE write_up_status IN ('queued', 'running') OR analysis_status IN ('queued', 'running');

CREATE TABLE IF NOT EXISTS public.coaching_session_commitments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  session_id uuid REFERENCES public.coaching_sessions(id) ON DELETE SET NULL,
  owner text NOT NULL CHECK (owner IN ('coach', 'athlete')),
  text text NOT NULL CHECK (char_length(btrim(text)) BETWEEN 2 AND 400),
  due_on date,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'dropped')),
  -- confirmed (both said yes) or proposed (read from a transcript, not yet confirmed)
  confirmed boolean NOT NULL DEFAULT true,
  source_quote text CHECK (source_quote IS NULL OR char_length(source_quote) <= 600),
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS coaching_session_commitments_open_idx
  ON public.coaching_session_commitments (client_id) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS public.coaching_session_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.coaching_sessions(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  area text NOT NULL CHECK (area IN ('training', 'nutrition', 'cardio', 'recovery', 'schedule', 'competition', 'communication', 'coaching')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 200),
  current_text text CHECK (current_text IS NULL OR char_length(current_text) <= 1000),
  proposed_text text CHECK (proposed_text IS NULL OR char_length(proposed_text) <= 1000),
  reason text CHECK (reason IS NULL OR char_length(reason) <= 1500),
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  benefit text CHECK (benefit IS NULL OR char_length(benefit) <= 600),
  tradeoffs text CHECK (tradeoffs IS NULL OR char_length(tradeoffs) <= 600),
  affects text CHECK (affects IS NULL OR char_length(affects) <= 600),
  -- keep: the plan stays as it is (an explicit recommendation, never filler)
  kind text NOT NULL DEFAULT 'change' CHECK (kind IN ('change', 'keep')),
  status text NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'approved', 'edited', 'kept', 'rejected', 'deferred', 'clarify')),
  decision_note text CHECK (decision_note IS NULL OR char_length(decision_note) <= 1000),
  -- where an approval went: the existing editor's own record
  routed_kind text CHECK (routed_kind IS NULL OR routed_kind IN ('program_ai_edit', 'nutrition_plan_edit', 'cardio_proposal', 'message', 'manual')),
  routed_id text,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS coaching_session_recommendations_session_idx
  ON public.coaching_session_recommendations (session_id);

CREATE TABLE IF NOT EXISTS public.client_intelligence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('goal', 'preference', 'training_response', 'approach', 'decision', 'technique', 'constraint', 'achievement', 'relationship', 'concern', 'other')),
  text text NOT NULL CHECK (char_length(btrim(text)) BETWEEN 3 AND 600),
  permanence text NOT NULL DEFAULT 'lasting' CHECK (permanence IN ('lasting', 'temporary')),
  expires_on date,
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'confirmed', 'archived')),
  -- coach: private to the coaching team; shareable: fine to show the athlete
  visibility text NOT NULL DEFAULT 'coach' CHECK (visibility IN ('coach', 'shareable')),
  source_session_id uuid REFERENCES public.coaching_sessions(id) ON DELETE SET NULL,
  source_quote text CHECK (source_quote IS NULL OR char_length(source_quote) <= 600),
  confirmed_by uuid,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (permanence = 'lasting' OR expires_on IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS client_intelligence_client_idx ON public.client_intelligence (client_id, status);

CREATE TABLE IF NOT EXISTS public.coaching_session_events (
  id bigserial PRIMARY KEY,
  session_id uuid NOT NULL,
  client_id uuid NOT NULL,
  actor_id uuid,
  actor text NOT NULL CHECK (actor IN ('coach', 'cleo', 'athlete', 'system')),
  action text NOT NULL CHECK (char_length(action) BETWEEN 2 AND 60),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS coaching_session_events_session_idx ON public.coaching_session_events (session_id, at);

-- the record is append-only
CREATE OR REPLACE FUNCTION public.tg_coaching_session_events_keep()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  RAISE EXCEPTION 'The coaching session record is append-only';
END;
$$;
DROP TRIGGER IF EXISTS coaching_session_events_keep ON public.coaching_session_events;
CREATE TRIGGER coaching_session_events_keep BEFORE UPDATE OR DELETE ON public.coaching_session_events
  FOR EACH ROW EXECUTE FUNCTION public.tg_coaching_session_events_keep();

-- updated_at
CREATE OR REPLACE FUNCTION public.tg_coaching_sessions_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS coaching_sessions_touch ON public.coaching_sessions;
CREATE TRIGGER coaching_sessions_touch BEFORE UPDATE ON public.coaching_sessions
  FOR EACH ROW EXECUTE FUNCTION public.tg_coaching_sessions_touch();
DROP TRIGGER IF EXISTS coaching_session_commitments_touch ON public.coaching_session_commitments;
CREATE TRIGGER coaching_session_commitments_touch BEFORE UPDATE ON public.coaching_session_commitments
  FOR EACH ROW EXECUTE FUNCTION public.tg_coaching_sessions_touch();
DROP TRIGGER IF EXISTS client_intelligence_touch ON public.client_intelligence;
CREATE TRIGGER client_intelligence_touch BEFORE UPDATE ON public.client_intelligence
  FOR EACH ROW EXECUTE FUNCTION public.tg_coaching_sessions_touch();

-- staff read their own clients' rows; nobody writes but the server
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['coaching_sessions', 'coaching_session_commitments', 'coaching_session_recommendations', 'client_intelligence', 'coaching_session_events']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "Staff read their clients" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "Staff read their clients" ON public.%I FOR SELECT TO authenticated USING ((SELECT public.has_role((SELECT auth.uid()), ''admin'')) OR client_id IN (SELECT public.coached_client_ids()))',
      t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;
GRANT USAGE, SELECT ON SEQUENCE public.coaching_session_events_id_seq TO service_role;

-- transcripts: a private bucket, read and written only by the server
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('coaching-transcripts', 'coaching-transcripts', false, 5242880)
ON CONFLICT (id) DO NOTHING;

-- a transcript past its retention date goes (its structured intelligence stays)
CREATE OR REPLACE FUNCTION public.coaching_transcripts_due()
RETURNS SETOF public.coaching_sessions
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT * FROM public.coaching_sessions
   WHERE transcript_path IS NOT NULL AND transcript_deleted_at IS NULL
     AND transcript_retain_until IS NOT NULL AND transcript_retain_until < (now() AT TIME ZONE 'UTC')::date
   LIMIT 50
$$;
REVOKE ALL ON FUNCTION public.coaching_transcripts_due() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.coaching_transcripts_due() TO service_role;

-- the background work: Cleo's write-ups and transcript analyses
CREATE OR REPLACE FUNCTION public.coaching_sessions_due()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.coaching_sessions
     WHERE (write_up_status = 'queued' OR analysis_status = 'queued'
        OR ((write_up_status = 'running' OR analysis_status = 'running')
            AND (locked_at IS NULL OR locked_at < now() - interval '3 minutes')))
       AND attempts < 4
  ) OR EXISTS (SELECT 1 FROM public.coaching_transcripts_due())
$$;
REVOKE ALL ON FUNCTION public.coaching_sessions_due() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.coaching_sessions_due() TO service_role, postgres;

DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'coaching-sessions-tick';
  PERFORM cron.schedule(
    'coaching-sessions-tick',
    '* * * * *',
    $cmd$
    SELECT net.http_post(
      url := 'https://project--5f1f340c-5afa-4262-90c8-1f9406568c6c.lovable.app/api/public/hooks/coaching-sessions-tick',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_hook_secret')),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    ) WHERE public.coaching_sessions_due();
    $cmd$
  );
END $$;
