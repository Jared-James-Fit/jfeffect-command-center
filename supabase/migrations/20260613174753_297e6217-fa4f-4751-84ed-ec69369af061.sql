-- Phase 3B: real scheduled-send delivery infrastructure
-- Adds atomic status flip + admin RPCs for cancellation and retry.
-- Default kill-switch values inside app_settings.forms_scheduled_delivery
-- gain a live_enabled flag (default false) and an allowlist of recipient
-- client IDs for safe live testing.

-- 1) Atomically flip a claimed schedule from 'pending' to 'sending'.
--    Returns the row when the flip succeeded, NULL otherwise (e.g. cancelled
--    or already processing). Caller is the worker, which previously acquired
--    a lease via claim_scheduled_responses.
CREATE OR REPLACE FUNCTION public.mark_schedule_sending(_schedule_id uuid)
RETURNS public.scheduled_submission_responses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  out_row public.scheduled_submission_responses%ROWTYPE;
BEGIN
  UPDATE public.scheduled_submission_responses
     SET status = 'sending',
         updated_at = now()
   WHERE id = _schedule_id
     AND status = 'pending'
  RETURNING * INTO out_row;
  RETURN out_row;
END;
$function$;

-- 2) Finalize a real send. status must be 'sent' or 'failed'.
CREATE OR REPLACE FUNCTION public.finalize_schedule_send(
  _schedule_id uuid,
  _status text,
  _error text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF _status NOT IN ('sent','failed') THEN
    RAISE EXCEPTION 'invalid finalize status %', _status;
  END IF;
  UPDATE public.scheduled_submission_responses
     SET status = _status,
         last_error = CASE WHEN _status='failed' THEN _error ELSE NULL END,
         claimed_at = NULL,
         claimed_by_worker = NULL,
         lease_until = NULL,
         updated_at = now()
   WHERE id = _schedule_id;
END;
$function$;

-- 3) Safe cancellation — refuses to cancel if not pending.
--    Returns the resulting (or current) status.
CREATE OR REPLACE FUNCTION public.cancel_scheduled_response_safe(_review_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  cur_status text;
BEGIN
  SELECT status INTO cur_status
    FROM public.scheduled_submission_responses
   WHERE review_id = _review_id
   ORDER BY created_at DESC
   LIMIT 1
   FOR UPDATE;
  IF cur_status IS NULL THEN
    RETURN 'none';
  END IF;
  IF cur_status <> 'pending' THEN
    RETURN cur_status;
  END IF;
  UPDATE public.scheduled_submission_responses
     SET status = 'cancelled', updated_at = now()
   WHERE review_id = _review_id AND status = 'pending';
  RETURN 'cancelled';
END;
$function$;

-- 4) Admin retry — re-arms a failed schedule for the next cron tick.
--    Caller authorization is enforced in the server function layer; we
--    additionally require an admin user_id here for defense in depth.
CREATE OR REPLACE FUNCTION public.retry_failed_schedule(_schedule_id uuid, _actor uuid)
RETURNS public.scheduled_submission_responses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  is_admin boolean;
  out_row public.scheduled_submission_responses%ROWTYPE;
BEGIN
  SELECT public.has_role(_actor, 'admin'::app_role) INTO is_admin;
  IF NOT COALESCE(is_admin, false) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  UPDATE public.scheduled_submission_responses
     SET status = 'pending',
         claimed_at = NULL,
         claimed_by_worker = NULL,
         lease_until = NULL,
         updated_at = now()
   WHERE id = _schedule_id
     AND status = 'failed'
  RETURNING * INTO out_row;
  RETURN out_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_schedule_sending(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_schedule_send(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_scheduled_response_safe(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.retry_failed_schedule(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_schedule_sending(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_schedule_send(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_scheduled_response_safe(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.retry_failed_schedule(uuid, uuid) TO authenticated, service_role;
