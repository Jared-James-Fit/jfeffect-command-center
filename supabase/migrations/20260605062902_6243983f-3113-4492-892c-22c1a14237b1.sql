ALTER TABLE public.agreements
  ADD COLUMN IF NOT EXISTS client_marked_complete_at timestamptz,
  ADD COLUMN IF NOT EXISTS client_marked_complete_by uuid;