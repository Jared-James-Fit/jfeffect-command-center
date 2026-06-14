
-- =========================================================================
-- NATIVE AGREEMENTS FOUNDATION (Phase 1)
-- =========================================================================
-- Existing SignNow tables (agreements, agreement_templates, signnow_settings)
-- and JF Membership legal acceptance flow are untouched. All new tables use
-- the na_* namespace where there would be a collision.

-- Shared updated_at helper (idempotent)
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

-- Generic immutability triggers
CREATE OR REPLACE FUNCTION public.tg_block_all_modifications()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'Row is immutable (table=%, op=%)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'check_violation';
END $$;

CREATE OR REPLACE FUNCTION public.tg_block_delete()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'Deletion not permitted on % (audit-protected)', TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END $$;

-- =========================================================================
-- JURISDICTION PROFILES
-- =========================================================================
CREATE TABLE public.jurisdiction_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,                       -- e.g. 'CA-MB'
  display_name text NOT NULL,                      -- e.g. 'Manitoba, Canada'
  country text NOT NULL,
  region text,
  legal_operator_name text,
  operating_business_name text,
  business_address text,
  legal_notice_email text,
  approved_cancellation_wording text,
  max_initial_term_months integer,
  requires_installment_option boolean NOT NULL DEFAULT false,
  requires_cancellation_disclosure boolean NOT NULL DEFAULT false,
  disclosure_text text,
  status text NOT NULL DEFAULT 'legal_review_required'
    CHECK (status IN ('draft','legal_review_required','approved','published','retired')),
  legal_reviewer text,
  legal_review_date date,
  published_at timestamptz,
  retired_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.jurisdiction_profiles TO authenticated;
GRANT ALL ON public.jurisdiction_profiles TO service_role;
ALTER TABLE public.jurisdiction_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "jp read all authenticated" ON public.jurisdiction_profiles
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "jp admin write" ON public.jurisdiction_profiles
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'))
  WITH CHECK (has_role(auth.uid(),'admin'));
CREATE TRIGGER jp_updated_at BEFORE UPDATE ON public.jurisdiction_profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- =========================================================================
-- LEGAL MODULES (structured, versioned legal text)
-- =========================================================================
CREATE TABLE public.legal_modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,                       -- e.g. 'master-coaching-terms'
  internal_name text NOT NULL,
  client_facing_title text NOT NULL,
  category text NOT NULL CHECK (category IN (
    'service_order','master_terms','risk_waiver','electronic_records',
    'health_screening','guardian_consent','minor_assent','payor_authorization',
    'media_consent','addendum','single_session_waiver','statutory_notice','other'
  )),
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.legal_modules TO authenticated;
GRANT ALL ON public.legal_modules TO service_role;
ALTER TABLE public.legal_modules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lm read all" ON public.legal_modules FOR SELECT TO authenticated USING (true);
CREATE POLICY "lm admin write" ON public.legal_modules FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE TRIGGER lm_updated_at BEFORE UPDATE ON public.legal_modules
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.legal_module_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id uuid NOT NULL REFERENCES public.legal_modules(id) ON DELETE RESTRICT,
  version integer NOT NULL,
  jurisdiction_profile_id uuid REFERENCES public.jurisdiction_profiles(id),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','legal_review_required','approved','published','retired')),
  blocks jsonb NOT NULL DEFAULT '[]'::jsonb,        -- ordered content blocks
  variables jsonb NOT NULL DEFAULT '{}'::jsonb,
  conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
  required_acknowledgements jsonb NOT NULL DEFAULT '[]'::jsonb,
  required_signers jsonb NOT NULL DEFAULT '["client"]'::jsonb,
  content_hash text NOT NULL,                       -- sha256 of canonical content
  legal_reviewer text,
  legal_review_date date,
  effective_date date,
  published_at timestamptz,
  retired_at timestamptz,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (module_id, version)
);
CREATE INDEX lmv_module_status_idx ON public.legal_module_versions(module_id, status);
CREATE INDEX lmv_jurisdiction_idx ON public.legal_module_versions(jurisdiction_profile_id);
GRANT SELECT ON public.legal_module_versions TO authenticated;
GRANT ALL ON public.legal_module_versions TO service_role;
ALTER TABLE public.legal_module_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lmv read all" ON public.legal_module_versions FOR SELECT TO authenticated USING (true);
CREATE POLICY "lmv admin write" ON public.legal_module_versions FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE TRIGGER lmv_updated_at BEFORE UPDATE ON public.legal_module_versions
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Block edits to published versions (must create a new draft instead)
CREATE OR REPLACE FUNCTION public.tg_lmv_protect_published()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.status = 'published' AND NEW.status NOT IN ('published','retired') THEN
    RAISE EXCEPTION 'Cannot revert a published legal_module_version (id=%)', OLD.id;
  END IF;
  IF OLD.status = 'published' AND (
       NEW.blocks::text <> OLD.blocks::text
    OR NEW.content_hash <> OLD.content_hash
    OR NEW.required_acknowledgements::text <> OLD.required_acknowledgements::text
    OR NEW.required_signers::text <> OLD.required_signers::text
  ) THEN
    RAISE EXCEPTION 'Cannot edit content of a published legal_module_version (id=%) - create a new version', OLD.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lmv_protect_published BEFORE UPDATE ON public.legal_module_versions
  FOR EACH ROW EXECUTE FUNCTION public.tg_lmv_protect_published();

