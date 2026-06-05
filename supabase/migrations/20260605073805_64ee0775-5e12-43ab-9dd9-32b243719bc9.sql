ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS profile_picture_source text,
  ADD COLUMN IF NOT EXISTS profile_picture_updated_by text,
  ADD COLUMN IF NOT EXISTS profile_picture_needs_update boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS profile_picture_needs_update_at timestamptz,
  ADD COLUMN IF NOT EXISTS profile_picture_needs_update_reason text;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS profile_picture_source text,
  ADD COLUMN IF NOT EXISTS profile_picture_updated_at timestamptz;