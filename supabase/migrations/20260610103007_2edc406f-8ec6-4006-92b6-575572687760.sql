
-- 1. Extend account_type CHECK
ALTER TABLE public.app_members DROP CONSTRAINT IF EXISTS app_members_account_type_check;
ALTER TABLE public.app_members ADD CONSTRAINT app_members_account_type_check
  CHECK (account_type = ANY (ARRAY['app_member'::text, 'program_only'::text, 'jf_member'::text]));

-- 2. New access levels
INSERT INTO public.access_levels (key, label, description, sort_order) VALUES
  ('jf_membership', 'JF Membership', 'JF Membership self-guided bundle', 15),
  ('community',     'Community',     'Group chats, announcements, community feed', 25)
ON CONFLICT (key) DO NOTHING;

-- 3. Defaults table
CREATE TABLE IF NOT EXISTS public.member_access_defaults (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_type text NOT NULL,
  access_level_key text NOT NULL REFERENCES public.access_levels(key) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_type, access_level_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_access_defaults TO authenticated;
GRANT ALL ON public.member_access_defaults TO service_role;

ALTER TABLE public.member_access_defaults ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin manage member_access_defaults"
  ON public.member_access_defaults
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated read member_access_defaults"
  ON public.member_access_defaults
  FOR SELECT
  TO authenticated
  USING (true);

CREATE TRIGGER member_access_defaults_set_updated_at
  BEFORE UPDATE ON public.member_access_defaults
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 4. Seed defaults
-- JF Membership: self-guided bundle, no coaching
INSERT INTO public.member_access_defaults (account_type, access_level_key) VALUES
  ('jf_member', 'jf_membership'),
  ('jf_member', 'app_membership'),
  ('jf_member', 'program_library'),
  ('jf_member', 'resource_library'),
  ('jf_member', 'nutrition_tools'),
  ('jf_member', 'community'),
  -- App Member (existing behaviour)
  ('app_member', 'app_membership'),
  ('app_member', 'program_library'),
  ('app_member', 'resource_library'),
  ('app_member', 'community'),
  -- Program-Only (just plans)
  ('program_only', 'program_library')
ON CONFLICT (account_type, access_level_key) DO NOTHING;

-- 5. Helper function: idempotently grant defaults for a member
CREATE OR REPLACE FUNCTION public.apply_default_member_access(_member_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_type text;
  v_inserted int := 0;
BEGIN
  SELECT account_type INTO v_account_type
    FROM public.app_members WHERE id = _member_id;
  IF v_account_type IS NULL THEN RETURN 0; END IF;

  WITH ins AS (
    INSERT INTO public.member_access (member_id, access_level_key, source, active)
    SELECT _member_id, d.access_level_key, 'admin_grant', true
      FROM public.member_access_defaults d
     WHERE d.account_type = v_account_type
       AND d.enabled = true
       AND NOT EXISTS (
         SELECT 1 FROM public.member_access ma
          WHERE ma.member_id = _member_id
            AND ma.access_level_key = d.access_level_key
       )
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_inserted FROM ins;

  RETURN v_inserted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_default_member_access(uuid) TO authenticated, service_role;