-- =========================================================================
-- NATIVE AGREEMENT TEMPLATES (separate from legacy `agreement_templates`)
-- =========================================================================
CREATE TABLE public.na_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  internal_name text NOT NULL,
  client_facing_title text NOT NULL,
  service_type text NOT NULL CHECK (service_type IN (
    'online_coaching','in_person_pt','hybrid_coaching','complimentary_session',
    'custom','package_change_addendum'
  )),
  default_jurisdiction_id uuid REFERENCES public.jurisdiction_profiles(id),
  requires_health_screening boolean NOT NULL DEFAULT false,
  countersignature_required boolean NOT NULL DEFAULT false,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.na_templates TO authenticated;
GRANT ALL ON public.na_templates TO service_role;
ALTER TABLE public.na_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "nat read all" ON public.na_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY "nat admin write" ON public.na_templates FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE TRIGGER nat_updated_at BEFORE UPDATE ON public.na_templates
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.na_template_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.na_templates(id) ON DELETE RESTRICT,
  version integer NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','legal_review_required','approved','published','retired')),
  -- ordered list of {module_id, required:bool, conditions:{...}}
  module_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  package_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  countersignature_required boolean NOT NULL DEFAULT false,
  legal_reviewer text,
  legal_review_date date,
  published_at timestamptz,
  retired_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, version)
);
GRANT SELECT ON public.na_template_versions TO authenticated;
GRANT ALL ON public.na_template_versions TO service_role;
ALTER TABLE public.na_template_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "natv read all" ON public.na_template_versions FOR SELECT TO authenticated USING (true);
CREATE POLICY "natv admin write" ON public.na_template_versions FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE TRIGGER natv_updated_at BEFORE UPDATE ON public.na_template_versions
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- =========================================================================
-- AGREEMENT PACKAGE (per-client instance)
-- =========================================================================
CREATE TABLE public.na_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  template_version_id uuid NOT NULL REFERENCES public.na_template_versions(id),
  jurisdiction_profile_id uuid NOT NULL REFERENCES public.jurisdiction_profiles(id),
  purchase_record_id uuid REFERENCES public.purchase_records(id),
  custom_title text,
  -- detailed admin status (client-facing status derived in UI)
  status text NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft','legal_review_required','ready','scheduled','sent','delivered',
    'viewed','in_progress','client_signed','guardian_pending','payor_pending',
    'countersignature_pending','completed','declined','expired','voided',
    'replaced','delivery_failed','pdf_failed','drive_sync_failed',
    'unsupported_jurisdiction'
  )),
  -- service order data (denormalized for snapshot)
  service_order jsonb NOT NULL DEFAULT '{}'::jsonb,
  financial_terms jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- minor units (cents) for fast filtering
  contract_value_minor bigint,
  currency text DEFAULT 'CAD',
  -- conditional module decisions made at creation time
  active_modules jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- supersedes / addendum chain
  parent_package_id uuid REFERENCES public.na_packages(id),
  replaces_package_id uuid REFERENCES public.na_packages(id),
  -- timestamps
  scheduled_send_at timestamptz,
  sent_at timestamptz,
  first_viewed_at timestamptz,
  completed_at timestamptz,
  voided_at timestamptz,
  voided_by uuid,
  void_reason text,
  expires_at timestamptz,
  -- jurisdiction enforcement
  jurisdiction_supported boolean NOT NULL DEFAULT true,
  jurisdiction_block_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX nap_client_idx ON public.na_packages(client_id);
