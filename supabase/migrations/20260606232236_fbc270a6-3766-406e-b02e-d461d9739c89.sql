CREATE TABLE public.processed_stripe_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.processed_stripe_events TO service_role;

ALTER TABLE public.processed_stripe_events ENABLE ROW LEVEL SECURITY;

-- No policies for authenticated/anon: this table is service-role only.
-- The Stripe webhook uses the service role key (bypasses RLS).
