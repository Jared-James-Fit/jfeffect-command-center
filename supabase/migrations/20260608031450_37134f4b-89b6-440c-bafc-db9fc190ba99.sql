
-- ── member_resources: powers both Resources tab and Tools tab ────────────────
CREATE TABLE public.member_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text,
  kind text NOT NULL DEFAULT 'resource',
  format text NOT NULL DEFAULT 'link',
  url text,
  storage_path text,
  thumbnail_url text,
  body_md text,
  required_access_level text NOT NULL DEFAULT 'app_membership' REFERENCES public.access_levels(key),
  status text NOT NULL DEFAULT 'Draft',
  featured boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT member_resources_kind_check CHECK (kind IN ('resource','tool')),
  CONSTRAINT member_resources_format_check CHECK (format IN ('pdf','video','link','article','calculator','embed','image')),
  CONSTRAINT member_resources_status_check CHECK (status IN ('Draft','Published','Archived'))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_resources TO authenticated;
GRANT ALL ON public.member_resources TO service_role;
ALTER TABLE public.member_resources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin manage member_resources" ON public.member_resources
  TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(),'admin'::app_role));

CREATE POLICY "Members read published resources" ON public.member_resources
  FOR SELECT TO authenticated
  USING (status = 'Published' OR public.has_role(auth.uid(),'admin'::app_role));

CREATE INDEX idx_member_resources_kind_status ON public.member_resources(kind, status);
CREATE INDEX idx_member_resources_access ON public.member_resources(required_access_level);

CREATE TRIGGER trg_member_resources_updated_at
  BEFORE UPDATE ON public.member_resources
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ── featured_member_items: support resources too ────────────────────────────
ALTER TABLE public.featured_member_items
  DROP CONSTRAINT IF EXISTS featured_member_items_item_type_check;
ALTER TABLE public.featured_member_items
  ADD CONSTRAINT featured_member_items_item_type_check CHECK (item_type IN ('plan','resource'));
ALTER TABLE public.featured_member_items
  ADD COLUMN IF NOT EXISTS resource_id uuid REFERENCES public.member_resources(id) ON DELETE CASCADE;
ALTER TABLE public.featured_member_items
  ALTER COLUMN plan_id DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS featured_member_items_resource_unique
  ON public.featured_member_items(resource_id) WHERE resource_id IS NOT NULL;

-- ── offers: member-facing upgrade catalog flags ─────────────────────────────
ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS is_member_facing boolean NOT NULL DEFAULT false;
ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS member_tier_label text;
ALTER TABLE public.coaching_products ADD COLUMN IF NOT EXISTS is_member_facing boolean NOT NULL DEFAULT false;
ALTER TABLE public.coaching_products ADD COLUMN IF NOT EXISTS member_tier_label text;
CREATE INDEX IF NOT EXISTS idx_coaching_products_member_facing
  ON public.coaching_products(is_member_facing) WHERE is_member_facing = true;
