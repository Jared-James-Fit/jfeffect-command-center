ALTER TABLE public.lift_videos
  ADD COLUMN IF NOT EXISTS batch_id uuid,
  ADD COLUMN IF NOT EXISTS batch_note text,
  ADD COLUMN IF NOT EXISTS batch_size integer,
  ADD COLUMN IF NOT EXISTS batch_index integer;
CREATE INDEX IF NOT EXISTS lift_videos_batch_id_idx ON public.lift_videos(batch_id);