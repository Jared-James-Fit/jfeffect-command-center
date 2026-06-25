
-- =========================================================
-- media_drafts
-- =========================================================
CREATE TABLE IF NOT EXISTS public.media_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL DEFAULT 'Untitled draft',
  draft_type text NOT NULL DEFAULT 'other',
  platform text,
  content_pillar text,
  campaign text,
  hook text,
  body text,
  caption text,
  cta text,
  notes text,
  reference_links jsonb NOT NULL DEFAULT '[]'::jsonb,
  linked_asset_ids uuid[] NOT NULL DEFAULT '{}',
  assignee uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft',
  is_archived boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  converted_content_id uuid REFERENCES public.media_content_records(id) ON DELETE SET NULL,
  current_version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_drafts TO authenticated;
GRANT ALL ON public.media_drafts TO service_role;

ALTER TABLE public.media_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "media_drafts_admin_or_media_select"
  ON public.media_drafts FOR SELECT TO authenticated
  USING (public.is_admin_or_media_manager(auth.uid()));
CREATE POLICY "media_drafts_admin_or_media_insert"
  ON public.media_drafts FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_or_media_manager(auth.uid()));
CREATE POLICY "media_drafts_admin_or_media_update"
  ON public.media_drafts FOR UPDATE TO authenticated
  USING (public.is_admin_or_media_manager(auth.uid()))
  WITH CHECK (public.is_admin_or_media_manager(auth.uid()));
CREATE POLICY "media_drafts_admin_delete"
  ON public.media_drafts FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS media_drafts_archived_idx ON public.media_drafts (is_archived);
CREATE INDEX IF NOT EXISTS media_drafts_status_idx ON public.media_drafts (status);
CREATE INDEX IF NOT EXISTS media_drafts_assignee_idx ON public.media_drafts (assignee);
CREATE INDEX IF NOT EXISTS media_drafts_type_idx ON public.media_drafts (draft_type);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.media_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS media_drafts_set_updated_at ON public.media_drafts;
CREATE TRIGGER media_drafts_set_updated_at
  BEFORE UPDATE ON public.media_drafts
  FOR EACH ROW EXECUTE FUNCTION public.media_set_updated_at();

-- =========================================================
-- media_draft_versions
-- =========================================================
CREATE TABLE IF NOT EXISTS public.media_draft_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL REFERENCES public.media_drafts(id) ON DELETE CASCADE,
  version integer NOT NULL,
  snapshot jsonb NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (draft_id, version)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_draft_versions TO authenticated;
GRANT ALL ON public.media_draft_versions TO service_role;

ALTER TABLE public.media_draft_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "media_draft_versions_admin_or_media_select"
  ON public.media_draft_versions FOR SELECT TO authenticated
  USING (public.is_admin_or_media_manager(auth.uid()));
CREATE POLICY "media_draft_versions_admin_or_media_insert"
  ON public.media_draft_versions FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_or_media_manager(auth.uid()));
CREATE POLICY "media_draft_versions_admin_delete"
  ON public.media_draft_versions FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS media_draft_versions_draft_idx
  ON public.media_draft_versions (draft_id, version DESC);

-- =========================================================
-- media_testimonials
-- =========================================================
CREATE TABLE IF NOT EXISTS public.media_testimonials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_name text NOT NULL,
  testimonial_type text NOT NULL DEFAULT 'written',
  headline text,
  quote text,
  result text,
  before_measurement text,
  after_measurement text,
  timeframe text,
  date_received date,
  source text,
  media_resource_ids uuid[] NOT NULL DEFAULT '{}',
  permission_status text NOT NULL DEFAULT 'permission_needed',
  permission_notes text,
  visibility text NOT NULL DEFAULT 'private',
  tags text[] NOT NULL DEFAULT '{}',
  campaign text,
  connected_page text,
  notes text,
  is_archived boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  converted_content_id uuid REFERENCES public.media_content_records(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_testimonials TO authenticated;
GRANT ALL ON public.media_testimonials TO service_role;

ALTER TABLE public.media_testimonials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "media_testimonials_admin_or_media_select"
  ON public.media_testimonials FOR SELECT TO authenticated
  USING (public.is_admin_or_media_manager(auth.uid()));
CREATE POLICY "media_testimonials_admin_or_media_insert"
  ON public.media_testimonials FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_or_media_manager(auth.uid()));
CREATE POLICY "media_testimonials_admin_or_media_update"
  ON public.media_testimonials FOR UPDATE TO authenticated
  USING (public.is_admin_or_media_manager(auth.uid()))
  WITH CHECK (public.is_admin_or_media_manager(auth.uid()));
CREATE POLICY "media_testimonials_admin_delete"
  ON public.media_testimonials FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS media_testimonials_archived_idx ON public.media_testimonials (is_archived);
CREATE INDEX IF NOT EXISTS media_testimonials_permission_idx ON public.media_testimonials (permission_status);
CREATE INDEX IF NOT EXISTS media_testimonials_type_idx ON public.media_testimonials (testimonial_type);

DROP TRIGGER IF EXISTS media_testimonials_set_updated_at ON public.media_testimonials;
CREATE TRIGGER media_testimonials_set_updated_at
  BEFORE UPDATE ON public.media_testimonials
  FOR EACH ROW EXECUTE FUNCTION public.media_set_updated_at();

-- =========================================================
-- media_templates
-- =========================================================
CREATE TABLE IF NOT EXISTS public.media_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  title text NOT NULL,
  body text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  tags text[] NOT NULL DEFAULT '{}',
  is_archived boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  attached_campaign text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_templates TO authenticated;
GRANT ALL ON public.media_templates TO service_role;

ALTER TABLE public.media_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "media_templates_admin_or_media_select"
  ON public.media_templates FOR SELECT TO authenticated
  USING (public.is_admin_or_media_manager(auth.uid()));
CREATE POLICY "media_templates_admin_or_media_insert"
  ON public.media_templates FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_or_media_manager(auth.uid()));
CREATE POLICY "media_templates_admin_or_media_update"
  ON public.media_templates FOR UPDATE TO authenticated
  USING (public.is_admin_or_media_manager(auth.uid()))
  WITH CHECK (public.is_admin_or_media_manager(auth.uid()));
CREATE POLICY "media_templates_admin_delete"
  ON public.media_templates FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS media_templates_category_idx ON public.media_templates (category);
CREATE INDEX IF NOT EXISTS media_templates_archived_idx ON public.media_templates (is_archived);

DROP TRIGGER IF EXISTS media_templates_set_updated_at ON public.media_templates;
CREATE TRIGGER media_templates_set_updated_at
  BEFORE UPDATE ON public.media_templates
  FOR EACH ROW EXECUTE FUNCTION public.media_set_updated_at();