CREATE INDEX nap_status_idx ON public.na_packages(status);
CREATE INDEX nap_purchase_idx ON public.na_packages(purchase_record_id);
GRANT SELECT, INSERT, UPDATE ON public.na_packages TO authenticated;
GRANT ALL ON public.na_packages TO service_role;
ALTER TABLE public.na_packages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "nap admin all" ON public.na_packages FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "nap client read own" ON public.na_packages FOR SELECT TO authenticated
  USING (client_id IN (SELECT id FROM public.clients WHERE user_id = auth.uid()));
CREATE TRIGGER nap_updated_at BEFORE UPDATE ON public.na_packages
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- =========================================================================
-- PACKAGE MODULES (resolved at send time)
-- =========================================================================
CREATE TABLE public.na_package_modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.na_packages(id) ON DELETE CASCADE,
  module_version_id uuid NOT NULL REFERENCES public.legal_module_versions(id),
  ordinal integer NOT NULL,
  required boolean NOT NULL DEFAULT true,
  conditions_met jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (package_id, ordinal),
  UNIQUE (package_id, module_version_id)
);
CREATE INDEX napm_package_idx ON public.na_package_modules(package_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.na_package_modules TO authenticated;
GRANT ALL ON public.na_package_modules TO service_role;
ALTER TABLE public.na_package_modules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "napm admin all" ON public.na_package_modules FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "napm client read own" ON public.na_package_modules FOR SELECT TO authenticated
  USING (package_id IN (
    SELECT id FROM public.na_packages
    WHERE client_id IN (SELECT id FROM public.clients WHERE user_id = auth.uid())
  ));

-- =========================================================================
-- SNAPSHOTS (immutable once sealed)
-- =========================================================================
CREATE TABLE public.na_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.na_packages(id) ON DELETE RESTRICT,
  snapshot_hash text NOT NULL,
  -- full resolved content (modules expanded with variables substituted)
  content jsonb NOT NULL,
  jurisdiction_profile_snapshot jsonb NOT NULL,
  template_version_snapshot jsonb NOT NULL,
  modules_snapshot jsonb NOT NULL,
  service_order_snapshot jsonb NOT NULL,
  financial_terms_snapshot jsonb NOT NULL,
  signers_snapshot jsonb NOT NULL,
  required_acknowledgements_snapshot jsonb NOT NULL,
  sealed boolean NOT NULL DEFAULT false,
  sealed_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (package_id, snapshot_hash)
);
CREATE INDEX nas_package_idx ON public.na_snapshots(package_id);
GRANT SELECT, INSERT ON public.na_snapshots TO authenticated;
GRANT ALL ON public.na_snapshots TO service_role;
ALTER TABLE public.na_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "nas admin all" ON public.na_snapshots FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "nas client read own" ON public.na_snapshots FOR SELECT TO authenticated
  USING (package_id IN (
    SELECT id FROM public.na_packages
    WHERE client_id IN (SELECT id FROM public.clients WHERE user_id = auth.uid())
  ));
-- Immutability: cannot edit or delete a sealed snapshot
CREATE OR REPLACE FUNCTION public.tg_nas_protect_sealed()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.sealed THEN
    RAISE EXCEPTION 'Sealed snapshot cannot be deleted (id=%)', OLD.id;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.sealed THEN
    IF NEW.snapshot_hash <> OLD.snapshot_hash
       OR NEW.content::text <> OLD.content::text
       OR NEW.sealed_at IS DISTINCT FROM OLD.sealed_at
       OR NEW.sealed <> OLD.sealed THEN
      RAISE EXCEPTION 'Sealed snapshot cannot be modified (id=%)', OLD.id;
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER nas_protect_sealed
  BEFORE UPDATE OR DELETE ON public.na_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.tg_nas_protect_sealed();

-- =========================================================================
-- SIGNERS
-- =========================================================================
CREATE TABLE public.na_signers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.na_packages(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN (
    'client','guardian','minor_assent','payor','coach_countersigner'
  )),
  ordinal integer NOT NULL DEFAULT 1,
  user_id uuid,                       -- nullable for guest signers
  full_name text NOT NULL,
  email text NOT NULL,
  phone text,
  -- payor-specific
  payor_relationship text,
  payor_obligation jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending','invited','viewed','signed','declined','revoked'
  )),
  invited_at timestamptz,
  first_viewed_at timestamptz,
  signed_at timestamptz,
  declined_at timestamptz,
  decline_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (package_id, role, ordinal)
);
CREATE INDEX nasg_package_idx ON public.na_signers(package_id);
CREATE INDEX nasg_user_idx ON public.na_signers(user_id);
GRANT SELECT, INSERT, UPDATE ON public.na_signers TO authenticated;
GRANT ALL ON public.na_signers TO service_role;
ALTER TABLE public.na_signers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "nasg admin all" ON public.na_signers FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "nasg signer read own" ON public.na_signers FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR package_id IN (
      SELECT id FROM public.na_packages
      WHERE client_id IN (SELECT id FROM public.clients WHERE user_id = auth.uid())
    )
  );
