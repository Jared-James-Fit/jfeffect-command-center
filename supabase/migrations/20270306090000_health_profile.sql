-- One health profile per client (health-profile.ts), read by the coach's Health
-- card, the client's Account → Health & injuries, the nutrition AI (and its
-- supplement advice) and the program AI.
--
-- client_health_items: injuries, conditions, medications, supplements they take
-- and allergies, added by the coach or by the client. Staff (admins and the
-- client's own coach) manage every row; a client reads their own rows the coach
-- didn't keep to themself (coach_only) and adds / changes / removes only rows
-- they added (source = 'client').
--
-- client_health_profiles: one row per client, the coach's settings: whether
-- they compete drug-tested (and where) and how much they want to spend on
-- supplements. The client can read theirs; only staff write it.
--
-- nutrition_targets.supplements / nutrition_ai_plans.supplements: a plan's
-- supplements ({ items, notes }), suggested by supplements.ts and reviewed by
-- the coach. The client reads them with their plan.
--
-- The Nutrition Update Request gets three optional questions after allergies:
-- health conditions / injuries / medications, supplements taken now, and a
-- supplement budget.

CREATE TABLE IF NOT EXISTS public.client_health_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('injury', 'condition', 'medication', 'supplement', 'allergy')),
  label text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 120),
  details text CHECK (details IS NULL OR char_length(details) <= 1000),
  body_area text CHECK (body_area IS NULL OR char_length(body_area) <= 60),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved')),
  since date,
  resolved_on date,
  source text NOT NULL DEFAULT 'coach' CHECK (source IN ('coach', 'client')),
  coach_only boolean NOT NULL DEFAULT false,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- a client's own row is never hidden from them
  CHECK (NOT (source = 'client' AND coach_only))
);

CREATE INDEX IF NOT EXISTS client_health_items_client_idx ON public.client_health_items (client_id, status);

DROP TRIGGER IF EXISTS client_health_items_touch ON public.client_health_items;
CREATE TRIGGER client_health_items_touch
  BEFORE UPDATE ON public.client_health_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.client_health_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff read health items" ON public.client_health_items;
CREATE POLICY "Staff read health items" ON public.client_health_items
  FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')) OR client_id IN (SELECT public.coached_client_ids()));

DROP POLICY IF EXISTS "Staff add health items" ON public.client_health_items;
CREATE POLICY "Staff add health items" ON public.client_health_items
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin')) OR client_id IN (SELECT public.coached_client_ids()));

DROP POLICY IF EXISTS "Staff change health items" ON public.client_health_items;
CREATE POLICY "Staff change health items" ON public.client_health_items
  FOR UPDATE TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')) OR client_id IN (SELECT public.coached_client_ids()))
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin')) OR client_id IN (SELECT public.coached_client_ids()));

DROP POLICY IF EXISTS "Staff remove health items" ON public.client_health_items;
CREATE POLICY "Staff remove health items" ON public.client_health_items
  FOR DELETE TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')) OR client_id IN (SELECT public.coached_client_ids()));

