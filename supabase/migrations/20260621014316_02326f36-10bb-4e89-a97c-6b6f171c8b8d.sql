-- Session Credit Packages: catalog of purchasable session bundles + per-client purchase rows
CREATE TABLE IF NOT EXISTS public.session_credit_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  session_count integer NOT NULL CHECK (session_count > 0),
  unit_price_minor bigint NOT NULL CHECK (unit_price_minor >= 0),
  total_price_minor bigint NOT NULL CHECK (total_price_minor >= 0),
  currency text NOT NULL DEFAULT 'CAD',
  validity_days integer,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.session_credit_packages TO authenticated;
GRANT ALL ON public.session_credit_packages TO service_role;

ALTER TABLE public.session_credit_packages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage session credit packages"
  ON public.session_credit_packages
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated can read active session credit packages"
  ON public.session_credit_packages
  FOR SELECT
  TO authenticated
  USING (active = true);

CREATE OR REPLACE FUNCTION public.touch_session_credit_packages()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_session_credit_packages_touch
  BEFORE UPDATE ON public.session_credit_packages
  FOR EACH ROW EXECUTE FUNCTION public.touch_session_credit_packages();
