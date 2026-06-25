
ALTER TABLE public.media_resources
  ADD COLUMN IF NOT EXISTS is_favourite boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_archived  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived_at  timestamptz,
  ADD COLUMN IF NOT EXISTS provider     text,
  ADD COLUMN IF NOT EXISTS campaign_id  uuid,
  ADD COLUMN IF NOT EXISTS content_id   uuid,
  ADD COLUMN IF NOT EXISTS visibility   text NOT NULL DEFAULT 'team';

DO $$ BEGIN
  ALTER TABLE public.media_resources
    ADD CONSTRAINT media_resources_content_fkey
    FOREIGN KEY (content_id) REFERENCES public.media_content_records(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS media_resources_archived_idx ON public.media_resources (is_archived);
CREATE INDEX IF NOT EXISTS media_resources_favourite_idx ON public.media_resources (is_favourite) WHERE is_favourite;
CREATE INDEX IF NOT EXISTS media_resources_content_idx ON public.media_resources (content_id);
CREATE INDEX IF NOT EXISTS media_resources_campaign_idx ON public.media_resources (campaign_id);

ALTER TABLE public.media_resource_folders
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS sort_order  integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS media_resource_folders_archived_idx ON public.media_resource_folders (is_archived);