CREATE TRIGGER nasg_updated_at BEFORE UPDATE ON public.na_signers
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- =========================================================================
-- ACKNOWLEDGEMENTS  (immutable after creation)
-- =========================================================================
CREATE TABLE public.na_acknowledgements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.na_packages(id) ON DELETE RESTRICT,
  snapshot_id uuid NOT NULL REFERENCES public.na_snapshots(id) ON DELETE RESTRICT,
  signer_id uuid NOT NULL REFERENCES public.na_signers(id) ON DELETE RESTRICT,
  ack_key text NOT NULL,
  exact_wording text NOT NULL,
  module_version_id uuid REFERENCES public.legal_module_versions(id),
  accepted_at timestamptz NOT NULL DEFAULT now(),
  ip text,
  user_agent text,
  UNIQUE (snapshot_id, signer_id, ack_key)
);
CREATE INDEX naack_signer_idx ON public.na_acknowledgements(signer_id);
GRANT SELECT, INSERT ON public.na_acknowledgements TO authenticated;
GRANT ALL ON public.na_acknowledgements TO service_role;
ALTER TABLE public.na_acknowledgements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "naack admin read" ON public.na_acknowledgements FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin')
    OR signer_id IN (SELECT id FROM public.na_signers WHERE user_id = auth.uid())
    OR package_id IN (
      SELECT id FROM public.na_packages
      WHERE client_id IN (SELECT id FROM public.clients WHERE user_id = auth.uid())
    ));
CREATE POLICY "naack signer insert" ON public.na_acknowledgements FOR INSERT TO authenticated
  WITH CHECK (signer_id IN (SELECT id FROM public.na_signers WHERE user_id = auth.uid())
    OR has_role(auth.uid(),'admin'));
CREATE TRIGGER naack_immutable
  BEFORE UPDATE OR DELETE ON public.na_acknowledgements
  FOR EACH ROW EXECUTE FUNCTION public.tg_block_all_modifications();

-- =========================================================================
-- SIGNATURES (immutable; bound to snapshot)
-- =========================================================================
CREATE TABLE public.na_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.na_packages(id) ON DELETE RESTRICT,
  snapshot_id uuid NOT NULL REFERENCES public.na_snapshots(id) ON DELETE RESTRICT,
  signer_id uuid NOT NULL REFERENCES public.na_signers(id) ON DELETE RESTRICT,
  snapshot_hash text NOT NULL,
  signer_role text NOT NULL,
  typed_legal_name text NOT NULL,
  signature_method text NOT NULL CHECK (signature_method IN ('typed','drawn')),
  signature_style text,                  -- font style for typed
  signature_representation text,         -- typed text or drawn-vector reference
  intent_wording text NOT NULL,
  signed_at_server timestamptz NOT NULL DEFAULT now(),
  signed_at_utc timestamptz NOT NULL DEFAULT now(),
  displayed_local_time text,
  signer_timezone text,
  ip text,
  user_agent text,
  verification_method text,              -- 'authenticated_session' | 'guest_otp'
  auth_session_ref text,
  guest_token_id uuid,                   -- references na_guest_tokens(id)
  UNIQUE (snapshot_id, signer_id)
);
CREATE INDEX nasig_package_idx ON public.na_signatures(package_id);
GRANT SELECT, INSERT ON public.na_signatures TO authenticated;
GRANT ALL ON public.na_signatures TO service_role;
ALTER TABLE public.na_signatures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "nasig read scoped" ON public.na_signatures FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin')
    OR signer_id IN (SELECT id FROM public.na_signers WHERE user_id = auth.uid())
    OR package_id IN (
      SELECT id FROM public.na_packages
      WHERE client_id IN (SELECT id FROM public.clients WHERE user_id = auth.uid())
    ));
CREATE POLICY "nasig insert via service or signer" ON public.na_signatures FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(),'admin')
    OR signer_id IN (SELECT id FROM public.na_signers WHERE user_id = auth.uid()));
CREATE TRIGGER nasig_immutable
  BEFORE UPDATE OR DELETE ON public.na_signatures
  FOR EACH ROW EXECUTE FUNCTION public.tg_block_all_modifications();

