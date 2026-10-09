-- SECURITY DEFINER functions any signed-in user could call directly (through
-- the REST API, skipping the server functions' checks):
--
--  * auto_calculate_purchase_term_dates: no caller check at all. Anyone could
--    read a full purchase row (amounts, Stripe ids) and set its term dates.
--  * update_purchase_term_dates: any coach, any purchase. Now admin or the
--    assigned coach of the purchase's client.
--  * claim_message_for_retry / cancel_scheduled_message: no caller check;
--    returned the whole message row. Now admin, the scheduler or the sender
--    (server jobs with no user still pass).
--  * consume/reserve/release_session_for_pt: no caller check; anyone could
--    spend or release a client's PT credits. Now service-role only. The
--    pt_sessions triggers are SECURITY DEFINER, so they still call them, and
--    setPtSessionStatus checks the caller before consuming. Same for
--    grant_sessions_if_paid_in_full (triggers only).
--
-- Bodies are copied from their latest migrations; only the checks are new.

-- from 20260624000003_purchase_term_date_tracking.sql
CREATE OR REPLACE FUNCTION public.update_purchase_term_dates(
  _purchase_id  uuid,
  _start_date   date,
  _end_date     date,
  _reason       text DEFAULT NULL
)
RETURNS public.purchase_records
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_record public.purchase_records;
  v_history jsonb;
  v_entry   jsonb;
BEGIN
  SELECT * INTO v_record FROM public.purchase_records WHERE id = _purchase_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase record not found';
  END IF;

  -- Admin, or the coach assigned to this purchase's client.
  IF NOT (
    public.has_role(auth.uid(), 'admin') OR
    public.is_assigned_coach(v_record.client_id)
  ) THEN
    RAISE EXCEPTION 'Only admins or the client''s coach can update purchase term dates';
  END IF;

  -- Build history entry from CURRENT values (before overwriting)
  v_entry := jsonb_build_object(
    'start_date',  v_record.term_start_date,
    'end_date',    v_record.term_end_date,
    'changed_at',  now(),
    'changed_by',  auth.uid(),
    'reason',      COALESCE(_reason, 'Manual update')
  );

  -- Append to existing history (keep last 50 entries)
  v_history := COALESCE(v_record.term_date_history, '[]'::jsonb);
  v_history := (v_history || jsonb_build_array(v_entry));
  -- Trim to last 50
  IF jsonb_array_length(v_history) > 50 THEN
    v_history := (SELECT jsonb_agg(elem) FROM (
      SELECT elem FROM jsonb_array_elements(v_history) WITH ORDINALITY AS t(elem, ord)
      ORDER BY ord DESC LIMIT 50
    ) sub);
  END IF;

  UPDATE public.purchase_records
  SET
    term_start_date    = _start_date,
    term_end_date      = _end_date,
    package_expiry_date = _end_date,  -- keep in sync
    term_date_history  = v_history,
    term_auto_calculated = false,     -- manually set
    updated_at         = now()
  WHERE id = _purchase_id
  RETURNING * INTO v_record;

  RETURN v_record;
END;
$$;

-- from 20260624000003_purchase_term_date_tracking.sql
CREATE OR REPLACE FUNCTION public.auto_calculate_purchase_term_dates(
  _purchase_id   uuid,
  _start_date    date DEFAULT CURRENT_DATE,
  _term_length   int  DEFAULT NULL,
  _term_unit     text DEFAULT NULL  -- 'days' | 'weeks' | 'months' | 'years'
)
RETURNS public.purchase_records
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_record   public.purchase_records;
  v_end_date date;
  v_interval interval;
BEGIN
  SELECT * INTO v_record FROM public.purchase_records WHERE id = _purchase_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Purchase record not found'; END IF;

  -- Server jobs (no user), an admin, or the client's assigned coach.
  IF auth.uid() IS NOT NULL AND NOT (
    public.has_role(auth.uid(), 'admin') OR
    public.is_assigned_coach(v_record.client_id)
  ) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  -- Only auto-calculate if no dates are set yet
  IF v_record.term_start_date IS NOT NULL THEN
    RETURN v_record;
  END IF;

  -- Calculate end date from term
  IF _term_length IS NOT NULL AND _term_unit IS NOT NULL THEN
    v_interval := CASE lower(_term_unit)
      WHEN 'days'   THEN (_term_length || ' days')::interval
      WHEN 'weeks'  THEN (_term_length || ' weeks')::interval
      WHEN 'months' THEN (_term_length || ' months')::interval
      WHEN 'years'  THEN (_term_length || ' years')::interval
      ELSE NULL
    END;
    IF v_interval IS NOT NULL THEN
      v_end_date := _start_date + v_interval;
    END IF;
  END IF;

  UPDATE public.purchase_records
  SET
    term_start_date      = _start_date,
    term_end_date        = COALESCE(v_end_date, v_record.term_end_date),
    package_expiry_date  = COALESCE(v_end_date, v_record.package_expiry_date),
    term_length_snapshot = _term_length,
    term_unit_snapshot   = _term_unit,
    term_auto_calculated = true,
    updated_at           = now()
  WHERE id = _purchase_id
  RETURNING * INTO v_record;

  RETURN v_record;
END;
$$;

-- from 20260613180515_03e8368e-380d-4873-8146-b10baf140ca1.sql
CREATE OR REPLACE FUNCTION public.claim_message_for_retry(_message_id uuid)
RETURNS SETOF public.messages
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.messages
     SET delivery_status = 'sending',
         attempt_count   = attempt_count + 1,
         last_attempt_at = now(),
         delivery_error  = NULL,
         updated_at      = now()
   WHERE id = _message_id
     AND delivery_status = 'failed'
     AND (auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin') OR scheduled_by = auth.uid() OR sender_id = auth.uid())
  RETURNING *;
$$;

-- from 20260613180515_03e8368e-380d-4873-8146-b10baf140ca1.sql
CREATE OR REPLACE FUNCTION public.cancel_scheduled_message(_message_id uuid)
RETURNS SETOF public.messages
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.messages
     SET delivery_status = 'cancelled',
         cancelled_at    = now(),
         updated_at      = now()
   WHERE id = _message_id
     AND delivery_status = 'scheduled'
     AND (lease_until IS NULL OR lease_until < now())
     AND (auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin') OR scheduled_by = auth.uid() OR sender_id = auth.uid())
  RETURNING *;
$$;

REVOKE EXECUTE ON FUNCTION public.consume_session_for_pt(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reserve_session_for_pt(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_session_for_pt(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_session_for_pt(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_session_for_pt(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_session_for_pt(uuid, text) TO service_role;

-- grant_sessions_if_paid_in_full: only ever needed from its two
-- SECURITY DEFINER triggers (payment ledger insert, purchase insert).
REVOKE EXECUTE ON FUNCTION public.grant_sessions_if_paid_in_full(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_sessions_if_paid_in_full(uuid) TO service_role;
