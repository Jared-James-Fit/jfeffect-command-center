-- POV impersonation + curated featured items

-- 1) Sandbox flag on app_members so admin POV rows don't pollute real metrics.
ALTER TABLE public.app_members
  ADD COLUMN IF NOT EXISTS is_admin_sandbox boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS app_members_is_admin_sandbox_idx
  ON public.app_members (is_admin_sandbox) WHERE is_admin_sandbox = true;

-- 2) Curated featured list (admin-managed). Phase 1 supports member_plan items.
CREATE TABLE IF NOT EXISTS public.featured_member_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_type text NOT NULL CHECK (item_type IN ('plan')),
  plan_id uuid REFERENCES public.member_plans(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT featured_member_items_plan_unique UNIQUE (plan_id)
);

GRANT SELECT ON public.featured_member_items TO authenticated;
GRANT ALL ON public.featured_member_items TO service_role;

ALTER TABLE public.featured_member_items ENABLE ROW LEVEL SECURITY;

-- Members can read active featured items; admins can read all (writes via server fn / service_role).
CREATE POLICY "Anyone authenticated can read active featured items"
  ON public.featured_member_items FOR SELECT
  TO authenticated
  USING (active = true OR public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER featured_member_items_updated_at
  BEFORE UPDATE ON public.featured_member_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE INDEX IF NOT EXISTS featured_member_items_position_idx
  ON public.featured_member_items (active, position);