
-- =========================================================================
-- BILLING PHASE 2: PT SESSION ENTITLEMENT LEDGER
-- =========================================================================
CREATE TABLE public.session_ledger_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  purchase_id uuid REFERENCES public.purchase_records(id) ON DELETE RESTRICT,
  pt_session_id uuid REFERENCES public.pt_sessions(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'granted','used','unused','expired','transferred_out','transferred_in',
    'refunded','adjusted'
  )),
  session_count integer NOT NULL,                   -- +N for grant/transfer_in, -1 for used, etc.
  unit_value_minor bigint,
  currency text DEFAULT 'CAD',
  effective_date date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  expires_at date,                                  -- copy of purchase expiry at grant time
  note text,
  related_event_id uuid REFERENCES public.session_ledger_events(id),
  source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual','auto_grant_on_payment','auto_use_on_complete','auto_expire','conversion','admin_adjust')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sle_client_idx ON public.session_ledger_events(client_id, effective_date DESC);
CREATE INDEX sle_purchase_idx ON public.session_ledger_events(purchase_id);
CREATE INDEX sle_pt_session_idx ON public.session_ledger_events(pt_session_id);
GRANT SELECT, INSERT ON public.session_ledger_events TO authenticated;
GRANT ALL ON public.session_ledger_events TO service_role;
ALTER TABLE public.session_ledger_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sle admin all" ON public.session_ledger_events FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "sle client read own" ON public.session_ledger_events FOR SELECT TO authenticated
  USING (client_id IN (SELECT id FROM public.clients WHERE user_id = auth.uid()));

-- Append-only
CREATE OR REPLACE FUNCTION public.tg_sle_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'session_ledger_events is append-only';
END $$;
CREATE TRIGGER sle_immutable BEFORE UPDATE OR DELETE ON public.session_ledger_events
  FOR EACH ROW EXECUTE FUNCTION public.tg_sle_immutable();