-- =========================================================================
-- EVENTS (append-only audit log)
-- =========================================================================
CREATE TABLE public.na_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.na_packages(id) ON DELETE RESTRICT,
  snapshot_id uuid REFERENCES public.na_snapshots(id),
  signer_id uuid REFERENCES public.na_signers(id),
  event_type text NOT NULL,
  actor_user_id uuid,
  actor_role text,
  ip text,
  user_agent text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX nae_package_idx ON public.na_events(package_id, created_at DESC);
GRANT SELECT, INSERT ON public.na_events TO authenticated;
GRANT ALL ON public.na_events TO service_role;
ALTER TABLE public.na_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "nae read scoped" ON public.na_events FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin')
    OR package_id IN (
      SELECT id FROM public.na_packages
      WHERE client_id IN (SELECT id FROM public.clients WHERE user_id = auth.uid())
    ));
CREATE POLICY "nae insert any auth" ON public.na_events FOR INSERT TO authenticated WITH CHECK (true);
CREATE TRIGGER nae_immutable
  BEFORE UPDATE OR DELETE ON public.na_events
  FOR EACH ROW EXECUTE FUNCTION public.tg_block_all_modifications();

-- =========================================================================
-- DOCUMENTS (final PDFs)
-- =========================================================================
CREATE TABLE public.na_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.na_packages(id) ON DELETE RESTRICT,
  snapshot_id uuid NOT NULL REFERENCES public.na_snapshots(id),
  kind text NOT NULL CHECK (kind IN ('agreement_pdf','audit_certificate','health_screening')),
  document_version integer NOT NULL DEFAULT 1,
  snapshot_hash text NOT NULL,
  final_pdf_hash text,
  renderer text,
  renderer_version text,
  storage_bucket text,
  storage_path text,
  byte_size bigint,
  generated_at timestamptz,
  drive_account text,
  drive_folder_id text,
  drive_file_id text,
  drive_file_url text,
  drive_sync_status text DEFAULT 'pending'
    CHECK (drive_sync_status IN ('pending','syncing','synced','failed','disabled')),
  drive_sync_attempts integer NOT NULL DEFAULT 0,
  drive_last_attempt_at timestamptz,
  drive_last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (package_id, kind, document_version)
);
CREATE INDEX nad_package_idx ON public.na_documents(package_id);
CREATE INDEX nad_drive_status_idx ON public.na_documents(drive_sync_status)
  WHERE drive_sync_status IN ('pending','failed');
GRANT SELECT ON public.na_documents TO authenticated;
GRANT ALL ON public.na_documents TO service_role;
ALTER TABLE public.na_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "nad admin all" ON public.na_documents FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "nad client read own (non-health)" ON public.na_documents FOR SELECT TO authenticated
  USING (kind <> 'health_screening' AND package_id IN (
    SELECT id FROM public.na_packages
    WHERE client_id IN (SELECT id FROM public.clients WHERE user_id = auth.uid())
  ));
CREATE TRIGGER nad_updated_at BEFORE UPDATE ON public.na_documents
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
-- Cannot overwrite a final_pdf_hash once set; repairs create a new row with bumped document_version
CREATE OR REPLACE FUNCTION public.tg_nad_protect_final()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.final_pdf_hash IS NOT NULL AND NEW.final_pdf_hash IS DISTINCT FROM OLD.final_pdf_hash THEN
    RAISE EXCEPTION 'final_pdf_hash is immutable once set (document id=%) - create a new document_version row', OLD.id;
  END IF;
  IF OLD.storage_path IS NOT NULL AND NEW.storage_path IS DISTINCT FROM OLD.storage_path THEN
    RAISE EXCEPTION 'storage_path is immutable once set (document id=%)', OLD.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER nad_protect_final BEFORE UPDATE ON public.na_documents
  FOR EACH ROW EXECUTE FUNCTION public.tg_nad_protect_final();

-- =========================================================================
-- REMINDERS
-- =========================================================================
CREATE TABLE public.na_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.na_packages(id) ON DELETE CASCADE,
  signer_id uuid REFERENCES public.na_signers(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('email','sms','in_app')),
  scheduled_for timestamptz NOT NULL,
  sent_at timestamptz,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sent','failed','cancelled')),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX nar_due_idx ON public.na_reminders(scheduled_for) WHERE status = 'pending';
