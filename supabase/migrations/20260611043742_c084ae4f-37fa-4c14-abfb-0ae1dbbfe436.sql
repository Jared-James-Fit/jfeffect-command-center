ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS coach_call_access_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS coach_sms_access_enabled boolean NOT NULL DEFAULT false;