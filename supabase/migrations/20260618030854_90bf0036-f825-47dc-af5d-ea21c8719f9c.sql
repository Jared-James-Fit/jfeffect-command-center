
ALTER TABLE public.exercises
  ADD COLUMN IF NOT EXISTS secondary_vimeo_id text,
  ADD COLUMN IF NOT EXISTS secondary_vimeo_embed_url text,
  ADD COLUMN IF NOT EXISTS active_video_set text NOT NULL DEFAULT 'primary';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'exercises_active_video_set_check'
  ) THEN
    ALTER TABLE public.exercises
      ADD CONSTRAINT exercises_active_video_set_check
      CHECK (active_video_set IN ('primary','secondary'));
  END IF;
END $$;
