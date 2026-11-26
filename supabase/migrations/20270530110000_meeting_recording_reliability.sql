-- Meeting recordings never sit stuck (Nov 26 2026).
--
-- A part waiting on the client's AI permission is checked again every 10
-- minutes (a consent check, no model call), so it's transcribed once they
-- allow it. A recording that never became a transcript (no permission, every
-- part failed) still has its audio deleted when its retention runs out: the
-- coach's choice when recording started (`recording.retain_days`, 30 by
-- default; 0 keeps it until deleted), counted from the part's upload.

CREATE OR REPLACE FUNCTION public.coaching_audio_due()
RETURNS TABLE (session_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT DISTINCT a.session_id
    FROM public.coaching_session_audio a
    JOIN public.coaching_sessions s ON s.id = a.session_id
   WHERE a.status <> 'deleted'
     AND s.transcript_path IS NULL
     AND coalesce(s.recording->>'status', '') <> 'ready'
     AND (CASE WHEN s.recording->>'retain_days' ~ '^[0-9]+$' THEN (s.recording->>'retain_days')::int ELSE 30 END) > 0
     AND a.created_at < now() - make_interval(days => CASE WHEN s.recording->>'retain_days' ~ '^[0-9]+$' THEN (s.recording->>'retain_days')::int ELSE 30 END)
   LIMIT 20
$$;
REVOKE ALL ON FUNCTION public.coaching_audio_due() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.coaching_audio_due() TO service_role, postgres;

CREATE OR REPLACE FUNCTION public.coaching_sessions_due()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.coaching_sessions
     WHERE (write_up_status = 'queued' OR analysis_status = 'queued'
        OR ((write_up_status = 'running' OR analysis_status = 'running')
            AND (locked_at IS NULL OR locked_at < now() - interval '3 minutes')))
       AND attempts < 4
  ) OR EXISTS (SELECT 1 FROM public.coaching_transcripts_due())
  -- audio past its retention that never became a transcript
  OR EXISTS (SELECT 1 FROM public.coaching_audio_due())
  -- a recording's parts to transcribe (a part waiting on the client's AI permission: every 10 minutes)
  OR EXISTS (
    SELECT 1 FROM public.coaching_session_audio
     WHERE (status = 'uploaded'
            OR (status = 'transcribing' AND (locked_at IS NULL OR locked_at < now() - interval '4 minutes'))
            OR (status = 'waiting_consent' AND updated_at < now() - interval '10 minutes'))
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
