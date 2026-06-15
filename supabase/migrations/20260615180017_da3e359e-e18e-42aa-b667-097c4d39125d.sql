
-- 1) Extend member_plans with library publishing settings + counters
ALTER TABLE public.member_plans
  ADD COLUMN IF NOT EXISTS allow_pdf_download boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS allow_partial_imports boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS allow_full_program boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS public_title text,
  ADD COLUMN IF NOT EXISTS audience_mode text NOT NULL DEFAULT 'access_level',
  ADD COLUMN IF NOT EXISTS eligible_plan_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  ADD COLUMN IF NOT EXISTS notify_on_publish boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_published_version bigint,
  ADD COLUMN IF NOT EXISTS change_notes text,
  ADD COLUMN IF NOT EXISTS imports_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS previews_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pdf_downloads_count integer NOT NULL DEFAULT 0;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'member_plans_audience_mode_chk'
  ) THEN
    ALTER TABLE public.member_plans
      ADD CONSTRAINT member_plans_audience_mode_chk
      CHECK (audience_mode IN ('all_active','access_level','plans'));
  END IF;
END $$;

-- 2) Extend enrollments with import metadata
ALTER TABLE public.member_plan_enrollments
  ADD COLUMN IF NOT EXISTS source_version bigint,
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS training_days text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS import_mode text NOT NULL DEFAULT 'full',
  ADD COLUMN IF NOT EXISTS selection_json jsonb;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'member_plan_enrollments_import_mode_chk'
  ) THEN
    ALTER TABLE public.member_plan_enrollments
      ADD CONSTRAINT member_plan_enrollments_import_mode_chk
      CHECK (import_mode IN ('full','partial'));
  END IF;
END $$;

-- 3) Saved-for-later (member bookmarks)
CREATE TABLE IF NOT EXISTS public.member_plan_saved (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.app_members(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.member_plans(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_id, plan_id)
);

GRANT SELECT, INSERT, DELETE ON public.member_plan_saved TO authenticated;
GRANT ALL ON public.member_plan_saved TO service_role;
ALTER TABLE public.member_plan_saved ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read all saved plans" ON public.member_plan_saved;
CREATE POLICY "Admins read all saved plans" ON public.member_plan_saved
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

DROP POLICY IF EXISTS "Members manage own saved plans" ON public.member_plan_saved;
CREATE POLICY "Members manage own saved plans" ON public.member_plan_saved
  FOR ALL TO authenticated
  USING (member_id = public.current_member_id())
  WITH CHECK (member_id = public.current_member_id());

CREATE INDEX IF NOT EXISTS idx_member_plan_saved_member ON public.member_plan_saved(member_id);
CREATE INDEX IF NOT EXISTS idx_member_plan_saved_plan ON public.member_plan_saved(plan_id);

-- 4) Event log
CREATE TABLE IF NOT EXISTS public.member_plan_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.member_plans(id) ON DELETE CASCADE,
  member_id uuid REFERENCES public.app_members(id) ON DELETE SET NULL,
  actor_user_id uuid,
  event_type text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT member_plan_events_type_chk CHECK (
    event_type IN ('preview','import','pdf_download','save','publish','unpublish','update_publish')
  )
);

GRANT SELECT, INSERT ON public.member_plan_events TO authenticated;
GRANT ALL ON public.member_plan_events TO service_role;
ALTER TABLE public.member_plan_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read all events" ON public.member_plan_events;
CREATE POLICY "Admins read all events" ON public.member_plan_events
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

DROP POLICY IF EXISTS "Members read own events" ON public.member_plan_events;
CREATE POLICY "Members read own events" ON public.member_plan_events
  FOR SELECT TO authenticated
  USING (member_id = public.current_member_id());

DROP POLICY IF EXISTS "Members insert own events" ON public.member_plan_events;
CREATE POLICY "Members insert own events" ON public.member_plan_events
  FOR INSERT TO authenticated
  WITH CHECK (member_id = public.current_member_id());

CREATE INDEX IF NOT EXISTS idx_member_plan_events_plan ON public.member_plan_events(plan_id, event_type);
CREATE INDEX IF NOT EXISTS idx_member_plan_events_member ON public.member_plan_events(member_id);

-- 5) Audit trail (admin publish history)
CREATE TABLE IF NOT EXISTS public.member_plan_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.member_plans(id) ON DELETE CASCADE,
  action text NOT NULL,
  version bigint,
  actor_user_id uuid,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT member_plan_audit_action_chk CHECK (
    action IN ('publish','unpublish','update_publish','metadata_edit','duplicate','create')
  )
);

GRANT SELECT, INSERT ON public.member_plan_audit TO authenticated;
GRANT ALL ON public.member_plan_audit TO service_role;
ALTER TABLE public.member_plan_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read audit" ON public.member_plan_audit;
CREATE POLICY "Admins read audit" ON public.member_plan_audit
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

DROP POLICY IF EXISTS "Admins write audit" ON public.member_plan_audit;
CREATE POLICY "Admins write audit" ON public.member_plan_audit
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE INDEX IF NOT EXISTS idx_member_plan_audit_plan ON public.member_plan_audit(plan_id, created_at DESC);
