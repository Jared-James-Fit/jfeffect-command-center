
-- ============================================================
-- 1. app_members
-- ============================================================
CREATE TABLE public.app_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  account_type TEXT NOT NULL DEFAULT 'app_member' CHECK (account_type IN ('app_member','program_only')),
  status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Trial','Past Due','Cancelled','Expired','Deactivated','Archived')),
  stripe_customer_id TEXT,
  setup_token TEXT UNIQUE,
  setup_token_expires_at TIMESTAMPTZ,
  messaging_permission TEXT NOT NULL DEFAULT 'support_only' CHECK (messaging_permission IN ('none','support_only','upgrade_only')),
  last_signed_in_at TIMESTAMPTZ,
  last_active_at TIMESTAMPTZ,
  admin_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_app_members_email_lower ON public.app_members (lower(email));
CREATE INDEX idx_app_members_user_id ON public.app_members(user_id);
CREATE INDEX idx_app_members_status ON public.app_members(status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_members TO authenticated;
GRANT ALL ON public.app_members TO service_role;
ALTER TABLE public.app_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Member can read own row" ON public.app_members FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "Member can update own basic fields" ON public.app_members FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Admin manage app_members" ON public.app_members FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_app_members_updated_at BEFORE UPDATE ON public.app_members
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Helper: current member id
CREATE OR REPLACE FUNCTION public.current_member_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.app_members WHERE user_id = auth.uid() LIMIT 1
$$;

-- ============================================================
-- 2. access_levels (catalog)
-- ============================================================
CREATE TABLE public.access_levels (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.access_levels TO authenticated, anon;
GRANT ALL ON public.access_levels TO service_role;
ALTER TABLE public.access_levels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read access_levels" ON public.access_levels FOR SELECT USING (true);
CREATE POLICY "Admin manage access_levels" ON public.access_levels FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.access_levels (key, label, description, sort_order) VALUES
  ('app_membership',     'App Membership',       'Full app member access to Plan Library and Resources', 10),
  ('program_library',    'Program Library',      'Browse and start plans in the member Plan Library',    20),
  ('powerlifting_plans', 'Powerlifting Plans',   'Access to powerlifting-style plans',                   30),
  ('bodybuilding_plans', 'Bodybuilding Plans',   'Access to bodybuilding/hypertrophy plans',             40),
  ('fat_loss_plans',     'Fat Loss Plans',       'Access to fat-loss training plans',                    50),
  ('resource_library',   'Resource Library',     'Guides, PDFs, videos',                                 60),
  ('nutrition_tools',    'Nutrition Tools',      'Nutrition tools and calculators',                      70),
  ('premium_member',     'Premium Member',       'Premium tier access',                                  80),
  ('coaching_access',    'Coaching Access',      '1-on-1 coaching features',                             90);

-- ============================================================
-- 3. product_access_grants (offer -> account type + access keys)
-- ============================================================
CREATE TABLE public.product_access_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id UUID NOT NULL UNIQUE REFERENCES public.offers(id) ON DELETE CASCADE,
  account_type_granted TEXT NOT NULL DEFAULT 'app_member'
    CHECK (account_type_granted IN ('coaching_client','app_member','program_only')),
  access_level_keys TEXT[] NOT NULL DEFAULT '{}',
  included_plan_ids UUID[] NOT NULL DEFAULT '{}',
  is_subscription BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.product_access_grants TO authenticated;
GRANT ALL ON public.product_access_grants TO service_role;
ALTER TABLE public.product_access_grants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read product_access_grants" ON public.product_access_grants FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin manage product_access_grants" ON public.product_access_grants FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER trg_pag_updated_at BEFORE UPDATE ON public.product_access_grants
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============================================================
-- 4. member_access (member's currently-granted keys)
-- ============================================================
CREATE TABLE public.member_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES public.app_members(id) ON DELETE CASCADE,
  access_level_key TEXT NOT NULL REFERENCES public.access_levels(key) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'admin_grant' CHECK (source IN ('subscription','one_time','admin_grant')),
  offer_id UUID REFERENCES public.offers(id) ON DELETE SET NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_member_access_member ON public.member_access(member_id);
CREATE INDEX idx_member_access_key ON public.member_access(access_level_key);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_access TO authenticated;
GRANT ALL ON public.member_access TO service_role;
ALTER TABLE public.member_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Member reads own access" ON public.member_access FOR SELECT TO authenticated
  USING (member_id = public.current_member_id());
CREATE POLICY "Admin manage member_access" ON public.member_access FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER trg_member_access_updated_at BEFORE UPDATE ON public.member_access
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Helper: member has access
CREATE OR REPLACE FUNCTION public.member_has_access(_member_id UUID, _key TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.member_access
     WHERE member_id = _member_id
       AND access_level_key = _key
       AND active = true
       AND (expires_at IS NULL OR expires_at > now())
  )
$$;

-- ============================================================
-- 5. member_plans (published library)
-- ============================================================
CREATE TABLE public.member_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  cover_image_url TEXT,
  training_style TEXT NOT NULL DEFAULT 'custom',
  goal TEXT,
  difficulty TEXT NOT NULL DEFAULT 'All Levels' CHECK (difficulty IN ('Beginner','Intermediate','Advanced','All Levels')),
  weeks INTEGER NOT NULL DEFAULT 4,
  days_per_week INTEGER NOT NULL DEFAULT 3,
  est_minutes_per_workout INTEGER,
  equipment_needed TEXT[] NOT NULL DEFAULT '{}',
  tags TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft','Published','Archived')),
  featured BOOLEAN NOT NULL DEFAULT false,
  tracking_enabled BOOLEAN NOT NULL DEFAULT true,
  logging_enabled BOOLEAN NOT NULL DEFAULT true,
  required_access_level TEXT NOT NULL DEFAULT 'app_membership' REFERENCES public.access_levels(key),
  source_template_id UUID REFERENCES public.pl_templates(id) ON DELETE SET NULL,
  source_block_id UUID REFERENCES public.pl_blocks(id) ON DELETE SET NULL,
  published_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  workouts_total INTEGER NOT NULL DEFAULT 0,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_member_plans_status ON public.member_plans(status);
CREATE INDEX idx_member_plans_access ON public.member_plans(required_access_level);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_plans TO authenticated;
GRANT ALL ON public.member_plans TO service_role;
ALTER TABLE public.member_plans ENABLE ROW LEVEL SECURITY;
-- Members see Published plans only (visibility check; access check is enforced when starting)
CREATE POLICY "Members read published plans" ON public.member_plans FOR SELECT TO authenticated
  USING (status = 'Published' OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admin manage member_plans" ON public.member_plans FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER trg_member_plans_updated_at BEFORE UPDATE ON public.member_plans
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============================================================
-- 6. member_plan_enrollments
-- ============================================================
CREATE TABLE public.member_plan_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES public.app_members(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES public.member_plans(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Completed','Abandoned')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  current_week INTEGER NOT NULL DEFAULT 1,
  workouts_completed INTEGER NOT NULL DEFAULT 0,
  workouts_total INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_enrollments_member ON public.member_plan_enrollments(member_id);
CREATE INDEX idx_enrollments_status ON public.member_plan_enrollments(status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_plan_enrollments TO authenticated;
GRANT ALL ON public.member_plan_enrollments TO service_role;
ALTER TABLE public.member_plan_enrollments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Member manage own enrollments" ON public.member_plan_enrollments FOR ALL TO authenticated
  USING (member_id = public.current_member_id()) WITH CHECK (member_id = public.current_member_id());
CREATE POLICY "Admin manage enrollments" ON public.member_plan_enrollments FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER trg_enrollments_updated_at BEFORE UPDATE ON public.member_plan_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============================================================
-- 7. member_workout_completions
-- ============================================================
CREATE TABLE public.member_workout_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id UUID NOT NULL REFERENCES public.member_plan_enrollments(id) ON DELETE CASCADE,
  week_index INTEGER NOT NULL,
  day_index INTEGER NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (enrollment_id, week_index, day_index)
);
CREATE INDEX idx_workout_completions_enrollment ON public.member_workout_completions(enrollment_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_workout_completions TO authenticated;
GRANT ALL ON public.member_workout_completions TO service_role;
ALTER TABLE public.member_workout_completions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Member manage own completions" ON public.member_workout_completions FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.member_plan_enrollments e WHERE e.id = enrollment_id AND e.member_id = public.current_member_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.member_plan_enrollments e WHERE e.id = enrollment_id AND e.member_id = public.current_member_id()));
CREATE POLICY "Admin manage completions" ON public.member_workout_completions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============================================================
-- 8. member_set_logs
-- ============================================================
CREATE TABLE public.member_set_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id UUID NOT NULL REFERENCES public.member_plan_enrollments(id) ON DELETE CASCADE,
  week_index INTEGER NOT NULL,
  day_index INTEGER NOT NULL,
  exercise_index INTEGER NOT NULL,
  set_index INTEGER NOT NULL,
  reps INTEGER,
  load_kg NUMERIC,
  load_lb NUMERIC,
  rpe NUMERIC,
  rir NUMERIC,
  notes TEXT,
  logged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (enrollment_id, week_index, day_index, exercise_index, set_index)
);
CREATE INDEX idx_set_logs_enrollment ON public.member_set_logs(enrollment_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_set_logs TO authenticated;
GRANT ALL ON public.member_set_logs TO service_role;
ALTER TABLE public.member_set_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Member manage own set logs" ON public.member_set_logs FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.member_plan_enrollments e WHERE e.id = enrollment_id AND e.member_id = public.current_member_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.member_plan_enrollments e WHERE e.id = enrollment_id AND e.member_id = public.current_member_id()));
CREATE POLICY "Admin manage set logs" ON public.member_set_logs FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER trg_set_logs_updated_at BEFORE UPDATE ON public.member_set_logs
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
