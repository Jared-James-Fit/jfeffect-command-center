ALTER TABLE public.jf_pending_signups
  ADD COLUMN IF NOT EXISTS acknowledgement_text text,
  ADD COLUMN IF NOT EXISTS user_agent text,
  ADD COLUMN IF NOT EXISTS ip_address inet;