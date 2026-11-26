-- Coaching sold straight from the site ("Ready to start"), next to the call path.
--
-- A package can be bought without a call or an approval only while the coach
-- turns it on for that package (`direct_checkout`, default off: coaching stays
-- by approval, plan approvals rule). The public reads the flag through
-- coaching_package_json so the apply page can offer "Ready to start"; the
-- server still checks the package, its Stripe price and the Stripe mode before
-- any checkout (direct-checkout.ts). Nothing here changes a price, a product
-- or a subscription.

ALTER TABLE public.coaching_packages
  ADD COLUMN IF NOT EXISTS direct_checkout boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.coaching_packages.direct_checkout IS
  'Sold straight from the site (Ready to start: short intake, Stripe Checkout, onboarding) without the coach''s approval. Off by default.';

-- The public shape gains the flag (and nothing private).
CREATE OR REPLACE FUNCTION public.coaching_package_json(p public.coaching_packages)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'slug', p.slug, 'kind', p.kind, 'name', p.name, 'tagline', p.tagline,
    'description', p.description, 'best_for', p.best_for, 'features', to_jsonb(p.features),
    'price_cents', p.price_cents, 'currency', p.currency, 'billing_interval', p.billing_interval,
    'recommended', p.recommended, 'cta_label', p.cta_label,
    'included_calls', p.included_calls, 'call_minutes', p.call_minutes,
    'sort_order', p.sort_order, 'listed', p.status = 'active' AND p.is_public,
    'direct_checkout', p.kind = 'subscription' AND p.direct_checkout)
$$;
REVOKE ALL ON FUNCTION public.coaching_package_json(public.coaching_packages) FROM PUBLIC, anon, authenticated;

-- A direct checkout's application row says where it came from; the Leads page
-- already lists every coaching_applications row (no new table, one lead).
COMMENT ON COLUMN public.coaching_applications.application_source IS
  'quick_apply_v2 (the website questions), in_app_plan (Manage plan), direct_checkout (Ready to start on the site), …';

-- Live checkouts from the site stay off until the owner says so: while the
-- default Stripe key is a live key, "Ready to start" is offered only when this
-- setting is 'true' (a test key always works, for testing).
INSERT INTO public.app_settings (key, value)
SELECT 'coaching_direct_checkout.live_enabled', 'false'
WHERE NOT EXISTS (SELECT 1 FROM public.app_settings WHERE key = 'coaching_direct_checkout.live_enabled');
