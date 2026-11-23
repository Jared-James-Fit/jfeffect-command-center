-- Coaching site launch (Nov 23 2026): the packages say exactly what each one is,
-- the existing $130 subscribers are on Complete Online Coaching (association
-- only), and the public site's steps are counted anonymously.
--
--   1. Package words. Nutrition Coaching ($99) and Coaching Plus ($249) stay
--      drafts and off the site until the owner approves them; their words now
--      match the approved lineup: Nutrition is nutrition only, Plus is Complete
--      plus exactly two private 30-minute calls each billing month and nothing
--      else. "Best for" is written for the closing "Which one is you?" section.
--      Complete keeps its $130 price, its product link and its place on the site.
--   2. One-time consultations get their prices and lengths, still drafts and
--      never on the site (publishing them waits on booking and payment).
--   3. The four active $130 subscribers (Alyssa, Nicole, Jarrett, Devin) are put
--      on Complete Online Coaching: an enrollment pointing at their own sale,
--      their contracted $130. Nothing about their sale, Stripe subscription,
--      billing date, price or terms changes.
--   4. membership_funnel_events takes the site's coaching steps and a coarse
--      device class (phone / tablet / desktop), still anonymous: a random id
--      per browser, never a person. coaching_funnel() reads it for the admin,
--      with interest (taps, applications by package) kept apart from customers
--      (people who applied and then got a sale or a package).

SET lock_timeout = '8s';

-- ---------------------------------------------------------------------------
-- 1. Package words (the version trigger keeps the before and after)
-- ---------------------------------------------------------------------------
UPDATE public.coaching_packages SET
  tagline = 'Train on your own, with everything you need.',
  best_for = 'You want to train on your own.',
  features = ARRAY[
    'My programs, or build or upload your own',
    'Every set, PR and progression logged',
    '2,000+ exercises with how-to videos',
    'Calories, macros, a meal plan and a food log',
    'The Crew and a monthly League'
  ]
WHERE slug = 'free';

UPDATE public.coaching_packages SET
  tagline = 'I run your nutrition. You run your training.',
  description = 'Calories, macros and a meal plan built around the food you eat, checked in on and adjusted as your bodyweight moves. Your training stays yours, in the free app.',
  best_for = 'You run your own training and want your nutrition handled.',
  features = ARRAY[
    'A nutrition plan built around the food you eat',
    'Calories and macros set for your goal',
    'Nutrition check-ins with my feedback',
    'Adjusted as your bodyweight moves',
    'The full app for your own training'
  ]
WHERE slug = 'nutrition' AND status = 'draft';

UPDATE public.coaching_packages SET
  tagline = 'Your training and nutrition, run by me.',
  best_for = 'You want me to run your training and your nutrition.',
  features = ARRAY[
    'A program written for you and changed as you progress',
    'A nutrition plan built around the food you eat',
    'Weekly check-ins, and I adjust the plan',
    'Technique feedback on the sets you film',
    'Message me in the app',
    'Meet prep if you compete'
  ]
WHERE slug = 'complete';

UPDATE public.coaching_packages SET
  tagline = 'Complete coaching, plus time with me on video.',
  description = 'Everything in Complete Online Coaching, plus two private 30-minute video calls each billing month.',
  best_for = 'You want all of that, plus time with me on video.',
  features = ARRAY[
    'Everything in Complete Online Coaching',
    'Two private 30-minute video calls each billing month'
  ],
  included_calls = 2,
  call_minutes = 30,
  call_cancel_hours = 24
WHERE slug = 'plus' AND status = 'draft';

