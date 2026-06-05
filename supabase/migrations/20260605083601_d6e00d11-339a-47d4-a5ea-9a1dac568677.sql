ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS openpowerlifting_url text,
  ADD COLUMN IF NOT EXISTS is_powerlifter boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS powerlifter_badge_label text NOT NULL DEFAULT 'Powerlifter',
  ADD COLUMN IF NOT EXISTS powerlifting_visible_to_client boolean NOT NULL DEFAULT false;