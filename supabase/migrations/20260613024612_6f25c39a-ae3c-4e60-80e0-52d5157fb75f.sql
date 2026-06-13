-- ============================================================================
-- Legal & Safety: enforcement safeguards (Pass 2 foundation)
-- ============================================================================

-- 1) Enforcement mode enum
DO $$ BEGIN
  CREATE TYPE public.legal_enforcement_mode AS ENUM (
    'notice_only',
    'workflow_gate',
    'onboarding_gate',
    'full_portal_gate'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) New columns on legal_documents
ALTER TABLE public.legal_documents
  ADD COLUMN IF NOT EXISTS enforcement_mode public.legal_enforcement_mode NOT NULL DEFAULT 'notice_only',
  ADD COLUMN IF NOT EXISTS enforcement_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS effective_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS grace_period_days integer NOT NULL DEFAULT 0
    CHECK (grace_period_days >= 0 AND grace_period_days <= 365),
  ADD COLUMN IF NOT EXISTS emergency_disabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS emergency_disabled_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS emergency_disabled_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS emergency_disabled_reason text NULL,
  ADD COLUMN IF NOT EXISTS audience_user_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS audience_product_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS audience_form_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS audience_offer_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS applies_to_new_users_only boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS public_read_allowed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS test_mode boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_legal_documents_enforcement
  ON public.legal_documents (enforcement_enabled, enforcement_mode)
  WHERE enforcement_enabled = true AND emergency_disabled = false;

CREATE INDEX IF NOT EXISTS idx_legal_documents_public_read
  ON public.legal_documents (doc_type)
  WHERE public_read_allowed = true AND archived = false;

-- 3) Audit table
CREATE TABLE IF NOT EXISTS public.legal_enforcement_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.legal_documents(id) ON DELETE CASCADE,
  version_id uuid NULL REFERENCES public.legal_document_versions(id) ON DELETE SET NULL,
  actor_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  event text NOT NULL CHECK (event IN (
    'enforcement_enabled','enforcement_disabled',
    'emergency_disabled','emergency_cleared',
    'mode_changed','audience_changed','effective_date_changed',
    'grace_period_changed','test_mode_changed',
    'global_kill_switch_enabled','global_kill_switch_disabled'
  )),
  previous_value jsonb NULL,
  new_value jsonb NULL,
  note text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.legal_enforcement_audit TO authenticated;
GRANT ALL ON public.legal_enforcement_audit TO service_role;
ALTER TABLE public.legal_enforcement_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read enforcement audit" ON public.legal_enforcement_audit;
CREATE POLICY "Admins read enforcement audit"
  ON public.legal_enforcement_audit
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins insert enforcement audit" ON public.legal_enforcement_audit;
CREATE POLICY "Admins insert enforcement audit"
  ON public.legal_enforcement_audit
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX IF NOT EXISTS idx_legal_enforcement_audit_doc
  ON public.legal_enforcement_audit (document_id, created_at DESC);

-- 4) Global kill switch in app_settings (value column is text — store JSON as text)
INSERT INTO public.app_settings (key, value)
VALUES (
  'legal_enforcement',
  jsonb_build_object(
    'global_kill_switch', false,
    'reason', null,
    'updated_at', now()
  )::text
)
ON CONFLICT (key) DO NOTHING;

-- 5) Helper: is global kill switch active?
CREATE OR REPLACE FUNCTION public.legal_kill_switch_active()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((value::jsonb->>'global_kill_switch')::boolean, false)
    FROM public.app_settings
   WHERE key = 'legal_enforcement'
   LIMIT 1
$$;

-- 6) Helper: effective enforcement for (doc, user)
CREATE OR REPLACE FUNCTION public.legal_effective_enforcement(_doc_id uuid, _user_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d record;
  v_in_audience boolean := true;
  v_account_created timestamptz;
BEGIN
  IF public.legal_kill_switch_active() THEN RETURN 'inactive'; END IF;

  SELECT * INTO d FROM public.legal_documents WHERE id = _doc_id;
  IF NOT FOUND OR d.archived THEN RETURN 'inactive'; END IF;
  IF d.emergency_disabled THEN RETURN 'inactive'; END IF;
  IF NOT d.enforcement_enabled THEN RETURN 'notice_only'; END IF;
  IF d.effective_at IS NOT NULL AND d.effective_at > now() THEN RETURN 'inactive'; END IF;

  IF d.audience = 'selected_users' THEN
    v_in_audience := _user_id = ANY(d.audience_user_ids);
  ELSIF d.audience = 'staff' THEN
    v_in_audience := public.is_coach_or_admin(_user_id);
  ELSIF d.audience = 'new_clients' OR d.applies_to_new_users_only THEN
    SELECT account_created_at INTO v_account_created
      FROM public.clients WHERE user_id = _user_id LIMIT 1;
    IF d.effective_at IS NOT NULL THEN
      v_in_audience := v_account_created IS NOT NULL AND v_account_created >= d.effective_at;
    ELSE
      v_in_audience := v_account_created IS NOT NULL
        AND v_account_created >= COALESCE(d.created_at, '-infinity'::timestamptz);
    END IF;
  ELSIF d.audience IN ('all_clients','everyone') THEN
    v_in_audience := true;
  ELSIF d.audience IN ('selected_products','selected_forms') THEN
    RETURN 'notice_only';
  END IF;

  IF NOT v_in_audience THEN RETURN 'inactive'; END IF;

  IF d.grace_period_days > 0 AND d.effective_at IS NOT NULL THEN
    IF now() < d.effective_at + make_interval(days => d.grace_period_days) THEN
      RETURN 'notice_only';
    END IF;
  END IF;

  RETURN d.enforcement_mode::text;
END;
$$;

GRANT EXECUTE ON FUNCTION public.legal_kill_switch_active() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.legal_effective_enforcement(uuid, uuid) TO authenticated;

-- 7) Public read of Terms / Privacy
DO $$ BEGIN EXECUTE 'GRANT SELECT ON public.legal_documents TO anon'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'GRANT SELECT ON public.legal_document_versions TO anon'; EXCEPTION WHEN OTHERS THEN NULL; END $$;

DROP POLICY IF EXISTS "Public can read published, public-allowed documents" ON public.legal_documents;
CREATE POLICY "Public can read published, public-allowed documents"
  ON public.legal_documents
  FOR SELECT TO anon
  USING (
    public_read_allowed = true
    AND archived = false
    AND emergency_disabled = false
  );

DROP POLICY IF EXISTS "Public can read published, public-allowed versions" ON public.legal_document_versions;
CREATE POLICY "Public can read published, public-allowed versions"
  ON public.legal_document_versions
  FOR SELECT TO anon
  USING (
    status = 'published'
    AND EXISTS (
      SELECT 1 FROM public.legal_documents d
       WHERE d.id = legal_document_versions.document_id
         AND d.public_read_allowed = true
         AND d.archived = false
         AND d.emergency_disabled = false
         AND d.current_version_id = legal_document_versions.id
    )
  );

-- 8) Defensive backfill — keep any pre-existing documents in safe defaults
UPDATE public.legal_documents
   SET enforcement_mode = COALESCE(enforcement_mode, 'notice_only'),
       enforcement_enabled = COALESCE(enforcement_enabled, false);
