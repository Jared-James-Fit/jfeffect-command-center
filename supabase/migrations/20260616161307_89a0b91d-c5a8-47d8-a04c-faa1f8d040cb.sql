
-- ============================================================
-- Discount / Promo / Ambassador / Referral Code Foundation
-- ============================================================

-- Enums
DO $$ BEGIN
  CREATE TYPE public.discount_code_category AS ENUM ('promotion','ambassador','client_referral','retention','manual');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.discount_code_status AS ENUM ('draft','scheduled','active','paused','expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.discount_code_type AS ENUM ('percentage','fixed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.discount_code_duration AS ENUM ('once','forever','repeating');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- citext for case-insensitive public codes
CREATE EXTENSION IF NOT EXISTS citext;

-- ============================================================
-- 1) discount_codes
-- ============================================================
CREATE TABLE IF NOT EXISTS public.discount_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  internal_name TEXT NOT NULL,
  public_code CITEXT NOT NULL UNIQUE,
  category public.discount_code_category NOT NULL,
  description TEXT,

  discount_type public.discount_code_type NOT NULL DEFAULT 'percentage',
  discount_value NUMERIC(10,2) NOT NULL CHECK (discount_value >= 0),
  subscription_duration public.discount_code_duration NOT NULL DEFAULT 'once',
  duration_months INTEGER,

  eligible_product_ids UUID[] NOT NULL DEFAULT '{}',
  applies_to_all_products BOOLEAN NOT NULL DEFAULT FALSE,
  new_customers_only BOOLEAN NOT NULL DEFAULT FALSE,
  existing_customers_only BOOLEAN NOT NULL DEFAULT FALSE,
  min_purchase_cents INTEGER,

  start_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  time_zone TEXT NOT NULL DEFAULT 'America/Winnipeg',

  status public.discount_code_status NOT NULL DEFAULT 'draft',
  total_usage_limit INTEGER,
  per_customer_limit INTEGER DEFAULT 1,

  pairing_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  pairable_category public.discount_code_category,
  max_promo_codes INTEGER NOT NULL DEFAULT 1,
  max_referral_codes INTEGER NOT NULL DEFAULT 1,
  max_total_codes INTEGER NOT NULL DEFAULT 2,
  excluded_code_ids UUID[] NOT NULL DEFAULT '{}',

  linked_ambassador_id UUID,
  linked_client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,

  stripe_coupon_id TEXT,
  stripe_promotion_code_id TEXT,
  stripe_test_mode_synced BOOLEAN NOT NULL DEFAULT FALSE,
  stripe_live_mode_synced BOOLEAN NOT NULL DEFAULT FALSE,

  created_by UUID,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.discount_codes TO authenticated;
GRANT ALL ON public.discount_codes TO service_role;

CREATE INDEX IF NOT EXISTS discount_codes_status_idx ON public.discount_codes(status);
CREATE INDEX IF NOT EXISTS discount_codes_category_idx ON public.discount_codes(category);
CREATE INDEX IF NOT EXISTS discount_codes_expires_idx ON public.discount_codes(expires_at);
CREATE INDEX IF NOT EXISTS discount_codes_linked_ambassador_idx ON public.discount_codes(linked_ambassador_id);
CREATE INDEX IF NOT EXISTS discount_codes_linked_client_idx ON public.discount_codes(linked_client_id);

ALTER TABLE public.discount_codes ENABLE ROW LEVEL SECURITY;

-- Admin full access
CREATE POLICY "Admins manage discount codes"
  ON public.discount_codes FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- Authenticated users can read active codes (for checkout validation UI hints)
CREATE POLICY "Authenticated can view active codes"
  ON public.discount_codes FOR SELECT
  TO authenticated
  USING (status = 'active');

-- Validation trigger (CHECK with now() not allowed — use trigger)
CREATE OR REPLACE FUNCTION public.discount_codes_validate()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.discount_type = 'percentage' AND NEW.discount_value > 100 THEN
    RAISE EXCEPTION 'percentage discount cannot exceed 100';
  END IF;
  IF NEW.subscription_duration = 'repeating' AND (NEW.duration_months IS NULL OR NEW.duration_months <= 0) THEN
    RAISE EXCEPTION 'repeating duration requires duration_months > 0';
  END IF;
  IF NEW.status = 'active' AND NEW.expires_at IS NULL AND NEW.category = 'promotion' THEN
    RAISE EXCEPTION 'promotion codes require expires_at before activation';
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS discount_codes_validate_tr ON public.discount_codes;
CREATE TRIGGER discount_codes_validate_tr
  BEFORE INSERT OR UPDATE ON public.discount_codes
  FOR EACH ROW EXECUTE FUNCTION public.discount_codes_validate();

