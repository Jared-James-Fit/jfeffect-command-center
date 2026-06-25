
-- Phase 1 Foundation: Shared Media Manager content record
-- Non-destructive. Does NOT touch tasks, events, media_archives, pl_*, broadcasts, etc.

CREATE TABLE IF NOT EXISTS public.media_content_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  thumbnail_url text,
  content_type text,            -- reel, post, story, email, video, blog, etc.
  platform text,                -- instagram, tiktok, youtube, email, etc.
  production_status text NOT NULL DEFAULT 'idea',   -- idea, drafting, in_review, approved, scheduled, published
  approval_status text NOT NULL DEFAULT 'pending',  -- pending, changes_requested, approved, rejected
  campaign_id uuid,             -- soft link; not FK to avoid coupling to legacy campaign table
  pillar text,                  -- content pillar
  assignee_id uuid,             -- coach/staff user id
  reviewer_id uuid,
  priority integer NOT NULL DEFAULT 0,
  due_date date,
  publish_date date,
  publish_time time,
  hook text,
  script text,
  caption text,
  cta text,
  internal_notes text,
  reference_links jsonb NOT NULL DEFAULT '[]'::jsonb,
  linked_asset_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  linked_task_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  archived_at timestamptz,
  archived boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS media_content_records_status_idx
  ON public.media_content_records (production_status, archived);
CREATE INDEX IF NOT EXISTS media_content_records_publish_date_idx
  ON public.media_content_records (publish_date) WHERE archived = false;
CREATE INDEX IF NOT EXISTS media_content_records_assignee_idx
  ON public.media_content_records (assignee_id) WHERE archived = false;
CREATE INDEX IF NOT EXISTS media_content_records_campaign_idx
  ON public.media_content_records (campaign_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_content_records TO authenticated;
GRANT ALL ON public.media_content_records TO service_role;

ALTER TABLE public.media_content_records ENABLE ROW LEVEL SECURITY;

-- Internal-only: admins, coaches, media managers can read/write.
-- Clients/members are NOT granted any policy so RLS denies them.
DROP POLICY IF EXISTS "media staff select content records" ON public.media_content_records;
CREATE POLICY "media staff select content records"
  ON public.media_content_records FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'coach'::app_role)
    OR public.has_role(auth.uid(), 'media_manager'::app_role)
  );

DROP POLICY IF EXISTS "media staff insert content records" ON public.media_content_records;
CREATE POLICY "media staff insert content records"
  ON public.media_content_records FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'media_manager'::app_role)
  );

DROP POLICY IF EXISTS "media staff update content records" ON public.media_content_records;
CREATE POLICY "media staff update content records"
  ON public.media_content_records FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'media_manager'::app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'media_manager'::app_role)
  );

DROP POLICY IF EXISTS "admin delete content records" ON public.media_content_records;
CREATE POLICY "admin delete content records"
  ON public.media_content_records FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP TRIGGER IF EXISTS trg_media_content_records_updated_at ON public.media_content_records;
CREATE TRIGGER trg_media_content_records_updated_at
  BEFORE UPDATE ON public.media_content_records
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