GRANT SELECT, INSERT, UPDATE, DELETE ON public.na_reminders TO authenticated;
GRANT ALL ON public.na_reminders TO service_role;
ALTER TABLE public.na_reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "nar admin all" ON public.na_reminders FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE TRIGGER nar_updated_at BEFORE UPDATE ON public.na_reminders
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- =========================================================================
-- GUEST SIGNING TOKENS (for guardians/payors without accounts)
-- =========================================================================
CREATE TABLE public.na_guest_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.na_packages(id) ON DELETE CASCADE,
  signer_id uuid NOT NULL REFERENCES public.na_signers(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,        -- store hash, never raw
  email_to_verify text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid,
  revoke_reason text,
  rate_limit_count integer NOT NULL DEFAULT 0,
  rate_limit_window_start timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (signer_id)
);
CREATE INDEX nagt_signer_idx ON public.na_guest_tokens(signer_id);
GRANT SELECT, INSERT, UPDATE ON public.na_guest_tokens TO authenticated;
GRANT ALL ON public.na_guest_tokens TO service_role;
ALTER TABLE public.na_guest_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "nagt admin all" ON public.na_guest_tokens FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));

-- =========================================================================
-- HEALTH SCREENING (separate, restricted)
-- =========================================================================
CREATE TABLE public.health_screenings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  package_id uuid REFERENCES public.na_packages(id) ON DELETE SET NULL,
  questionnaire_slug text NOT NULL,        -- e.g. 'par-q-plus', 'jf-custom-v1'
  questionnaire_version text NOT NULL,
  source text NOT NULL CHECK (source IN ('integrated','external_hosted','custom')),
  permission_record text,                  -- admin-confirmed permission/license
  completed_at timestamptz,
  expires_at timestamptz,
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN (
    'in_progress','cleared','review_required','clearance_required','expired'
  )),
  cleared_at timestamptz,
  cleared_by uuid,
  clearance_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX hs_client_idx ON public.health_screenings(client_id);
CREATE INDEX hs_package_idx ON public.health_screenings(package_id);
GRANT SELECT, INSERT, UPDATE ON public.health_screenings TO authenticated;
GRANT ALL ON public.health_screenings TO service_role;
ALTER TABLE public.health_screenings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hs admin all" ON public.health_screenings FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
-- Client-portal read access added in Phase 5 when the client-facing flow ships
CREATE TRIGGER hs_updated_at BEFORE UPDATE ON public.health_screenings
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.health_screening_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  screening_id uuid NOT NULL REFERENCES public.health_screenings(id) ON DELETE CASCADE,
  question_key text NOT NULL,
  answer_bool boolean,
  answer_text text,
  explanation text,
  follow_up_of text,
  answered_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (screening_id, question_key)
);
GRANT SELECT, INSERT ON public.health_screening_answers TO authenticated;
GRANT ALL ON public.health_screening_answers TO service_role;
ALTER TABLE public.health_screening_answers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hsa admin only" ON public.health_screening_answers FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));

CREATE TABLE public.medical_clearance_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  screening_id uuid NOT NULL REFERENCES public.health_screenings(id) ON DELETE CASCADE,
  storage_bucket text NOT NULL,
  storage_path text NOT NULL,
  file_hash text,
  uploaded_by uuid,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  notes text
);
GRANT SELECT, INSERT ON public.medical_clearance_documents TO authenticated;
GRANT ALL ON public.medical_clearance_documents TO service_role;
ALTER TABLE public.medical_clearance_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mcd admin only" ON public.medical_clearance_documents FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));

-- =========================================================================
-- MEDIA CONSENT (granular, with prospective withdrawal)
-- =========================================================================
CREATE TABLE public.media_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  package_id uuid REFERENCES public.na_packages(id) ON DELETE SET NULL,
  signer_id uuid REFERENCES public.na_signers(id) ON DELETE SET NULL,
  effective_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  -- per-channel granular consent flags
  consent_testimonial boolean NOT NULL DEFAULT false,
  consent_before_after boolean NOT NULL DEFAULT false,
  consent_training_video boolean NOT NULL DEFAULT false,
  consent_use_full_name boolean NOT NULL DEFAULT false,
  consent_use_first_name boolean NOT NULL DEFAULT false,
  consent_anonymous boolean NOT NULL DEFAULT false,
  consent_social_media boolean NOT NULL DEFAULT false,
  consent_website boolean NOT NULL DEFAULT false,
  consent_paid_advertising boolean NOT NULL DEFAULT false,
  withdrawn_at timestamptz,
  withdrawn_by uuid,
  withdrawal_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mc_client_idx ON public.media_consents(client_id);