-- ============================================================
-- 2) discount_code_redemptions
-- ============================================================
CREATE TABLE IF NOT EXISTS public.discount_code_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID,
  customer_email TEXT,
  promo_code_id UUID REFERENCES public.discount_codes(id) ON DELETE SET NULL,
  referral_code_id UUID REFERENCES public.discount_codes(id) ON DELETE SET NULL,
  referring_user_id UUID,
  product_id UUID,
  product_name TEXT,
  checkout_session_id TEXT,
  subscription_id TEXT,
  stripe_customer_id TEXT,
  original_cents INTEGER,
  promo_discount_cents INTEGER,
  referral_discount_cents INTEGER,
  final_cents INTEGER,
  subscription_status TEXT,
  cancellation_status TEXT,
  refund_status TEXT,
  stripe_sync_status TEXT,
  mode TEXT NOT NULL DEFAULT 'test' CHECK (mode IN ('test','live')),
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.discount_code_redemptions TO authenticated;
GRANT ALL ON public.discount_code_redemptions TO service_role;

CREATE UNIQUE INDEX IF NOT EXISTS discount_code_redemptions_session_uniq
  ON public.discount_code_redemptions(checkout_session_id)
  WHERE checkout_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS discount_code_redemptions_customer_idx ON public.discount_code_redemptions(customer_id);
CREATE INDEX IF NOT EXISTS discount_code_redemptions_promo_idx ON public.discount_code_redemptions(promo_code_id);
CREATE INDEX IF NOT EXISTS discount_code_redemptions_referral_idx ON public.discount_code_redemptions(referral_code_id);
CREATE INDEX IF NOT EXISTS discount_code_redemptions_redeemed_idx ON public.discount_code_redemptions(redeemed_at DESC);

ALTER TABLE public.discount_code_redemptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage redemptions"
  ON public.discount_code_redemptions FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Customers view own redemptions"
  ON public.discount_code_redemptions FOR SELECT
  TO authenticated
  USING (customer_id = auth.uid());

-- updated_at trigger reuse
CREATE OR REPLACE FUNCTION public.discount_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS discount_code_redemptions_set_updated_at ON public.discount_code_redemptions;
CREATE TRIGGER discount_code_redemptions_set_updated_at
  BEFORE UPDATE ON public.discount_code_redemptions
  FOR EACH ROW EXECUTE FUNCTION public.discount_set_updated_at();

-- ============================================================
-- 3) discount_code_audit_log
-- ============================================================
CREATE TABLE IF NOT EXISTS public.discount_code_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID,
  actor_email TEXT,
  action TEXT NOT NULL,
  code_id UUID REFERENCES public.discount_codes(id) ON DELETE SET NULL,
  code_public TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.discount_code_audit_log TO authenticated;
GRANT ALL ON public.discount_code_audit_log TO service_role;

CREATE INDEX IF NOT EXISTS discount_code_audit_log_code_idx ON public.discount_code_audit_log(code_id);
CREATE INDEX IF NOT EXISTS discount_code_audit_log_created_idx ON public.discount_code_audit_log(created_at DESC);

ALTER TABLE public.discount_code_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view audit log"
  ON public.discount_code_audit_log FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated insert audit events"
  ON public.discount_code_audit_log FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- ============================================================
