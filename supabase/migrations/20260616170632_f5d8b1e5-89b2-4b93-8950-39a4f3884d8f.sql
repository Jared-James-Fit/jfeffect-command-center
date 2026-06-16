
CREATE TYPE public.billing_source_type AS ENUM (
  'trainerize_legacy','jfeffect_stripe','manual_external','complimentary','none'
);
CREATE TYPE public.access_source_type AS ENUM (
  'legacy_coaching','new_stripe_coaching','membership','complimentary','manual_admin'
);
CREATE TYPE public.access_status_type AS ENUM (
  'active','paused','past_due','ending','ended'
);
CREATE TYPE public.legacy_billing_status AS ENUM (
  'active','past_due','paused','cancelled','unknown'
);
CREATE TYPE public.migration_review_status AS ENUM (
  'draft','in_review','authorized','completed','cancelled'
);

ALTER TABLE public.clients
  ADD COLUMN billing_source public.billing_source_type NOT NULL DEFAULT 'none',
  ADD COLUMN billing_source_set_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN billing_source_set_at timestamptz,
  ADD COLUMN billing_source_locked boolean NOT NULL DEFAULT false,
  ADD COLUMN billing_source_notes text;

CREATE INDEX idx_clients_billing_source ON public.clients(billing_source);

CREATE TABLE public.legacy_billing_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL UNIQUE,
  trainerize_customer_ref text,
  trainerize_subscription_ref text,
  plan_name text,
  amount_cents integer,
  currency text DEFAULT 'usd',
  billing_interval text,
  next_billing_at timestamptz,
  status public.legacy_billing_status NOT NULL DEFAULT 'unknown',
  last_verified_at timestamptz,
  last_verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.legacy_billing_records TO authenticated;
GRANT ALL ON public.legacy_billing_records TO service_role;
ALTER TABLE public.legacy_billing_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage legacy billing records" ON public.legacy_billing_records
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "Service role legacy billing records" ON public.legacy_billing_records
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE public.client_access_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  access_source public.access_source_type NOT NULL,
  access_tier text,
  status public.access_status_type NOT NULL DEFAULT 'active',
  billing_source public.billing_source_type NOT NULL DEFAULT 'none',
  effective_start timestamptz NOT NULL DEFAULT now(),
  effective_end timestamptz,
  granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  last_verified_at timestamptz,
  last_verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_cae_client ON public.client_access_entitlements(client_id);
CREATE INDEX idx_cae_status ON public.client_access_entitlements(status);
CREATE INDEX idx_cae_billing_source ON public.client_access_entitlements(billing_source);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_access_entitlements TO authenticated;
GRANT ALL ON public.client_access_entitlements TO service_role;
ALTER TABLE public.client_access_entitlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage entitlements" ON public.client_access_entitlements
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "Coaches read entitlements" ON public.client_access_entitlements
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'coach'));
CREATE POLICY "Service role entitlements" ON public.client_access_entitlements
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE public.billing_migration_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  status public.migration_review_status NOT NULL DEFAULT 'draft',
  checklist jsonb NOT NULL DEFAULT '{}'::jsonb,
  current_plan_name text,
  current_amount_cents integer,
  current_currency text,
  current_interval text,
  current_next_billing_at timestamptz,
  target_product_id text,
  target_price_id text,
  authorized_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  authorized_at timestamptz,
  completed_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE INDEX idx_bmr_client ON public.billing_migration_reviews(client_id);
CREATE INDEX idx_bmr_status ON public.billing_migration_reviews(status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.billing_migration_reviews TO authenticated;
GRANT ALL ON public.billing_migration_reviews TO service_role;
ALTER TABLE public.billing_migration_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage migration reviews" ON public.billing_migration_reviews
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "Service role migration reviews" ON public.billing_migration_reviews
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE public.billing_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid,
  admin_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  previous_value jsonb,
  new_value jsonb,
  reason text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_bal_client ON public.billing_audit_log(client_id);
CREATE INDEX idx_bal_event ON public.billing_audit_log(event_type);
CREATE INDEX idx_bal_created ON public.billing_audit_log(created_at DESC);
GRANT SELECT, INSERT ON public.billing_audit_log TO authenticated;
GRANT ALL ON public.billing_audit_log TO service_role;
ALTER TABLE public.billing_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read billing audit" ON public.billing_audit_log
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "Admins insert billing audit" ON public.billing_audit_log
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "Service role billing audit" ON public.billing_audit_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER trg_lbr_updated_at BEFORE UPDATE ON public.legacy_billing_records
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER trg_cae_updated_at BEFORE UPDATE ON public.client_access_entitlements
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER trg_bmr_updated_at BEFORE UPDATE ON public.billing_migration_reviews
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
