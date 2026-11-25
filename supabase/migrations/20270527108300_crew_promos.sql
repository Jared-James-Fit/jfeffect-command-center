-- Crew promos (T01): JF Effect's own promotions as a screen in the Crew feed,
-- labelled "Sponsored · JF Effect". Own promos only: a campaign links inside
-- the app (a path, never another site) and has no advertiser. Where they go in
-- the feed is crew-ads/placement.ts (first after 8-10 posts, then every 12 or
-- more, at most 2 a visit and 3 a day, never without enough posts, never while
-- a workout is going); who sees one is crew_promos_for_me() (never a service
-- they already have, never one they dismissed). Impressions, taps and
-- dismissals are counted per campaign for the admin.

CREATE TABLE IF NOT EXISTS public.crew_ad_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  headline text NOT NULL CHECK (char_length(headline) BETWEEN 2 AND 80),
  body text CHECK (body IS NULL OR char_length(body) <= 240),
  cta_label text NOT NULL DEFAULT 'Learn more' CHECK (char_length(cta_label) BETWEEN 2 AND 30),
  -- inside the app only: "/coaching", "/portal/plan"… never a full URL
  cta_path text NOT NULL CHECK (cta_path ~ '^/[A-Za-z0-9/_?=&.#-]*$' AND cta_path !~ '^//'),
  -- who never sees it because they already have it: 'coaching' (a coaching client), 'premium'
  suppress_for text[] NOT NULL DEFAULT '{}'::text[] CHECK (suppress_for <@ ARRAY['coaching', 'premium']::text[]),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'ended')),
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.crew_ad_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.crew_ad_campaigns(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event text NOT NULL CHECK (event IN ('impression', 'click', 'dismiss')),
  session_key text NOT NULL DEFAULT '' CHECK (char_length(session_key) <= 64),
  created_at timestamptz NOT NULL DEFAULT now()
);
-- one impression per campaign per person per visit; one dismissal per campaign per person
CREATE UNIQUE INDEX IF NOT EXISTS crew_ad_events_one_impression ON public.crew_ad_events (campaign_id, user_id, session_key) WHERE event = 'impression';
CREATE UNIQUE INDEX IF NOT EXISTS crew_ad_events_one_dismiss ON public.crew_ad_events (campaign_id, user_id) WHERE event = 'dismiss';
CREATE INDEX IF NOT EXISTS crew_ad_events_user_created ON public.crew_ad_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS crew_ad_events_campaign ON public.crew_ad_events (campaign_id, event);

ALTER TABLE public.crew_ad_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crew_ad_events ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crew_ad_campaigns TO authenticated;
GRANT ALL ON public.crew_ad_campaigns TO service_role;
GRANT SELECT ON public.crew_ad_events TO authenticated;
GRANT ALL ON public.crew_ad_events TO service_role;

-- campaigns: the admin manages them; everyone else reads them only through crew_promos_for_me()
DROP POLICY IF EXISTS "crew promos: admin" ON public.crew_ad_campaigns;
CREATE POLICY "crew promos: admin" ON public.crew_ad_campaigns
  FOR ALL TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')))
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin')));

-- events: written only by crew_promo_track(); the admin reads them
DROP POLICY IF EXISTS "crew promo events: admin reads" ON public.crew_ad_events;
CREATE POLICY "crew promo events: admin reads" ON public.crew_ad_events
  FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')));

-- The promos this person may see now (live, not suppressed by what they have, not dismissed),
-- and how many promos they've been shown today (Winnipeg day; the 3-a-day cap).
CREATE OR REPLACE FUNCTION public.crew_promos_for_me()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  me uuid := auth.uid();
  v_coaching boolean;
  v_premium boolean;
  v_today int;
  v_list jsonb;
BEGIN
  IF me IS NULL THEN
    RETURN jsonb_build_object('campaigns', '[]'::jsonb, 'shown_today', 0);
  END IF;
  v_coaching := EXISTS (
    SELECT 1 FROM public.clients c
     WHERE c.user_id = me AND NOT coalesce(c.archived, false)
       AND c.service_tier = 'coaching' AND coalesce(c.status, '') NOT IN ('Lead', 'Member', 'Deactivated')
  );
  v_premium := public.premium_active(me);
  SELECT count(*) INTO v_today
    FROM public.crew_ad_events e
   WHERE e.user_id = me AND e.event = 'impression'
     AND e.created_at >= (date_trunc('day', now() AT TIME ZONE 'America/Winnipeg') AT TIME ZONE 'America/Winnipeg');
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id, 'headline', a.headline, 'body', a.body, 'cta_label', a.cta_label, 'cta_path', a.cta_path)
           ORDER BY a.created_at), '[]'::jsonb)
    INTO v_list
    FROM public.crew_ad_campaigns a
   WHERE a.status = 'active'
     AND (a.starts_at IS NULL OR a.starts_at <= now())
     AND (a.ends_at IS NULL OR a.ends_at > now())
     AND NOT ('coaching' = ANY (a.suppress_for) AND v_coaching)
     AND NOT ('premium' = ANY (a.suppress_for) AND v_premium)
     AND NOT EXISTS (SELECT 1 FROM public.crew_ad_events d WHERE d.campaign_id = a.id AND d.user_id = me AND d.event = 'dismiss');
  RETURN jsonb_build_object('campaigns', v_list, 'shown_today', v_today);
END;
$$;
REVOKE ALL ON FUNCTION public.crew_promos_for_me() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crew_promos_for_me() TO authenticated;

-- An impression, a tap or a dismissal by the signed-in person (an impression once per visit).
CREATE OR REPLACE FUNCTION public.crew_promo_track(_campaign uuid, _event text, _session text)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  me uuid := auth.uid();
BEGIN
  IF me IS NULL OR _event NOT IN ('impression', 'click', 'dismiss') THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.crew_ad_campaigns WHERE id = _campaign AND status = 'active') THEN
    RETURN false;
  END IF;
  INSERT INTO public.crew_ad_events (campaign_id, user_id, event, session_key)
  VALUES (_campaign, me, _event, left(coalesce(_session, ''), 64))
  ON CONFLICT DO NOTHING;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.crew_promo_track(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crew_promo_track(uuid, text, text) TO authenticated;

-- The admin's numbers per campaign: impressions, people reached, taps, dismissals.
CREATE OR REPLACE FUNCTION public.crew_promo_stats()
RETURNS TABLE (campaign_id uuid, impressions bigint, people bigint, clicks bigint, dismissals bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT a.id,
         count(*) FILTER (WHERE e.event = 'impression'),
         count(DISTINCT e.user_id) FILTER (WHERE e.event = 'impression'),
         count(*) FILTER (WHERE e.event = 'click'),
         count(*) FILTER (WHERE e.event = 'dismiss')
    FROM public.crew_ad_campaigns a
    LEFT JOIN public.crew_ad_events e ON e.campaign_id = a.id
   WHERE public.has_role(auth.uid(), 'admin')
   GROUP BY a.id
$$;
REVOKE ALL ON FUNCTION public.crew_promo_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crew_promo_stats() TO authenticated;

DROP TRIGGER IF EXISTS crew_ad_campaigns_touch ON public.crew_ad_campaigns;
CREATE TRIGGER crew_ad_campaigns_touch BEFORE UPDATE ON public.crew_ad_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

SELECT public.rls_evaluate_once('crew_ad_campaigns');
SELECT public.rls_evaluate_once('crew_ad_events');
