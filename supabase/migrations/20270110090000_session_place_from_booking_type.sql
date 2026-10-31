-- A PT session brought in from Google Calendar is the default booking type's
-- session: the first active in-person type that uses a credit ("1:1 Training",
-- 800 Vaughan Ave). It takes that type's name, session type and place, and is
-- linked to it (booking_card_id), so it reads like every session booked in the
-- app. An upcoming one is where that type is held, never whatever free text the
-- Google event had (Nicolas's repeating event still said the old 511 Robinson
-- Ave gym); a past one keeps where Google says it was (the gym moved in
-- September, and history stays true). The server then writes the same place
-- onto an upcoming one's Google event, so the two agree.
--
-- Otherwise as before (20261222140000_import_calendar_sessions.sql): linked,
-- never duplicated; a past appointment is a done session using a credit (taking
-- over a day counted by hand); an upcoming one a booked session holding a
-- credit; the Google event keeps the coach's title, time and notes.

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
  v_location text;
  v_tally public.session_ledger_events;
  v_took boolean := false;
  v_card record;
BEGIN
  SELECT id, location INTO v_id, v_location FROM public.pt_sessions WHERE google_event_id = _event_id LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('id', v_id, 'result', 'already_in_app', 'location', v_location);
  END IF;

  SELECT id, location INTO v_id, v_location FROM public.pt_sessions
   WHERE client_id = _client_id AND session_date = _date AND start_time = _start
     AND google_event_id IS NULL AND status <> 'Cancelled'
   LIMIT 1;
  IF FOUND THEN
    UPDATE public.pt_sessions SET google_event_id = _event_id, google_calendar_id = _calendar_id WHERE id = v_id;
    RETURN jsonb_build_object('id', v_id, 'result', 'linked', 'location', v_location);
  END IF;

  -- The default booking type: in person, uses a credit, first in the coach's list.
  SELECT b.id, b.name, b.session_type, b.custom_type, b.location INTO v_card
    FROM public.booking_cards b
   WHERE b.is_active AND b.uses_credit AND b.location_mode = 'in_person'
   ORDER BY b.sort_order, b.created_at
   LIMIT 1;

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

  v_location := CASE
    WHEN _completed THEN COALESCE(NULLIF(_location, ''), NULLIF(v_card.location, ''), 'Iron Image Gym')
    ELSE COALESCE(NULLIF(v_card.location, ''), NULLIF(_location, ''), 'Iron Image Gym')
  END;

  INSERT INTO public.pt_sessions (
    client_id, title, session_type, custom_type, booking_card_id, session_date, start_time, end_time, timezone,
    location, status, uses_credit, google_event_id, google_calendar_id, booked_via, send_confirmation_email,
    reminders_enabled
  ) VALUES (
    _client_id, COALESCE(NULLIF(v_card.name, ''), NULLIF(_title, ''), '1:1 Training'),
    COALESCE(v_card.session_type, 'Personal Training Session'), v_card.custom_type, v_card.id,
    _date, _start, _end, COALESCE(NULLIF(_tz, ''), 'America/Winnipeg'),
    v_location, CASE WHEN _completed THEN 'Completed' ELSE 'Scheduled' END, true,
    _event_id, _calendar_id, 'google_calendar', false, true
  )
  RETURNING id INTO v_id;

  UPDATE public.pt_sessions SET gcal_dirty = false, gcal_attempts = 0, gcal_synced_at = now() WHERE id = v_id;

  RETURN jsonb_build_object('id', v_id, 'result', 'created', 'took_over_tally', v_took, 'location', v_location);
END;
$function$;

REVOKE ALL ON FUNCTION public.import_calendar_pt_session(uuid, text, text, date, time, time, text, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_calendar_pt_session(uuid, text, text, date, time, time, text, text, text, boolean) TO service_role;

NOTIFY pgrst, 'reload schema';
