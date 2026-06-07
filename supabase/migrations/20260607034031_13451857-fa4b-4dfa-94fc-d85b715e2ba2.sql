ALTER TABLE public.lift_videos
  ADD COLUMN IF NOT EXISTS original_drive_file_id text,
  ADD COLUMN IF NOT EXISTS original_drive_url text,
  ADD COLUMN IF NOT EXISTS drive_embed_url text,
  ADD COLUMN IF NOT EXISTS preview_url text,
  ADD COLUMN IF NOT EXISTS preview_status text NOT NULL DEFAULT 'not_generated',
  ADD COLUMN IF NOT EXISTS preview_error text,
  ADD COLUMN IF NOT EXISTS file_type text,
  ADD COLUMN IF NOT EXISTS file_size_bytes bigint,
  ADD COLUMN IF NOT EXISTS upload_status text NOT NULL DEFAULT 'Unknown',
  ADD COLUMN IF NOT EXISTS playback_error text;

UPDATE public.lift_videos lv
SET
  original_drive_file_id = COALESCE(lv.original_drive_file_id, mi.drive_file_id),
  original_drive_url = COALESCE(lv.original_drive_url, mi.drive_url),
  drive_embed_url = COALESCE(lv.drive_embed_url, mi.drive_embed_url),
  thumbnail_url = COALESCE(lv.thumbnail_url, mi.thumbnail_url),
  file_type = COALESCE(lv.file_type, mi.mime_type),
  file_size_bytes = COALESCE(lv.file_size_bytes, mi.size_bytes),
  upload_status = CASE
    WHEN mi.drive_file_id IS NOT NULL THEN 'Drive uploaded'
    ELSE lv.upload_status
  END,
  preview_status = CASE
    WHEN COALESCE(lv.preview_url, '') <> '' THEN 'ready'
    WHEN mi.drive_file_id IS NOT NULL THEN 'not_generated'
    ELSE lv.preview_status
  END
FROM public.media_items mi
WHERE mi.client_id = lv.client_id
  AND (
    mi.drive_embed_url = lv.video_url
    OR mi.drive_url = lv.video_url
    OR (mi.drive_file_id IS NOT NULL AND lv.video_url LIKE '%' || mi.drive_file_id || '%')
  );

UPDATE public.lift_videos lv
SET
  original_drive_file_id = COALESCE(lv.original_drive_file_id, substring(lv.video_url from '/file/d/([A-Za-z0-9_-]+)')),
  original_drive_url = COALESCE(lv.original_drive_url, CASE WHEN lv.video_url LIKE 'https://drive.google.com/%' THEN lv.video_url ELSE NULL END),
  drive_embed_url = COALESCE(lv.drive_embed_url, CASE WHEN lv.video_url LIKE '%/preview%' THEN lv.video_url ELSE NULL END),
  upload_status = CASE
    WHEN COALESCE(lv.original_drive_file_id, substring(lv.video_url from '/file/d/([A-Za-z0-9_-]+)')) IS NOT NULL THEN 'Drive uploaded'
    WHEN lv.video_storage_path IS NOT NULL THEN 'App storage fallback'
    ELSE lv.upload_status
  END
WHERE lv.video_url IS NOT NULL OR lv.video_storage_path IS NOT NULL;