DROP POLICY IF EXISTS "Clients read own health items" ON public.client_health_items;
CREATE POLICY "Clients read own health items" ON public.client_health_items
  FOR SELECT TO authenticated
  USING (NOT coach_only AND client_id IN (SELECT c.id FROM public.clients c WHERE c.user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "Clients add own health items" ON public.client_health_items;
CREATE POLICY "Clients add own health items" ON public.client_health_items
  FOR INSERT TO authenticated
  WITH CHECK (source = 'client' AND NOT coach_only AND client_id IN (SELECT c.id FROM public.clients c WHERE c.user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "Clients change own health items" ON public.client_health_items;
CREATE POLICY "Clients change own health items" ON public.client_health_items
  FOR UPDATE TO authenticated
  USING (source = 'client' AND client_id IN (SELECT c.id FROM public.clients c WHERE c.user_id = (SELECT auth.uid())))
  WITH CHECK (source = 'client' AND NOT coach_only AND client_id IN (SELECT c.id FROM public.clients c WHERE c.user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "Clients remove own health items" ON public.client_health_items;
CREATE POLICY "Clients remove own health items" ON public.client_health_items
  FOR DELETE TO authenticated
  USING (source = 'client' AND client_id IN (SELECT c.id FROM public.clients c WHERE c.user_id = (SELECT auth.uid())));

REVOKE ALL ON public.client_health_items FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_health_items TO authenticated;

SELECT public.rls_evaluate_once('client_health_items');

CREATE TABLE IF NOT EXISTS public.client_health_profiles (
  client_id uuid PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  drug_tested boolean,
  federation text CHECK (federation IS NULL OR char_length(federation) <= 80),
  supplement_budget text CHECK (supplement_budget IS NULL OR supplement_budget IN ('essentials', 'some', 'open')),
  updated_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS client_health_profiles_touch ON public.client_health_profiles;
CREATE TRIGGER client_health_profiles_touch
  BEFORE UPDATE ON public.client_health_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.client_health_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff read health profiles" ON public.client_health_profiles;
CREATE POLICY "Staff read health profiles" ON public.client_health_profiles
  FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')) OR client_id IN (SELECT public.coached_client_ids()));

DROP POLICY IF EXISTS "Staff add health profiles" ON public.client_health_profiles;
CREATE POLICY "Staff add health profiles" ON public.client_health_profiles
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin')) OR client_id IN (SELECT public.coached_client_ids()));

DROP POLICY IF EXISTS "Staff change health profiles" ON public.client_health_profiles;
CREATE POLICY "Staff change health profiles" ON public.client_health_profiles
  FOR UPDATE TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')) OR client_id IN (SELECT public.coached_client_ids()))
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin')) OR client_id IN (SELECT public.coached_client_ids()));

DROP POLICY IF EXISTS "Clients read own health profile" ON public.client_health_profiles;
CREATE POLICY "Clients read own health profile" ON public.client_health_profiles
  FOR SELECT TO authenticated
  USING (client_id IN (SELECT c.id FROM public.clients c WHERE c.user_id = (SELECT auth.uid())));

REVOKE ALL ON public.client_health_profiles FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.client_health_profiles TO authenticated;

SELECT public.rls_evaluate_once('client_health_profiles');

ALTER TABLE public.nutrition_targets ADD COLUMN IF NOT EXISTS supplements jsonb;
ALTER TABLE public.nutrition_ai_plans ADD COLUMN IF NOT EXISTS supplements jsonb;

-- Three optional questions on the Nutrition Update Request, right after allergies.
DO $$
DECLARE
  f uuid := 'b7a1f0c2-5d3e-4c8a-9f21-6e0d4a1b2c3d';
  after_allergies int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.nf_forms WHERE id = f) THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.nf_questions WHERE form_id = f AND archived_at IS NULL AND label ILIKE 'Any health conditions%') THEN
    RETURN;
  END IF;
  SELECT order_index INTO after_allergies
    FROM public.nf_questions
   WHERE form_id = f AND archived_at IS NULL AND label ILIKE '%allerg%'
   ORDER BY order_index LIMIT 1;
  IF after_allergies IS NULL THEN
    SELECT coalesce(max(order_index), 0) INTO after_allergies FROM public.nf_questions WHERE form_id = f AND archived_at IS NULL;
  END IF;
  UPDATE public.nf_questions SET order_index = order_index + 3 WHERE form_id = f AND order_index > after_allergies;
  INSERT INTO public.nf_questions (form_id, order_index, question_type, label, help_text, required, options, validation)
  VALUES
    (f, after_allergies + 1, 'long_text', 'Any health conditions, injuries or medications? List them, or write none.',
     'This helps us keep your plan and supplements safe. Only you and your coach see it.', false, '[]'::jsonb,
     '{"quick": ["None"], "quick_exclusive": ["None"]}'::jsonb),
    (f, after_allergies + 2, 'long_text', 'What supplements do you take now? Name and dose, or write none.',
     NULL, false, '[]'::jsonb,
     '{"quick": ["None"], "quick_exclusive": ["None"]}'::jsonb),
    (f, after_allergies + 3, 'single_choice', 'How much do you want to spend on supplements?',
     NULL, false, '["Just the essentials", "A few worthwhile extras", "Whatever''s worth it"]'::jsonb, '{}'::jsonb);
END $$;