GRANT SELECT, INSERT, UPDATE ON public.media_consents TO authenticated;
GRANT ALL ON public.media_consents TO service_role;
ALTER TABLE public.media_consents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mc admin all" ON public.media_consents FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "mc client own" ON public.media_consents FOR SELECT TO authenticated
  USING (client_id IN (SELECT id FROM public.clients WHERE user_id = auth.uid()));
-- Past consents are append-only: once superseded_at is set, that row is locked
CREATE OR REPLACE FUNCTION public.tg_mc_lock_superseded()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.superseded_at IS NOT NULL THEN
    RAISE EXCEPTION 'media_consent row (id=%) is superseded and locked', OLD.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER mc_lock_superseded BEFORE UPDATE ON public.media_consents
  FOR EACH ROW EXECUTE FUNCTION public.tg_mc_lock_superseded();

-- =========================================================================
-- PROPOSAL RECORDS (sales proposals, not legal agreements)
-- =========================================================================
CREATE TABLE public.proposal_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  prospect_email text,
  prospect_name text,
  service text NOT NULL,
  deliverables jsonb NOT NULL DEFAULT '[]'::jsonb,
  standard_price_minor bigint,
  offered_price_minor bigint,
  currency text DEFAULT 'CAD',
  term text,
  expires_at timestamptz,
  notes text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft','sent','viewed','accepted','declined','expired','withdrawn'
  )),
  accepted_at timestamptz,
  accepted_signer_name text,
  converted_to_package_id uuid REFERENCES public.na_packages(id),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.proposal_records TO authenticated;
GRANT ALL ON public.proposal_records TO service_role;
ALTER TABLE public.proposal_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pr admin all" ON public.proposal_records FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE TRIGGER pr_updated_at BEFORE UPDATE ON public.proposal_records
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- =========================================================================
-- LEGACY AGREEMENT RECORDS (read-only mirror of SignNow / pre-native)
-- =========================================================================
CREATE TABLE public.legacy_agreement_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system text NOT NULL,                  -- 'signnow' | 'manual' | 'paper'
  source_record_id uuid,                        -- original agreements.id if applicable
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  client_full_name text,
  client_email text,
  template_name text,
  agreement_type text,
  status text,
  signed_at timestamptz,
  signed_copy_url text,
  drive_file_url text,
  signnow_document_id text,
  imported_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (source_system, source_record_id)
);
CREATE INDEX lar_client_idx ON public.legacy_agreement_records(client_id);
GRANT SELECT, INSERT ON public.legacy_agreement_records TO authenticated;
GRANT ALL ON public.legacy_agreement_records TO service_role;
ALTER TABLE public.legacy_agreement_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lar admin read" ON public.legacy_agreement_records FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin'));
CREATE POLICY "lar admin insert" ON public.legacy_agreement_records FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(),'admin'));
-- Effectively read-only after insert (allow only re-imports via UPSERT through service role)
CREATE OR REPLACE FUNCTION public.tg_lar_block_update()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'legacy_agreement_records is read-only after import';
END $$;
CREATE TRIGGER lar_block_update BEFORE UPDATE OR DELETE ON public.legacy_agreement_records
  FOR EACH ROW EXECUTE FUNCTION public.tg_lar_block_update();

-- =========================================================================
-- STATE-MACHINE FUNCTION (writes audit event atomically)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.na_transition_package(
  _package_id uuid,
  _event_type text,
  _details jsonb DEFAULT '{}'::jsonb,
  _signer_id uuid DEFAULT NULL
)
RETURNS public.na_packages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _pkg public.na_packages;
  _new_status text;
