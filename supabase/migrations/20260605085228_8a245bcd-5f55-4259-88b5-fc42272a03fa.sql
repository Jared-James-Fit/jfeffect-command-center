
ALTER TABLE public.coaching_products
  ADD COLUMN IF NOT EXISTS product_type text,
  ADD COLUMN IF NOT EXISTS term_length integer,
  ADD COLUMN IF NOT EXISTS term_unit text,
  ADD COLUMN IF NOT EXISTS included_features text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS agreement_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS agreement_template_id uuid,
  ADD COLUMN IF NOT EXISTS agreement_before_service boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'Active';

ALTER TABLE public.coaching_products ALTER COLUMN currency SET DEFAULT 'cad';
