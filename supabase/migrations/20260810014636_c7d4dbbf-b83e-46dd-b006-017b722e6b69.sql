-- =============================================================
-- PT Session Wallet: reservation-aware credits
-- Additive only: no existing rows are modified or deleted.
-- Event model in session_ledger_events:
--   granted (+N)        credits purchased/granted
--   adjusted (±N)       manual admin adjustments / completion reverts
--   reserved (-1)       credit held while a booking is Scheduled
--   released (+1)       hold released (cancel / delete / no-show w/o deduct)
--   used (-1)           credit consumed (completed / no-show deducted)
--   expired (-N)        expiry sweep (existing)
--   transferred_out/in  package upgrade / conversion moves
-- remaining = SUM(session_count) => now means AVAILABLE credits.
-- =============================================================

-- 1) Balance report: add `reserved`, keep `remaining` (= available), restrict access
DROP FUNCTION public.session_balance(uuid);

CREATE FUNCTION public.session_balance(_client_id uuid)
RETURNS TABLE(purchase_id uuid, offer_name text, granted integer, used integer, expired integer, transferred integer, reserved integer, remaining integer, expires_at date)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only admins, the assigned coach, or the client themselves may read balances.
  IF auth.uid() IS NULL OR (
    NOT public.has_role(auth.uid(), 'admin')
    AND NOT public.is_assigned_coach_for_client(_client_id)
    AND NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = _client_id AND c.user_id = auth.uid())
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.id AS purchase_id,
    p.offer_name,
    COALESCE(SUM(CASE WHEN e.event_type IN ('granted','transferred_in') THEN e.session_count END),0)::int AS granted,
    COALESCE(SUM(CASE WHEN e.event_type = 'used' THEN -e.session_count END),0)::int AS used,
    COALESCE(SUM(CASE WHEN e.event_type = 'expired' THEN -e.session_count END),0)::int AS expired,
    COALESCE(SUM(CASE WHEN e.event_type IN ('transferred_out','refunded') THEN -e.session_count END),0)::int AS transferred,
    GREATEST(0, -(
      COALESCE(SUM(CASE WHEN e.event_type = 'reserved' THEN e.session_count END),0)
      + COALESCE(SUM(CASE WHEN e.event_type = 'released' THEN e.session_count END),0)
    ))::int AS reserved,
    COALESCE(SUM(e.session_count),0)::int AS remaining,
    MAX(e.expires_at) AS expires_at
  FROM public.purchase_records p
  LEFT JOIN public.session_ledger_events e ON e.purchase_id = p.id
  WHERE p.client_id = _client_id
    AND (p.sessions_purchased > 0 OR EXISTS (SELECT 1 FROM public.session_ledger_events le WHERE le.purchase_id = p.id))
  GROUP BY p.id, p.offer_name
  HAVING COALESCE(SUM(e.session_count),0) <> 0 OR COUNT(e.id) > 0
  ORDER BY MIN(e.effective_date) NULLS LAST;
END;
$$;

GRANT EXECUTE ON FUNCTION public.session_balance(uuid) TO authenticated;

-- 2) Helper: the outstanding (not-yet-released) reservation for a booking
CREATE OR REPLACE FUNCTION public._pt_outstanding_reservation(_pt_session_id uuid)
RETURNS public.session_ledger_events
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _ev public.session_ledger_events;
BEGIN
  SELECT e.* INTO _ev
  FROM public.session_ledger_events e
  WHERE e.pt_session_id = _pt_session_id
    AND e.event_type = 'reserved'
    AND NOT EXISTS (
      SELECT 1 FROM public.session_ledger_events r
      WHERE r.event_type = 'released' AND r.related_event_id = e.id
    )
  ORDER BY e.created_at DESC
  LIMIT 1;
  RETURN _ev;
END;
$$;

REVOKE ALL ON FUNCTION public._pt_outstanding_reservation(uuid) FROM PUBLIC, authenticated, anon;

