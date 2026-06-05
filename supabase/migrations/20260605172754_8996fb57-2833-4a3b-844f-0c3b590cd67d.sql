
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS preferred_name text,
  ADD COLUMN IF NOT EXISTS date_of_birth date,
  ADD COLUMN IF NOT EXISTS height_cm numeric,
  ADD COLUMN IF NOT EXISTS preferred_height_unit text NOT NULL DEFAULT 'imperial',
  ADD COLUMN IF NOT EXISTS emergency_contact_name text,
  ADD COLUMN IF NOT EXISTS emergency_contact_phone text,
  ADD COLUMN IF NOT EXISTS basic_info_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS basic_info_update_requested boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS basic_info_update_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS basic_info_update_reason text;

ALTER TABLE public.clients
  ADD CONSTRAINT clients_preferred_height_unit_check
  CHECK (preferred_height_unit IN ('imperial','metric')) NOT VALID;

ALTER TABLE public.clients VALIDATE CONSTRAINT clients_preferred_height_unit_check;