-- ---------------------------------------------------------------------------
-- 2. One-time consultations: prices and lengths, still drafts
-- ---------------------------------------------------------------------------
UPDATE public.coaching_packages SET name = 'Technique Review', price_cents = 7900, call_minutes = 30, sort_order = 110
WHERE slug = 'technique-review' AND status = 'draft';
UPDATE public.coaching_packages SET name = 'Training Consultation', price_cents = 11900, call_minutes = 45, sort_order = 120
WHERE slug = 'training-consultation' AND status = 'draft';
UPDATE public.coaching_packages SET name = 'Nutrition Review', price_cents = 9900, call_minutes = 45, sort_order = 130
WHERE slug = 'nutrition-review' AND status = 'draft';
UPDATE public.coaching_packages SET name = 'Competition Strategy', price_cents = 17900, call_minutes = 60, sort_order = 140
WHERE slug = 'competition-strategy' AND status = 'draft';
UPDATE public.coaching_packages SET
  admin_note = 'One-time call, priced. Stays off the site until its booking type and checkout are set up and tested.'
WHERE kind = 'one_time' AND status = 'draft';

-- ---------------------------------------------------------------------------
-- 3. The active $130 subscribers, on Complete Online Coaching
-- ---------------------------------------------------------------------------
-- Only their own live subscription sale, only when they're not already on a
-- package. The enrollment's mirror sets their "Coaching package" label; the
-- sale, the Stripe subscription and the billing are never touched.
INSERT INTO public.coaching_package_enrollments
  (client_id, package_id, status, starts_on, sale_id, contracted_price_cents, note, created_by)
SELECT pr.client_id, p.id, 'active', coalesce(pr.purchased_at, pr.created_at)::date, pr.id, 13000,
       'Existing $130 subscriber, linked Nov 23 2026. Billing unchanged.', NULL
  FROM public.purchase_records pr
  JOIN public.coaching_packages p ON p.slug = 'complete' AND p.status = 'active'
 WHERE pr.id IN (
         '279f7a03-bbe1-4d97-9767-3db19adf22b5',
         '199b76de-59d7-44c4-ab57-27b11b67b332',
         '3fe2865d-6a50-4cc1-9282-d81c36e355a0',
         '67cf57de-c7cb-498f-8bc4-754c311577f7')
   AND pr.offer_id = '70bfbedb-30bb-4b94-a889-a121b22948cf'
   AND pr.stripe_subscription_status = 'active'
   AND pr.archived_at IS NULL
   AND NOT EXISTS (
         SELECT 1 FROM public.coaching_package_enrollments e
          WHERE e.client_id = pr.client_id AND e.status = 'active');

-- ---------------------------------------------------------------------------
-- 4. The site's steps, anonymous
-- ---------------------------------------------------------------------------
ALTER TABLE public.membership_funnel_events DROP CONSTRAINT IF EXISTS membership_funnel_events_event_check;
ALTER TABLE public.membership_funnel_events ADD CONSTRAINT membership_funnel_events_event_check CHECK (event IN (
  'landing_view', 'apply_start', 'apply_step', 'apply_submit',
  'coaching_view', 'pricing_view', 'cta_free', 'cta_coaching', 'package_select',
  'coaching_apply_start', 'coaching_apply_step', 'coaching_apply_submit'));
ALTER TABLE public.membership_funnel_events
  ADD COLUMN IF NOT EXISTS device text CHECK (device IS NULL OR device IN ('phone', 'tablet', 'desktop'));

