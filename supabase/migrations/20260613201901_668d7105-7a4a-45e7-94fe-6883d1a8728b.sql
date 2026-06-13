ALTER TABLE public.jf_membership_settings
ADD COLUMN IF NOT EXISTS public_checkout_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.jf_membership_settings.public_checkout_enabled IS
  'Kill switch for the public /join checkout. When false, the launch gate returns ok=false and createJfSignupCheckout refuses to create a Stripe session. Existing members are unaffected.';