-- =========================================================================
-- SESSION BALANCE FUNCTION
-- =========================================================================
CREATE OR REPLACE FUNCTION public.session_balance(_client_id uuid)
RETURNS TABLE (
  purchase_id uuid,
  offer_name text,
  granted integer,
  used integer,
  expired integer,
  transferred integer,
  remaining integer,
  expires_at date
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    p.id AS purchase_id,
    p.offer_name,
    COALESCE(SUM(CASE WHEN e.event_type IN ('granted','transferred_in') THEN e.session_count END),0)::int AS granted,
    COALESCE(SUM(CASE WHEN e.event_type = 'used' THEN -e.session_count END),0)::int AS used,
    COALESCE(SUM(CASE WHEN e.event_type = 'expired' THEN -e.session_count END),0)::int AS expired,
    COALESCE(SUM(CASE WHEN e.event_type IN ('transferred_out','refunded') THEN -e.session_count END),0)::int AS transferred,
    COALESCE(SUM(e.session_count),0)::int AS remaining,
    MAX(e.expires_at) AS expires_at
  FROM public.purchase_records p
  LEFT JOIN public.session_ledger_events e ON e.purchase_id = p.id
  WHERE p.client_id = _client_id
    AND (p.sessions_purchased > 0 OR EXISTS (SELECT 1 FROM public.session_ledger_events WHERE purchase_id = p.id))
  GROUP BY p.id, p.offer_name
  HAVING COALESCE(SUM(e.session_count),0) <> 0 OR COUNT(e.id) > 0
  ORDER BY MIN(e.effective_date) NULLS LAST;
$$;
REVOKE ALL ON FUNCTION public.session_balance(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.session_balance(uuid) TO authenticated, service_role;

-- =========================================================================
-- AUTO-GRANT on full payment of a session-bearing purchase
-- =========================================================================
CREATE OR REPLACE FUNCTION public.grant_sessions_if_paid_in_full(_purchase_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _p public.purchase_records;
  _already_granted int;
BEGIN
  SELECT * INTO _p FROM public.purchase_records WHERE id = _purchase_id;
  IF NOT FOUND OR COALESCE(_p.sessions_purchased,0) = 0 THEN RETURN; END IF;
  IF COALESCE(_p.amount_outstanding_cents, 999999999) > 0 THEN RETURN; END IF;

  SELECT COALESCE(SUM(session_count),0) INTO _already_granted
  FROM public.session_ledger_events
  WHERE purchase_id = _purchase_id AND event_type = 'granted';

  IF _already_granted >= _p.sessions_purchased THEN RETURN; END IF;

  INSERT INTO public.session_ledger_events(
    client_id, purchase_id, event_type, session_count, unit_value_minor,
    currency, effective_date, expires_at, source, note
  ) VALUES (
    _p.client_id, _p.id, 'granted',
    (_p.sessions_purchased - _already_granted),
    CASE WHEN _p.sessions_purchased > 0 AND _p.amount_paid_cents IS NOT NULL
         THEN (_p.amount_paid_cents / _p.sessions_purchased)::bigint
         ELSE NULL END,
    COALESCE(_p.currency,'CAD'),
    (now() AT TIME ZONE 'UTC')::date,
    _p.package_expiry_date,
    'auto_grant_on_payment',
    'Auto-granted on paid-in-full'
  );
END $$;
GRANT EXECUTE ON FUNCTION public.grant_sessions_if_paid_in_full(uuid) TO authenticated, service_role;

-- Trigger on payment_ledger insert: recompute purchase totals, then auto-grant
CREATE OR REPLACE FUNCTION public.tg_payment_ledger_after_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.purchase_id IS NOT NULL THEN
    PERFORM public.recompute_purchase_totals(NEW.purchase_id);
    PERFORM public.grant_sessions_if_paid_in_full(NEW.purchase_id);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS payment_ledger_after_insert ON public.payment_ledger;
CREATE TRIGGER payment_ledger_after_insert
  AFTER INSERT ON public.payment_ledger
  FOR EACH ROW EXECUTE FUNCTION public.tg_payment_ledger_after_insert();

-- =========================================================================
-- CONSUME SESSION on pt_sessions -> Completed
-- =========================================================================
CREATE OR REPLACE FUNCTION public.consume_session_for_pt(_pt_session_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _s public.pt_sessions;
  _purchase_id uuid;
  _already int;
BEGIN
  SELECT * INTO _s FROM public.pt_sessions WHERE id = _pt_session_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- skip if we already recorded usage for this calendar session
  SELECT COUNT(*) INTO _already FROM public.session_ledger_events
   WHERE pt_session_id = _pt_session_id AND event_type = 'used';
  IF _already > 0 THEN RETURN; END IF;

  -- pick the oldest purchase with remaining sessions
  SELECT b.purchase_id INTO _purchase_id
  FROM public.session_balance(_s.client_id) b
  WHERE b.remaining > 0
    AND (b.expires_at IS NULL OR b.expires_at >= _s.session_date)
  ORDER BY b.expires_at NULLS LAST
  LIMIT 1;

  IF _purchase_id IS NULL THEN RETURN; END IF;

  INSERT INTO public.session_ledger_events(
    client_id, purchase_id, pt_session_id, event_type, session_count,
    effective_date, source, note
  ) VALUES (
    _s.client_id, _purchase_id, _pt_session_id, 'used', -1,
    _s.session_date, 'auto_use_on_complete',
    'Auto-consumed on pt_sessions completion'
  );
END $$;
GRANT EXECUTE ON FUNCTION public.consume_session_for_pt(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tg_pt_session_status_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'Completed' AND (OLD IS NULL OR OLD.status IS DISTINCT FROM 'Completed') THEN
    PERFORM public.consume_session_for_pt(NEW.id);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS pt_session_status_change ON public.pt_sessions;
CREATE TRIGGER pt_session_status_change
  AFTER INSERT OR UPDATE OF status ON public.pt_sessions
  FOR EACH ROW EXECUTE FUNCTION public.tg_pt_session_status_change();

-- =========================================================================
-- EXPIRE SESSIONS (callable from a scheduler)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.expire_overdue_sessions()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _count int := 0;
  _row record;
BEGIN
  FOR _row IN
    SELECT p.client_id, p.id AS purchase_id, b.remaining, p.package_expiry_date
    FROM public.purchase_records p
    JOIN LATERAL public.session_balance(p.client_id) b ON b.purchase_id = p.id
    WHERE p.package_expiry_date IS NOT NULL
      AND p.package_expiry_date < (now() AT TIME ZONE 'UTC')::date
      AND b.remaining > 0
  LOOP
    INSERT INTO public.session_ledger_events(
      client_id, purchase_id, event_type, session_count, effective_date,
      source, note
    ) VALUES (
      _row.client_id, _row.purchase_id, 'expired', -_row.remaining,
      _row.package_expiry_date, 'auto_expire',
      'Auto-expired on ' || _row.package_expiry_date::text
    );
    _count := _count + 1;
  END LOOP;
  RETURN _count;
END $$;
GRANT EXECUTE ON FUNCTION public.expire_overdue_sessions() TO authenticated, service_role;

-- =========================================================================
-- SERVICE CONVERSIONS (PT -> online coaching, etc.)
-- =========================================================================
CREATE TABLE public.service_conversions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  original_purchase_id uuid NOT NULL REFERENCES public.purchase_records(id) ON DELETE RESTRICT,
  new_purchase_id uuid REFERENCES public.purchase_records(id) ON DELETE RESTRICT,
  reason text,
  effective_date date NOT NULL,
  original_contract_value_cents bigint NOT NULL,
  value_delivered_cents bigint NOT NULL,
  sessions_used integer DEFAULT 0,
  sessions_remaining integer DEFAULT 0,
  credit_applied_cents bigint NOT NULL DEFAULT 0,
  new_price_cents bigint NOT NULL DEFAULT 0,
  amount_due_cents bigint NOT NULL DEFAULT 0,
  refund_owed_cents bigint NOT NULL DEFAULT 0,
  original_disposition text NOT NULL DEFAULT 'ended'
    CHECK (original_disposition IN ('ended','partially_replaced','continues')),
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sc_client_idx ON public.service_conversions(client_id);
CREATE INDEX sc_original_idx ON public.service_conversions(original_purchase_id);
GRANT SELECT, INSERT ON public.service_conversions TO authenticated;
GRANT ALL ON public.service_conversions TO service_role;
ALTER TABLE public.service_conversions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sc admin all" ON public.service_conversions FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "sc client read own" ON public.service_conversions FOR SELECT TO authenticated
  USING (client_id IN (SELECT id FROM public.clients WHERE user_id = auth.uid()));

-- Immutable after insert
CREATE OR REPLACE FUNCTION public.tg_sc_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'service_conversions is immutable'; END $$;
CREATE TRIGGER sc_immutable BEFORE UPDATE OR DELETE ON public.service_conversions
  FOR EACH ROW EXECUTE FUNCTION public.tg_sc_immutable();

-- =========================================================================
-- CONVERT SERVICE FUNCTION (PT -> Online Coaching, etc.)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.convert_client_service(
  _original_purchase_id uuid,
  _new_offer_id uuid,
  _new_offer_name text,
  _effective_date date,
  _value_delivered_cents bigint,
  _new_price_cents bigint,
  _credit_applied_cents bigint,
  _original_disposition text DEFAULT 'ended',
  _reason text DEFAULT NULL
)
RETURNS public.service_conversions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _orig public.purchase_records;
  _new_purchase_id uuid;
  _bal record;
  _conv public.service_conversions;
  _amount_due bigint;
  _refund_owed bigint;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT * INTO _orig FROM public.purchase_records WHERE id = _original_purchase_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Original purchase not found'; END IF;

  SELECT * INTO _bal FROM public.session_balance(_orig.client_id)
   WHERE purchase_id = _original_purchase_id;

  -- Compute money: amount due / refund owed
  IF _new_price_cents > _credit_applied_cents THEN
    _amount_due := _new_price_cents - _credit_applied_cents;
    _refund_owed := 0;
  ELSE
    _amount_due := 0;
    _refund_owed := _credit_applied_cents - _new_price_cents;
  END IF;

  -- Create new purchase row (do not touch the original)
  INSERT INTO public.purchase_records(
    client_id, offer_id, offer_name, currency,
    full_payable_amount, contract_value_cents, amount_outstanding_cents,
    payment_structure, purchase_status_v2, offer_snapshot
  ) VALUES (
    _orig.client_id, _new_offer_id, _new_offer_name, COALESCE(_orig.currency,'CAD'),
    (_new_price_cents/100.0),
    _new_price_cents,
    GREATEST(_amount_due, 0),
    'converted',
    'active',
    jsonb_build_object(
      'converted_from_purchase_id', _orig.id,
      'effective_date', _effective_date,
      'credit_applied_cents', _credit_applied_cents
    )
  ) RETURNING id INTO _new_purchase_id;

  -- Apply credit (if any) as a ledger entry
  IF _credit_applied_cents > 0 THEN
    INSERT INTO public.payment_ledger(
      client_id, purchase_id, txn_type, method, amount_minor, currency,
      transaction_date, source, internal_note
    ) VALUES (
      _orig.client_id, _new_purchase_id, 'credit_applied', 'credit_balance',
      _credit_applied_cents, COALESCE(_orig.currency,'CAD'),
      _effective_date, 'manual',
      'Credit applied from conversion of ' || _orig.offer_name
    );
  END IF;

  -- Mark remaining sessions on original as transferred_out
  IF COALESCE(_bal.remaining,0) > 0 THEN
    INSERT INTO public.session_ledger_events(
      client_id, purchase_id, event_type, session_count, effective_date,
      source, note
    ) VALUES (
      _orig.client_id, _original_purchase_id, 'transferred_out', -_bal.remaining,
      _effective_date, 'conversion',
      'Transferred to new purchase ' || _new_purchase_id::text
    );
  END IF;

  -- Record conversion
  INSERT INTO public.service_conversions(
    client_id, original_purchase_id, new_purchase_id, reason, effective_date,
    original_contract_value_cents, value_delivered_cents,
    sessions_used, sessions_remaining,
    credit_applied_cents, new_price_cents, amount_due_cents, refund_owed_cents,
    original_disposition, created_by
  ) VALUES (
    _orig.client_id, _original_purchase_id, _new_purchase_id, _reason, _effective_date,
    COALESCE(_orig.contract_value_cents,0), _value_delivered_cents,
    COALESCE(_bal.used,0), COALESCE(_bal.remaining,0),
    _credit_applied_cents, _new_price_cents, _amount_due, _refund_owed,
    _original_disposition, auth.uid()
  ) RETURNING * INTO _conv;

  -- Update original purchase status if ended/partial
  IF _original_disposition IN ('ended','partially_replaced') THEN
    UPDATE public.purchase_records
       SET purchase_status_v2 = 'converted'
     WHERE id = _original_purchase_id;
  END IF;

  RETURN _conv;
END $$;
GRANT EXECUTE ON FUNCTION public.convert_client_service(uuid,uuid,text,date,bigint,bigint,bigint,text,text) TO authenticated, service_role;
