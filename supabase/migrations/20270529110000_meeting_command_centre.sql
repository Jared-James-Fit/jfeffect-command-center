-- The meeting command centre (Nov 25 2026, docs/COACHING_SESSIONS.md).
--
--  * Appointments: a call is confirmed by the client (pt_session_confirm, their
--    own session only), by booking it themselves, or by asking for the time it
--    moves to; the day-before request is stamped once by the server's tick; a
--    move clears both stamps, so a moved call is confirmed afresh.
--  * Meetings: every booked call gets a coach-led plan prepared by itself
--    (auto_prepared), refreshed when what's on file changes (prep_hash),
--    with what changed since the coach last looked (changes,
--    coach_reviewed_at); the meeting's outcome and its recording's consent.
--  * Recommendations: applied is its own fact (applied_at), never implied by
--    an approval; flags say what needs a check (an unconfirmed unit).
--  * Memory: auto-kept lines are marked (undo), lines tied to an event carry
--    it, and duplicates and conflicts point at the line they match.
--  * Recordings: a meeting's audio in parts (coaching_session_audio) in a
--    private bucket, transcribed by the server, staff-read only; the parts go
--    with the transcript's retention.
-- Nothing existing is rewritten: every column is new with a default, every
-- function is recreated as it was plus the new conditions.

SET lock_timeout = '10s';

/* ------------------------------------------------------------------ */
/* Appointments                                                        */

ALTER TABLE public.pt_sessions
  ADD COLUMN IF NOT EXISTS client_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmation_requested_at timestamptz;

-- they booked it themselves: confirmed as booked. A move clears both stamps.
CREATE OR REPLACE FUNCTION public.tg_pt_session_confirmation()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF tg_op = 'INSERT' THEN
    IF NEW.booked_via IN ('client_app', 'booking_page') AND NEW.client_confirmed_at IS NULL THEN
      NEW.client_confirmed_at := now();
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.session_date IS DISTINCT FROM OLD.session_date
     OR NEW.start_time IS DISTINCT FROM OLD.start_time
     OR NEW.timezone IS DISTINCT FROM OLD.timezone THEN
    -- a time the client asked for (their change request) is theirs: confirmed
    IF EXISTS (
      SELECT 1 FROM public.pt_session_change_requests r
       WHERE r.pt_session_id = NEW.id AND r.status = 'pending' AND r.kind = 'move'
         AND r.proposed_date = NEW.session_date AND left(r.proposed_start::text, 5) = left(NEW.start_time::text, 5)
    ) THEN
      NEW.client_confirmed_at := now();
    ELSE
      NEW.client_confirmed_at := NULL;
    END IF;
    NEW.confirmation_requested_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_pt_sessions_zz_confirmation ON public.pt_sessions;
CREATE TRIGGER trg_pt_sessions_zz_confirmation BEFORE INSERT OR UPDATE ON public.pt_sessions
  FOR EACH ROW EXECUTE FUNCTION public.tg_pt_session_confirmation();

-- the client confirms their own booked session, nothing else
CREATE OR REPLACE FUNCTION public.pt_session_confirm(_session uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  r record;
BEGIN
  SELECT p.id, p.status, p.starts_at, p.client_confirmed_at, c.user_id
    INTO r
    FROM public.pt_sessions p JOIN public.clients c ON c.id = p.client_id
   WHERE p.id = _session;
  IF r.id IS NULL OR r.user_id IS NULL OR r.user_id IS DISTINCT FROM (SELECT auth.uid()) THEN
    RAISE EXCEPTION 'You can''t confirm this session.' USING ERRCODE = '42501';
  END IF;
  IF r.status <> 'Scheduled' THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_booked'); END IF;
  IF r.starts_at IS NOT NULL AND r.starts_at <= now() THEN RETURN jsonb_build_object('ok', false, 'reason', 'started'); END IF;
  IF r.client_confirmed_at IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'already', true); END IF;
  UPDATE public.pt_sessions SET client_confirmed_at = now() WHERE id = _session;
  RETURN jsonb_build_object('ok', true, 'already', false);
