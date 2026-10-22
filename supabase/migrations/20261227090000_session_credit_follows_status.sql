-- A PT session's credit follows its status, whichever screen changes it:
--   Scheduled              → holds one credit
--   Completed              → uses one (it happened)
--   Missed                 → uses one (late cancel or no-show that counts)
--   Cancelled, Rescheduled → none: the credit is banked for another booking
-- and a booked session turns Completed by itself once its day is over, so the
-- coach only steps in when something changed (bank it, use it, move it).

-- The session's own "today" (bad or empty zones fall back to the gym's).
CREATE OR REPLACE FUNCTION public.pt_local_today(_tz text)
RETURNS date
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
BEGIN
  RETURN (now() AT TIME ZONE COALESCE(NULLIF(_tz, ''), 'America/Winnipeg'))::date;
EXCEPTION WHEN others THEN
  RETURN (now() AT TIME ZONE 'America/Winnipeg')::date;
END;
$$;

-- The session's use of a credit that hasn't been given back (by row, not by
-- time: rows written in one transaction share created_at).
CREATE OR REPLACE FUNCTION public._pt_unreversed_use(_pt_session_id uuid)
RETURNS public.session_ledger_events
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT u.*
  FROM public.session_ledger_events u
  WHERE u.pt_session_id = _pt_session_id
    AND u.event_type = 'used'
    AND NOT EXISTS (
      SELECT 1 FROM public.session_ledger_events r
      WHERE r.related_event_id = u.id AND r.event_type = 'adjusted' AND r.source = 'revert_on_uncomplete'
    )
  ORDER BY u.created_at DESC
  LIMIT 1;
$$;

