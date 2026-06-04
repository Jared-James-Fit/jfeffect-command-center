
-- ============ OFFERS: expand schema ============
ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS short_description text,
  ADD COLUMN IF NOT EXISTS full_payable_amount numeric,
  ADD COLUMN IF NOT EXISTS amount_due_today numeric,
  ADD COLUMN IF NOT EXISTS deposit_amount numeric,
  ADD COLUMN IF NOT EXISTS number_of_payments integer,
  ADD COLUMN IF NOT EXISTS payment_amount numeric,
  ADD COLUMN IF NOT EXISTS payment_frequency text,
  ADD COLUMN IF NOT EXISTS payment_start_date date,
  ADD COLUMN IF NOT EXISTS final_payment_date date,
  ADD COLUMN IF NOT EXISTS billing_day integer,
  ADD COLUMN IF NOT EXISTS taxes_included boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_processing_note text,
  ADD COLUMN IF NOT EXISTS late_failed_policy text,
  ADD COLUMN IF NOT EXISTS refund_policy text,
  ADD COLUMN IF NOT EXISTS cancellation_policy text,
  ADD COLUMN IF NOT EXISTS is_fixed_term_commitment boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS commitment_term_length text,
  ADD COLUMN IF NOT EXISTS commitment_start_date date,
  ADD COLUMN IF NOT EXISTS commitment_end_date date,
  ADD COLUMN IF NOT EXISTS installment_amount numeric,
  ADD COLUMN IF NOT EXISTS installment_frequency text,
  ADD COLUMN IF NOT EXISTS installment_due_day integer,
  ADD COLUMN IF NOT EXISTS term_start_date date,
  ADD COLUMN IF NOT EXISTS term_end_date date,
  ADD COLUMN IF NOT EXISTS term_duration integer,
  ADD COLUMN IF NOT EXISTS term_duration_unit text,
  ADD COLUMN IF NOT EXISTS access_length text,
  ADD COLUMN IF NOT EXISTS renewal_date date,
  ADD COLUMN IF NOT EXISTS expiration_date date,
  ADD COLUMN IF NOT EXISTS is_recurring boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS minimum_commitment_length text,
  ADD COLUMN IF NOT EXISTS package_expiry_date date,
  ADD COLUMN IF NOT EXISTS location text,
  ADD COLUMN IF NOT EXISTS session_length_minutes integer,
  ADD COLUMN IF NOT EXISTS sessions_included integer,
  ADD COLUMN IF NOT EXISTS cancellation_window text,
  ADD COLUMN IF NOT EXISTS no_show_policy text,
  ADD COLUMN IF NOT EXISTS late_arrival_policy text,
  ADD COLUMN IF NOT EXISTS rescheduling_policy text,
  ADD COLUMN IF NOT EXISTS transferability_policy text,
  ADD COLUMN IF NOT EXISTS gym_access_note text,
  ADD COLUMN IF NOT EXISTS included_features text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS excluded_features text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS requires_agreement boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS purchase_disclaimer text,
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_edited_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_template boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS template_source_id uuid,
  ADD COLUMN IF NOT EXISTS admin_notes text,
  ADD COLUMN IF NOT EXISTS delivery_assets jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;

-- bump version on edit
CREATE OR REPLACE FUNCTION public.tg_offer_bump_version()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.last_edited_at := now();
    -- only bump if user-facing details changed
    IF (NEW.name IS DISTINCT FROM OLD.name
        OR NEW.price IS DISTINCT FROM OLD.price
        OR NEW.full_payable_amount IS DISTINCT FROM OLD.full_payable_amount
        OR NEW.payment_structure IS DISTINCT FROM OLD.payment_structure
        OR NEW.payment_frequency IS DISTINCT FROM OLD.payment_frequency
        OR NEW.included_features IS DISTINCT FROM OLD.included_features
        OR NEW.excluded_features IS DISTINCT FROM OLD.excluded_features
        OR NEW.cancellation_policy IS DISTINCT FROM OLD.cancellation_policy
        OR NEW.refund_policy IS DISTINCT FROM OLD.refund_policy
        OR NEW.term_duration IS DISTINCT FROM OLD.term_duration
        OR NEW.term_duration_unit IS DISTINCT FROM OLD.term_duration_unit) THEN
      NEW.version := COALESCE(OLD.version, 1) + 1;
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS offers_bump_version ON public.offers;
CREATE TRIGGER offers_bump_version BEFORE UPDATE ON public.offers
  FOR EACH ROW EXECUTE FUNCTION public.tg_offer_bump_version();

