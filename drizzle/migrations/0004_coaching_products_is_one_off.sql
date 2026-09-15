ALTER TABLE public.coaching_products
  ADD COLUMN IF NOT EXISTS is_one_off boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.coaching_products.is_one_off IS
  'True for one-off custom sales created from a client profile. Hidden from the reusable product catalog and from the Add Sale product picker.';