-- The coaching funnel since a moment, for the admin's Coaching packages screen.
-- Interest: visitors, pricing seen, package taps, applications by package.
-- Customers: people whose application was followed by a sale or a package.
CREATE OR REPLACE FUNCTION public.coaching_funnel(_since timestamptz)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH ev AS (
    SELECT * FROM public.membership_funnel_events WHERE created_at >= _since
  ), apps AS (
    SELECT * FROM public.coaching_applications
     WHERE coalesce(submitted_at, created_at) >= _since AND NOT coalesce(is_test, false)
  ), won AS (
    SELECT a.id, a.package_slug,
           (SELECT p.slug FROM public.coaching_package_enrollments e
              JOIN public.coaching_packages p ON p.id = e.package_id
             WHERE e.client_id = a.client_id AND e.created_at >= coalesce(a.submitted_at, a.created_at)
             ORDER BY e.created_at LIMIT 1) AS enrolled_slug
      FROM apps a
     WHERE a.client_id IS NOT NULL
       AND (EXISTS (SELECT 1 FROM public.purchase_records pr
                     WHERE pr.client_id = a.client_id AND pr.archived_at IS NULL
                       AND pr.created_at >= coalesce(a.submitted_at, a.created_at))
         OR EXISTS (SELECT 1 FROM public.coaching_package_enrollments e
                     WHERE e.client_id = a.client_id AND e.created_at >= coalesce(a.submitted_at, a.created_at)))
  ), by_device AS (
    SELECT coalesce(device, 'unknown') AS device,
           count(DISTINCT visitor_id) FILTER (WHERE event IN ('landing_view', 'coaching_view')) AS visitors,
           count(DISTINCT visitor_id) FILTER (WHERE event = 'apply_submit') AS joined_free,
           count(DISTINCT visitor_id) FILTER (WHERE event = 'coaching_apply_submit') AS applied
      FROM ev GROUP BY 1
  )
  SELECT jsonb_build_object(
    'landing_visitors', (SELECT count(DISTINCT visitor_id) FROM ev WHERE event = 'landing_view'),
    'coaching_visitors', (SELECT count(DISTINCT visitor_id) FROM ev WHERE event = 'coaching_view'),
    'pricing_views', (SELECT count(DISTINCT visitor_id) FROM ev WHERE event = 'pricing_view'),
    'cta_free', (SELECT count(DISTINCT visitor_id) FROM ev WHERE event = 'cta_free'),
    'cta_coaching', (SELECT count(DISTINCT visitor_id) FROM ev WHERE event = 'cta_coaching'),
    'free_starts', (SELECT count(DISTINCT visitor_id) FROM ev WHERE event = 'apply_start'),
    'free_sent', (SELECT count(DISTINCT visitor_id) FROM ev WHERE event = 'apply_submit'),
    'apply_starts', (SELECT count(DISTINCT visitor_id) FROM ev WHERE event = 'coaching_apply_start'),
    'apply_sent', (SELECT count(DISTINCT visitor_id) FROM ev WHERE event = 'coaching_apply_submit'),
    'apply_steps', coalesce((SELECT jsonb_object_agg(step, n) FROM (
        SELECT step, count(DISTINCT visitor_id) AS n FROM ev
         WHERE event = 'coaching_apply_step' AND step <> '' GROUP BY step) s), '{}'::jsonb),
    'package_taps', coalesce((SELECT jsonb_object_agg(step, n) FROM (
        SELECT step, count(DISTINCT visitor_id) AS n FROM ev
         WHERE event = 'package_select' AND step <> '' GROUP BY step) s), '{}'::jsonb),
    'applications', (SELECT count(*) FROM apps),
    'applications_by_package', coalesce((SELECT jsonb_object_agg(k, n) FROM (
        SELECT coalesce(nullif(package_slug, ''), 'none') AS k, count(*) AS n FROM apps GROUP BY 1) s), '{}'::jsonb),
    'customers', (SELECT count(*) FROM won),
    'customers_by_package', coalesce((SELECT jsonb_object_agg(k, n) FROM (
        SELECT coalesce(enrolled_slug, nullif(package_slug, ''), 'none') AS k, count(*) AS n FROM won GROUP BY 1) s), '{}'::jsonb),
    'devices', coalesce((SELECT jsonb_agg(jsonb_build_object('device', device, 'visitors', visitors, 'joined_free', joined_free, 'applied', applied)
        ORDER BY visitors DESC) FROM by_device), '[]'::jsonb)
  )
$$;
REVOKE ALL ON FUNCTION public.coaching_funnel(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.coaching_funnel(timestamptz) TO service_role;