-- ============ CLIENTS: agreement status fields ============
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS agreement_signed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS agreement_signed_date date,
  ADD COLUMN IF NOT EXISTS agreement_version text,
  ADD COLUMN IF NOT EXISTS agreement_status text NOT NULL DEFAULT 'Not Sent',
  ADD COLUMN IF NOT EXISTS agreement_signature_platform_link text;

-- ============ PURCHASE RECORDS ============
CREATE TABLE IF NOT EXISTS public.purchase_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  offer_id uuid,                       -- null if offer later deleted
  offer_version integer,
  -- snapshot of offer at purchase time
  offer_name text NOT NULL,
  offer_type text,
  short_description text,
  full_description text,
  currency text DEFAULT 'USD',
  full_payable_amount numeric,
  amount_due_today numeric,
  deposit_amount numeric,
  payment_structure text,
  payment_frequency text,
  number_of_payments integer,
  installment_amount numeric,
  stripe_payment_link text,
  stripe_checkout_session_id text,
  stripe_price_id text,
  stripe_product_id text,
  -- term
  term_start_date date,
  term_end_date date,
  term_duration_text text,
  package_expiry_date date,
  is_recurring boolean DEFAULT false,
  is_fixed_term_commitment boolean DEFAULT false,
  -- inclusions / policies snapshot
  included_features text[] DEFAULT '{}'::text[],
  excluded_features text[] DEFAULT '{}'::text[],
  cancellation_policy text,
  refund_policy text,
  in_person_policy text,
  purchase_disclaimer text,
  -- in-person session tracking
  location text,
  session_length_minutes integer,
  sessions_purchased integer DEFAULT 0,
  sessions_used integer DEFAULT 0,
  sessions_booked integer DEFAULT 0,
  sessions_completed integer DEFAULT 0,
  sessions_missed integer DEFAULT 0,
  sessions_cancelled integer DEFAULT 0,
  package_tracking_enabled boolean DEFAULT false,
  -- agreement linkage at purchase time
  agreement_signed_at_purchase boolean DEFAULT false,
  agreement_signed_date date,
  agreement_version text,
  agreement_link text,
  -- client acceptance
  terms_accepted boolean DEFAULT false,
  terms_accepted_at timestamptz,
  terms_accepted_client_name text,
  terms_accepted_client_email text,
  -- payment + lifecycle
  payment_status text NOT NULL DEFAULT 'Pending',
  amount_paid numeric DEFAULT 0,
  paid_at timestamptz,
  status text NOT NULL DEFAULT 'Active',  -- Active / Cancelled / Completed / Refunded
  -- audit
  timezone text,
  admin_notes text,
  assigned_by uuid,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  purchased_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_records TO authenticated;
GRANT ALL ON public.purchase_records TO service_role;

ALTER TABLE public.purchase_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin manage purchase_records"
  ON public.purchase_records FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Coach manage assigned purchase_records"
  ON public.purchase_records FOR ALL TO authenticated
  USING (is_assigned_coach(client_id))
  WITH CHECK (is_assigned_coach(client_id));

CREATE POLICY "Client read own purchase_records"
  ON public.purchase_records FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM clients c
    WHERE c.id = purchase_records.client_id AND c.user_id = auth.uid()
  ));

CREATE POLICY "Client accept own purchase_records"
  ON public.purchase_records FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM clients c
    WHERE c.id = purchase_records.client_id AND c.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM clients c
    WHERE c.id = purchase_records.client_id AND c.user_id = auth.uid()
  ));

CREATE TRIGGER purchase_records_updated_at BEFORE UPDATE ON public.purchase_records
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE INDEX IF NOT EXISTS purchase_records_client_idx ON public.purchase_records(client_id, purchased_at DESC);
CREATE INDEX IF NOT EXISTS purchase_records_offer_idx ON public.purchase_records(offer_id);
