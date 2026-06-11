
-- Helper
CREATE OR REPLACE FUNCTION public.is_media_manager(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_uid, 'media_manager'::app_role)
$$;

-- Review status enum
DO $$ BEGIN
  CREATE TYPE public.review_status AS ENUM ('draft','needs_review','approved','published','archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Broadcasts
ALTER TABLE public.broadcasts
  ADD COLUMN IF NOT EXISTS review_status public.review_status NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS submitted_by uuid,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_notes text;

-- Events
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS review_status public.review_status NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS submitted_by uuid,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_notes text;

-- Sales pages drafts
ALTER TABLE public.sales_pages
  ADD COLUMN IF NOT EXISTS draft_payload jsonb,
  ADD COLUMN IF NOT EXISTS draft_status public.review_status,
  ADD COLUMN IF NOT EXISTS draft_submitted_by uuid,
  ADD COLUMN IF NOT EXISTS draft_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS draft_reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS draft_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS draft_notes text;

CREATE INDEX IF NOT EXISTS idx_broadcasts_review_status ON public.broadcasts(review_status);
CREATE INDEX IF NOT EXISTS idx_events_review_status ON public.events(review_status);

-- Media visibility
DO $$ BEGIN
  CREATE TYPE public.media_visibility AS ENUM ('private','marketing','public');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.media_items
  ADD COLUMN IF NOT EXISTS marketing_visibility public.media_visibility NOT NULL DEFAULT 'private';

ALTER TABLE public.media_archives
  ADD COLUMN IF NOT EXISTS marketing_visibility public.media_visibility NOT NULL DEFAULT 'private';

CREATE INDEX IF NOT EXISTS idx_media_items_marketing_vis ON public.media_items(marketing_visibility) WHERE marketing_visibility <> 'private';
CREATE INDEX IF NOT EXISTS idx_media_archives_marketing_vis ON public.media_archives(marketing_visibility) WHERE marketing_visibility <> 'private';

-- Staff invites
CREATE TABLE IF NOT EXISTS public.staff_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  first_name text,
  last_name text,
  phone text,
  role public.app_role NOT NULL,
  setup_token text UNIQUE,
  setup_token_expires_at timestamptz,
  status text NOT NULL DEFAULT 'pending',
  redeemed_user_id uuid,
  redeemed_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_invites TO authenticated;
GRANT ALL ON public.staff_invites TO service_role;

ALTER TABLE public.staff_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_invites admin all" ON public.staff_invites;
CREATE POLICY "staff_invites admin all" ON public.staff_invites
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

DROP TRIGGER IF EXISTS tg_staff_invites_updated_at ON public.staff_invites;
CREATE TRIGGER tg_staff_invites_updated_at
  BEFORE UPDATE ON public.staff_invites
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Media Manager RLS — broadcasts
DROP POLICY IF EXISTS "broadcasts media_manager read" ON public.broadcasts;
CREATE POLICY "broadcasts media_manager read" ON public.broadcasts
  FOR SELECT TO authenticated
  USING (public.is_media_manager(auth.uid()));

DROP POLICY IF EXISTS "broadcasts media_manager insert draft" ON public.broadcasts;
CREATE POLICY "broadcasts media_manager insert draft" ON public.broadcasts
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_media_manager(auth.uid())
    AND review_status IN ('draft','needs_review')
    AND submitted_by = auth.uid()
  );

DROP POLICY IF EXISTS "broadcasts media_manager update own draft" ON public.broadcasts;
CREATE POLICY "broadcasts media_manager update own draft" ON public.broadcasts
  FOR UPDATE TO authenticated
  USING (
    public.is_media_manager(auth.uid())
    AND submitted_by = auth.uid()
    AND review_status IN ('draft','needs_review')
  )
  WITH CHECK (
    public.is_media_manager(auth.uid())
    AND submitted_by = auth.uid()
    AND review_status IN ('draft','needs_review')
  );

-- Events
DROP POLICY IF EXISTS "events media_manager read" ON public.events;
CREATE POLICY "events media_manager read" ON public.events
  FOR SELECT TO authenticated
  USING (public.is_media_manager(auth.uid()));

DROP POLICY IF EXISTS "events media_manager insert draft" ON public.events;
CREATE POLICY "events media_manager insert draft" ON public.events
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_media_manager(auth.uid())
    AND review_status IN ('draft','needs_review')
    AND submitted_by = auth.uid()
  );