END;
$$;
REVOKE ALL ON FUNCTION public.pt_session_confirm(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pt_session_confirm(uuid) TO authenticated;

/* ------------------------------------------------------------------ */
/* Meetings                                                            */

ALTER TABLE public.coaching_sessions
  ADD COLUMN IF NOT EXISTS auto_prepared boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS prep_hash text,
  ADD COLUMN IF NOT EXISTS prep_refreshed_at timestamptz,
  ADD COLUMN IF NOT EXISTS coach_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS changes jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS outcome jsonb,
  ADD COLUMN IF NOT EXISTS recording jsonb;

ALTER TABLE public.coaching_session_recommendations
  ADD COLUMN IF NOT EXISTS applied_at timestamptz,
  ADD COLUMN IF NOT EXISTS applied_by uuid,
  ADD COLUMN IF NOT EXISTS flags jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.client_intelligence
  ADD COLUMN IF NOT EXISTS auto_kept boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS event_key text,
  ADD COLUMN IF NOT EXISTS event_title text,
  ADD COLUMN IF NOT EXISTS event_date date,
  ADD COLUMN IF NOT EXISTS review_reason text CHECK (review_reason IS NULL OR char_length(review_reason) <= 200),
  ADD COLUMN IF NOT EXISTS duplicate_of uuid REFERENCES public.client_intelligence(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS conflicts_with uuid REFERENCES public.client_intelligence(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS merged_count integer NOT NULL DEFAULT 1;

/* ------------------------------------------------------------------ */
/* Recordings                                                          */

CREATE TABLE IF NOT EXISTS public.coaching_session_audio (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.coaching_sessions(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  seq integer NOT NULL CHECK (seq >= 0 AND seq < 200),
  path text NOT NULL,
  mime text NOT NULL DEFAULT 'audio/webm',
  bytes integer,
  -- where this part starts in the meeting, and how long it is
  offset_ms integer NOT NULL DEFAULT 0,
  duration_ms integer,
  status text NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'transcribing', 'done', 'failed', 'waiting_consent', 'deleted')),
  -- [{ start, end, speaker, text }] in seconds from this part's start
  transcript jsonb,
  model text,
  error text,
  attempts integer NOT NULL DEFAULT 0,
  locked_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, seq)
);
CREATE INDEX IF NOT EXISTS coaching_session_audio_work_idx ON public.coaching_session_audio (status) WHERE status IN ('uploaded', 'transcribing');
DROP TRIGGER IF EXISTS coaching_session_audio_touch ON public.coaching_session_audio;
CREATE TRIGGER coaching_session_audio_touch BEFORE UPDATE ON public.coaching_session_audio
  FOR EACH ROW EXECUTE FUNCTION public.tg_coaching_sessions_touch();
ALTER TABLE public.coaching_session_audio ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff read their clients" ON public.coaching_session_audio;
CREATE POLICY "Staff read their clients" ON public.coaching_session_audio FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')) OR client_id IN (SELECT public.coached_client_ids()));
REVOKE INSERT, UPDATE, DELETE ON public.coaching_session_audio FROM anon, authenticated;
GRANT SELECT ON public.coaching_session_audio TO authenticated;
GRANT ALL ON public.coaching_session_audio TO service_role;

-- audio: a private bucket, written through signed upload links the server makes after checking the coach
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('coaching-recordings', 'coaching-recordings', false, 26214400)
ON CONFLICT (id) DO NOTHING;

/* ------------------------------------------------------------------ */
/* The pre-meeting questions: did they train the unlogged sessions     */

INSERT INTO public.nf_questions (id, form_id, order_index, question_type, label, help_text, required, options, validation, conditional_logic)
VALUES (
  'c0a1e7e0-5a7e-4c0d-9f00-000000000311',
  'c0a1e7e0-5a7e-4c0d-9f00-000000000e01',
  11,
  'single_choice',
  'Some of your planned workouts have nothing logged. Did you train them?',
  null,
  false,
  '["Yes, I just didn''t log them","Some of them","No, I missed them"]'::jsonb,
  '{"session_key":"unlogged"}'::jsonb,
  '{}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

/* ------------------------------------------------------------------ */
/* The background work                                                 */

CREATE OR REPLACE FUNCTION public.coaching_sessions_due()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.coaching_sessions
     WHERE (write_up_status = 'queued' OR analysis_status = 'queued'
        OR ((write_up_status = 'running' OR analysis_status = 'running')
            AND (locked_at IS NULL OR locked_at < now() - interval '3 minutes')))
       AND attempts < 4
  ) OR EXISTS (SELECT 1 FROM public.coaching_transcripts_due())
  -- a recording's parts to transcribe
  OR EXISTS (
    SELECT 1 FROM public.coaching_session_audio
     WHERE (status = 'uploaded' OR (status = 'transcribing' AND (locked_at IS NULL OR locked_at < now() - interval '4 minutes')))
       AND attempts < 4
  )
  -- a booked call with no plan yet (every call is prepared the moment it's booked)
  OR EXISTS (
    SELECT 1 FROM public.pt_sessions p JOIN public.clients c ON c.id = p.client_id
     WHERE p.status = 'Scheduled' AND p.starts_at > now() AND p.starts_at < now() + interval '14 days'
       AND coalesce(p.session_type, '') NOT IN ('Personal Training Session', 'Technique Session', 'Powerlifting Session', 'Bodybuilding Session', 'Assessment Session', 'Custom Session')
       AND coalesce(c.archived, false) = false AND c.service_tier = 'coaching'
       AND NOT EXISTS (SELECT 1 FROM public.coaching_sessions s WHERE s.pt_session_id = p.id)
  )
  -- an upcoming plan due a refresh (what's on file may have changed)
  OR EXISTS (
    SELECT 1 FROM public.coaching_sessions s
     WHERE s.status IN ('preparing', 'ready') AND s.format <> 'retrospective'
       AND (s.scheduled_at IS NULL OR s.scheduled_at > now())
       AND (s.scheduled_at IS NULL OR s.scheduled_at < now() + interval '8 days')
       AND (s.prep_refreshed_at IS NULL OR s.prep_refreshed_at < now() - interval '3 hours')
       AND s.created_at > now() - interval '60 days'
  )
$$;
REVOKE ALL ON FUNCTION public.coaching_sessions_due() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.coaching_sessions_due() TO service_role, postgres;