-- 4) referral_attribution
-- ============================================================
CREATE TABLE IF NOT EXISTS public.referral_attribution (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID,
  customer_email TEXT,
  referring_user_id UUID,
  referral_code_id UUID REFERENCES public.discount_codes(id) ON DELETE SET NULL,
  promo_code_id UUID REFERENCES public.discount_codes(id) ON DELETE SET NULL,
  checkout_session_id TEXT,
  subscription_id TEXT,
  product_id UUID,
  original_cents INTEGER,
  promo_discount_cents INTEGER,
  referral_discount_cents INTEGER,
  recurring_discounted_cents INTEGER,
  subscription_status TEXT,
  cancellation_status TEXT,
  refund_status TEXT,
  attributed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.referral_attribution TO authenticated;
GRANT ALL ON public.referral_attribution TO service_role;

CREATE UNIQUE INDEX IF NOT EXISTS referral_attribution_session_uniq
  ON public.referral_attribution(checkout_session_id)
  WHERE checkout_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS referral_attribution_referring_idx ON public.referral_attribution(referring_user_id);
CREATE INDEX IF NOT EXISTS referral_attribution_customer_idx ON public.referral_attribution(customer_id);

ALTER TABLE public.referral_attribution ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage attribution"
  ON public.referral_attribution FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Referring users view their attribution"
  ON public.referral_attribution FOR SELECT
  TO authenticated
  USING (referring_user_id = auth.uid());

DROP TRIGGER IF EXISTS referral_attribution_set_updated_at ON public.referral_attribution;
CREATE TRIGGER referral_attribution_set_updated_at
  BEFORE UPDATE ON public.referral_attribution
  FOR EACH ROW EXECUTE FUNCTION public.discount_set_updated_at();

-- ============================================================
-- 5) Server-side validation function
-- ============================================================
-- Returns JSON: { ok: bool, applied: [{id, code, category, discount_type, discount_value, message}], rejected: [{code, reason}] }
CREATE OR REPLACE FUNCTION public.validate_discount_codes(
  _codes TEXT[],
  _customer_id UUID DEFAULT NULL,
  _product_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  applied JSONB := '[]'::jsonb;
  rejected JSONB := '[]'::jsonb;
  seen TEXT[] := '{}';
  promo_count INT := 0;
  referral_count INT := 0;
  code_text TEXT;
  rec public.discount_codes%ROWTYPE;
  cat_referral BOOLEAN;
BEGIN
  IF _codes IS NULL OR array_length(_codes,1) IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'applied', applied, 'rejected', rejected);
  END IF;

  IF array_length(_codes,1) > 2 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'applied', applied,
      'rejected', jsonb_build_array(jsonb_build_object('code', NULL, 'reason', 'Maximum two codes per checkout'))
    );
  END IF;

  FOREACH code_text IN ARRAY _codes LOOP
    IF code_text IS NULL OR length(trim(code_text)) = 0 THEN CONTINUE; END IF;
    IF upper(code_text) = ANY(SELECT upper(x) FROM unnest(seen) x) THEN
      rejected := rejected || jsonb_build_object('code', code_text, 'reason', 'Duplicate code');
      CONTINUE;
    END IF;
    seen := array_append(seen, code_text);

    SELECT * INTO rec FROM public.discount_codes WHERE public_code = code_text::citext LIMIT 1;
    IF NOT FOUND THEN
      rejected := rejected || jsonb_build_object('code', code_text, 'reason', 'Code not found');
      CONTINUE;
    END IF;
    IF rec.status <> 'active' THEN
      rejected := rejected || jsonb_build_object('code', code_text, 'reason', 'Code is not currently active');
      CONTINUE;
    END IF;
    IF rec.expires_at IS NOT NULL AND rec.expires_at < now() THEN
      rejected := rejected || jsonb_build_object('code', code_text, 'reason', 'Code has expired');
      CONTINUE;
    END IF;
    IF rec.start_at IS NOT NULL AND rec.start_at > now() THEN
      rejected := rejected || jsonb_build_object('code', code_text, 'reason', 'Code is not yet active');
      CONTINUE;
    END IF;
    IF _product_id IS NOT NULL AND NOT rec.applies_to_all_products
       AND NOT (_product_id = ANY(rec.eligible_product_ids)) THEN
      rejected := rejected || jsonb_build_object('code', code_text, 'reason', 'Not eligible for this product');
      CONTINUE;
    END IF;

    cat_referral := rec.category IN ('ambassador','client_referral');

    IF rec.category = 'promotion' THEN promo_count := promo_count + 1; END IF;
    IF cat_referral THEN referral_count := referral_count + 1; END IF;

    IF promo_count > 1 THEN
      rejected := rejected || jsonb_build_object('code', code_text, 'reason', 'Only one promotional offer can be used per membership');
      promo_count := promo_count - 1;
      CONTINUE;
    END IF;
    IF referral_count > 1 THEN
      rejected := rejected || jsonb_build_object('code', code_text, 'reason', 'Only one ambassador or referral code can be used per membership');
      referral_count := referral_count - 1;
      CONTINUE;
    END IF;

    applied := applied || jsonb_build_object(
      'id', rec.id,
      'code', rec.public_code,
      'category', rec.category,
      'discount_type', rec.discount_type,
      'discount_value', rec.discount_value,
      'subscription_duration', rec.subscription_duration,
      'duration_months', rec.duration_months,
      'description', rec.description
    );
  END LOOP;

  RETURN jsonb_build_object(
    'ok', jsonb_array_length(rejected) = 0,
    'applied', applied,
    'rejected', rejected
  );
END $$;

GRANT EXECUTE ON FUNCTION public.validate_discount_codes(TEXT[], UUID, UUID) TO authenticated, anon, service_role;
