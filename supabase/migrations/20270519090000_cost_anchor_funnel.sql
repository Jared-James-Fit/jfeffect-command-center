-- The home page's price story now opens with what help usually costs (Nov 23
-- 2026): a year of a personal trainer and of higher-priced online coaching,
-- as worked examples (cost-anchors.ts), before the app is shown and its $0 is
-- revealed. Either example being half on screen is one more anonymous step,
-- `cost_anchor_view` (once per visitor per day, like every site step), and the
-- admin's funnel counts it as `anchor_views`. Nothing else changes: no event
-- is removed, no row is touched.

SET lock_timeout = '8s';

ALTER TABLE public.membership_funnel_events DROP CONSTRAINT IF EXISTS membership_funnel_events_event_check;
ALTER TABLE public.membership_funnel_events ADD CONSTRAINT membership_funnel_events_event_check CHECK (event IN (
  'landing_view', 'apply_start', 'apply_step', 'apply_submit',
  'coaching_view', 'pricing_view', 'cost_anchor_view', 'price_reveal_view', 'free_reveal_view', 'cta_free', 'cta_coaching', 'package_select',
  'coaching_apply_start', 'coaching_apply_step', 'coaching_apply_submit'));

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
    'anchor_views', (SELECT count(DISTINCT visitor_id) FROM ev WHERE event = 'cost_anchor_view'),
    'free_reveal_views', (SELECT count(DISTINCT visitor_id) FROM ev WHERE event = 'free_reveal_view'),
    'reveal_views', (SELECT count(DISTINCT visitor_id) FROM ev WHERE event = 'price_reveal_view'),
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
