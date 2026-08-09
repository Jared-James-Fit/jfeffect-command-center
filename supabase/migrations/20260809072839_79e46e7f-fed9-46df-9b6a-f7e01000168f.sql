-- 1) Extend the PT session status trigger: restoring credit when a Completed
-- session is reverted to a non-completed status. The ledger is append-only,
-- so the revert writes a compensating +1 'adjusted' event linked to the
-- original 'used' event (never deletes history).
CREATE OR REPLACE FUNCTION public.tg_pt_session_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _used_event public.session_ledger_events;
  _already_reverted int;
BEGIN
  -- Deduct one session when marked Completed (consume fn is idempotent)
  IF NEW.status = 'Completed' AND (OLD IS NULL OR OLD.status IS DISTINCT FROM 'Completed') THEN
    PERFORM public.consume_session_for_pt(NEW.id);
  END IF;

  -- Restore one session when a Completed session is moved to another status
  IF TG_OP = 'UPDATE' AND OLD.status = 'Completed' AND NEW.status IS DISTINCT FROM 'Completed' THEN
    SELECT * INTO _used_event
      FROM public.session_ledger_events
     WHERE pt_session_id = NEW.id AND event_type = 'used'
     ORDER BY created_at DESC
     LIMIT 1;
    IF FOUND THEN
      SELECT COUNT(*) INTO _already_reverted
        FROM public.session_ledger_events
       WHERE pt_session_id = NEW.id AND source = 'revert_on_uncomplete';
      IF _already_reverted = 0 THEN
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
  END IF;
  RETURN NEW;
END $$;

-- 2) Auto-grant sessions when a session-pack purchase is paid in full.
-- grant_sessions_if_paid_in_full() is idempotent: it skips purchases with an
-- outstanding balance and tops up only the un-granted remainder, so this is
-- safe to fire on every relevant insert/update (manual mark-paid AND Stripe
-- webhook payment updates).
CREATE OR REPLACE FUNCTION public.tg_purchase_grant_sessions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(NEW.sessions_purchased, 0) > 0 THEN
    PERFORM public.grant_sessions_if_paid_in_full(NEW.id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS purchase_records_grant_sessions ON public.purchase_records;
CREATE TRIGGER purchase_records_grant_sessions
AFTER INSERT OR UPDATE OF amount_outstanding_cents, amount_paid_cents, sessions_purchased, payment_status, paid_at
ON public.purchase_records
FOR EACH ROW
EXECUTE FUNCTION public.tg_purchase_grant_sessions();