-- Each package holds exactly the sessions it sold.
--
-- 1. A used session can be moved to another package (or off any package) by
--    an 'adjusted' +N on the old one and a 'used' -N on the new one, both
--    source 'reattribute' and pointing at the original (related_event_id).
--    A hold moves the same way with 'released' / 'reserved'. The ledger stays
--    append-only.
-- 2. Package "used" nets out what was given back: an un-completed session
--    (revert_on_uncomplete) or a moved one (reattribute).
-- 3. Booking and completing pick the oldest package that still has room
--    without needing a signed-in admin: session_balance() returns nothing
--    for the service role, so every client self-booking landed on no package.
-- 4. Sessions trained or booked while no package had room (the client is
--    financing) are applied to the next package as soon as its sessions are
--    granted, oldest first, up to its size.
-- 5. Marc Asugui: package 1 = his first 16 (Aug 10 - Sep 4), package 2 = the
--    next 16 (Sep 7 - Oct 2); the 10 after (Oct 5 - 20) and his 10 bookings
--    (Oct 21 - Nov 6) are off both packages until he buys the next one.

ALTER TABLE public.session_ledger_events DROP CONSTRAINT IF EXISTS session_ledger_events_source_check;
ALTER TABLE public.session_ledger_events ADD CONSTRAINT session_ledger_events_source_check CHECK (source = ANY (ARRAY[
  'manual', 'auto_grant_on_payment', 'auto_use_on_complete', 'auto_expire', 'conversion', 'admin_adjust',
  'auto_use_on_appointment', 'auto_unuse_on_appointment_cancel', 'package_grant', 'revert_on_uncomplete',
  'reserve_on_book', 'release_reservation', 'convert_on_complete', 'sell_sessions_dialog', 'upgrade_transfer',
  'reattribute'
]::text[]));

