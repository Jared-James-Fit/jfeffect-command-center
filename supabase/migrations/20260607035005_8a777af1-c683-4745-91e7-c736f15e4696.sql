UPDATE public.lift_videos
SET
  preview_status = 'ready',
  upload_status = CASE
    WHEN upload_status IN ('Unknown', 'Submitted', 'not_generated') OR upload_status IS NULL THEN 'App storage fallback'
    ELSE upload_status
  END,
  file_type = COALESCE(file_type,
    CASE
      WHEN lower(video_storage_path) LIKE '%.mov' THEN 'video/quicktime'
      WHEN lower(video_storage_path) LIKE '%.mp4' THEN 'video/mp4'
      WHEN lower(video_storage_path) LIKE '%.m4v' THEN 'video/x-m4v'
      ELSE NULL
    END
  )
WHERE video_storage_path IS NOT NULL
  AND (original_drive_file_id IS NULL OR original_drive_file_id = '')
  AND (preview_url IS NULL OR preview_url = '');