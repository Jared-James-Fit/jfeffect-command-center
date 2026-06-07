
-- Singleton settings for auto-archive
CREATE TABLE IF NOT EXISTS public.media_archive_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton BOOLEAN NOT NULL DEFAULT true UNIQUE,
  auto_archive_enabled BOOLEAN NOT NULL DEFAULT false,
  chat_media_retention_days INTEGER NOT NULL DEFAULT 180,
  lift_video_retention_days INTEGER NOT NULL DEFAULT 180,
  checkin_retention_days INTEGER NOT NULL DEFAULT 180,
  progress_retention_days INTEGER NOT NULL DEFAULT 180,
  default_visibility TEXT NOT NULL DEFAULT 'follow_original',
  last_run_at TIMESTAMPTZ,
  last_run_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_archive_settings TO authenticated;
GRANT ALL ON public.media_archive_settings TO service_role;
ALTER TABLE public.media_archive_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin manage media_archive_settings"
  ON public.media_archive_settings
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER tg_media_archive_settings_updated
  BEFORE UPDATE ON public.media_archive_settings
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

INSERT INTO public.media_archive_settings (singleton) VALUES (true)
  ON CONFLICT (singleton) DO NOTHING;

-- Archive job log
CREATE TABLE IF NOT EXISTS public.media_archives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,         -- 'message_attachment' | 'lift_video' | 'media_item'
  source_id UUID NOT NULL,           -- message_id / lift_video_id / media_item_id
  source_subkey TEXT,                -- attachment index within a message, or null
  drive_file_id TEXT,
  drive_url TEXT,
  drive_folder_id TEXT,
  drive_folder_path TEXT,
  file_name TEXT,
  mime_type TEXT,
  size_bytes BIGINT,
  archive_status TEXT NOT NULL DEFAULT 'queued',  -- queued | archiving | archived | failed | restored
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  visibility TEXT NOT NULL DEFAULT 'follow_original', -- admin_only | visible_to_client | follow_original
  archived_at TIMESTAMPTZ,
  restored_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_type, source_id, source_subkey)
);

CREATE INDEX IF NOT EXISTS idx_media_archives_client ON public.media_archives (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_archives_status ON public.media_archives (archive_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_archives_source ON public.media_archives (source_type, source_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_archives TO authenticated;
GRANT ALL ON public.media_archives TO service_role;
ALTER TABLE public.media_archives ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin manage media_archives"
  ON public.media_archives
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Coach manage assigned media_archives"
  ON public.media_archives
  TO authenticated
  USING (public.is_assigned_coach(client_id))
  WITH CHECK (public.is_assigned_coach(client_id));

CREATE POLICY "Client read own visible media_archives"
  ON public.media_archives FOR SELECT
  TO authenticated
  USING (
    visibility = 'visible_to_client'
    AND EXISTS (SELECT 1 FROM public.clients c WHERE c.id = media_archives.client_id AND c.user_id = auth.uid())
  );

CREATE TRIGGER tg_media_archives_updated
  BEFORE UPDATE ON public.media_archives
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Quick lookup of Drive offload state on lift_videos and media_items
ALTER TABLE public.lift_videos
  ADD COLUMN IF NOT EXISTS drive_file_id TEXT,
  ADD COLUMN IF NOT EXISTS drive_url TEXT,
  ADD COLUMN IF NOT EXISTS drive_folder_id TEXT,
  ADD COLUMN IF NOT EXISTS archive_status TEXT;

ALTER TABLE public.media_items
  ADD COLUMN IF NOT EXISTS archive_status TEXT;
