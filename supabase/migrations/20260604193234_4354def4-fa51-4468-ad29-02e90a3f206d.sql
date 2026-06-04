
-- ============ AGREEMENT TEMPLATES ============
CREATE TABLE public.agreement_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  pdf_storage_path text NOT NULL,
  page_count integer NOT NULL DEFAULT 1,
  version integer NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  archived boolean NOT NULL DEFAULT false,
  requires_coach_signature boolean NOT NULL DEFAULT false,
  supports_payor boolean NOT NULL DEFAULT false,
  supports_minor boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agreement_templates TO authenticated;
GRANT ALL ON public.agreement_templates TO service_role;
ALTER TABLE public.agreement_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin manage agreement_templates" ON public.agreement_templates
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Auth read active agreement_templates" ON public.agreement_templates
  FOR SELECT TO authenticated USING (true);
CREATE TRIGGER trg_agreement_templates_updated_at
  BEFORE UPDATE ON public.agreement_templates
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============ TEMPLATE FIELDS ============
CREATE TABLE public.agreement_template_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.agreement_templates(id) ON DELETE CASCADE,
  page integer NOT NULL DEFAULT 1,
  x numeric NOT NULL,                 -- 0..1 normalized
  y numeric NOT NULL,                 -- 0..1 normalized (from top)
  width numeric NOT NULL,             -- 0..1 normalized
  height numeric NOT NULL,            -- 0..1 normalized
  field_type text NOT NULL,           -- text, signature, initial, date, checkbox, dropdown, phone, email, address
  signer_role text NOT NULL DEFAULT 'client', -- client, coach, payor, parent_guardian
  label text,
  internal_name text NOT NULL,
  required boolean NOT NULL DEFAULT true,
  placeholder text,
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agreement_template_fields TO authenticated;
GRANT ALL ON public.agreement_template_fields TO service_role;
ALTER TABLE public.agreement_template_fields ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin manage agreement_template_fields" ON public.agreement_template_fields
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Auth read agreement_template_fields" ON public.agreement_template_fields
  FOR SELECT TO authenticated USING (true);
CREATE INDEX idx_atf_template ON public.agreement_template_fields(template_id);
CREATE TRIGGER trg_atf_updated_at
  BEFORE UPDATE ON public.agreement_template_fields
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============ AGREEMENTS (instances) ============
CREATE TABLE public.agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  template_id uuid REFERENCES public.agreement_templates(id) ON DELETE SET NULL,
  template_version integer NOT NULL DEFAULT 1,
  template_name text NOT NULL,
  template_pdf_path text NOT NULL,             -- snapshot path of the PDF at send time
  fields_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb, -- snapshot of fields at send time
  status text NOT NULL DEFAULT 'Not Sent',     -- Not Sent, Sent, Opened, In Progress, Waiting On Client, Waiting On Coach, Completed, Expired, Cancelled, Needs Update
  signing_token text UNIQUE,
  payor_required boolean NOT NULL DEFAULT false,
  minor_required boolean NOT NULL DEFAULT false,
  requires_coach_signature boolean NOT NULL DEFAULT false,
  purchase_record_id uuid REFERENCES public.purchase_records(id) ON DELETE SET NULL,
  signed_pdf_path text,
  signed_pdf_sha256 text,
  sent_at timestamptz,
  opened_at timestamptz,
  client_signed_at timestamptz,
  coach_signed_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz,
  cancelled_at timestamptz,
  last_reminder_at timestamptz,
  admin_notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agreements TO authenticated;
GRANT ALL ON public.agreements TO service_role;
ALTER TABLE public.agreements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin manage agreements" ON public.agreements
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Coach manage assigned agreements" ON public.agreements
  FOR ALL TO authenticated
  USING (is_assigned_coach(client_id))
  WITH CHECK (is_assigned_coach(client_id));
CREATE POLICY "Client read own agreements" ON public.agreements
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = agreements.client_id AND c.user_id = auth.uid()));
CREATE POLICY "Client update own agreements" ON public.agreements
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = agreements.client_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = agreements.client_id AND c.user_id = auth.uid()));
CREATE INDEX idx_agreements_client ON public.agreements(client_id);
CREATE INDEX idx_agreements_status ON public.agreements(status);
CREATE TRIGGER trg_agreements_updated_at
  BEFORE UPDATE ON public.agreements
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============ FIELD VALUES ============
CREATE TABLE public.agreement_field_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id uuid NOT NULL REFERENCES public.agreements(id) ON DELETE CASCADE,
  field_internal_name text NOT NULL,
  signer_role text NOT NULL,
  field_type text NOT NULL,
  value_text text,
  value_signature_data_url text,
  signed_at timestamptz,
  signer_name text,
  signer_email text,
  signer_ip text,
  signer_user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agreement_id, field_internal_name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agreement_field_values TO authenticated;
GRANT ALL ON public.agreement_field_values TO service_role;
ALTER TABLE public.agreement_field_values ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin manage agreement_field_values" ON public.agreement_field_values
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Coach manage assigned agreement_field_values" ON public.agreement_field_values
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.agreements a WHERE a.id = agreement_field_values.agreement_id AND is_assigned_coach(a.client_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.agreements a WHERE a.id = agreement_field_values.agreement_id AND is_assigned_coach(a.client_id)));
CREATE POLICY "Client manage own agreement_field_values" ON public.agreement_field_values
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.agreements a JOIN public.clients c ON c.id = a.client_id WHERE a.id = agreement_field_values.agreement_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.agreements a JOIN public.clients c ON c.id = a.client_id WHERE a.id = agreement_field_values.agreement_id AND c.user_id = auth.uid()));
CREATE INDEX idx_afv_agreement ON public.agreement_field_values(agreement_id);
CREATE TRIGGER trg_afv_updated_at
  BEFORE UPDATE ON public.agreement_field_values
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============ AUDIT LOG ============
CREATE TABLE public.agreement_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id uuid NOT NULL REFERENCES public.agreements(id) ON DELETE CASCADE,
  event text NOT NULL,                 -- sent, opened, viewed, field_saved, signed, completed, reminder_sent, cancelled, voided
  actor_role text NOT NULL,            -- admin, coach, client, payor, parent_guardian, system
  actor_user_id uuid,
  signer_name text,
  signer_email text,
  ip text,
  user_agent text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.agreement_audit_log TO authenticated;
GRANT ALL ON public.agreement_audit_log TO service_role;
ALTER TABLE public.agreement_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin read agreement_audit_log" ON public.agreement_audit_log
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Coach read assigned agreement_audit_log" ON public.agreement_audit_log
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.agreements a WHERE a.id = agreement_audit_log.agreement_id AND is_assigned_coach(a.client_id)));
CREATE POLICY "Client read own agreement_audit_log" ON public.agreement_audit_log
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.agreements a JOIN public.clients c ON c.id = a.client_id WHERE a.id = agreement_audit_log.agreement_id AND c.user_id = auth.uid()));
CREATE POLICY "Admin or assigned coach insert agreement_audit_log" ON public.agreement_audit_log
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role)
    OR EXISTS (SELECT 1 FROM public.agreements a WHERE a.id = agreement_audit_log.agreement_id AND (is_assigned_coach(a.client_id) OR EXISTS (SELECT 1 FROM public.clients c WHERE c.id = a.client_id AND c.user_id = auth.uid()))));
CREATE INDEX idx_aal_agreement ON public.agreement_audit_log(agreement_id);
