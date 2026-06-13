
-- 1. Locking + telemetry columns on scheduled_submission_responses
ALTER TABLE public.scheduled_submission_responses
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS claimed_by_worker text,
  ADD COLUMN IF NOT EXISTS lease_until timestamptz,
  ADD COLUMN IF NOT EXISTS dry_run_summary jsonb,
  ADD COLUMN IF NOT EXISTS dry_run_validated_at timestamptz,
  ADD COLUMN IF NOT EXISTS test_mode boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS scheduled_submission_responses_due_idx
  ON public.scheduled_submission_responses (scheduled_at)
  WHERE status = 'pending';

-- 2. Idempotency + channel on submission_delivery_attempts
ALTER TABLE public.submission_delivery_attempts
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS notes jsonb,
  ADD COLUMN IF NOT EXISTS worker_run_id uuid;

-- Allow new outcomes
ALTER TABLE public.submission_delivery_attempts
  DROP CONSTRAINT IF EXISTS submission_delivery_attempts_outcome_check;
ALTER TABLE public.submission_delivery_attempts
  ADD CONSTRAINT submission_delivery_attempts_outcome_check
  CHECK (outcome IN ('success','failed','dry_run','skipped','dry_run_failed'));

-- One dry-run attempt per schedule (prevents duplicate dry-runs across cron ticks)
CREATE UNIQUE INDEX IF NOT EXISTS submission_delivery_attempts_dryrun_unique
  ON public.submission_delivery_attempts (schedule_id)
  WHERE outcome IN ('dry_run','dry_run_failed');

-- Idempotency key uniqueness when provided
CREATE UNIQUE INDEX IF NOT EXISTS submission_delivery_attempts_idem_unique
  ON public.submission_delivery_attempts (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- 3. worker_runs table — telemetry per cron tick
CREATE TABLE IF NOT EXISTS public.worker_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_name text NOT NULL,
  mode text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  rows_claimed integer NOT NULL DEFAULT 0,
  rows_simulated_success integer NOT NULL DEFAULT 0,
  rows_simulated_failed integer NOT NULL DEFAULT 0,
  rows_skipped integer NOT NULL DEFAULT 0,
  rows_real_sent integer NOT NULL DEFAULT 0,
  rows_real_failed integer NOT NULL DEFAULT 0,
  duplicates_prevented integer NOT NULL DEFAULT 0,
  emergency_disabled boolean NOT NULL DEFAULT false,
  error text,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS worker_runs_started_idx ON public.worker_runs (started_at DESC);

GRANT SELECT ON public.worker_runs TO authenticated;
GRANT ALL ON public.worker_runs TO service_role;
ALTER TABLE public.worker_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Coaches and admins can read worker runs"
ON public.worker_runs FOR SELECT TO authenticated
USING (public.is_coach_or_admin(auth.uid()));

-- 4. scheduler_mode_audit — every flip of delivery mode is recorded
CREATE TABLE IF NOT EXISTS public.scheduler_mode_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  changed_by uuid REFERENCES auth.users(id),
  changed_at timestamptz NOT NULL DEFAULT now(),
  previous_mode text,
  new_mode text NOT NULL,
  previous_emergency_disabled boolean,
  new_emergency_disabled boolean NOT NULL,
  reason text,
  ip_address text,
  user_agent text,
  details jsonb
);
CREATE INDEX IF NOT EXISTS scheduler_mode_audit_at_idx ON public.scheduler_mode_audit (changed_at DESC);

GRANT SELECT, INSERT ON public.scheduler_mode_audit TO authenticated;
GRANT ALL ON public.scheduler_mode_audit TO service_role;
ALTER TABLE public.scheduler_mode_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read scheduler audit"
ON public.scheduler_mode_audit FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can insert scheduler audit"
ON public.scheduler_mode_audit FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) AND changed_by = auth.uid());

-- 5. Seed safety default — mode must default to dry_run
INSERT INTO public.app_settings (key, value)
VALUES (
  'forms_scheduled_delivery',
  jsonb_build_object(
    'mode', 'dry_run',
    'emergency_disable', false,
    'updated_at', to_jsonb(now()),
    'updated_by', NULL,
    'notes', 'Default safety configuration — real delivery is OFF.'
  )::text
)
ON CONFLICT (key) DO NOTHING;

-- 6. Atomic claim function (SECURITY DEFINER, callable by service_role only)
CREATE OR REPLACE FUNCTION public.claim_scheduled_responses(
  _worker_name text,
  _batch_size integer DEFAULT 25,
  _lease_seconds integer DEFAULT 300
)
RETURNS SETOF public.scheduled_submission_responses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT id
      FROM public.scheduled_submission_responses
     WHERE status = 'pending'
       AND scheduled_at <= now()
       AND (claimed_at IS NULL OR lease_until IS NULL OR lease_until < now())
     ORDER BY scheduled_at ASC
     LIMIT GREATEST(_batch_size, 1)
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.scheduled_submission_responses s
     SET claimed_at = now(),
         claimed_by_worker = _worker_name,
         lease_until = now() + make_interval(secs => GREATEST(_lease_seconds, 30)),
         attempts = s.attempts + 1,
         last_attempt_at = now(),
         updated_at = now()
   FROM due
  WHERE s.id = due.id
  RETURNING s.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_scheduled_responses(text, integer, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_scheduled_responses(text, integer, integer) TO service_role;

-- 7. Release helper (used to unclaim after dry-run validation so the row
-- stays available to a future real-mode run without being "consumed").
CREATE OR REPLACE FUNCTION public.release_scheduled_claim(
  _schedule_id uuid,
  _validated boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.scheduled_submission_responses
     SET claimed_at = NULL,
         claimed_by_worker = NULL,
         lease_until = NULL,
         dry_run_validated_at = CASE WHEN _validated THEN now() ELSE dry_run_validated_at END,
         updated_at = now()
   WHERE id = _schedule_id;
END;
$$;
REVOKE ALL ON FUNCTION public.release_scheduled_claim(uuid, boolean) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_scheduled_claim(uuid, boolean) TO service_role;
