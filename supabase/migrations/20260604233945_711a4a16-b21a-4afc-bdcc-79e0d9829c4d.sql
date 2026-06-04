
ALTER TABLE public.exercises
  ADD COLUMN IF NOT EXISTS video_provider text DEFAULT 'youtube',
  ADD COLUMN IF NOT EXISTS video_url text,
  ADD COLUMN IF NOT EXISTS vimeo_video_id text,
  ADD COLUMN IF NOT EXISTS vimeo_url text,
  ADD COLUMN IF NOT EXISTS vimeo_embed_url text,
  ADD COLUMN IF NOT EXISTS thumbnail_url text,
  ADD COLUMN IF NOT EXISTS legacy_youtube_url text,
  ADD COLUMN IF NOT EXISTS source_youtube_url text,
  ADD COLUMN IF NOT EXISTS youtube_replaced boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS youtube_fallback_allowed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS video_migration_status text DEFAULT 'youtube_pending',
  ADD COLUMN IF NOT EXISTS source_type text,
  ADD COLUMN IF NOT EXISTS source_quality text,
  ADD COLUMN IF NOT EXISTS quality_warning text,
  ADD COLUMN IF NOT EXISTS vimeo_working boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS safe_to_publish boolean NOT NULL DEFAULT false;

UPDATE public.exercises
   SET legacy_youtube_url = COALESCE(legacy_youtube_url, youtube_url),
       source_youtube_url = COALESCE(source_youtube_url, youtube_url),
       video_migration_status = COALESCE(video_migration_status, 'youtube_pending'),
       video_provider = COALESCE(video_provider, 'youtube')
 WHERE youtube_url IS NOT NULL AND youtube_url <> '';