-- Per-package balance with no access check: for the definer functions below
-- only. session_balance() is the checked way in.
CREATE OR REPLACE FUNCTION public._session_balance_rows(_client_id uuid)
 RETURNS TABLE(purchase_id uuid, offer_name text, granted integer, used integer, expired integer, transferred integer, reserved integer, remaining integer, expires_at date, opened_on date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    p.id,
    p.offer_name,
    COALESCE(SUM(CASE WHEN e.event_type IN ('granted','transferred_in') THEN e.session_count END),0)::int,
    (COALESCE(SUM(CASE WHEN e.event_type = 'used' THEN -e.session_count END),0)
     - COALESCE(SUM(CASE WHEN e.event_type = 'adjusted' AND e.source IN ('revert_on_uncomplete','reattribute') THEN e.session_count END),0))::int,
    COALESCE(SUM(CASE WHEN e.event_type = 'expired' THEN -e.session_count END),0)::int,
    COALESCE(SUM(CASE WHEN e.event_type IN ('transferred_out','refunded') THEN -e.session_count END),0)::int,
    GREATEST(0, -(
      COALESCE(SUM(CASE WHEN e.event_type = 'reserved' THEN e.session_count END),0)
      + COALESCE(SUM(CASE WHEN e.event_type = 'released' THEN e.session_count END),0)
    ))::int,
    COALESCE(SUM(e.session_count),0)::int,
    MAX(e.expires_at),
    MIN(e.effective_date)
  FROM public.purchase_records p
  LEFT JOIN public.session_ledger_events e ON e.purchase_id = p.id
  WHERE p.client_id = _client_id
    AND (p.sessions_purchased > 0 OR EXISTS (SELECT 1 FROM public.session_ledger_events le WHERE le.purchase_id = p.id))
  GROUP BY p.id, p.offer_name
  HAVING COALESCE(SUM(e.session_count),0) <> 0 OR COUNT(e.id) > 0
$function$;
REVOKE ALL ON FUNCTION public._session_balance_rows(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.session_balance(_client_id uuid)
 RETURNS TABLE(purchase_id uuid, offer_name text, granted integer, used integer, expired integer, transferred integer, reserved integer, remaining integer, expires_at date)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  SELECT b.purchase_id, b.offer_name, b.granted, b.used, b.expired, b.transferred, b.reserved, b.remaining, b.expires_at
  FROM public._session_balance_rows(_client_id) b
  ORDER BY b.opened_on NULLS LAST;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reserve_session_for_pt(_pt_session_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _s public.pt_sessions;
  _purchase_id uuid;
  _unit bigint;
  _cur text := 'CAD';
BEGIN
  SELECT * INTO _s FROM public.pt_sessions WHERE id = _pt_session_id;
  IF NOT FOUND OR _s.status <> 'Scheduled' THEN RETURN; END IF;
  IF (public._pt_outstanding_reservation(_pt_session_id)).id IS NOT NULL THEN RETURN; END IF;

  -- Oldest package with room wins (earliest expiry, then the one opened first)
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
    _s.client_id, _purchase_id, _pt_session_id, 'reserved', -1,
    _unit, _cur, _s.session_date, 'reserve_on_book',
    CASE WHEN _purchase_id IS NULL
      THEN 'Reserved 1 session WITHOUT available credit (admin overbook override)'
      ELSE 'Reserved 1 session · booking on ' || _s.session_date::text END
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.consume_session_for_pt(_pt_session_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

-- Move one used session or one open hold to another package (or to none).
CREATE OR REPLACE FUNCTION public._move_session_event(_event_id uuid, _to_purchase uuid, _note text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  e public.session_ledger_events;
  _unit bigint;
  _cur text;
BEGIN
  SELECT * INTO e FROM public.session_ledger_events WHERE id = _event_id;
  IF NOT FOUND OR e.purchase_id IS NOT DISTINCT FROM _to_purchase THEN RETURN false; END IF;
  _unit := e.unit_value_minor;
  _cur := COALESCE(e.currency, 'CAD');
  IF _to_purchase IS NOT NULL THEN
    SELECT (p.amount_paid_cents / GREATEST(COALESCE(p.sessions_purchased, 1), 1))::bigint, COALESCE(p.currency, 'CAD')
      INTO _unit, _cur
      FROM public.purchase_records p WHERE p.id = _to_purchase AND p.client_id = e.client_id;
    IF NOT FOUND THEN RETURN false; END IF;
  END IF;

  IF e.event_type = 'used' THEN
    IF EXISTS (SELECT 1 FROM public.session_ledger_events a
                WHERE a.related_event_id = e.id AND a.event_type = 'adjusted'
                  AND a.source IN ('revert_on_uncomplete', 'reattribute')) THEN
      RETURN false; -- already given back or moved
    END IF;
    INSERT INTO public.session_ledger_events(client_id, purchase_id, pt_session_id, appointment_id, event_type, session_count,
      unit_value_minor, currency, effective_date, source, note, related_event_id)
    VALUES (e.client_id, e.purchase_id, e.pt_session_id, e.appointment_id, 'adjusted', -e.session_count,
      e.unit_value_minor, e.currency, e.effective_date, 'reattribute', _note, e.id);
    INSERT INTO public.session_ledger_events(client_id, purchase_id, pt_session_id, appointment_id, event_type, session_count,
      unit_value_minor, currency, effective_date, source, note, related_event_id)
    VALUES (e.client_id, _to_purchase, e.pt_session_id, e.appointment_id, 'used', e.session_count,
      _unit, _cur, e.effective_date, 'reattribute', _note, e.id);
    RETURN true;
  ELSIF e.event_type = 'reserved' THEN
    IF EXISTS (SELECT 1 FROM public.session_ledger_events r
                WHERE r.event_type = 'released' AND r.related_event_id = e.id) THEN
      RETURN false; -- no longer held
    END IF;
    INSERT INTO public.session_ledger_events(client_id, purchase_id, pt_session_id, appointment_id, event_type, session_count,
      unit_value_minor, currency, effective_date, source, note, related_event_id)
    VALUES (e.client_id, e.purchase_id, e.pt_session_id, e.appointment_id, 'released', -e.session_count,
      e.unit_value_minor, e.currency, e.effective_date, 'reattribute', _note, e.id);
    INSERT INTO public.session_ledger_events(client_id, purchase_id, pt_session_id, appointment_id, event_type, session_count,
      unit_value_minor, currency, effective_date, source, note, related_event_id)
    VALUES (e.client_id, _to_purchase, e.pt_session_id, e.appointment_id, 'reserved', e.session_count,
      _unit, _cur, e.effective_date, 'reattribute', _note, e.id);
    RETURN true;
  END IF;
  RETURN false;
END;
$function$;
REVOKE ALL ON FUNCTION public._move_session_event(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

-- Take a package back down to what it sold: open holds first, then used
-- sessions, latest first, go off it.
CREATE OR REPLACE FUNCTION public.fit_package_sessions(_purchase_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _net int;
  _moved int := 0;
  r record;
BEGIN
  SELECT COALESCE(SUM(session_count), 0) INTO _net FROM public.session_ledger_events WHERE purchase_id = _purchase_id;
  IF _net >= 0 THEN RETURN 0; END IF;

  FOR r IN
    SELECT e.id, e.session_count FROM public.session_ledger_events e
     WHERE e.purchase_id = _purchase_id AND e.event_type = 'reserved'
       AND NOT EXISTS (SELECT 1 FROM public.session_ledger_events x WHERE x.event_type = 'released' AND x.related_event_id = e.id)
     ORDER BY e.effective_date DESC, e.created_at DESC
  LOOP
    EXIT WHEN _net >= 0;
    IF public._move_session_event(r.id, NULL, 'Moved off this package: its sessions were already used') THEN
      _net := _net - r.session_count;
      _moved := _moved + 1;
    END IF;
  END LOOP;

  FOR r IN
    SELECT e.id, e.session_count FROM public.session_ledger_events e
     WHERE e.purchase_id = _purchase_id AND e.event_type = 'used'
       AND NOT EXISTS (SELECT 1 FROM public.session_ledger_events a
                        WHERE a.related_event_id = e.id AND a.event_type = 'adjusted'
                          AND a.source IN ('revert_on_uncomplete', 'reattribute'))
     ORDER BY e.effective_date DESC, e.created_at DESC
  LOOP
    EXIT WHEN _net >= 0;
    IF public._move_session_event(r.id, NULL, 'Moved off this package: past the sessions it sold') THEN
      _net := _net - r.session_count;
      _moved := _moved + 1;
    END IF;
  END LOOP;
  RETURN _moved;
END;
$function$;
REVOKE ALL ON FUNCTION public.fit_package_sessions(uuid) FROM PUBLIC, anon, authenticated;

-- Put sessions trained or booked without a package onto this one: only the
-- ones no-package credits don't cover, used before booked, oldest first, up
-- to the room the package has.
CREATE OR REPLACE FUNCTION public.apply_unbilled_sessions(_purchase_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _client uuid;
  _room int;
  _adhoc int;
  _over int;
  _take int;
  _done int := 0;
  r record;
BEGIN
  SELECT client_id INTO _client FROM public.purchase_records WHERE id = _purchase_id;
  IF _client IS NULL THEN RETURN 0; END IF;
  SELECT COALESCE(SUM(session_count), 0) INTO _room FROM public.session_ledger_events WHERE purchase_id = _purchase_id;
  SELECT COALESCE(SUM(session_count), 0) INTO _adhoc FROM public.session_ledger_events WHERE client_id = _client AND purchase_id IS NULL;
  _over := GREATEST(-_adhoc, 0);
  _take := LEAST(_room, _over);
  IF _take <= 0 THEN RETURN 0; END IF;

  FOR r IN
    WITH c AS (
      SELECT e.id, e.session_count, e.effective_date, e.created_at, 0 AS kind
        FROM public.session_ledger_events e
       WHERE e.client_id = _client AND e.purchase_id IS NULL AND e.event_type = 'used'
         AND NOT EXISTS (SELECT 1 FROM public.session_ledger_events a
                          WHERE a.related_event_id = e.id AND a.event_type = 'adjusted'
                            AND a.source IN ('revert_on_uncomplete', 'reattribute'))
      UNION ALL
      SELECT e.id, e.session_count, e.effective_date, e.created_at, 1
        FROM public.session_ledger_events e
       WHERE e.client_id = _client AND e.purchase_id IS NULL AND e.event_type = 'reserved'
         AND NOT EXISTS (SELECT 1 FROM public.session_ledger_events x WHERE x.event_type = 'released' AND x.related_event_id = e.id)
    ), o AS (
      SELECT c.*, row_number() OVER (ORDER BY kind, effective_date, created_at) AS rn, count(*) OVER () AS total FROM c
    )
    SELECT id, session_count FROM o WHERE rn > total - _over ORDER BY rn
  LOOP
    EXIT WHEN _done >= _take;
    IF public._move_session_event(r.id, _purchase_id, 'Applied to this package: trained or booked before it was bought') THEN
      _done := _done - r.session_count;
    END IF;
  END LOOP;
  RETURN _done;
END;
$function$;
REVOKE ALL ON FUNCTION public.apply_unbilled_sessions(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tg_sle_apply_unbilled()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.apply_unbilled_sessions(NEW.purchase_id);
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS sle_apply_unbilled ON public.session_ledger_events;
CREATE TRIGGER sle_apply_unbilled
  AFTER INSERT ON public.session_ledger_events
  FOR EACH ROW
  WHEN (NEW.purchase_id IS NOT NULL AND NEW.event_type IN ('granted', 'transferred_in') AND NEW.session_count > 0)
  EXECUTE FUNCTION public.tg_sle_apply_unbilled();

-- Marc Asugui: package 1 keeps his first 16, package 2 the next 16.
DO $marc$
BEGIN
  IF EXISTS (SELECT 1 FROM public.purchase_records WHERE id = '4992ae66-61eb-4795-8d7b-702a11b9bb39') THEN
    PERFORM public.fit_package_sessions('4992ae66-61eb-4795-8d7b-702a11b9bb39');
    PERFORM public.fit_package_sessions('a41eb0e8-bc48-4018-ac01-d34a268a90e9');
  END IF;
END
$marc$;
