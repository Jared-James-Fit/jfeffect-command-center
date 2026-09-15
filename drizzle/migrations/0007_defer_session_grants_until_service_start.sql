-- Session credits must follow ACCESS ACTIVATION, not payment. When a sale has a
-- future coaching/service start date, payment alone must not hand the client
-- usable credits; they are granted on (or after) the start date instead.
CREATE OR REPLACE FUNCTION public.grant_sessions_if_paid_in_full(_purchase_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _p public.purchase_records;
  _mode text;
  _already int;
  _entitled int;
  _total_minor bigint;
  _paid_minor bigint;
BEGIN
  SELECT * INTO _p FROM public.purchase_records WHERE id = _purchase_id;
  IF NOT FOUND OR COALESCE(_p.sessions_purchased, 0) = 0 THEN RETURN; END IF;

  _mode := COALESCE(_p.session_fulfillment, 'first_payment');
  IF _mode = 'manual' THEN RETURN; END IF;

  -- Access has not started yet: hold the credits until the start date.
  IF _p.service_start_date IS NOT NULL
     AND _p.service_start_date > (now() AT TIME ZONE 'America/Winnipeg')::date THEN
    RETURN;
  END IF;

  _paid_minor  := COALESCE(_p.amount_paid_cents, 0);
  _total_minor := COALESCE(_p.contract_value_cents, 0);

  IF _paid_minor <= 0 THEN RETURN; END IF;

  IF _mode = 'per_installment' AND _total_minor > 0 THEN
    _entitled := LEAST(
      _p.sessions_purchased,
      FLOOR(_p.sessions_purchased::numeric * _paid_minor::numeric / _total_minor::numeric)::int
    );
  ELSE
    _entitled := _p.sessions_purchased;
  END IF;

  SELECT COALESCE(SUM(session_count), 0) INTO _already
    FROM public.session_ledger_events
   WHERE purchase_id = _purchase_id AND event_type = 'granted';

  IF _entitled <= _already THEN RETURN; END IF;

  INSERT INTO public.session_ledger_events(
    client_id, purchase_id, event_type, session_count, unit_value_minor,
    currency, effective_date, expires_at, source, note
  ) VALUES (
    _p.client_id, _p.id, 'granted', (_entitled - _already),
    CASE WHEN _p.sessions_purchased > 0 AND _paid_minor > 0
         THEN (_paid_minor / _p.sessions_purchased)::bigint ELSE NULL END,
    COALESCE(_p.currency, 'CAD'),
    GREATEST(
      COALESCE(_p.service_start_date, (now() AT TIME ZONE 'America/Winnipeg')::date),
      (now() AT TIME ZONE 'America/Winnipeg')::date
    ),
    _p.package_expiry_date,
    'auto_grant_on_payment',
    'Sessions granted on access activation'
  );
END $function$;

-- Catch-up sweep: grants credits for paid sales whose start date has arrived.
CREATE OR REPLACE FUNCTION public.grant_sessions_due_today()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _r record;
  _n int := 0;
BEGIN
  FOR _r IN
    SELECT p.id
      FROM public.purchase_records p
     WHERE COALESCE(p.sessions_purchased, 0) > 0
       AND COALESCE(p.amount_paid_cents, 0) > 0
       AND COALESCE(p.session_fulfillment, 'first_payment') <> 'manual'
       AND p.service_start_date IS NOT NULL
       AND p.service_start_date <= (now() AT TIME ZONE 'America/Winnipeg')::date
       AND COALESCE((
             SELECT SUM(e.session_count) FROM public.session_ledger_events e
              WHERE e.purchase_id = p.id AND e.event_type = 'granted'
           ), 0) < p.sessions_purchased
  LOOP
    PERFORM public.grant_sessions_if_paid_in_full(_r.id);
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END $function$;