BEGIN
  SELECT * INTO _pkg FROM public.na_packages WHERE id = _package_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'package not found'; END IF;

  _new_status := CASE _event_type
    WHEN 'mark_ready'                  THEN 'ready'
    WHEN 'scheduled'                   THEN 'scheduled'
    WHEN 'sent'                        THEN 'sent'
    WHEN 'delivered'                   THEN 'delivered'
    WHEN 'viewed'                      THEN CASE WHEN _pkg.status IN ('sent','delivered') THEN 'viewed' ELSE _pkg.status END
    WHEN 'signing_started'             THEN CASE WHEN _pkg.status IN ('viewed','sent','delivered') THEN 'in_progress' ELSE _pkg.status END
    WHEN 'client_signed'               THEN 'client_signed'
    WHEN 'guardian_pending'            THEN 'guardian_pending'
    WHEN 'payor_pending'               THEN 'payor_pending'
    WHEN 'countersignature_pending'    THEN 'countersignature_pending'
    WHEN 'completed'                   THEN 'completed'
    WHEN 'declined'                    THEN 'declined'
    WHEN 'expired'                     THEN 'expired'
    WHEN 'voided'                      THEN 'voided'
    WHEN 'replaced'                    THEN 'replaced'
    WHEN 'delivery_failed'             THEN 'delivery_failed'
    WHEN 'pdf_failed'                  THEN 'pdf_failed'
    WHEN 'drive_sync_failed'           THEN 'drive_sync_failed'
    WHEN 'unsupported_jurisdiction'    THEN 'unsupported_jurisdiction'
    ELSE _pkg.status
  END;

  IF _pkg.status IN ('completed','voided','replaced','expired','declined') AND _event_type NOT IN
       ('voided','replaced','expired','declined','viewed','signing_started') THEN
    -- terminal states; do not transition further but still allow logging events
    _new_status := _pkg.status;
  END IF;

  IF _new_status <> _pkg.status THEN
    UPDATE public.na_packages SET status = _new_status WHERE id = _package_id RETURNING * INTO _pkg;
  END IF;

  INSERT INTO public.na_events(package_id, event_type, signer_id, actor_user_id, details)
  VALUES (_package_id, _event_type, _signer_id, auth.uid(),
          jsonb_build_object('from_status', _pkg.status, 'to_status', _new_status) || COALESCE(_details,'{}'::jsonb));

  RETURN _pkg;
END $$;

REVOKE ALL ON FUNCTION public.na_transition_package(uuid,text,jsonb,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.na_transition_package(uuid,text,jsonb,uuid) TO authenticated, service_role;

-- =========================================================================
-- MANITOBA JURISDICTION SEED (legal_review_required - NOT published)
-- =========================================================================
INSERT INTO public.jurisdiction_profiles (
  code, display_name, country, region, status,
  max_initial_term_months, requires_installment_option, requires_cancellation_disclosure
) VALUES (
  'CA-MB', 'Manitoba, Canada', 'CA', 'MB', 'legal_review_required',
  12, true, true
) ON CONFLICT (code) DO NOTHING;

-- =========================================================================
-- SEED native template stubs (status legal_review_required, no module refs yet)
-- =========================================================================
INSERT INTO public.na_templates (slug, internal_name, client_facing_title, service_type, requires_health_screening)
VALUES
  ('online-coaching-adult',  'Adult Online Coaching',           'Online Coaching Agreement',            'online_coaching',        false),
  ('in-person-pt-adult',     'Adult In-Person PT',              'Personal Training Agreement',          'in_person_pt',           true),
  ('hybrid-coaching-adult',  'Adult Hybrid Coaching',           'Hybrid Coaching Agreement',            'hybrid_coaching',        true),
  ('complimentary-session',  'Single-Session Participation',    'Single-Session Participation Package', 'complimentary_session',  true),
  ('package-change-addendum','Package Change Addendum',         'Package Change Addendum',              'package_change_addendum',false)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.legal_modules (slug, internal_name, client_facing_title, category)
VALUES
  ('service-order',                'Service Order',                       'Your Service Order',                   'service_order'),
  ('master-coaching-terms',        'Master Coaching Terms',               'Coaching Terms',                       'master_terms'),
  ('risk-waiver-online',           'Online Training Risk & Waiver',       'Risk Acknowledgement & Waiver',        'risk_waiver'),
  ('risk-waiver-in-person',        'In-Person Training Risk & Waiver',    'Risk Acknowledgement & Waiver',        'risk_waiver'),
  ('risk-waiver-hybrid',           'Hybrid Risk & Waiver',                'Risk Acknowledgement & Waiver',        'risk_waiver'),
  ('electronic-records-consent',   'Electronic Records & Signature',      'Electronic Records & Signature Consent','electronic_records'),
  ('guardian-consent',             'Parent / Guardian Consent',           'Parent / Guardian Consent',            'guardian_consent'),
  ('minor-assent',                 'Minor Assent',                        'Your Acknowledgement',                 'minor_assent'),
  ('payor-authorization',          'Third-Party Payor Authorization',     'Payor Authorization',                  'payor_authorization'),
  ('media-consent',                'Optional Media Consent',              'Media Consent (Optional)',             'media_consent'),
  ('single-session-waiver',        'Single-Session Waiver',               'Single-Session Waiver',                'single_session_waiver'),
  ('manitoba-statutory-notice',    'Manitoba Statutory Notice',           'Important Manitoba Disclosure',        'statutory_notice')
ON CONFLICT (slug) DO NOTHING;
