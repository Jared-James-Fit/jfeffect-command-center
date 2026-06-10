
-- 1. Add archive bookkeeping columns on lift_videos (idempotent).
ALTER TABLE public.lift_videos
  ADD COLUMN IF NOT EXISTS archive_error text,
  ADD COLUMN IF NOT EXISTS archive_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS archive_next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS archive_last_attempt_at timestamptz;

-- Normalize archive_status default. Allowed values used by app code:
--   'not_archived' | 'pending' | 'archiving' | 'archived' | 'failed'
UPDATE public.lift_videos
   SET archive_status = 'archived'
 WHERE archive_status IS NULL
   AND (original_drive_file_id IS NOT NULL OR drive_file_id IS NOT NULL);

UPDATE public.lift_videos
   SET archive_status = 'not_archived'
 WHERE archive_status IS NULL;

ALTER TABLE public.lift_videos
  ALTER COLUMN archive_status SET DEFAULT 'not_archived';

-- Index for cron picker: pending archives oldest first.
CREATE INDEX IF NOT EXISTS idx_lift_videos_archive_pending
  ON public.lift_videos (archive_next_attempt_at)
  WHERE archive_status IN ('pending', 'failed');

-- 2. Storage RLS: assigned coaches can read lift-videos objects.
--    Path convention is `${uploader_user_id}/...`. Coaches don't own the row,
--    so we join from storage path -> lift_videos.uploaded_by -> clients
--    -> coaches to authorize signed-URL generation and reads.
DROP POLICY IF EXISTS "Coach read assigned lift-videos objects" ON storage.objects;
CREATE POLICY "Coach read assigned lift-videos objects"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'lift-videos'
  AND EXISTS (
    SELECT 1
    FROM public.lift_videos lv
    JOIN public.clients c ON c.id = lv.client_id
    JOIN public.coaches co ON co.id = c.assigned_coach_id
    WHERE lv.video_storage_path = storage.objects.name
      AND co.user_id = auth.uid()
      AND co.archived = false
      AND co.status = 'Active'
  )
);

-- 3. Reset stuck rows that were marked Uploading from previous Drive-only flow.
UPDATE public.lift_videos
   SET upload_status = 'Upload Failed',
       playback_error = COALESCE(playback_error, 'Upload interrupted by previous Drive-only pipeline; please re-send.')
 WHERE upload_status = 'Uploading'
   AND created_at < now() - interval '15 minutes'
   AND video_storage_path IS NULL
   AND video_url IS NULL;
