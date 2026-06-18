ALTER TABLE public.app_members
  ADD COLUMN IF NOT EXISTS manual_access_override boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS manual_access_disabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS access_end_date timestamptz,
  ADD COLUMN IF NOT EXISTS in_grace boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.app_members.manual_access_override IS 'Admin-set: grants access regardless of subscription state (unless manual_access_disabled).';
COMMENT ON COLUMN public.app_members.manual_access_disabled IS 'Admin-set kill switch: revokes access regardless of any other field.';
COMMENT ON COLUMN public.app_members.access_end_date IS 'Hard end date for access. Null = no expiry. Past = expired.';
COMMENT ON COLUMN public.app_members.in_grace IS 'Member is in payment-failure grace window; access stays on temporarily.';