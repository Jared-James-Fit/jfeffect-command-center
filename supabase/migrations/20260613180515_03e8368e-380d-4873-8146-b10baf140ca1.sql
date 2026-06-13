
-- Phase 4A — Additive messaging delivery state, scheduled-message worker primitives,
-- and protected retry RPC. Backwards compatible: existing rows default to 'sent'.

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS delivery_status text NOT NULL DEFAULT 'sent',
  ADD COLUMN IF NOT EXISTS delivery_error text,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS scheduled_by uuid,
  ADD COLUMN IF NOT EXISTS scheduled_tz text,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS claimed_by_worker text,
  ADD COLUMN IF NOT EXISTS lease_until timestamptz;

-- Allowed delivery states.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'messages_delivery_status_check'
  ) THEN
    ALTER TABLE public.messages
      ADD CONSTRAINT messages_delivery_status_check
      CHECK (delivery_status IN ('pending','sending','sent','failed','scheduled','cancelled'));
  END IF;
END$$;

-- Backfill sent_at for existing delivered rows so timeline UIs stay correct.
UPDATE public.messages
   SET sent_at = created_at
 WHERE sent_at IS NULL AND delivery_status = 'sent';

-- Indexes used by the worker and admin failed/scheduled views.
CREATE INDEX IF NOT EXISTS messages_scheduled_due_idx
  ON public.messages (scheduled_at)
  WHERE delivery_status = 'scheduled';

CREATE INDEX IF NOT EXISTS messages_failed_idx
  ON public.messages (client_id, created_at DESC)
  WHERE delivery_status = 'failed';

CREATE INDEX IF NOT EXISTS messages_lease_idx
  ON public.messages (lease_until)
  WHERE delivery_status IN ('scheduled','sending');

-- RESTRICTIVE select policy: clients only see delivered rows. Admins + assigned
-- coaches keep full visibility (for retry / cancellation workflows). Sender of
-- the row also sees their own pending/scheduled/failed entries so the composer
-- shows status feedback immediately.
DROP POLICY IF EXISTS "Hide non-delivered messages from non-staff" ON public.messages;
CREATE POLICY "Hide non-delivered messages from non-staff"
  ON public.messages AS RESTRICTIVE
  FOR SELECT
  TO authenticated
  USING (
    delivery_status IN ('sent','sending')
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.is_assigned_coach(client_id)
    OR sender_id = auth.uid()
  );

-- ------------------------------------------------------------------
-- Worker RPCs — mirror the safe primitives used by the AI-review worker.
-- ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.claim_scheduled_messages(
  _worker_name text,
  _batch_size integer DEFAULT 25,
  _lease_seconds integer DEFAULT 300
)
RETURNS SETOF public.messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.messages m
     SET claimed_at        = now(),
         claimed_by_worker = _worker_name,
         lease_until       = now() + (_lease_seconds || ' seconds')::interval,
         attempt_count     = m.attempt_count + 1,
         last_attempt_at   = now(),
         updated_at        = now()
   WHERE m.id IN (
           SELECT id FROM public.messages
            WHERE delivery_status = 'scheduled'
              AND scheduled_at IS NOT NULL
              AND scheduled_at <= now()
              AND (lease_until IS NULL OR lease_until < now())
            ORDER BY scheduled_at ASC
              FOR UPDATE SKIP LOCKED
            LIMIT _batch_size
         )
  RETURNING m.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_message_sending(_message_id uuid)
RETURNS SETOF public.messages
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.messages
     SET delivery_status = 'sending', updated_at = now()
   WHERE id = _message_id
     AND delivery_status = 'scheduled'
  RETURNING *;
$$;

CREATE OR REPLACE FUNCTION public.finalize_message_send(
  _message_id uuid,
  _status text,
  _error text DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.messages
     SET delivery_status = _status,
         delivery_error  = _error,
         sent_at         = CASE WHEN _status = 'sent' THEN now() ELSE sent_at END,
         claimed_at      = NULL,
         claimed_by_worker = NULL,
         lease_until     = NULL,
         updated_at      = now()
   WHERE id = _message_id;
$$;

CREATE OR REPLACE FUNCTION public.release_message_claim(_message_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.messages
     SET claimed_at = NULL,
         claimed_by_worker = NULL,
         lease_until = NULL,
         updated_at = now()
   WHERE id = _message_id;
$$;

-- Protected retry: atomically flips a 'failed' row to 'sending' so a concurrent
-- click can't double-send. Returns 0 rows when another caller already claimed.
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
  RETURNING *;
$$;

-- Cancel a scheduled message — only if it has not been claimed yet.
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
  RETURNING *;
$$;

GRANT EXECUTE ON FUNCTION public.claim_scheduled_messages(text,integer,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_message_sending(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_message_send(uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_message_claim(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_message_for_retry(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_scheduled_message(uuid) TO authenticated, service_role;

-- Kill switch for the messages worker, mirrors forms_scheduled_delivery shape.
INSERT INTO public.app_settings (key, value)
VALUES (
  'messages_scheduled_delivery',
  jsonb_build_object(
    'mode', 'dry_run',
    'emergency_disable', false,
    'live_enabled', false,
    'allowed_test_recipients', '[]'::jsonb,
    'notes', 'Default safety configuration — real delivery is OFF.'
  )
)
ON CONFLICT (key) DO NOTHING;
