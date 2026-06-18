ALTER TABLE public.app_members
  ADD COLUMN IF NOT EXISTS admin_access_note text,
  ADD COLUMN IF NOT EXISTS access_start_date timestamptz,
  ADD COLUMN IF NOT EXISTS reactivated_at timestamptz,
  ADD COLUMN IF NOT EXISTS expired_at timestamptz;