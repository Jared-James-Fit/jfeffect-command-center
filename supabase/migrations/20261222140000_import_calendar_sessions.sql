-- Google Calendar → app sessions. The coach books many PT sessions straight
-- into Google; import_calendar_pt_session puts one on the client's calendar,
-- linked to its Google event, so credits follow what was actually booked:
--   - already in the app (same Google event, or the same client at the same
--     start) → linked, never duplicated;
--   - a past appointment → a done session that uses a credit. A day already
--     counted by hand (the session tracker's tally, a 'used' with no session)
--     hands its credit over (adjusted +1, 'reattribute') so it's never counted
--     twice;
--   - an upcoming one → a booked session holding a credit.
-- The Google event is left as the coach wrote it (gcal_dirty cleared); the
-- server only tags it as this session's copy.

ALTER TABLE public.pt_sessions DROP CONSTRAINT IF EXISTS pt_sessions_booked_via_check;
ALTER TABLE public.pt_sessions ADD CONSTRAINT pt_sessions_booked_via_check
  CHECK (booked_via IS NULL OR booked_via = ANY (ARRAY['client_app', 'booking_page', 'google_calendar']));

CREATE OR REPLACE FUNCTION public.import_calendar_pt_session(
  _client_id uuid,
  _event_id text,
  _calendar_id text,
  _date date,
  _start time,
  _end time,
  _tz text,
  _title text,
  _location text,
  _completed boolean
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_tally public.session_ledger_events;
  v_took boolean := false;
BEGIN
  SELECT id INTO v_id FROM public.pt_sessions WHERE google_event_id = _event_id LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('id', v_id, 'result', 'already_in_app');
  END IF;

  -- Booked in the app already but never linked: link it, don't add a second.
  SELECT id INTO v_id FROM public.pt_sessions
   WHERE client_id = _client_id AND session_date = _date AND start_time = _start
     AND google_event_id IS NULL AND status <> 'Cancelled'
   LIMIT 1;
  IF FOUND THEN
    UPDATE public.pt_sessions SET google_event_id = _event_id, google_calendar_id = _calendar_id WHERE id = v_id;
    RETURN jsonb_build_object('id', v_id, 'result', 'linked');
  END IF;

  IF _completed THEN
    SELECT e.* INTO v_tally
      FROM public.session_ledger_events e
     WHERE e.client_id = _client_id
       AND e.pt_session_id IS NULL
       AND e.event_type = 'used'
       AND e.effective_date = _date
       AND NOT EXISTS (
         SELECT 1 FROM public.session_ledger_events a
          WHERE a.related_event_id = e.id AND a.event_type = 'adjusted'
            AND a.source IN ('revert_on_uncomplete', 'reattribute'))
     ORDER BY e.created_at
     LIMIT 1;
    IF FOUND THEN
      INSERT INTO public.session_ledger_events (
        client_id, purchase_id, event_type, session_count, unit_value_minor, currency,
        effective_date, source, note, related_event_id
      ) VALUES (
        _client_id, v_tally.purchase_id, 'adjusted', 1, v_tally.unit_value_minor, v_tally.currency,
        _date, 'reattribute', 'Counted by hand; now the session from Google Calendar on ' || to_char(_date, 'Mon FMDD'), v_tally.id
      );
      v_took := true;
    END IF;
  END IF;

  INSERT INTO public.pt_sessions (
    client_id, title, session_date, start_time, end_time, timezone, location, status, uses_credit,
    google_event_id, google_calendar_id, booked_via, send_confirmation_email, reminders_enabled
  ) VALUES (
    _client_id, COALESCE(NULLIF(_title, ''), '1:1 Training'), _date, _start, _end,
    COALESCE(NULLIF(_tz, ''), 'America/Winnipeg'), COALESCE(NULLIF(_location, ''), 'Iron Image Gym'),
    CASE WHEN _completed THEN 'Completed' ELSE 'Scheduled' END, true,
    _event_id, _calendar_id, 'google_calendar', false, true
  )
  RETURNING id INTO v_id;

  -- The Google event stays as the coach wrote it.
  UPDATE public.pt_sessions SET gcal_dirty = false, gcal_attempts = 0, gcal_synced_at = now() WHERE id = v_id;

  RETURN jsonb_build_object('id', v_id, 'result', 'created', 'took_over_tally', v_took);
END;
$function$;

REVOKE ALL ON FUNCTION public.import_calendar_pt_session(uuid, text, text, date, time, time, text, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_calendar_pt_session(uuid, text, text, date, time, time, text, text, text, boolean) TO service_role;
