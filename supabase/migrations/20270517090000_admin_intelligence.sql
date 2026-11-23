-- Admin intelligence (Nov 23 2026): what AI and texts cost day by day, how people use the app and
-- the website, and one protective limit on background AI spend.
--
--   ops_ai_daily / ops_ai_by_model / ops_sms_daily
--                       the Usage & spend page's trends, read from the ledgers that already exist
--                       (ai_call_log, sms_log); service role only, after the server's admin check.
--   app_sessions        one row per visit: who (a login, or an anonymous browser id on the public
--   app_page_views      site), which surface, the device class, where the visit came from, and an
--                       approximate place from the host's IP geolocation (country, region, city,
--                       a point rounded to 0.1 degree, ~11 km). Never an IP address, never a precise
--                       location. Written only by the server (/api/public/app-pulse); nobody can
--                       read the rows but the service role. Kept 400 days.
--   app_intel_report    the App & website page's read, one call (service role only).
--   ai_background_held  true while the month's AI spend is past the budget and the owner chose to
--                       hold background AI then (app_settings 'ai_spend_hold', written by the
--                       ai-health tick). The Crew deck backlog's kick reads it: background decks wait,
--                       nothing else changes.
SET lock_timeout = '3s';

-- ---------------------------------------------------------------------------
-- 1. Usage & spend
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ops_ai_daily(_days integer DEFAULT 30)
RETURNS TABLE (day date, calls bigint, failed bigint, paused bigint, cost numeric, unpriced bigint, gateway_cost numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.instant_to_local(l.at, 'America/Winnipeg')::date AS day,
         count(*),
         count(*) FILTER (WHERE NOT l.ok AND coalesce(l.failure, '') <> 'paused'),
         count(*) FILTER (WHERE l.failure = 'paused'),
         coalesce(sum(l.cost_usd), 0),
         count(*) FILTER (WHERE l.cost_usd IS NULL AND l.ok),
         coalesce(sum(l.cost_usd) FILTER (WHERE l.provider = 'gateway'), 0)
    FROM public.ai_call_log l
   WHERE l.at >= now() - make_interval(days => greatest(1, least(coalesce(_days, 30), 400)) + 1)
     AND l.task <> 'probe'
   GROUP BY 1
   ORDER BY 1;
$$;

CREATE OR REPLACE FUNCTION public.ops_ai_by_model(_since timestamptz)
RETURNS TABLE (model text, provider text, calls bigint, failed bigint, cost numeric, priced bigint, ok_priced bigint, ok_cost numeric, avg_ms numeric, tokens bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.model,
         min(l.provider),
         count(*),
         count(*) FILTER (WHERE NOT l.ok AND coalesce(l.failure, '') <> 'paused'),
         coalesce(sum(l.cost_usd), 0),
         count(l.cost_usd),
         count(l.cost_usd) FILTER (WHERE l.ok),
         coalesce(sum(l.cost_usd) FILTER (WHERE l.ok), 0),
         round(avg(l.ms) FILTER (WHERE l.ok)),
         coalesce(sum(coalesce(l.input_tokens, 0) + coalesce(l.output_tokens, 0)), 0)::bigint
    FROM public.ai_call_log l
   WHERE l.at >= _since AND l.task <> 'probe'
   GROUP BY l.model;
$$;

-- sms_log keeps every text the gateway was asked for: sent ones carry a Twilio sid, refused
-- ones a blocked_reason. A text's cost is the larger of Twilio's price and our estimate (the
-- same rule as sms_cost_summary); delivered means Twilio confirmed it, "unconfirmed" that it was
-- accepted and never read back.
CREATE OR REPLACE FUNCTION public.ops_sms_daily(_days integer DEFAULT 30)
RETURNS TABLE (day date, asked bigint, sent bigint, segments bigint, cost_usd numeric, priced bigint,
               delivered bigint, undelivered bigint, failed bigint, blocked bigint, unconfirmed bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.instant_to_local(l.created_at, 'America/Winnipeg')::date AS day,
         count(*),
         count(*) FILTER (WHERE l.twilio_sid IS NOT NULL),
         coalesce(sum(l.segments) FILTER (WHERE l.twilio_sid IS NOT NULL), 0),
         coalesce(sum(greatest(coalesce(l.price_usd, 0), coalesce(l.est_cost_usd, 0))) FILTER (WHERE l.twilio_sid IS NOT NULL), 0),
         count(*) FILTER (WHERE l.price_usd IS NOT NULL),
         count(*) FILTER (WHERE l.twilio_status = 'delivered'),
         count(*) FILTER (WHERE l.twilio_status IN ('undelivered', 'failed')),
         count(*) FILTER (WHERE l.status = 'failed'),
         count(*) FILTER (WHERE l.twilio_sid IS NULL AND (l.status = 'skipped' OR l.blocked_reason IS NOT NULL)),
         count(*) FILTER (WHERE l.twilio_sid IS NOT NULL AND coalesce(l.twilio_status, 'accepted') NOT IN ('delivered', 'undelivered', 'failed'))
    FROM public.sms_log l
   WHERE l.created_at >= now() - make_interval(days => greatest(1, least(coalesce(_days, 30), 400)) + 1)
   GROUP BY 1
   ORDER BY 1;
$$;

CREATE OR REPLACE FUNCTION public.ops_sms_by_category(_since timestamptz)
RETURNS TABLE (category text, asked bigint, sent bigint, segments bigint, cost_usd numeric,
               delivered bigint, undelivered bigint, failed bigint, blocked bigint, by_push bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(l.category, l.kind, 'other'),
         count(*),
         count(*) FILTER (WHERE l.twilio_sid IS NOT NULL),
         coalesce(sum(l.segments) FILTER (WHERE l.twilio_sid IS NOT NULL), 0),
         coalesce(sum(greatest(coalesce(l.price_usd, 0), coalesce(l.est_cost_usd, 0))) FILTER (WHERE l.twilio_sid IS NOT NULL), 0),
         count(*) FILTER (WHERE l.twilio_status = 'delivered'),
         count(*) FILTER (WHERE l.twilio_status IN ('undelivered', 'failed')),
         count(*) FILTER (WHERE l.status = 'failed'),
         count(*) FILTER (WHERE l.twilio_sid IS NULL AND (l.status = 'skipped' OR l.blocked_reason IS NOT NULL)),
         count(*) FILTER (WHERE l.blocked_reason = 'push_delivered')
    FROM public.sms_log l
   WHERE l.created_at >= _since
   GROUP BY 1;
$$;

REVOKE ALL ON FUNCTION public.ops_ai_daily(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ops_ai_by_model(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ops_sms_daily(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ops_sms_by_category(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_ai_daily(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.ops_ai_by_model(timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.ops_sms_daily(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.ops_sms_by_category(timestamptz) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. The background-AI hold
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ai_background_held()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce((
    SELECT (s.value::jsonb ->> 'held')::boolean
      FROM public.app_settings s
     WHERE s.key = 'ai_spend_hold'
     LIMIT 1
  ), false);
$$;
REVOKE ALL ON FUNCTION public.ai_background_held() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_background_held() TO service_role;

-- The deck kick as it was (20270512100000_ai_reliability.sql), except that while the hold is on
-- no background deck (the library backlog, priority 40+) is started. Lessons and tips due soon
-- still get theirs.
CREATE OR REPLACE FUNCTION public.community_post_decks_kick()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_free int;
  v_background_left int;
  v_job uuid;
  v_sent boolean := false;
BEGIN
  IF EXISTS (SELECT 1 FROM public.ai_provider_health WHERE provider = 'openai' AND status <> 'ok' AND next_probe_at > now()) THEN
    RETURN false;
  END IF;
  v_free := 3 - (SELECT count(*) FROM public.community_post_decks WHERE status = 'running' AND claimed_at > now() - interval '12 minutes');
  IF v_free <= 0 THEN RETURN false; END IF;
  v_background_left := 4 - (SELECT count(*) FROM public.community_post_decks
                             WHERE priority >= 40 AND claimed_at > now() - interval '24 hours');
  IF public.ai_background_held() THEN
    v_background_left := 0;
  END IF;
  FOR v_job IN
    SELECT id FROM public.community_post_decks
     WHERE status = 'pending' AND run_after <= now()
       AND (priority < 40 OR v_background_left > 0)
     ORDER BY priority, created_at
     LIMIT v_free
  LOOP
    -- held a minute so the next kick doesn't name it again before its run claims it
    UPDATE public.community_post_decks SET run_after = now() + interval '1 minute' WHERE id = v_job;
    PERFORM net.http_post(
      url := 'https://project--5f1f340c-5afa-4262-90c8-1f9406568c6c.lovable.app/api/public/hooks/post-decks-tick',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-hook-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_hook_secret' LIMIT 1)),
      body := jsonb_build_object('jobId', v_job),
      timeout_milliseconds := 600000);
    v_sent := true;
    v_background_left := v_background_left - 1;
  END LOOP;
  RETURN v_sent;
END;
$$;
REVOKE ALL ON FUNCTION public.community_post_decks_kick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.community_post_decks_kick() TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Visits: sessions and page views
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.app_sessions (
  id uuid PRIMARY KEY,
  visitor_id uuid NOT NULL,
  user_id uuid,
  audience text NOT NULL DEFAULT 'visitor' CHECK (audience IN ('visitor', 'member', 'client', 'staff', 'pending')),
  surface text NOT NULL DEFAULT 'app' CHECK (surface IN ('site', 'app', 'admin')),
  platform text CHECK (platform IN ('ios_app', 'android_app', 'home_screen', 'browser')),
  device text CHECK (device IN ('phone', 'tablet', 'desktop')),
  os text CHECK (os IN ('ios', 'android', 'macos', 'windows', 'linux', 'chromeos', 'other')),
  entry_path text,
  entry_feature text,
  referrer_host text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  country text,
  region text,
  city text,
  lat numeric(4, 1) CHECK (lat BETWEEN -90 AND 90),
  lng numeric(5, 1) CHECK (lng BETWEEN -180 AND 180),
  started_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  views integer NOT NULL DEFAULT 0,
  active_seconds integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS app_sessions_last_seen_idx ON public.app_sessions (last_seen_at DESC);
CREATE INDEX IF NOT EXISTS app_sessions_started_idx ON public.app_sessions (started_at);
CREATE INDEX IF NOT EXISTS app_sessions_user_idx ON public.app_sessions (user_id, started_at) WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.app_page_views (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES public.app_sessions (id) ON DELETE CASCADE,
  user_id uuid,
  at timestamptz NOT NULL DEFAULT now(),
  path text NOT NULL,
  feature text NOT NULL
);
CREATE INDEX IF NOT EXISTS app_page_views_at_idx ON public.app_page_views (at);
CREATE INDEX IF NOT EXISTS app_page_views_session_idx ON public.app_page_views (session_id, at);
CREATE INDEX IF NOT EXISTS app_page_views_feature_idx ON public.app_page_views (feature, at);

ALTER TABLE public.app_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_page_views ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_sessions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.app_page_views FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.app_sessions TO service_role;
GRANT ALL ON public.app_page_views TO service_role;

-- A visit's heartbeat: the session made on its first beat (with the place the host gave), then
-- moved along. One call per beat; never more than 600 views a session or 12 hours of active time.
CREATE OR REPLACE FUNCTION public.app_pulse_record(
  _session uuid, _visitor uuid, _user uuid, _audience text, _surface text, _platform text,
  _device text, _os text, _entry_path text, _entry_feature text, _referrer_host text,
  _utm_source text, _utm_medium text, _utm_campaign text,
  _country text, _region text, _city text, _lat numeric, _lng numeric,
  _views jsonb, _active_seconds integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.app_sessions%ROWTYPE;
  v_views int := 0;
  v jsonb;
BEGIN
  SELECT * INTO v_existing FROM public.app_sessions WHERE id = _session FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.app_sessions (id, visitor_id, user_id, audience, surface, platform, device, os,
      entry_path, entry_feature, referrer_host, utm_source, utm_medium, utm_campaign,
      country, region, city, lat, lng)
    VALUES (_session, _visitor, _user, coalesce(_audience, 'visitor'), coalesce(_surface, 'app'), _platform, _device, _os,
      left(_entry_path, 200), left(_entry_feature, 60), left(_referrer_host, 120),
      left(_utm_source, 120), left(_utm_medium, 120), left(_utm_campaign, 120),
      left(upper(_country), 2), left(_region, 80), left(_city, 80),
      CASE WHEN _lat BETWEEN -90 AND 90 THEN round(_lat, 1) END,
      CASE WHEN _lng BETWEEN -180 AND 180 THEN round(_lng, 1) END)
    ON CONFLICT (id) DO NOTHING;
    SELECT * INTO v_existing FROM public.app_sessions WHERE id = _session FOR UPDATE;
  ELSIF v_existing.visitor_id <> _visitor THEN
    RETURN; -- someone else's session id: never move it
  END IF;

  IF v_existing.views < 600 AND jsonb_typeof(_views) = 'array' THEN
    FOR v IN SELECT * FROM jsonb_array_elements(_views) LIMIT greatest(0, least(40, 600 - v_existing.views)) LOOP
      IF coalesce(v ->> 'path', '') <> '' AND coalesce(v ->> 'feature', '') <> '' THEN
        INSERT INTO public.app_page_views (session_id, user_id, at, path, feature)
        VALUES (_session, coalesce(_user, v_existing.user_id),
                least(now(), greatest(now() - interval '10 minutes', coalesce((v ->> 'at')::timestamptz, now()))),
                left(v ->> 'path', 200), left(v ->> 'feature', 60));
        v_views := v_views + 1;
      END IF;
    END LOOP;
  END IF;

  UPDATE public.app_sessions
     SET last_seen_at = now(),
         views = views + v_views,
         active_seconds = least(43200, active_seconds + greatest(0, least(coalesce(_active_seconds, 0), 300))),
         -- a visit that signs in part way through becomes that login's
         user_id = coalesce(user_id, _user),
         audience = CASE WHEN user_id IS NULL AND _user IS NOT NULL THEN coalesce(_audience, audience) ELSE audience END
   WHERE id = _session;
END;
$$;
REVOKE ALL ON FUNCTION public.app_pulse_record(uuid, uuid, uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text, numeric, numeric, jsonb, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_pulse_record(uuid, uuid, uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text, numeric, numeric, jsonb, integer) TO service_role;

-- Who a login is, for a visit: staff (any role but client, or the business owner), a coaching
-- client, a free member, or a login waiting on its application. Test logins are never counted.
CREATE OR REPLACE FUNCTION public.app_pulse_audience(_uid uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN _uid IS NULL THEN 'visitor'
    WHEN public.is_test_login(_uid) THEN 'test'
    WHEN EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _uid AND r.role::text <> 'client') THEN 'staff'
    WHEN EXISTS (SELECT 1 FROM public.clients c WHERE c.user_id = _uid AND c.service_tier = 'coaching') THEN 'client'
    WHEN EXISTS (SELECT 1 FROM public.clients c WHERE c.user_id = _uid) THEN 'member'
    ELSE 'pending'
  END;
$$;
REVOKE ALL ON FUNCTION public.app_pulse_audience(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_pulse_audience(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. The App & website read
-- ---------------------------------------------------------------------------
--
-- Definitions (the page says them too):
--   live           a visit with a heartbeat in the last 5 minutes (the app beats once a minute
--                  while it's on screen)
--   active person  a signed-in client or member who opened the app that day: an app visit, or
--                  before visits were recorded (Nov 23 2026), a coaching client's sign-in record
--                  (client_activity_log 'signed_in', kept since Jun 5 2026). Staff and test logins
--                  are never counted.
--   session        one visit: closing the app or 30 minutes away starts a new one
--   visitor        an anonymous browser on the public site (a random id kept on that browser)
CREATE OR REPLACE FUNCTION public.app_intel_report(_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days int := greatest(7, least(coalesce(_days, 30), 365));
  v_tz text := 'America/Winnipeg';
  v_today date := public.instant_to_local(now(), 'America/Winnipeg')::date;
  v_from date := v_today - (v_days - 1);
  v_result jsonb;
BEGIN
  WITH
  staff AS (
    SELECT r.user_id FROM public.user_roles r WHERE r.role::text <> 'client'
    UNION SELECT s.u FROM public.community_staff_people() s(u)
  ),
  people AS (
    SELECT u.id AS user_id, u.created_at,
           c.service_tier, c.status, c.archived, c.id AS client_id
      FROM auth.users u
      LEFT JOIN LATERAL (
        SELECT c.* FROM public.clients c WHERE c.user_id = u.id
         ORDER BY (c.service_tier = 'coaching') DESC, c.created_at LIMIT 1
      ) c ON true
     WHERE u.id NOT IN (SELECT user_id FROM staff WHERE user_id IS NOT NULL)
       AND NOT public.is_test_login(u.id)
  ),
  -- every day each person was in the app, from both records (the last 200 days: the read never
  -- looks further back, the 6 monthly cohorts included)
  activity AS (
    SELECT DISTINCT s.user_id, public.instant_to_local(s.started_at, v_tz)::date AS day
      FROM public.app_sessions s
     WHERE s.user_id IN (SELECT user_id FROM people) AND s.audience IN ('client', 'member', 'pending')
       AND s.started_at > now() - interval '200 days'
    UNION
    SELECT DISTINCT a.actor_user_id, public.instant_to_local(a.created_at, v_tz)::date
      FROM public.client_activity_log a
     WHERE a.action = 'signed_in' AND a.actor_user_id IN (SELECT user_id FROM people)
       AND a.created_at > now() - interval '200 days'
  ),
  days AS (SELECT generate_series(v_from, v_today, interval '1 day')::date AS day),
  -- each source read once and grouped by day (never a scan per day: visits grow every day)
  recent_activity AS (SELECT a.user_id, a.day FROM activity a WHERE a.day >= v_from - 6),
  sess_days AS (
    SELECT public.instant_to_local(s.started_at, v_tz)::date AS day, s.audience, s.visitor_id
      FROM public.app_sessions s
     WHERE s.started_at >= public.local_to_instant(v_from::timestamp, v_tz) AND s.audience <> 'test'
  ),
  by_sess AS (
    SELECT day,
           count(*) FILTER (WHERE audience IN ('client', 'member', 'pending')) AS sessions,
           count(DISTINCT visitor_id) FILTER (WHERE audience = 'visitor') AS site_visitors
      FROM sess_days GROUP BY day
  ),
  by_landing AS (
    SELECT f.day, count(DISTINCT f.visitor_id) AS landing
      FROM public.membership_funnel_events f
     WHERE f.event = 'landing_view' AND f.day >= v_from
     GROUP BY f.day
  ),
  by_signup AS (
    SELECT public.instant_to_local(p.created_at, v_tz)::date AS day, count(*) AS signups
      FROM people p WHERE p.created_at >= public.local_to_instant(v_from::timestamp, v_tz)
     GROUP BY 1
  ),
  daily AS (
    SELECT d.day,
           (SELECT count(DISTINCT a.user_id) FROM recent_activity a WHERE a.day = d.day) AS active,
           (SELECT count(DISTINCT a.user_id) FROM recent_activity a WHERE a.day BETWEEN d.day - 6 AND d.day) AS active7,
           coalesce(bs.sessions, 0) AS sessions,
           coalesce(bl.landing, 0) AS landing,
           coalesce(bs.site_visitors, 0) AS site_visitors,
           coalesce(bu.signups, 0) AS signups
      FROM days d
      LEFT JOIN by_sess bs ON bs.day = d.day
      LEFT JOIN by_landing bl ON bl.day = d.day
      LEFT JOIN by_signup bu ON bu.day = d.day
  ),
  live AS (
    SELECT s.* FROM public.app_sessions s
     WHERE s.last_seen_at > now() - interval '5 minutes' AND s.audience <> 'test'
  ),
  live_pages AS (
    SELECT DISTINCT ON (v.session_id) v.session_id, v.feature
      FROM public.app_page_views v
     WHERE v.session_id IN (SELECT id FROM live)
     ORDER BY v.session_id, v.at DESC
  ),
  window_sessions AS (
    SELECT s.* FROM public.app_sessions s
     WHERE s.started_at >= public.local_to_instant(v_from::timestamp, v_tz) AND s.audience <> 'test'
  ),
  feature_use AS (
    SELECT v.feature, s.audience,
           count(*) AS views,
           count(DISTINCT coalesce(s.user_id::text, s.visitor_id::text)) AS people
      FROM public.app_page_views v
      JOIN window_sessions s ON s.id = v.session_id
     GROUP BY 1, 2
  ),
  -- what people did, from the records each feature keeps (30 days)
  did AS (
    SELECT 'Logged a workout' AS action, count(DISTINCT c.user_id) AS people
      FROM public.pl_day_completions d JOIN public.clients c ON c.id = d.client_id
     WHERE d.completed_at >= now() - interval '30 days' AND c.user_id IN (SELECT user_id FROM people)
    UNION ALL
    SELECT 'Messaged their coach', count(DISTINCT m.sender_id) FROM public.messages m
     WHERE m.created_at >= now() - interval '30 days' AND m.sender_role = 'client' AND m.sender_id IN (SELECT user_id FROM people)
    UNION ALL
    SELECT 'Viewed Crew posts', count(DISTINCT v.viewer_user_id) FROM public.community_post_views v
     WHERE v.viewed_at >= now() - interval '30 days' AND v.viewer_user_id IN (SELECT user_id FROM people)
    UNION ALL
    SELECT 'Posted to Crew', count(DISTINCT p.author_user_id) FROM public.community_posts p
     WHERE p.created_at >= now() - interval '30 days' AND p.author_user_id IN (SELECT user_id FROM people)
    UNION ALL
    SELECT 'Liked or commented', count(DISTINCT x.u) FROM (
       SELECT r.user_id AS u FROM public.community_reactions r WHERE r.created_at >= now() - interval '30 days'
       UNION SELECT cm.author_user_id FROM public.community_comments cm WHERE cm.created_at >= now() - interval '30 days') x
     WHERE x.u IN (SELECT user_id FROM people)
    UNION ALL
    SELECT 'Logged bodyweight', count(DISTINCT b.user_id) FROM public.progress_bodyweight b
     WHERE b.created_at >= now() - interval '30 days' AND b.user_id IN (SELECT user_id FROM people)
    UNION ALL
    SELECT 'Logged water', count(DISTINCT w.user_id) FROM public.progress_water_entries w
     WHERE w.created_at >= now() - interval '30 days' AND w.user_id IN (SELECT user_id FROM people)
    UNION ALL
    SELECT 'Sent a weekly check-in', count(DISTINCT c.user_id) FROM public.messenger_checkins k JOIN public.clients c ON c.id = k.client_id
     WHERE k.submitted_at >= now() - interval '30 days' AND c.user_id IN (SELECT user_id FROM people)
    UNION ALL
    SELECT 'Filmed a set', count(DISTINCT c.user_id) FROM public.pl_set_videos sv JOIN public.clients c ON c.id = sv.client_id
     WHERE sv.created_at >= now() - interval '30 days' AND sv.deleted_at IS NULL AND c.user_id IN (SELECT user_id FROM people)
    UNION ALL
    SELECT 'Logged food', count(DISTINCT ml.user_id) FROM public.member_meal_logs ml
     WHERE ml.created_at >= now() - interval '30 days' AND ml.user_id IN (SELECT user_id FROM people)
    UNION ALL
    SELECT 'Built or imported a program', count(DISTINCT ap.owner_id) FROM public.athlete_programs ap
     WHERE ap.created_at >= now() - interval '30 days' AND ap.owner_id IN (SELECT user_id FROM people)
  ),
  -- retention: of each month's new people, the share who were in the app in each month after
  cohorts AS (
    SELECT date_trunc('month', public.instant_to_local(p.created_at, v_tz))::date AS cohort, p.user_id
      FROM people p
     WHERE p.created_at >= date_trunc('month', now()) - interval '6 months'
  ),
  cohort_active AS (
    SELECT c.cohort, c.user_id,
           (extract(year FROM age(date_trunc('month', a.day), c.cohort)) * 12
            + extract(month FROM age(date_trunc('month', a.day), c.cohort)))::int AS m
      FROM cohorts c JOIN activity a ON a.user_id = c.user_id
  ),
  onboard AS (
    SELECT p.user_id, p.created_at, p.service_tier,
           EXISTS (SELECT 1 FROM activity a WHERE a.user_id = p.user_id
                    AND a.day > public.instant_to_local(p.created_at, v_tz)::date) AS came_back,
           EXISTS (SELECT 1 FROM public.pl_day_completions d JOIN public.clients c ON c.id = d.client_id
                    WHERE c.user_id = p.user_id AND d.completed_at IS NOT NULL
                      AND d.completed_at < p.created_at + interval '7 days') AS trained_week1,
           EXISTS (SELECT 1 FROM public.pl_day_completions d JOIN public.clients c ON c.id = d.client_id
                    WHERE c.user_id = p.user_id AND d.completed_at IS NOT NULL) AS ever_trained,
           EXISTS (SELECT 1 FROM activity a WHERE a.user_id = p.user_id
                    AND a.day >= public.instant_to_local(p.created_at, v_tz)::date + 21
                    AND a.day < public.instant_to_local(p.created_at, v_tz)::date + 35) AS active_week4
      FROM people p
     WHERE p.created_at >= now() - interval '180 days'
  )
  SELECT jsonb_build_object(
    'days', v_days,
    'from', v_from,
    'today', v_today,
    'tracking_since', (SELECT min(started_at) FROM public.app_sessions),
    'live', jsonb_build_object(
      'total', (SELECT count(*) FROM live WHERE audience <> 'staff'),
      'by_audience', (SELECT coalesce(jsonb_object_agg(a, n), '{}'::jsonb) FROM (
          SELECT audience a, count(*) n FROM live GROUP BY 1) x),
      'by_feature', (SELECT coalesce(jsonb_agg(jsonb_build_object('feature', f, 'n', n) ORDER BY n DESC), '[]'::jsonb) FROM (
          SELECT coalesce(lp.feature, l.entry_feature, 'Other') f, count(*) n
            FROM live l LEFT JOIN live_pages lp ON lp.session_id = l.id
           WHERE l.audience <> 'staff' GROUP BY 1) x)
    ),
    'now', jsonb_build_object(
      'dau', (SELECT count(DISTINCT user_id) FROM activity WHERE day = v_today),
      'wau', (SELECT count(DISTINCT user_id) FROM activity WHERE day > v_today - 7),
      'mau', (SELECT count(DISTINCT user_id) FROM activity WHERE day > v_today - 30),
      'wau_prev', (SELECT count(DISTINCT user_id) FROM activity WHERE day > v_today - 14 AND day <= v_today - 7),
      'mau_prev', (SELECT count(DISTINCT user_id) FROM activity WHERE day > v_today - 60 AND day <= v_today - 30),
      'people', (SELECT count(*) FROM people),
      'members', (SELECT count(*) FROM people WHERE service_tier = 'self_serve' AND NOT coalesce(archived, false)),
      'clients', (SELECT count(*) FROM people WHERE service_tier = 'coaching' AND NOT coalesce(archived, false)
                    AND coalesce(status, '') NOT IN ('Lead', 'Deactivated', 'Deleted')),
      'pending', (SELECT count(*) FROM people WHERE client_id IS NULL),
      'signups_window', (SELECT count(*) FROM people WHERE created_at >= public.local_to_instant(v_from::timestamp, v_tz)),
      'signups_prev', (SELECT count(*) FROM people WHERE created_at >= public.local_to_instant((v_from - v_days)::timestamp, v_tz)
                         AND created_at < public.local_to_instant(v_from::timestamp, v_tz))
    ),
    'daily', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'day', day, 'active', active, 'active7', active7, 'sessions', sessions,
        'landing', landing, 'site_visitors', site_visitors, 'signups', signups) ORDER BY day), '[]'::jsonb) FROM daily),
    'sessions', jsonb_build_object(
      'count', (SELECT count(*) FROM window_sessions WHERE audience IN ('client', 'member', 'pending')),
      'median_minutes', (SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY active_seconds) / 60.0)::numeric, 1)
                           FROM window_sessions WHERE audience IN ('client', 'member', 'pending') AND active_seconds > 0),
      'views_per', (SELECT round(avg(views)::numeric, 1) FROM window_sessions WHERE audience IN ('client', 'member', 'pending')),
      'by_platform', (SELECT coalesce(jsonb_object_agg(k, n), '{}'::jsonb) FROM (
          SELECT coalesce(platform, 'unknown') k, count(*) n FROM window_sessions WHERE audience <> 'staff' GROUP BY 1) x),
      'by_device', (SELECT coalesce(jsonb_object_agg(k, n), '{}'::jsonb) FROM (
          SELECT coalesce(device, 'unknown') k, count(*) n FROM window_sessions WHERE audience <> 'staff' GROUP BY 1) x),
      'by_os', (SELECT coalesce(jsonb_object_agg(k, n), '{}'::jsonb) FROM (
          SELECT coalesce(os, 'unknown') k, count(*) n FROM window_sessions WHERE audience <> 'staff' GROUP BY 1) x),
      'by_hour', (SELECT coalesce(jsonb_agg(jsonb_build_object('dow', dow, 'hour', hr, 'n', n)), '[]'::jsonb) FROM (
          SELECT extract(isodow FROM public.instant_to_local(started_at, v_tz))::int dow,
                 extract(hour FROM public.instant_to_local(started_at, v_tz))::int hr, count(*) n
            FROM window_sessions WHERE audience IN ('client', 'member', 'pending') GROUP BY 1, 2) x)
    ),
    'features', (SELECT coalesce(jsonb_agg(jsonb_build_object('feature', feature, 'audience', audience, 'views', views, 'people', people)), '[]'::jsonb) FROM feature_use),
    'actions', (SELECT coalesce(jsonb_agg(jsonb_build_object('action', action, 'people', people) ORDER BY people DESC), '[]'::jsonb) FROM did),
    'push_devices', (SELECT coalesce(jsonb_object_agg(k, n), '{}'::jsonb) FROM (
        SELECT coalesce(nullif(ps.platform, ''), 'unknown') k, count(DISTINCT ps.user_id) n
          FROM public.push_subscriptions ps
         WHERE ps.enabled AND ps.user_id IN (SELECT user_id FROM people) GROUP BY 1) x),
    'places', (SELECT coalesce(jsonb_agg(jsonb_build_object(
          'country', country, 'region', region, 'city', city, 'lat', lat, 'lng', lng,
          'people', people, 'visitors', visitors, 'sessions', sessions, 'live', live) ORDER BY sessions DESC), '[]'::jsonb) FROM (
        SELECT s.country, s.region, s.city,
               round(avg(s.lat), 1) lat, round(avg(s.lng), 1) lng,
               count(DISTINCT s.user_id) FILTER (WHERE s.audience IN ('client', 'member', 'pending')) people,
               count(DISTINCT s.visitor_id) FILTER (WHERE s.audience = 'visitor') visitors,
               count(*) sessions,
               count(*) FILTER (WHERE s.last_seen_at > now() - interval '5 minutes') live
          FROM window_sessions s
         WHERE s.audience <> 'staff' AND s.country IS NOT NULL
         GROUP BY 1, 2, 3) x),
    'unplaced_sessions', (SELECT count(*) FROM window_sessions WHERE audience <> 'staff' AND country IS NULL),
    'site', jsonb_build_object(
      'landing_visitors', (SELECT count(DISTINCT visitor_id) FROM public.membership_funnel_events
                             WHERE event = 'landing_view' AND day >= v_from),
      'landing_prev', (SELECT count(DISTINCT visitor_id) FROM public.membership_funnel_events
                         WHERE event = 'landing_view' AND day >= v_from - v_days AND day < v_from),
      'sources', (SELECT coalesce(jsonb_agg(jsonb_build_object('source', src, 'visitors', n) ORDER BY n DESC), '[]'::jsonb) FROM (
          SELECT coalesce(nullif(f.utm_source, ''), nullif(f.source, ''), nullif(f.referrer_host, ''), 'Direct') src,
                 count(DISTINCT f.visitor_id) n
            FROM public.membership_funnel_events f
           WHERE f.event = 'landing_view' AND f.day >= v_from
           GROUP BY 1 ORDER BY 2 DESC LIMIT 12) x),
      'devices', (SELECT coalesce(jsonb_object_agg(k, n), '{}'::jsonb) FROM (
          SELECT coalesce(f.device, 'unknown') k, count(DISTINCT f.visitor_id) n
            FROM public.membership_funnel_events f
           WHERE f.event = 'landing_view' AND f.day >= v_from GROUP BY 1) x),
      'steps', (SELECT coalesce(jsonb_object_agg(k, n), '{}'::jsonb) FROM (
          SELECT f.event || CASE WHEN coalesce(f.step, '') <> '' THEN ':' || f.step ELSE '' END k,
                 count(DISTINCT f.visitor_id) n
            FROM public.membership_funnel_events f WHERE f.day >= v_from GROUP BY 1) x),
      'member_apps', (SELECT count(*) FROM public.membership_applications a
                        WHERE NOT coalesce(a.is_test, false) AND a.created_at >= public.local_to_instant(v_from::timestamp, v_tz)),
      'member_approved', (SELECT count(*) FROM public.membership_applications a
                            WHERE NOT coalesce(a.is_test, false) AND a.decided_at >= public.local_to_instant(v_from::timestamp, v_tz)
                              AND a.status = 'approved'),
      'member_joined', (SELECT count(*) FROM public.membership_applications a
                          WHERE NOT coalesce(a.is_test, false) AND a.activated_at >= public.local_to_instant(v_from::timestamp, v_tz)),
      'coaching_apps', (SELECT count(*) FROM public.coaching_applications a
                          WHERE NOT coalesce(a.is_test, false) AND a.created_at >= public.local_to_instant(v_from::timestamp, v_tz)),
      'coaching_converted', (SELECT count(*) FROM public.clients c
                               WHERE c.converted_to_client_at >= public.local_to_instant(v_from::timestamp, v_tz))
    ),
    'retention', (SELECT coalesce(jsonb_agg(jsonb_build_object('cohort', cohort, 'size', size, 'months', months) ORDER BY cohort), '[]'::jsonb) FROM (
        SELECT c.cohort, count(DISTINCT c.user_id) size,
               (SELECT coalesce(jsonb_agg(jsonb_build_object('m', m, 'active', n) ORDER BY m), '[]'::jsonb) FROM (
                  SELECT ca.m, count(DISTINCT ca.user_id) n FROM cohort_active ca
                   WHERE ca.cohort = c.cohort AND ca.m >= 0 GROUP BY 1) y) months
          FROM cohorts c GROUP BY 1) x),
    'onboarding', jsonb_build_object(
      'joined', (SELECT count(*) FROM onboard),
      'came_back', (SELECT count(*) FROM onboard WHERE came_back),
      'trained_week1', (SELECT count(*) FROM onboard WHERE trained_week1),
      'ever_trained', (SELECT count(*) FROM onboard WHERE ever_trained),
      'active_week4', (SELECT count(*) FROM onboard WHERE active_week4 AND created_at < now() - interval '35 days'),
      'week4_eligible', (SELECT count(*) FROM onboard WHERE created_at < now() - interval '35 days')
    ),
    'churn', (SELECT coalesce(jsonb_agg(jsonb_build_object('month', m, 'ended', ended, 'started', started) ORDER BY m), '[]'::jsonb) FROM (
        SELECT to_char(mo, 'YYYY-MM') m,
               (SELECT count(*) FROM public.clients c
                 WHERE c.service_tier = 'coaching'
                   AND coalesce(c.deactivated_at, c.archived_at) >= mo
                   AND coalesce(c.deactivated_at, c.archived_at) < mo + interval '1 month') ended,
               (SELECT count(*) FROM public.clients c
                 WHERE c.service_tier = 'coaching'
                   AND coalesce(c.converted_to_client_at, c.account_created_at, c.created_at) >= mo
                   AND coalesce(c.converted_to_client_at, c.account_created_at, c.created_at) < mo + interval '1 month'
                   AND coalesce(c.status, '') <> 'Lead') started
          FROM generate_series(date_trunc('month', now()) - interval '5 months', date_trunc('month', now()), interval '1 month') mo) x),
    'revenue', (SELECT coalesce(jsonb_agg(jsonb_build_object('month', m, 'cash_in', cash_in, 'refunds', refunds) ORDER BY m), '[]'::jsonb) FROM (
        SELECT to_char(date_trunc('month', l.transaction_date), 'YYYY-MM') m,
               round(sum(CASE WHEN l.txn_type = 'payment' THEN (l.amount_minor - coalesce(l.tax_minor, 0)) ELSE 0 END) / 100.0, 2) cash_in,
               round(sum(CASE WHEN l.txn_type = 'refund' THEN abs(l.amount_minor - coalesce(l.tax_minor, 0)) ELSE 0 END) / 100.0, 2) refunds
          FROM public.payment_ledger l
         WHERE NOT coalesce(l.voided, false)
           AND l.transaction_date >= date_trunc('month', now()) - interval '5 months'
         GROUP BY 1) x),
    'subscriptions', jsonb_build_object(
      'active', (SELECT count(*) FROM public.purchase_records p
                  WHERE p.stripe_subscription_id IS NOT NULL AND p.archived_at IS NULL
                    AND coalesce(p.stripe_subscription_status, '') IN ('active', 'trialing', 'past_due')),
      'ending', (SELECT count(*) FROM public.purchase_records p
                  WHERE p.stripe_subscription_id IS NOT NULL AND p.archived_at IS NULL
                    AND coalesce(p.stripe_subscription_status, '') IN ('active', 'trialing') AND p.cancel_at_period_end),
      'failing', (SELECT count(*) FROM public.purchase_records p
                   WHERE p.stripe_subscription_id IS NOT NULL AND p.archived_at IS NULL
                     AND coalesce(p.stripe_subscription_status, '') IN ('past_due', 'unpaid', 'incomplete'))
    ),
    'staff_pages', (SELECT coalesce(jsonb_agg(jsonb_build_object('feature', feature, 'views', views) ORDER BY views DESC), '[]'::jsonb) FROM (
        SELECT v.feature, count(*) views FROM public.app_page_views v JOIN window_sessions s ON s.id = v.session_id
         WHERE s.audience = 'staff' GROUP BY 1) x)
  ) INTO v_result;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.app_intel_report(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_intel_report(integer) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Plan changes are part of an account's history (Membership → Change plan)
-- ---------------------------------------------------------------------------
-- A move between a free membership and coaching keeps the same record and every bit of data; the
-- account's history says when and who did it (account_lifecycle_events is server-written).
ALTER TABLE public.account_lifecycle_events DROP CONSTRAINT IF EXISTS account_lifecycle_events_event_check;
ALTER TABLE public.account_lifecycle_events ADD CONSTRAINT account_lifecycle_events_event_check CHECK (event IN (
  'deactivation_scheduled', 'deactivation_withdrawn', 'deactivated', 'reactivated',
  'subscription_cancelled', 'auto_pay_stopped', 'sessions_cancelled',
  'deletion_requested', 'deletion_withdrawn', 'deletion_completed',
  'moved_to_coaching', 'moved_to_membership'));

-- ---------------------------------------------------------------------------
-- 6. The Membership home's read (Membership → Overview)
-- ---------------------------------------------------------------------------
-- A member is the one athlete record a free member has: clients.service_tier = 'self_serve' with a
-- login, never staff, a test login or an admin's preview sandbox. Paid JF Membership is retired
-- (free by application), so paid statuses are read only as "legacy" from app_members.
CREATE OR REPLACE FUNCTION public.membership_overview(_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days int := greatest(7, least(coalesce(_days, 30), 365));
  v_tz text := 'America/Winnipeg';
  v_since timestamptz := now() - make_interval(days => greatest(7, least(coalesce(_days, 30), 365)));
  v_prev timestamptz := now() - make_interval(days => 2 * greatest(7, least(coalesce(_days, 30), 365)));
  v jsonb;
BEGIN
  WITH
  staff AS (SELECT r.user_id FROM public.user_roles r WHERE r.role::text <> 'client'),
  m AS (
    SELECT c.id, c.user_id, c.full_name, c.email, c.created_at, c.status, c.archived,
           c.last_active_at, c.deactivated_at,
           am.id AS member_id, am.setup_completed_at, am.manual_access_disabled
      FROM public.clients c
      LEFT JOIN LATERAL (SELECT a.* FROM public.app_members a WHERE a.user_id = c.user_id AND a.account_type = 'jf_member'
                          ORDER BY a.created_at LIMIT 1) am ON true
     WHERE c.service_tier = 'self_serve' AND c.user_id IS NOT NULL
       AND c.user_id NOT IN (SELECT user_id FROM staff WHERE user_id IS NOT NULL)
       AND NOT public.is_test_login(c.user_id)
  ),
  live_m AS (SELECT * FROM m WHERE NOT coalesce(archived, false) AND coalesce(status, '') NOT IN ('Deactivated', 'Deleted')),
  act AS (
    SELECT DISTINCT s.user_id, public.instant_to_local(s.started_at, v_tz)::date AS day
      FROM public.app_sessions s WHERE s.user_id IN (SELECT user_id FROM m) AND s.started_at > now() - interval '60 days'
    UNION
    SELECT DISTINCT a.actor_user_id, public.instant_to_local(a.created_at, v_tz)::date
      FROM public.client_activity_log a WHERE a.action = 'signed_in' AND a.actor_user_id IN (SELECT user_id FROM m)
       AND a.created_at > now() - interval '60 days'
    UNION
    SELECT DISTINCT x.user_id, public.instant_to_local(x.last_active_at, v_tz)::date FROM m x WHERE x.last_active_at > now() - interval '60 days'
  ),
  trained AS (
    SELECT d.client_id, count(*) FILTER (WHERE d.completed_at > now() - interval '30 days') AS n30, count(*) AS n_all,
           max(d.completed_at) AS last_at
      FROM public.pl_day_completions d
     WHERE d.client_id IN (SELECT id FROM m) AND d.completed_at IS NOT NULL
     GROUP BY d.client_id
  ),
  apps AS (SELECT a.* FROM public.membership_applications a WHERE NOT coalesce(a.is_test, false)),
  legacy AS (
    SELECT a.subscription_status, a.stripe_subscription_id
      FROM public.app_members a
     WHERE a.account_type = 'jf_member' AND a.stripe_subscription_id IS NOT NULL AND NOT coalesce(a.is_admin_sandbox, false)
  ),
  moved AS (
    SELECT e.event, e.created_at FROM public.account_lifecycle_events e WHERE e.event IN ('moved_to_coaching', 'moved_to_membership')
  )
  SELECT jsonb_build_object(
    'days', v_days,
    'members', jsonb_build_object(
      'total', (SELECT count(*) FROM live_m),
      'new', (SELECT count(*) FROM live_m WHERE created_at >= v_since),
      'new_prev', (SELECT count(*) FROM m WHERE created_at >= v_prev AND created_at < v_since),
      'active7', (SELECT count(DISTINCT a.user_id) FROM act a JOIN live_m x ON x.user_id = a.user_id
                   WHERE a.day > public.instant_to_local(now(), v_tz)::date - 7),
      'active30', (SELECT count(DISTINCT a.user_id) FROM act a JOIN live_m x ON x.user_id = a.user_id
                    WHERE a.day > public.instant_to_local(now(), v_tz)::date - 30),
      'trained30', (SELECT count(*) FROM trained t JOIN live_m x ON x.id = t.client_id WHERE t.n30 > 0),
      'never_trained', (SELECT count(*) FROM live_m x WHERE x.created_at < now() - interval '7 days'
                         AND NOT EXISTS (SELECT 1 FROM trained t WHERE t.client_id = x.id)),
      'setup_unfinished', (SELECT count(*) FROM live_m x WHERE x.member_id IS NOT NULL AND NOT coalesce(public.member_setup_complete(x.member_id), false)),
      'deactivated', (SELECT count(*) FROM m WHERE coalesce(status, '') = 'Deactivated' OR deactivated_at IS NOT NULL),
      'access_off', (SELECT count(*) FROM live_m WHERE coalesce(manual_access_disabled, false))
    ),
    'growth', (SELECT coalesce(jsonb_agg(jsonb_build_object('month', to_char(mo, 'YYYY-MM'),
                 'joined', (SELECT count(*) FROM m WHERE date_trunc('month', public.instant_to_local(m.created_at, v_tz)) = mo),
                 'total', (SELECT count(*) FROM m WHERE public.instant_to_local(m.created_at, v_tz) < mo + interval '1 month'
                             AND (m.deactivated_at IS NULL OR public.instant_to_local(m.deactivated_at, v_tz) >= mo + interval '1 month')),
                 'active', (SELECT count(DISTINCT a.user_id) FROM act a WHERE date_trunc('month', a.day) = mo))
               ORDER BY mo), '[]'::jsonb)
                 FROM generate_series(date_trunc('month', public.instant_to_local(now(), v_tz)) - interval '5 months',
                                      date_trunc('month', public.instant_to_local(now(), v_tz)), interval '1 month') mo),
    'applications', jsonb_build_object(
      'waiting', (SELECT count(*) FROM apps WHERE status = 'pending'),
      'oldest_waiting', (SELECT min(created_at) FROM apps WHERE status = 'pending'),
      'received', (SELECT count(*) FROM apps WHERE created_at >= v_since),
      'approved', (SELECT count(*) FROM apps WHERE status = 'approved' AND decided_at >= v_since),
      'declined', (SELECT count(*) FROM apps WHERE status = 'declined' AND decided_at >= v_since),
      'joined', (SELECT count(*) FROM apps WHERE activated_at >= v_since),
      'approved_not_joined', (SELECT count(*) FROM apps WHERE status = 'approved' AND activated_at IS NULL),
      'list', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', full_name, 'created_at', created_at, 'goal', goal,
                 'coaching_interest', coaching_interest) ORDER BY created_at), '[]'::jsonb)
                 FROM (SELECT * FROM apps WHERE status = 'pending' ORDER BY created_at LIMIT 5) w)
    ),
    'conversions', jsonb_build_object(
      'to_coaching', (SELECT count(*) FROM moved WHERE event = 'moved_to_coaching' AND created_at >= v_since),
      'to_membership', (SELECT count(*) FROM moved WHERE event = 'moved_to_membership' AND created_at >= v_since),
      'clients_from_membership', (SELECT count(*) FROM public.clients c
                                    WHERE c.service_tier = 'coaching' AND NOT coalesce(c.archived, false)
                                      AND EXISTS (SELECT 1 FROM public.app_members a WHERE a.user_id = c.user_id AND a.account_type = 'jf_member'))
    ),
    'revenue', jsonb_build_object(
      'credit_packs_minor', (SELECT coalesce(sum(p.amount_minor - coalesce(p.refunded_minor, 0)), 0) FROM public.ai_credit_purchases p
                              WHERE p.status = 'paid' AND p.paid_at >= v_since),
      'credit_packs', (SELECT count(*) FROM public.ai_credit_purchases p WHERE p.status = 'paid' AND p.paid_at >= v_since),
      'from_converted_minor', (SELECT coalesce(sum(l.amount_minor - coalesce(l.tax_minor, 0)), 0)
                                FROM public.payment_ledger l
                                JOIN public.clients c ON c.id = l.client_id
                               WHERE l.txn_type = 'payment' AND NOT coalesce(l.voided, false) AND l.transaction_date >= v_since::date
                                 AND EXISTS (SELECT 1 FROM public.app_members a WHERE a.user_id = c.user_id AND a.account_type = 'jf_member'))
    ),
    'legacy_paid', jsonb_build_object(
      'total', (SELECT count(*) FROM legacy),
      'by_status', (SELECT coalesce(jsonb_object_agg(s, n), '{}'::jsonb) FROM (
          SELECT coalesce(subscription_status, 'Unknown') s, count(*) n FROM legacy GROUP BY 1) x),
      'failing', (SELECT count(*) FROM legacy WHERE subscription_status IN ('Past Due', 'Payment Failed'))
    ),
    'programs', jsonb_build_object(
      'on_program', (SELECT count(DISTINCT b.client_id) FROM public.pl_blocks b
                      WHERE b.client_id IN (SELECT id FROM live_m) AND NOT coalesce(b.archived, false)),
      'library_live', (SELECT count(*) FROM public.member_plans p WHERE p.status = 'Published')
    ),
    'not_trained', (SELECT coalesce(jsonb_agg(jsonb_build_object('client_id', id, 'name', coalesce(nullif(btrim(full_name), ''), email), 'joined', created_at,
                      'last_active', last_active_at) ORDER BY created_at DESC), '[]'::jsonb)
                      FROM (SELECT * FROM live_m x WHERE x.created_at < now() - interval '7 days'
                              AND NOT EXISTS (SELECT 1 FROM trained t WHERE t.client_id = x.id)
                            ORDER BY x.created_at DESC LIMIT 6) y),
    'setup_list', (SELECT coalesce(jsonb_agg(jsonb_build_object('client_id', id, 'member_id', member_id, 'name', coalesce(nullif(btrim(full_name), ''), email), 'joined', created_at) ORDER BY created_at DESC), '[]'::jsonb)
                      FROM (SELECT * FROM live_m x WHERE x.member_id IS NOT NULL AND NOT coalesce(public.member_setup_complete(x.member_id), false)
                            ORDER BY x.created_at DESC LIMIT 6) y)
  ) INTO v;
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public.membership_overview(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.membership_overview(integer) TO service_role;

-- ---------------------------------------------------------------------------
-- 7. Retention: visits are kept 400 days
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'app-visits-retention';
    PERFORM cron.schedule('app-visits-retention', '23 9 * * *',
      $cmd$DELETE FROM public.app_sessions WHERE last_seen_at < now() - interval '400 days'$cmd$);
  END IF;
END $$;
