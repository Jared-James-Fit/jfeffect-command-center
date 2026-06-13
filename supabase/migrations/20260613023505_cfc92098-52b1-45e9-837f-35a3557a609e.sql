
-- ============================================================================
-- Legal & Safety system: foundation
-- ============================================================================

-- Enums
DO $$ BEGIN
  CREATE TYPE public.legal_doc_type AS ENUM (
    'terms','privacy','coaching_disclaimer','medical_disclaimer','nutrition_disclaimer',
    'ai_disclosure','waiver','par_q','upload_consent','media_release',
    'communication_consent','cancellation_policy','custom'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.legal_version_status AS ENUM ('draft','published','archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.legal_signature_method AS ENUM ('checkbox','typed_name','signature','link_only');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.legal_audience AS ENUM (
    'everyone','all_clients','new_clients','selected_users','selected_products','selected_forms','staff'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.legal_placement_surface AS ENUM (
    'onboarding','account_centre','login_footer','signup_footer','public_form',
    'injury_form','nutrition_form','upload_field','agreement_workflow',
    'ai_message_label','app_footer','custom'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.legal_acceptance_context AS ENUM (
    'onboarding','account_centre','form_submission','agreement','upload',
    'reaccept_prompt','public_form','signup','custom'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- Tables (created first, policies added afterward to avoid forward references)
-- ============================================================================

CREATE TABLE public.legal_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_type public.legal_doc_type NOT NULL,
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  audience public.legal_audience NOT NULL DEFAULT 'all_clients',
  is_required boolean NOT NULL DEFAULT false,
  is_optional_consent boolean NOT NULL DEFAULT false,
  archived boolean NOT NULL DEFAULT false,
  current_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);

CREATE TABLE public.legal_document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.legal_documents(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  status public.legal_version_status NOT NULL DEFAULT 'draft',
  title text NOT NULL,
  summary text,
  body text NOT NULL,
  signature_method public.legal_signature_method NOT NULL DEFAULT 'checkbox',
  requires_reacceptance boolean NOT NULL DEFAULT true,
  reacceptance_audience public.legal_audience NOT NULL DEFAULT 'all_clients',
  effective_date date,
  published_at timestamptz,
  published_by uuid REFERENCES auth.users(id),
  archived_at timestamptz,
  needs_legal_review boolean NOT NULL DEFAULT true,
  legal_review_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  UNIQUE (document_id, version_number)
);

ALTER TABLE public.legal_documents
  ADD CONSTRAINT fk_legal_documents_current_version
  FOREIGN KEY (current_version_id) REFERENCES public.legal_document_versions(id) ON DELETE SET NULL;

CREATE TABLE public.legal_document_placements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.legal_documents(id) ON DELETE CASCADE,
  surface public.legal_placement_surface NOT NULL,
  required boolean NOT NULL DEFAULT false,
  context_key text,
  display_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, surface, context_key)
);

CREATE TABLE public.legal_acceptance_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES public.legal_document_versions(id) ON DELETE CASCADE,
  audience public.legal_audience NOT NULL,
  selected_user_ids uuid[] NOT NULL DEFAULT '{}',
  selected_offer_ids uuid[] NOT NULL DEFAULT '{}',
  selected_form_ids uuid[] NOT NULL DEFAULT '{}',
  block_workflows boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.legal_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  document_id uuid NOT NULL REFERENCES public.legal_documents(id),
  version_id uuid NOT NULL REFERENCES public.legal_document_versions(id),
  context public.legal_acceptance_context NOT NULL,
  context_ref text,
  signature_method public.legal_signature_method NOT NULL,
  checkbox_checked boolean NOT NULL DEFAULT false,
  typed_name text,
  acknowledgement_text text NOT NULL,
  rendered_snapshot text,
  ip_address inet,
  user_agent text,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_reason text,
  superseded_by uuid REFERENCES public.legal_acceptances(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.legal_consent_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  consent_key text NOT NULL,
  granted boolean NOT NULL,
  source_acceptance_id uuid REFERENCES public.legal_acceptances(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, consent_key)
);

-- ============================================================================
-- Grants
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON public.legal_documents TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.legal_document_versions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.legal_document_placements TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.legal_acceptance_requirements TO authenticated;
GRANT SELECT, INSERT ON public.legal_acceptances TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.legal_consent_preferences TO authenticated;
GRANT ALL ON public.legal_documents, public.legal_document_versions,
            public.legal_document_placements, public.legal_acceptance_requirements,
            public.legal_acceptances, public.legal_consent_preferences
            TO service_role;

-- ============================================================================
-- RLS
-- ============================================================================
ALTER TABLE public.legal_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_document_placements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_acceptance_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_acceptances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_consent_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage legal documents"
  ON public.legal_documents FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Active users read non-archived legal documents"
  ON public.legal_documents FOR SELECT TO authenticated
  USING (archived = false);

CREATE POLICY "Admins manage all versions"
  ON public.legal_document_versions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Active users read published or previously-accepted versions"
  ON public.legal_document_versions FOR SELECT TO authenticated
  USING (
    status = 'published'
    OR EXISTS (
      SELECT 1 FROM public.legal_acceptances la
       WHERE la.version_id = legal_document_versions.id
         AND la.user_id = auth.uid()
    )
  );

CREATE POLICY "Admins manage placements"
  ON public.legal_document_placements FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Active users read active placements"
  ON public.legal_document_placements FOR SELECT TO authenticated
  USING (active = true);

CREATE POLICY "Admins manage requirements"
  ON public.legal_acceptance_requirements FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Active users read active requirements"
  ON public.legal_acceptance_requirements FOR SELECT TO authenticated
  USING (active = true);

CREATE POLICY "Users insert their own acceptances"
  ON public.legal_acceptances FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users read their own acceptances"
  ON public.legal_acceptances FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "Admins read all acceptances"
  ON public.legal_acceptances FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Assigned coach reads client acceptances"
  ON public.legal_acceptances FOR SELECT TO authenticated
  USING (client_id IS NOT NULL AND public.is_assigned_coach(client_id));

CREATE POLICY "Users manage their own consent preferences"
  ON public.legal_consent_preferences FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "Admins read all consent preferences"
  ON public.legal_consent_preferences FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Assigned coach reads client consent preferences"
  ON public.legal_consent_preferences FOR SELECT TO authenticated
  USING (client_id IS NOT NULL AND public.is_assigned_coach(client_id));

-- ============================================================================
-- Indexes
-- ============================================================================
CREATE INDEX idx_legal_documents_type ON public.legal_documents(doc_type);
CREATE INDEX idx_legal_documents_archived ON public.legal_documents(archived);
CREATE INDEX idx_ldv_document ON public.legal_document_versions(document_id);
CREATE INDEX idx_ldv_status ON public.legal_document_versions(status);
CREATE INDEX idx_ldv_published_at ON public.legal_document_versions(published_at);
CREATE INDEX idx_ldp_surface ON public.legal_document_placements(surface);
CREATE INDEX idx_ldp_document ON public.legal_document_placements(document_id);
CREATE INDEX idx_lar_version ON public.legal_acceptance_requirements(version_id);
CREATE UNIQUE INDEX uq_legal_acceptances_unique_evidence
  ON public.legal_acceptances (
    user_id, version_id, context, COALESCE(context_ref, '')
  )
  WHERE revoked_at IS NULL;
CREATE INDEX idx_la_user ON public.legal_acceptances(user_id);
CREATE INDEX idx_la_client ON public.legal_acceptances(client_id);
CREATE INDEX idx_la_version ON public.legal_acceptances(version_id);
CREATE INDEX idx_la_document ON public.legal_acceptances(document_id);
CREATE INDEX idx_la_accepted_at ON public.legal_acceptances(accepted_at);
CREATE INDEX idx_lcp_user ON public.legal_consent_preferences(user_id);
CREATE INDEX idx_lcp_key ON public.legal_consent_preferences(consent_key);

-- ============================================================================
-- Triggers
-- ============================================================================
CREATE TRIGGER trg_legal_documents_updated_at
  BEFORE UPDATE ON public.legal_documents
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE OR REPLACE FUNCTION public.tg_legal_version_immutable()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.status = 'published' THEN
    IF NEW.body IS DISTINCT FROM OLD.body
       OR NEW.title IS DISTINCT FROM OLD.title
       OR NEW.signature_method IS DISTINCT FROM OLD.signature_method
       OR NEW.version_number IS DISTINCT FROM OLD.version_number THEN
      RAISE EXCEPTION 'Published legal versions are immutable. Create a new version instead.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TRIGGER trg_legal_version_immutable
  BEFORE UPDATE ON public.legal_document_versions
  FOR EACH ROW EXECUTE FUNCTION public.tg_legal_version_immutable();

CREATE OR REPLACE FUNCTION public.tg_legal_version_publish_stamp()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'published' AND (OLD.status IS DISTINCT FROM 'published') THEN
    NEW.published_at := COALESCE(NEW.published_at, now());
    NEW.published_by := COALESCE(NEW.published_by, auth.uid());
    UPDATE public.legal_documents
       SET current_version_id = NEW.id, updated_at = now()
     WHERE id = NEW.document_id;
  END IF;
  IF NEW.status = 'archived' AND (OLD.status IS DISTINCT FROM 'archived') THEN
    NEW.archived_at := COALESCE(NEW.archived_at, now());
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_legal_version_publish_stamp
  BEFORE UPDATE ON public.legal_document_versions
  FOR EACH ROW EXECUTE FUNCTION public.tg_legal_version_publish_stamp();

CREATE TRIGGER trg_ldp_updated_at
  BEFORE UPDATE ON public.legal_document_placements
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER trg_lar_updated_at
  BEFORE UPDATE ON public.legal_acceptance_requirements
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER trg_lcp_updated_at
  BEFORE UPDATE ON public.legal_consent_preferences
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============================================================================
-- Seed starter DRAFT templates. None published. All flagged for legal review.
-- ============================================================================
DO $$
DECLARE
  v_doc_id uuid;
  v_starter_disclaimer text :=
    E'**This is a starter template and is not legal advice.**\n\n' ||
    E'Before publishing this document, it must be reviewed and approved by a qualified attorney licensed in the jurisdictions where you operate. ' ||
    E'The language below is intended as a structural starting point only.\n\n---\n\n';
  starter_rows record;
BEGIN
  FOR starter_rows IN
    SELECT * FROM (VALUES
      ('coaching_disclaimer','coaching-disclaimer','Coaching Disclaimer',
       'Coaching services are educational and motivational in nature and are not a substitute for professional medical, mental health, or dietetic advice.'),
      ('medical_disclaimer','medical-injury-disclaimer','Medical & Injury Disclaimer',
       'This app does not provide emergency care. Coaching feedback does not replace medical diagnosis or treatment. If you are experiencing severe or urgent symptoms, contact a qualified medical professional or emergency services immediately.'),
      ('nutrition_disclaimer','nutrition-disclaimer','Nutrition Disclaimer',
       'Nutrition guidance provided through this app is general coaching information and is not a substitute for medical nutrition therapy or treatment from a registered dietitian or licensed medical professional.'),
      ('ai_disclosure','ai-assisted-coaching-disclosure','AI-Assisted Coaching Disclosure',
       'Some messages in this app are drafted with AI assistance and reviewed by your coach before delivery. AI is not a medical professional and does not replace professional care. Your coach remains responsible for the guidance you receive.'),
      ('upload_consent','upload-and-progress-photo-consent','Upload & Progress Photo Consent',
       'By uploading photos, videos, or files, you authorize your coaching team to view and store them for the purpose of coaching review. Separate optional consents control any other use.'),
      ('media_release','media-and-testimonial-release','Media & Testimonial Release',
       'OPTIONAL. Granting this release authorizes the use of selected photos, videos, or quotes for marketing, testimonials, or social media. You may revoke this consent at any time for future use.'),
      ('communication_consent','communication-consent','Communication Consent',
       'You consent to receive coaching-related communications (in-app, email, SMS where applicable). Marketing communications are separately optional.')
    ) AS t(doc_type, slug, title, summary)
  LOOP
    INSERT INTO public.legal_documents (doc_type, slug, title, audience, is_required, is_optional_consent)
    VALUES (
      starter_rows.doc_type::public.legal_doc_type,
      starter_rows.slug,
      starter_rows.title,
      'all_clients',
      starter_rows.doc_type IN ('coaching_disclaimer','medical_disclaimer','ai_disclosure','communication_consent'),
      starter_rows.doc_type IN ('media_release')
    )
    RETURNING id INTO v_doc_id;

    INSERT INTO public.legal_document_versions (
      document_id, version_number, status, title, summary, body,
      signature_method, requires_reacceptance, needs_legal_review, legal_review_note
    ) VALUES (
      v_doc_id, 1, 'draft',
      starter_rows.title,
      starter_rows.summary,
      v_starter_disclaimer || starter_rows.summary,
      'checkbox', true, true,
      'Starter template. Requires professional legal review before publishing.'
    );
  END LOOP;
END $$;