DROP POLICY IF EXISTS "events media_manager update own draft" ON public.events;
CREATE POLICY "events media_manager update own draft" ON public.events
  FOR UPDATE TO authenticated
  USING (
    public.is_media_manager(auth.uid())
    AND submitted_by = auth.uid()
    AND review_status IN ('draft','needs_review')
  )
  WITH CHECK (
    public.is_media_manager(auth.uid())
    AND submitted_by = auth.uid()
    AND review_status IN ('draft','needs_review')
  );

-- Sales pages: read + draft-only update enforced by trigger
DROP POLICY IF EXISTS "sales_pages media_manager read" ON public.sales_pages;
CREATE POLICY "sales_pages media_manager read" ON public.sales_pages
  FOR SELECT TO authenticated
  USING (public.is_media_manager(auth.uid()));

DROP POLICY IF EXISTS "sales_pages media_manager update draft" ON public.sales_pages;
CREATE POLICY "sales_pages media_manager update draft" ON public.sales_pages
  FOR UPDATE TO authenticated
  USING (public.is_media_manager(auth.uid()))
  WITH CHECK (public.is_media_manager(auth.uid()));

CREATE OR REPLACE FUNCTION public.tg_sales_pages_mm_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN NEW;
  END IF;
  IF public.is_media_manager(auth.uid()) THEN
    IF NEW.published IS DISTINCT FROM OLD.published
       OR NEW.hero_headline IS DISTINCT FROM OLD.hero_headline
       OR NEW.hero_subheadline IS DISTINCT FROM OLD.hero_subheadline
       OR NEW.hero_image_url IS DISTINCT FROM OLD.hero_image_url
       OR NEW.primary_cta_label IS DISTINCT FROM OLD.primary_cta_label
       OR NEW.primary_cta_kind IS DISTINCT FROM OLD.primary_cta_kind
       OR NEW.primary_cta_url IS DISTINCT FROM OLD.primary_cta_url
       OR NEW.secondary_cta_label IS DISTINCT FROM OLD.secondary_cta_label
       OR NEW.secondary_cta_href IS DISTINCT FROM OLD.secondary_cta_href
       OR NEW.sections IS DISTINCT FROM OLD.sections
       OR NEW.visuals IS DISTINCT FROM OLD.visuals
       OR NEW.testimonials IS DISTINCT FROM OLD.testimonials
       OR NEW.promo_message IS DISTINCT FROM OLD.promo_message
    THEN
      RAISE EXCEPTION 'Media Manager can only edit draft fields. Submit for admin approval.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.draft_status IS NULL OR NEW.draft_status NOT IN ('draft','needs_review') THEN
      RAISE EXCEPTION 'Draft status must be draft or needs_review for Media Manager edits.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_sales_pages_mm_guard ON public.sales_pages;
CREATE TRIGGER tg_sales_pages_mm_guard
  BEFORE UPDATE ON public.sales_pages
  FOR EACH ROW EXECUTE FUNCTION public.tg_sales_pages_mm_guard();

-- Media items
DROP POLICY IF EXISTS "media_items media_manager read marketing" ON public.media_items;
CREATE POLICY "media_items media_manager read marketing" ON public.media_items
  FOR SELECT TO authenticated
  USING (
    public.is_media_manager(auth.uid())
    AND marketing_visibility IN ('marketing','public')
    AND media_type NOT IN ('Check-In Videos','Progress Photos','Lift Videos','Client Documents','Private')
  );

DROP POLICY IF EXISTS "media_archives media_manager read marketing" ON public.media_archives;
CREATE POLICY "media_archives media_manager read marketing" ON public.media_archives
  FOR SELECT TO authenticated
  USING (
    public.is_media_manager(auth.uid())
    AND marketing_visibility IN ('marketing','public')
    AND source_type NOT IN ('lift_video','check_in_video','progress_photo','agreement','client_document')
  );

-- Tasks: allow Media Manager to read tasks assigned to them
DROP POLICY IF EXISTS "tasks media_manager read assigned" ON public.tasks;
CREATE POLICY "tasks media_manager read assigned" ON public.tasks
  FOR SELECT TO authenticated
  USING (
    public.is_media_manager(auth.uid())
    AND assigned_to = auth.uid()
  );
