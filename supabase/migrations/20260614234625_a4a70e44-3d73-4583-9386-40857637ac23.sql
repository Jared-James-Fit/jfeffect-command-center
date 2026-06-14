
-- Scope JF trial-abuse tracking by Stripe mode so test-mode signups
-- don't suppress the trial for a real live signup with the same email.
ALTER TABLE public.jf_trial_emails
  ADD COLUMN IF NOT EXISTS stripe_mode text NOT NULL DEFAULT 'test';

-- Drop the old PK (email_lc alone) and re-key on (email_lc, stripe_mode).
ALTER TABLE public.jf_trial_emails
  DROP CONSTRAINT IF EXISTS jf_trial_emails_pkey;
ALTER TABLE public.jf_trial_emails
  ADD CONSTRAINT jf_trial_emails_pkey PRIMARY KEY (email_lc, stripe_mode);

-- Existing rows were all captured during internal pre-launch testing.
-- Mark them as test-mode so the first real live signup gets the 3-day trial.
UPDATE public.jf_trial_emails SET stripe_mode = 'test' WHERE stripe_mode IS NULL OR stripe_mode = '';
