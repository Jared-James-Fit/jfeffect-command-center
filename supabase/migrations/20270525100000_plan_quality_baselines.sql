-- Plan quality change log (Nov 24 2026; src/lib/plan-changes.ts, plan-changes.server.ts).
--
-- Each client's training, nutrition and cardio plan as the quality read last saw it (a fingerprint
-- of what matters for results: training rows still to train, nutrition days' numbers and a hash of
-- their meals, cardio sessions), and the changes found between reads (area, minor or substantial,
-- when it takes effect), so a minor edit never restarts a plan's evaluation and each change is
-- judged on its own window. Never a prescription: only the snapshot and the log.
--
-- Server only: written and read with the service role after the staff check
-- (assertStaffReachesClient); no client or staff policies.

CREATE TABLE IF NOT EXISTS public.plan_quality_baselines (
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  domain text NOT NULL CHECK (domain IN ('training', 'nutrition', 'cardio')),
  fingerprint jsonb NOT NULL,
  changes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(changes) = 'array'),
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, domain)
);

COMMENT ON TABLE public.plan_quality_baselines IS 'Plan quality: each plan''s last-seen shape and the minor / substantial changes found since (plan-changes.ts). Server only.';

ALTER TABLE public.plan_quality_baselines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.plan_quality_baselines FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.plan_quality_baselines TO service_role;