-- 3) Reserve 1 credit for a booking (idempotent)
CREATE OR REPLACE FUNCTION public.reserve_session_for_pt(_pt_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _s public.pt_sessions;
  _purchase_id uuid;
  _unit bigint;
  _cur text := 'CAD';
BEGIN
  SELECT * INTO _s FROM public.pt_sessions WHERE id = _pt_session_id;
  IF NOT FOUND OR _s.status <> 'Scheduled' THEN RETURN; END IF;
  IF (public._pt_outstanding_reservation(_pt_session_id)).id IS NOT NULL THEN RETURN; END IF;

  -- Oldest package with available credit wins (earliest expiry first)
  SELECT b.purchase_id INTO _purchase_id
  FROM public.session_balance(_s.client_id) b
  WHERE b.remaining > 0
    AND (b.expires_at IS NULL OR b.expires_at >= _s.session_date)
  ORDER BY b.expires_at NULLS LAST
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
    _s.client_id, _purchase_id, _pt_session_id, 'reserved', -1,
    _unit, _cur, _s.session_date, 'reserve_on_book',
    CASE WHEN _purchase_id IS NULL
      THEN 'Reserved 1 session WITHOUT available credit (admin overbook override)'
      ELSE 'Reserved 1 session · booking on ' || _s.session_date::text END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_session_for_pt(uuid) FROM PUBLIC, authenticated, anon;

-- 4) Release a held reservation (cancel / delete / no-show without deduction)
CREATE OR REPLACE FUNCTION public.release_session_for_pt(_pt_session_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _res public.session_ledger_events;
BEGIN
  _res := public._pt_outstanding_reservation(_pt_session_id);
  IF _res.id IS NULL THEN RETURN; END IF;

  INSERT INTO public.session_ledger_events(
    client_id, purchase_id, pt_session_id, event_type, session_count,
    unit_value_minor, currency, effective_date, source, note, related_event_id
  ) VALUES (
    _res.client_id, _res.purchase_id, _pt_session_id, 'released', 1,
    _res.unit_value_minor, _res.currency, (now() AT TIME ZONE 'UTC')::date,
    'release_reservation', _reason, _res.id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.release_session_for_pt(uuid, text) FROM PUBLIC, authenticated, anon;

-- 5) Consume 1 credit on completion / deducted no-show.
--    Converts a held reservation when one exists; otherwise deducts from the
--    oldest package with available credit. Re-completion safe.
CREATE OR REPLACE FUNCTION public.consume_session_for_pt(_pt_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _s public.pt_sessions;
  _res public.session_ledger_events;
  _last_type text;
  _purchase_id uuid;
  _unit bigint;
  _cur text := 'CAD';
BEGIN
  SELECT * INTO _s FROM public.pt_sessions WHERE id = _pt_session_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Skip when the latest consume/revert for this booking is already 'used'
  SELECT e.event_type INTO _last_type
  FROM public.session_ledger_events e
  WHERE e.pt_session_id = _pt_session_id
    AND (e.event_type = 'used' OR e.source = 'revert_on_uncomplete')
  ORDER BY e.created_at DESC
  LIMIT 1;
  IF _last_type = 'used' THEN RETURN; END IF;

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

  -- No reservation held: deduct from oldest package with available credit
  SELECT b.purchase_id INTO _purchase_id
  FROM public.session_balance(_s.client_id) b
  WHERE b.remaining > 0
    AND (b.expires_at IS NULL OR b.expires_at >= _s.session_date)
  ORDER BY b.expires_at NULLS LAST
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

GRANT EXECUTE ON FUNCTION public.consume_session_for_pt(uuid) TO authenticated;

-- 6) Booking status state machine
CREATE OR REPLACE FUNCTION public.tg_pt_session_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _used_event public.session_ledger_events;
  _last_type text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'Scheduled' THEN
      PERFORM public.reserve_session_for_pt(NEW.id);
    ELSIF NEW.status = 'Completed' THEN
      PERFORM public.consume_session_for_pt(NEW.id);
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;

  -- Leaving Completed: restore the used credit (unless already reverted)
  IF OLD.status = 'Completed' AND NEW.status IS DISTINCT FROM 'Completed' THEN
    SELECT e.event_type INTO _last_type
    FROM public.session_ledger_events e
    WHERE e.pt_session_id = NEW.id
      AND (e.event_type = 'used' OR e.source = 'revert_on_uncomplete')
    ORDER BY e.created_at DESC
    LIMIT 1;
    IF _last_type = 'used' THEN
      SELECT * INTO _used_event
      FROM public.session_ledger_events
      WHERE pt_session_id = NEW.id AND event_type = 'used'
      ORDER BY created_at DESC
      LIMIT 1;
      INSERT INTO public.session_ledger_events(
        client_id, purchase_id, pt_session_id, event_type, session_count,
        unit_value_minor, currency, effective_date, source, note, related_event_id
      ) VALUES (
        NEW.client_id, _used_event.purchase_id, NEW.id, 'adjusted', 1,
        _used_event.unit_value_minor, _used_event.currency,
        (now() AT TIME ZONE 'UTC')::date, 'revert_on_uncomplete',
        'Session un-marked as completed — credit restored', _used_event.id
      );
    END IF;
  END IF;

  -- Entering Scheduled: hold a credit (no-op when one is already held)
  IF NEW.status = 'Scheduled' THEN
    PERFORM public.reserve_session_for_pt(NEW.id);
  END IF;

  -- Leaving Scheduled
  IF OLD.status = 'Scheduled' THEN
    IF NEW.status = 'Completed' THEN
      PERFORM public.consume_session_for_pt(NEW.id);
    ELSIF NEW.status = 'Cancelled' THEN
      PERFORM public.release_session_for_pt(NEW.id, 'Released 1 reserved session · booking cancelled');
    ELSIF NEW.status = 'Missed' THEN
      PERFORM public.release_session_for_pt(NEW.id, 'Released 1 reserved session · no-show (not deducted)');
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 7) Deleting a booking releases any held credit
CREATE OR REPLACE FUNCTION public.tg_pt_session_release_on_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.release_session_for_pt(
    OLD.id,
    'Released 1 reserved session · booking deleted (' || OLD.session_date::text || ' ' || COALESCE(OLD.title, 'session') || ')'
  );
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS pt_session_release_on_delete ON public.pt_sessions;
CREATE TRIGGER pt_session_release_on_delete
  AFTER DELETE ON public.pt_sessions
  FOR EACH ROW EXECUTE FUNCTION public.tg_pt_session_release_on_delete();