-- Same as before, but "already used" is the row check above.
CREATE OR REPLACE FUNCTION public.consume_session_for_pt(_pt_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _s public.pt_sessions;
  _res public.session_ledger_events;
  _purchase_id uuid;
  _unit bigint;
  _cur text := 'CAD';
BEGIN
  SELECT * INTO _s FROM public.pt_sessions WHERE id = _pt_session_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF (public._pt_unreversed_use(_pt_session_id)).id IS NOT NULL THEN RETURN; END IF;

  -- Convert a held reservation into usage (release the hold, then record use)
  _res := public._pt_outstanding_reservation(_pt_session_id);
  IF _res.id IS NOT NULL THEN
    INSERT INTO public.session_ledger_events(
      client_id, purchase_id, pt_session_id, event_type, session_count,
      unit_value_minor, currency, effective_date, source, note, related_event_id
    ) VALUES (
      _res.client_id, _res.purchase_id, _pt_session_id, 'released', 1,
      _res.unit_value_minor, _res.currency, (now() AT TIME ZONE 'UTC')::date,
      'convert_on_complete', 'Reservation converted to used — session completed', _res.id
    );
    INSERT INTO public.session_ledger_events(
      client_id, purchase_id, pt_session_id, event_type, session_count,
      unit_value_minor, currency, effective_date, source, note
    ) VALUES (
      _s.client_id, _res.purchase_id, _pt_session_id, 'used', -1,
      _res.unit_value_minor, _res.currency, _s.session_date,
      'auto_use_on_complete', 'Completed — 1 session used'
    );
    RETURN;
  END IF;

  -- No reservation held: deduct from the oldest package with room
  SELECT b.purchase_id INTO _purchase_id
  FROM public._session_balance_rows(_s.client_id) b
  WHERE b.remaining > 0
    AND (b.expires_at IS NULL OR b.expires_at >= _s.session_date)
  ORDER BY b.expires_at NULLS LAST, b.opened_on NULLS LAST
  LIMIT 1;

  IF _purchase_id IS NOT NULL THEN
    SELECT (p.amount_paid_cents / GREATEST(COALESCE(p.sessions_purchased, 1), 1))::bigint,
           COALESCE(p.currency, 'CAD')
      INTO _unit, _cur
    FROM public.purchase_records p WHERE p.id = _purchase_id;
  END IF;

  INSERT INTO public.session_ledger_events(
    client_id, purchase_id, pt_session_id, event_type, session_count,
    unit_value_minor, currency, effective_date, source, note
  ) VALUES (
    _s.client_id, _purchase_id, _pt_session_id, 'used', -1,
    _unit, _cur, _s.session_date, 'auto_use_on_complete',
    CASE WHEN _purchase_id IS NULL
      THEN 'Completed — 1 session used (no credit balance; admin override)'
      ELSE 'Completed — 1 session used' END
  );
END;
$$;

-- Move the session's credit to what its status says, adding only the ledger
-- rows needed (safe to call any number of times).
CREATE OR REPLACE FUNCTION public.pt_session_settle_credit(_pt_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _s public.pt_sessions;
  _used public.session_ledger_events;
BEGIN
  SELECT * INTO _s FROM public.pt_sessions WHERE id = _pt_session_id;
  IF NOT FOUND OR NOT _s.uses_credit THEN RETURN; END IF;

  IF _s.status IN ('Completed', 'Missed') THEN
    -- Converts the held credit into a used one; nothing when it's already used.
    PERFORM public.consume_session_for_pt(_s.id);
    PERFORM public.release_session_for_pt(_s.id, 'Released 1 reserved session · already used');
    RETURN;
  END IF;

  -- Not used any more: give back the credit this session used.
  _used := public._pt_unreversed_use(_s.id);
  IF _used.id IS NOT NULL THEN
    INSERT INTO public.session_ledger_events(
      client_id, purchase_id, pt_session_id, event_type, session_count,
      unit_value_minor, currency, effective_date, source, note, related_event_id
    ) VALUES (
      _s.client_id, _used.purchase_id, _s.id, 'adjusted', 1,
      _used.unit_value_minor, _used.currency, (now() AT TIME ZONE 'UTC')::date,
      'revert_on_uncomplete',
      CASE _s.status
        WHEN 'Scheduled' THEN 'Booked again · used credit returned'
        ELSE 'Didn''t happen · credit banked'
      END,
      _used.id
    );
  END IF;

  IF _s.status = 'Scheduled' THEN
    PERFORM public.reserve_session_for_pt(_s.id);
  ELSE
    PERFORM public.release_session_for_pt(
      _s.id,
      CASE _s.status
        WHEN 'Cancelled' THEN 'Released 1 reserved session · booking cancelled'
        ELSE 'Released 1 reserved session · ' || lower(_s.status)
      END
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.pt_session_settle_credit(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._pt_unreversed_use(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tg_pt_session_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.uses_credit THEN
    PERFORM public.pt_session_settle_credit(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

-- Moving a session moves its status with it: a done one moved to today or
-- later is booked again (its credit held, not used); a booked one moved into
-- a day that's over is done. A status set in the same save wins.
CREATE OR REPLACE FUNCTION public.tg_pt_session_status_follows_date()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  _today date;
BEGIN
  IF NEW.session_date IS NOT DISTINCT FROM OLD.session_date
     OR NEW.status IS DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  _today := public.pt_local_today(NEW.timezone);
  IF NEW.status = 'Completed' AND NEW.session_date >= _today THEN
    NEW.status := 'Scheduled';
  ELSIF NEW.status = 'Scheduled' AND NEW.session_date < _today THEN
    NEW.status := 'Completed';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pt_sessions_status_follows_date ON public.pt_sessions;
CREATE TRIGGER trg_pt_sessions_status_follows_date
  BEFORE UPDATE OF session_date ON public.pt_sessions
  FOR EACH ROW EXECUTE FUNCTION public.tg_pt_session_status_follows_date();

-- Fires on a date change too, so a status the trigger above flipped settles
-- its credit (changes made by BEFORE triggers don't count as "OF status").
DROP TRIGGER IF EXISTS pt_session_status_change ON public.pt_sessions;
CREATE TRIGGER pt_session_status_change
  AFTER INSERT OR UPDATE OF status, session_date ON public.pt_sessions
  FOR EACH ROW EXECUTE FUNCTION public.tg_pt_session_status_change();

-- Booked sessions whose day is over become done (the credit is used). Left
-- for the coach: a session the client asked to move or cancel that nobody
-- answered, and archived clients' bookings.
CREATE OR REPLACE FUNCTION public.pt_sessions_auto_complete()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _id uuid;
  _n integer := 0;
BEGIN
  FOR _id IN
    SELECT s.id
    FROM public.pt_sessions s
    JOIN public.clients c ON c.id = s.client_id
    WHERE s.status = 'Scheduled'
      AND s.session_date < current_date + 1
      AND s.session_date < public.pt_local_today(s.timezone)
      AND NOT COALESCE(c.archived, false)
      AND NOT EXISTS (
        SELECT 1 FROM public.pt_session_change_requests r
        WHERE r.pt_session_id = s.id AND r.status = 'pending'
      )
    ORDER BY s.session_date, s.start_time
    LIMIT 500
  LOOP
    UPDATE public.pt_sessions SET status = 'Completed' WHERE id = _id AND status = 'Scheduled';
    IF FOUND THEN _n := _n + 1; END IF;
  END LOOP;
  RETURN _n;
END;
$$;

REVOKE ALL ON FUNCTION public.pt_sessions_auto_complete() FROM PUBLIC, anon, authenticated;

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pt-sessions-auto-complete') THEN
    PERFORM cron.unschedule('pt-sessions-auto-complete');
  END IF;
  PERFORM cron.schedule('pt-sessions-auto-complete', '4,19,34,49 * * * *', 'select public.pt_sessions_auto_complete();');
END
$cron$;

SELECT public.pt_sessions_auto_complete();

NOTIFY pgrst, 'reload schema';
