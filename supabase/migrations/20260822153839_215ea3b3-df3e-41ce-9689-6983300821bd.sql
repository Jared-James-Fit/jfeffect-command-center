ALTER TABLE public.coaching_products
  ADD COLUMN IF NOT EXISTS sessions_included integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS session_fulfillment text NOT NULL DEFAULT 'first_payment';

ALTER TABLE public.coaching_products
  DROP CONSTRAINT IF EXISTS coaching_products_session_fulfillment_chk;
ALTER TABLE public.coaching_products
  ADD CONSTRAINT coaching_products_session_fulfillment_chk
  CHECK (session_fulfillment IN ('first_payment','per_installment','manual'));

ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS session_fulfillment text NOT NULL DEFAULT 'first_payment';

ALTER TABLE public.purchase_records
  ADD COLUMN IF NOT EXISTS session_fulfillment text NOT NULL DEFAULT 'first_payment';

UPDATE public.coaching_products
   SET sessions_included = (regexp_match(name, '(\d+)\s+Sessions?', 'i'))[1]::int
 WHERE sessions_included = 0
   AND name ~* '\d+\s+Sessions?';

UPDATE public.coaching_products
   SET sessions_included = 1
 WHERE sessions_included = 0
   AND name ~* 'Single Session';

CREATE OR REPLACE FUNCTION public.tg_purchase_inherit_sessions()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _p record;
BEGIN
  IF COALESCE(NEW.sessions_purchased, 0) > 0 THEN
    RETURN NEW;
  END IF;

  SELECT sessions_included, session_fulfillment INTO _p
    FROM public.coaching_products
   WHERE (NEW.stripe_price_id IS NOT NULL AND stripe_price_id = NEW.stripe_price_id)
      OR (NEW.offer_name IS NOT NULL AND lower(name) = lower(NEW.offer_name))
   ORDER BY (NEW.stripe_price_id IS NOT NULL AND stripe_price_id = NEW.stripe_price_id) DESC
   LIMIT 1;

  IF FOUND AND COALESCE(_p.sessions_included, 0) > 0 THEN
    NEW.sessions_purchased := _p.sessions_included;
    NEW.package_tracking_enabled := true;
    NEW.session_fulfillment := COALESCE(_p.session_fulfillment, 'first_payment');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS purchase_records_inherit_sessions ON public.purchase_records;
CREATE TRIGGER purchase_records_inherit_sessions
  BEFORE INSERT ON public.purchase_records
  FOR EACH ROW EXECUTE FUNCTION public.tg_purchase_inherit_sessions();

CREATE OR REPLACE FUNCTION public.grant_sessions_if_paid_in_full(_purchase_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
    (now() AT TIME ZONE 'UTC')::date,
    _p.package_expiry_date,
    'auto_grant_on_payment',
    'Sessions granted on successful payment'
  );
END $$;

GRANT EXECUTE ON FUNCTION public.grant_sessions_if_paid_in_full(uuid) TO authenticated, service_role;

DROP TRIGGER IF EXISTS purchase_records_grant_sessions ON public.purchase_records;
CREATE TRIGGER purchase_records_grant_sessions
AFTER INSERT OR UPDATE OF amount_outstanding_cents, amount_paid_cents,
  sessions_purchased, payment_status, paid_at, session_fulfillment
ON public.purchase_records
FOR EACH ROW EXECUTE FUNCTION public.tg_purchase_grant_sessions();