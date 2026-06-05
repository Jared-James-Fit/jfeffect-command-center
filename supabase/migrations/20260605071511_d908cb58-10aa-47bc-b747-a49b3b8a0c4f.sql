ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS checkin_instructions text,
  ADD COLUMN IF NOT EXISTS checkin_due_day text,
  ADD COLUMN IF NOT EXISTS checkin_notes_client text,
  ADD COLUMN IF NOT EXISTS checkin_notes_admin text,
  ADD COLUMN IF NOT EXISTS checkin_allow_video boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS checkin_allow_photos boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS checkin_link_updated_at timestamptz;