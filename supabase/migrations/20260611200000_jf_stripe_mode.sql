ALTER TABLE public.jf_membership_settings
  ADD COLUMN IF NOT EXISTS stripe_mode text NOT NULL DEFAULT 'live'
  CHECK (stripe_mode IN ('test','live'));
