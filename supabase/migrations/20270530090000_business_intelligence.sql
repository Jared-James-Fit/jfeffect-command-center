-- Business intelligence (Nov 25 2026): one Analytics section over the website, the applications,
-- the coaching business and the whole app, built on what's already collected.
--
-- Reused, never copied: app_sessions / app_page_views (visits, Nov 23 2026), membership_funnel_events
-- (the public site's steps), the applications, every feature's own records (a workout finished, a
-- check-in sent, a post…), payment_ledger and purchase_records (billing, the source of truth for
-- money). Added:
--
--   app_sessions.channel / browser / touch_source / touch_campaign / attribution_ok
--                        where the visit itself came from (bi_channel, its TS twin src/lib/bi/channels.ts),
--                        the browser family (an in-app browser like Instagram's is a signal), and
--                        whether the person allows their visits to be tied together.
--   app_sessions.region  filled from the time zone's main city where that city names one province or
--                        state (bi_zone_region); never finer than the city the visit already had.
--   analytics_visitors   one row per browser: its first touch (channel, source, campaign, landing page)
--                        and, once someone signs in on it, their login, so a later sign-up or payment
--                        can be traced back to where they first came from. Never linked for a browser
--                        that sends Global Privacy Control or Do Not Track (attribution_ok).
--   analytics_events     what leaves no record of its own: web vitals, an error, a failed request, a
--                        page not found (src/lib/bi/events.ts is the catalog; anything else is refused).
--   bi_* reports         one read per Analytics tab, service role only, after the server's admin check.
--
-- Nothing here is visible to anyone but the service role (RLS on, no policies). Retention: events
-- 180 days, visitors 400 days (like the visits); bi_forget_user clears a person's analytics when their
-- account is purged.
SET lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Channels and regions
-- ---------------------------------------------------------------------------

-- The twin of channelOf (src/lib/bi/channels.ts); CHANNEL_CASES must agree on both.
CREATE OR REPLACE FUNCTION public.bi_channel(_referrer_host text, _utm_source text, _utm_medium text, _from text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  m text := left(lower(btrim(coalesce(_utm_medium, ''))), 120);
  s text := left(lower(btrim(coalesce(_utm_source, ''))), 120);
  r text := left(lower(btrim(coalesce(_referrer_host, ''))), 500);
  h text;
BEGIN
  IF s = '' THEN s := left(lower(btrim(coalesce(_from, ''))), 80); END IF;
  h := substring(r from '^[a-z][a-z0-9+.-]*://([^/?#:]+)');
  IF h IS NULL THEN h := coalesce(substring(r from '^([^/?#:]*)'), ''); END IF;
  h := regexp_replace(h, '^www\.', '');
  IF h !~ '^[a-z0-9.-]{1,120}$' THEN h := ''; END IF;

  IF m <> '' AND m ~ '^(cpc|ppc|cpm|cpv|paid|paid[_ -]?social|paidsocial|paid[_ -]?search|ads?|display|banner|sponsored|boost(ed)?|promoted)$' THEN RETURN 'paid'; END IF;
  IF m <> '' AND m ~ '^(e-?mail|newsletter)$' THEN RETURN 'email'; END IF;
  IF s <> '' THEN
    IF s ~ '^(e-?mail|newsletter|mailchimp|klaviyo|convertkit)$' THEN RETURN 'email'; END IF;
    IF s ~ '^(ig|insta|instagram|instagram[_ -]?(bio|story|stories|reel|reels|dm|post|ads?))$' THEN RETURN 'instagram'; END IF;
    IF s ~ '^(yt|youtube|youtube[_ -]?(shorts?|video|description))$' THEN RETURN 'youtube'; END IF;
    IF s ~ '^(tt|tiktok|tik[_ -]?tok)$' THEN RETURN 'tiktok'; END IF;
    IF s ~ '^(fb|facebook|meta|messenger|facebook[_ -]?(group|page|ads?))$' THEN RETURN 'facebook'; END IF;
    IF s ~ '^(google|google[_ -]?(search|organic))$' THEN RETURN 'google'; END IF;
    IF s ~ '^(bing|duckduckgo|ddg|yahoo|ecosia|brave|yandex|baidu)$' THEN RETURN 'search'; END IF;
    IF s ~ '^(twitter|x|threads|reddit|linkedin|pinterest|snapchat|discord)$' THEN RETURN 'social'; END IF;
  END IF;
  IF h <> '' AND h !~ '(^|\.)jfeffect\.com$' THEN
    IF h ~ '(^|\.)(mail\.google\.com|outlook\.(live|office)\.com|mail\.yahoo\.com|mail\.proton\.me)$' OR h ~ '^com\.google\.android\.gm$' OR h ~ '^com\.microsoft\.office\.outlook$' THEN RETURN 'email'; END IF;
    IF h ~ '(^|\.)instagram\.com$' OR h = 'com.instagram.android' THEN RETURN 'instagram'; END IF;
    IF h ~ '(^|\.)(youtube\.com|youtu\.be)$' OR h = 'com.google.android.youtube' THEN RETURN 'youtube'; END IF;
    IF h ~ '(^|\.)(tiktok\.com|tiktokv\.com)$' OR h = 'com.zhiliaoapp.musically' THEN RETURN 'tiktok'; END IF;
    IF h ~ '(^|\.)(facebook\.com|fb\.com|fb\.me|messenger\.com|m\.me)$' OR h ~ '^com\.facebook\.(katana|orca)$' THEN RETURN 'facebook'; END IF;
    IF h ~ '(^|\.)google\.[a-z.]{2,6}$' OR h = 'com.google.android.googlequicksearchbox' THEN RETURN 'google'; END IF;
    IF h ~ '(^|\.)(bing\.com|duckduckgo\.com|search\.yahoo\.com|yahoo\.com|ecosia\.org|search\.brave\.com|yandex\.[a-z]+|baidu\.com)$' THEN RETURN 'search'; END IF;
    IF h ~ '(^|\.)(t\.co|twitter\.com|x\.com|threads\.net|threads\.com|reddit\.com|linkedin\.com|lnkd\.in|pinterest\.[a-z.]+|pin\.it|snapchat\.com|discord\.com)$' THEN RETURN 'social'; END IF;
    RETURN 'referral';
  END IF;
  IF s <> '' OR m <> '' THEN RETURN 'other'; END IF;
  RETURN 'direct';
END;
$$;
GRANT EXECUTE ON FUNCTION public.bi_channel(text, text, text, text) TO service_role;

-- A province or state for the time zone cities that name exactly one (America/Toronto is Ontario
-- and Quebec, America/New_York a dozen states: those stay a city with no region).
CREATE OR REPLACE FUNCTION public.bi_zone_region(_country text, _city text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE upper(coalesce(_country, ''))
    WHEN 'CA' THEN CASE _city
      WHEN 'Winnipeg' THEN 'Manitoba' WHEN 'Regina' THEN 'Saskatchewan' WHEN 'Swift Current' THEN 'Saskatchewan'
      WHEN 'Edmonton' THEN 'Alberta' WHEN 'Calgary' THEN 'Alberta' WHEN 'Vancouver' THEN 'British Columbia'
      WHEN 'Dawson Creek' THEN 'British Columbia' WHEN 'Fort Nelson' THEN 'British Columbia' WHEN 'Creston' THEN 'British Columbia'
      WHEN 'Halifax' THEN 'Nova Scotia' WHEN 'Glace Bay' THEN 'Nova Scotia' WHEN 'Moncton' THEN 'New Brunswick'
      WHEN 'St Johns' THEN 'Newfoundland and Labrador' WHEN 'Goose Bay' THEN 'Newfoundland and Labrador'
      WHEN 'Whitehorse' THEN 'Yukon' WHEN 'Dawson' THEN 'Yukon' WHEN 'Inuvik' THEN 'Northwest Territories'
      WHEN 'Iqaluit' THEN 'Nunavut' WHEN 'Rankin Inlet' THEN 'Nunavut' WHEN 'Resolute' THEN 'Nunavut' WHEN 'Cambridge Bay' THEN 'Nunavut'
      WHEN 'Atikokan' THEN 'Ontario' WHEN 'Blanc-Sablon' THEN 'Quebec'
      ELSE NULL END
    WHEN 'US' THEN CASE _city
      WHEN 'Phoenix' THEN 'Arizona' WHEN 'Honolulu' THEN 'Hawaii' WHEN 'Anchorage' THEN 'Alaska' WHEN 'Juneau' THEN 'Alaska'
      WHEN 'Sitka' THEN 'Alaska' WHEN 'Nome' THEN 'Alaska' WHEN 'Yakutat' THEN 'Alaska' WHEN 'Metlakatla' THEN 'Alaska'
      WHEN 'Boise' THEN 'Idaho' WHEN 'Detroit' THEN 'Michigan' WHEN 'Menominee' THEN 'Michigan'
      WHEN 'Indianapolis' THEN 'Indiana' WHEN 'Knox' THEN 'Indiana' WHEN 'Marengo' THEN 'Indiana' WHEN 'Petersburg' THEN 'Indiana'
      WHEN 'Tell City' THEN 'Indiana' WHEN 'Vevay' THEN 'Indiana' WHEN 'Vincennes' THEN 'Indiana' WHEN 'Winamac' THEN 'Indiana'
      WHEN 'Louisville' THEN 'Kentucky' WHEN 'Monticello' THEN 'Kentucky'
      WHEN 'Beulah' THEN 'North Dakota' WHEN 'Center' THEN 'North Dakota' WHEN 'New Salem' THEN 'North Dakota'
      ELSE NULL END
    WHEN 'AU' THEN CASE _city
      WHEN 'Sydney' THEN 'New South Wales' WHEN 'Broken Hill' THEN 'New South Wales' WHEN 'Melbourne' THEN 'Victoria'
      WHEN 'Brisbane' THEN 'Queensland' WHEN 'Lindeman' THEN 'Queensland' WHEN 'Perth' THEN 'Western Australia'
      WHEN 'Adelaide' THEN 'South Australia' WHEN 'Hobart' THEN 'Tasmania' WHEN 'Darwin' THEN 'Northern Territory'
      ELSE NULL END
    ELSE NULL END
$$;
GRANT EXECUTE ON FUNCTION public.bi_zone_region(text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Visits: the visit's own source, browser, region, attribution consent
-- ---------------------------------------------------------------------------

ALTER TABLE public.app_sessions ADD COLUMN IF NOT EXISTS channel text;
ALTER TABLE public.app_sessions ADD COLUMN IF NOT EXISTS browser text;
ALTER TABLE public.app_sessions ADD COLUMN IF NOT EXISTS touch_source text;
ALTER TABLE public.app_sessions ADD COLUMN IF NOT EXISTS touch_campaign text;
ALTER TABLE public.app_sessions ADD COLUMN IF NOT EXISTS attribution_ok boolean NOT NULL DEFAULT true;
ALTER TABLE public.app_sessions DROP CONSTRAINT IF EXISTS app_sessions_channel_check;
ALTER TABLE public.app_sessions ADD CONSTRAINT app_sessions_channel_check CHECK (channel IS NULL OR channel IN (
  'instagram', 'youtube', 'tiktok', 'facebook', 'google', 'search', 'social', 'paid', 'email', 'referral', 'other', 'direct'));
ALTER TABLE public.app_sessions DROP CONSTRAINT IF EXISTS app_sessions_browser_check;
ALTER TABLE public.app_sessions ADD CONSTRAINT app_sessions_browser_check CHECK (browser IS NULL OR browser IN (
  'safari', 'chrome', 'firefox', 'edge', 'samsung', 'opera', 'instagram', 'facebook', 'tiktok', 'webview', 'other'));
ALTER TABLE public.app_sessions DROP CONSTRAINT IF EXISTS app_sessions_touch_check;
ALTER TABLE public.app_sessions ADD CONSTRAINT app_sessions_touch_check CHECK (
  (touch_source IS NULL OR char_length(touch_source) <= 120) AND (touch_campaign IS NULL OR char_length(touch_campaign) <= 120));
CREATE INDEX IF NOT EXISTS app_sessions_visitor_idx ON public.app_sessions (visitor_id, started_at);
CREATE INDEX IF NOT EXISTS app_sessions_channel_idx ON public.app_sessions (channel, started_at);

-- A new visit gets a channel from what it remembers (the first source of the last 30 days) and a
-- region from its city; the visit recorder then sets the channel of the visit's own landing
-- (bi_pulse_extras), which is the one last-touch attribution reads.
CREATE OR REPLACE FUNCTION public.tg_app_sessions_bi_defaults()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.channel IS NULL THEN
    NEW.channel := public.bi_channel(NEW.referrer_host, NEW.utm_source, NEW.utm_medium);
  END IF;
  IF NEW.region IS NULL AND NEW.country IS NOT NULL AND NEW.city IS NOT NULL THEN
    NEW.region := public.bi_zone_region(NEW.country, NEW.city);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS app_sessions_bi_defaults ON public.app_sessions;
CREATE TRIGGER app_sessions_bi_defaults BEFORE INSERT ON public.app_sessions
  FOR EACH ROW EXECUTE FUNCTION public.tg_app_sessions_bi_defaults();

-- Visits recorded before: their channel is the best they kept (the remembered source), their region
-- the time zone city's.
UPDATE public.app_sessions
   SET channel = public.bi_channel(referrer_host, utm_source, utm_medium)
 WHERE channel IS NULL;
UPDATE public.app_sessions
   SET region = public.bi_zone_region(country, city)
 WHERE region IS NULL AND country IS NOT NULL AND city IS NOT NULL AND public.bi_zone_region(country, city) IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Visitors (first touch, and the login a browser signed in with)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.analytics_visitors (
  visitor_id uuid PRIMARY KEY,
  first_seen_at timestamptz NOT NULL,
  first_session_id uuid,
  first_channel text,
  first_source text CHECK (first_source IS NULL OR char_length(first_source) <= 120),
  first_medium text CHECK (first_medium IS NULL OR char_length(first_medium) <= 120),
  first_campaign text CHECK (first_campaign IS NULL OR char_length(first_campaign) <= 120),
  first_landing text CHECK (first_landing IS NULL OR char_length(first_landing) <= 200),
  first_country text CHECK (first_country IS NULL OR char_length(first_country) = 2),
  user_id uuid,
  linked_at timestamptz,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS analytics_visitors_user_idx ON public.analytics_visitors (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS analytics_visitors_first_seen_idx ON public.analytics_visitors (first_seen_at);
ALTER TABLE public.analytics_visitors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.analytics_visitors FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.analytics_visitors TO service_role;

INSERT INTO public.analytics_visitors (visitor_id, first_seen_at, first_session_id, first_channel, first_source,
  first_medium, first_campaign, first_landing, first_country, user_id, linked_at, last_seen_at)
SELECT DISTINCT ON (s.visitor_id)
       s.visitor_id, s.started_at, s.id, public.bi_channel(s.referrer_host, s.utm_source, s.utm_medium),
       left(coalesce(nullif(s.utm_source, ''), s.referrer_host), 120), s.utm_medium, s.utm_campaign,
       s.entry_path, s.country,
       (SELECT s2.user_id FROM public.app_sessions s2 WHERE s2.visitor_id = s.visitor_id AND s2.user_id IS NOT NULL
         ORDER BY s2.started_at LIMIT 1),
       (SELECT min(s2.started_at) FROM public.app_sessions s2 WHERE s2.visitor_id = s.visitor_id AND s2.user_id IS NOT NULL),
       (SELECT max(s2.last_seen_at) FROM public.app_sessions s2 WHERE s2.visitor_id = s.visitor_id)
  FROM public.app_sessions s
 ORDER BY s.visitor_id, s.started_at
ON CONFLICT (visitor_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. Events
-- ---------------------------------------------------------------------------

-- The catalog (src/lib/bi/events.ts BI_EVENT_NAMES).
CREATE OR REPLACE FUNCTION public.bi_event_names()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$ SELECT ARRAY['web_vital', 'js_error', 'request_failed', 'page_not_found']::text[] $$;

CREATE TABLE IF NOT EXISTS public.analytics_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_event_id uuid NOT NULL,
  session_id uuid NOT NULL REFERENCES public.app_sessions (id) ON DELETE CASCADE,
  visitor_id uuid NOT NULL,
  user_id uuid,
  audience text NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  name text NOT NULL CHECK (name IN ('web_vital', 'js_error', 'request_failed', 'page_not_found')),
  label text NOT NULL DEFAULT '' CHECK (char_length(label) <= 200),
  value numeric,
  rating text CHECK (rating IS NULL OR char_length(rating) <= 20),
  path text NOT NULL DEFAULT '/' CHECK (char_length(path) <= 200),
  feature text NOT NULL DEFAULT 'Other' CHECK (char_length(feature) <= 60),
  UNIQUE (session_id, client_event_id)
);
CREATE INDEX IF NOT EXISTS analytics_events_name_at_idx ON public.analytics_events (name, at);
CREATE INDEX IF NOT EXISTS analytics_events_user_idx ON public.analytics_events (user_id) WHERE user_id IS NOT NULL;
ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.analytics_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.analytics_events TO service_role;

-- One beat's extras, after app_pulse_record: the visit's own touch, its browser, consent to tie it to
-- the visitor, the visitor's first touch and login, and the events. Never moves someone else's visit.
CREATE OR REPLACE FUNCTION public.bi_pulse_extras(
  _session uuid, _visitor uuid, _user uuid, _audience text, _browser text, _opt_out boolean,
  _touch_channel text, _touch_source text, _touch_campaign text, _events jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.app_sessions%ROWTYPE;
  v_have int;
  e jsonb;
  v_at timestamptz;
BEGIN
  SELECT * INTO s FROM public.app_sessions WHERE id = _session;
  IF NOT FOUND OR s.visitor_id <> _visitor OR s.audience = 'test' THEN RETURN; END IF;

  UPDATE public.app_sessions
     SET browser = coalesce(browser, CASE WHEN _browser IN ('safari', 'chrome', 'firefox', 'edge', 'samsung', 'opera', 'instagram', 'facebook', 'tiktok', 'webview', 'other') THEN _browser END),
         -- the touch rides only the visit's first beat (pulse.server.ts)
         channel = CASE WHEN _touch_channel IN ('instagram', 'youtube', 'tiktok', 'facebook', 'google', 'search', 'social', 'paid', 'email', 'referral', 'other', 'direct')
                        THEN _touch_channel ELSE channel END,
         touch_source = coalesce(touch_source, nullif(left(btrim(coalesce(_touch_source, '')), 120), '')),
         touch_campaign = coalesce(touch_campaign, nullif(left(btrim(coalesce(_touch_campaign, '')), 120), '')),
         attribution_ok = attribution_ok AND NOT coalesce(_opt_out, false)
   WHERE id = _session
  RETURNING * INTO s;

  IF NOT coalesce(_opt_out, false) AND s.attribution_ok THEN
    INSERT INTO public.analytics_visitors AS av (visitor_id, first_seen_at, first_session_id, first_channel, first_source,
      first_medium, first_campaign, first_landing, first_country, user_id, linked_at, last_seen_at)
    VALUES (s.visitor_id, s.started_at, s.id, public.bi_channel(s.referrer_host, s.utm_source, s.utm_medium),
      left(coalesce(nullif(s.utm_source, ''), s.referrer_host), 120), s.utm_medium, s.utm_campaign,
      s.entry_path, s.country, coalesce(_user, s.user_id),
      CASE WHEN coalesce(_user, s.user_id) IS NOT NULL THEN now() END, now())
    ON CONFLICT (visitor_id) DO UPDATE
      SET last_seen_at = now(),
          user_id = coalesce(av.user_id, excluded.user_id),
          linked_at = CASE WHEN av.user_id IS NULL AND excluded.user_id IS NOT NULL THEN now() ELSE av.linked_at END;
  END IF;

  IF coalesce(_opt_out, false) OR jsonb_typeof(_events) <> 'array' OR jsonb_array_length(_events) = 0 THEN RETURN; END IF;
  SELECT count(*) INTO v_have FROM public.analytics_events WHERE session_id = _session;
  FOR e IN SELECT * FROM jsonb_array_elements(_events) LIMIT greatest(0, least(30, 200 - v_have)) LOOP
    CONTINUE WHEN NOT (coalesce(e ->> 'name', '') = ANY (public.bi_event_names()));
    CONTINUE WHEN coalesce(e ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
    BEGIN
      v_at := (e ->> 'at')::timestamptz;
    EXCEPTION WHEN others THEN
      v_at := now();
    END;
    v_at := least(now(), greatest(now() - interval '1 day', coalesce(v_at, now())));
    INSERT INTO public.analytics_events (client_event_id, session_id, visitor_id, user_id, audience, at, name, label, value, rating, path, feature)
    VALUES ((e ->> 'id')::uuid, _session, _visitor, coalesce(_user, s.user_id), coalesce(_audience, s.audience), v_at,
            e ->> 'name', left(coalesce(e ->> 'label', ''), 200),
            CASE WHEN jsonb_typeof(e -> 'value') = 'number' THEN (e ->> 'value')::numeric END,
            nullif(left(coalesce(e ->> 'rating', ''), 20), ''),
            left(coalesce(nullif(e ->> 'path', ''), '/'), 200), left(coalesce(nullif(e ->> 'feature', ''), 'Other'), 60))
    ON CONFLICT (session_id, client_event_id) DO NOTHING;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.bi_pulse_extras(uuid, uuid, uuid, text, text, boolean, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bi_pulse_extras(uuid, uuid, uuid, text, text, boolean, text, text, text, jsonb) TO service_role;

-- A purged account's analytics: their visits (and the anonymous visits from a browser they signed
-- in on; never someone else's signed-in visits on a shared device), the events in them, and the
-- visitor rows. Called by the account purge (account-deletion.server.ts).
CREATE OR REPLACE FUNCTION public.bi_forget_user(_user uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n int := 0;
BEGIN
  IF _user IS NULL THEN RETURN 0; END IF;
  WITH browsers AS (
    SELECT visitor_id FROM public.analytics_visitors WHERE user_id = _user
    UNION SELECT visitor_id FROM public.app_sessions WHERE user_id = _user
  ), gone AS (
    DELETE FROM public.app_sessions s
     WHERE s.user_id = _user OR (s.user_id IS NULL AND s.visitor_id IN (SELECT visitor_id FROM browsers))
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM gone;
  DELETE FROM public.analytics_events WHERE user_id = _user;
  DELETE FROM public.analytics_visitors WHERE user_id = _user;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.bi_forget_user(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bi_forget_user(uuid) TO service_role;

-- Retention: events 180 days, visitors not seen in 400 days (the visits themselves already go at 400).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'bi-analytics-retention';
    PERFORM cron.schedule('bi-analytics-retention', '31 9 * * *',
      $job$DELETE FROM public.analytics_events WHERE at < now() - interval '180 days';
           DELETE FROM public.analytics_visitors WHERE last_seen_at < now() - interval '400 days';$job$);
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Shared sets: who counts, and the days each person was active
-- ---------------------------------------------------------------------------

-- Everyone who counts as a customer: every login but staff (any role but client, the business's
-- own people) and test logins. tier: client (coaching, not a lead), lead (a coaching applicant who
-- hasn't started), member (a free account), or pending (a login with no athlete record yet).
CREATE OR REPLACE FUNCTION public.bi_people()
RETURNS TABLE (user_id uuid, created_at timestamptz, tier text, client_id uuid, archived boolean, ended_at timestamptz, name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH staff AS (
    SELECT r.user_id FROM public.user_roles r WHERE r.role::text <> 'client'
    UNION SELECT s.u FROM public.community_staff_people() s(u)
  )
  SELECT u.id, u.created_at,
         CASE WHEN c.id IS NULL THEN 'pending'
              WHEN c.service_tier = 'coaching' AND coalesce(c.status, '') = 'Lead' THEN 'lead'
              WHEN c.service_tier = 'coaching' THEN 'client'
              ELSE 'member' END,
         c.id, coalesce(c.archived, false) OR coalesce(c.status, '') IN ('Deactivated', 'Deleted'),
         coalesce(c.deactivated_at, c.archived_at),
         coalesce(nullif(c.preferred_name, ''), nullif(c.first_name, ''), split_part(coalesce(c.full_name, ''), ' ', 1), 'Someone')
    FROM auth.users u
    LEFT JOIN LATERAL (
      SELECT c.* FROM public.clients c WHERE c.user_id = u.id
       ORDER BY (c.service_tier = 'coaching') DESC, c.created_at LIMIT 1
    ) c ON true
   WHERE u.id NOT IN (SELECT user_id FROM staff WHERE user_id IS NOT NULL)
     AND NOT public.is_test_login(u.id);
$$;
REVOKE ALL ON FUNCTION public.bi_people() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bi_people() TO service_role;

-- Browsers that belong to the business's own people (any staff visit on them): their anonymous
-- visits never count as customers.
CREATE OR REPLACE FUNCTION public.bi_internal_visitors()
RETURNS TABLE (visitor_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT s.visitor_id FROM public.app_sessions s WHERE s.audience IN ('staff', 'test')
$$;
REVOKE ALL ON FUNCTION public.bi_internal_visitors() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bi_internal_visitors() TO service_role;

-- Every day each login did something in the app, from every record that says so: a visit, a
-- sign-in (kept for coaching clients since Jun 2026), a workout finished, a Crew post seen or made,
-- a like or comment, a message sent, a weigh-in, food logged, a check-in sent, cardio done. These
-- records reach back before visits were recorded (Nov 23 2026), so activity and retention read the
-- history, not just the last few days. The caller keeps only the people who count (bi_people).
CREATE OR REPLACE FUNCTION public.bi_activity(_since timestamptz)
RETURNS TABLE (user_id uuid, day date)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT x.u, public.instant_to_local(x.at, 'America/Winnipeg')::date
    FROM (
      SELECT s.user_id u, s.started_at at FROM public.app_sessions s
       WHERE s.user_id IS NOT NULL AND s.surface <> 'admin' AND s.started_at >= _since
      UNION ALL
      SELECT a.actor_user_id, a.created_at FROM public.client_activity_log a
       WHERE a.action = 'signed_in' AND a.created_at >= _since
      UNION ALL
      SELECT c.user_id, d.completed_at FROM public.pl_day_completions d JOIN public.clients c ON c.id = d.client_id
       WHERE d.completed_at >= _since
      UNION ALL
      SELECT v.viewer_user_id, v.viewed_at FROM public.community_post_views v WHERE v.viewed_at >= _since
      UNION ALL
      SELECT p.author_user_id, p.created_at FROM public.community_posts p WHERE p.created_at >= _since
      UNION ALL
      SELECT r.user_id, r.created_at FROM public.community_reactions r WHERE r.created_at >= _since
      UNION ALL
      SELECT cm.author_user_id, cm.created_at FROM public.community_comments cm WHERE cm.created_at >= _since
      UNION ALL
      SELECT m.sender_id, m.created_at FROM public.messages m WHERE m.sender_role = 'client' AND m.created_at >= _since
      UNION ALL
      SELECT g.sender_id, g.created_at FROM public.group_messages g WHERE g.created_at >= _since
      UNION ALL
      SELECT b.user_id, b.created_at FROM public.progress_bodyweight b WHERE b.created_at >= _since
      UNION ALL
      SELECT ml.user_id, ml.created_at FROM public.member_meal_logs ml WHERE ml.created_at >= _since
      UNION ALL
      SELECT c.user_id, k.submitted_at FROM public.messenger_checkins k JOIN public.clients c ON c.id = k.client_id
       WHERE k.submitted_at >= _since
      UNION ALL
      SELECT c.user_id, cc.created_at FROM public.cardio_completions cc JOIN public.clients c ON c.id = cc.client_id
       WHERE cc.completed AND cc.created_at >= _since
    ) x
   WHERE x.u IS NOT NULL AND x.at IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.bi_activity(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bi_activity(timestamptz) TO service_role;

-- Each paying client's money: the first and last day they paid, and the total (before tax, net of
-- refunds), from the payments recorded on their sales (payment_ledger, voided ones left out).
CREATE OR REPLACE FUNCTION public.bi_payers()
RETURNS TABLE (client_id uuid, user_id uuid, first_paid date, first_paid_at timestamptz, last_paid date, paid_cents bigint, refunded_cents bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.client_id, c.user_id,
         min(l.transaction_date) FILTER (WHERE l.txn_type = 'payment'),
         min(coalesce(l.received_at, l.created_at)) FILTER (WHERE l.txn_type = 'payment'),
         max(l.transaction_date) FILTER (WHERE l.txn_type = 'payment'),
         coalesce(sum(l.amount_minor - coalesce(l.tax_minor, 0)) FILTER (WHERE l.txn_type = 'payment'), 0)::bigint,
         coalesce(sum(abs(l.amount_minor - coalesce(l.tax_minor, 0))) FILTER (WHERE l.txn_type = 'refund'), 0)::bigint
    FROM public.payment_ledger l
    JOIN public.clients c ON c.id = l.client_id
   WHERE NOT coalesce(l.voided, false) AND l.client_id IS NOT NULL
     AND (c.user_id IS NULL OR NOT public.is_test_login(c.user_id))
   GROUP BY l.client_id, c.user_id
  HAVING count(*) FILTER (WHERE l.txn_type = 'payment') > 0;
$$;
REVOKE ALL ON FUNCTION public.bi_payers() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bi_payers() TO service_role;

-- Where a person first came from, best evidence first: a browser they signed in on (tracked since
-- Nov 23 2026), their free membership application, their coaching application, then the source
-- written on their record. 'untracked' when nothing says.
CREATE OR REPLACE FUNCTION public.bi_first_touch(_user uuid, _client uuid)
RETURNS TABLE (channel text, detail text, method text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT x.channel, x.detail, x.method FROM (
    SELECT av.first_channel AS channel, av.first_source AS detail, 'tracked'::text AS method, 1 AS pri, av.first_seen_at AS at
      FROM public.analytics_visitors av JOIN auth.users u ON u.id = av.user_id
     WHERE _user IS NOT NULL AND av.user_id = _user AND av.first_channel IS NOT NULL
       -- only a visit seen by the time they joined is where they came from; someone who joined
       -- before visits were recorded (Nov 23 2026) is never credited to a later visit
       AND av.first_seen_at <= u.created_at + interval '1 day'
    UNION ALL
    SELECT public.bi_channel(ma.referrer, ma.utm_source, ma.utm_medium), coalesce(ma.utm_source, ma.referrer), 'application', 2, ma.created_at
      FROM public.membership_applications ma
     WHERE (ma.user_id = _user OR (_client IS NOT NULL AND ma.client_id = _client)) AND NOT coalesce(ma.is_test, false)
    UNION ALL
    SELECT public.bi_channel(ca.referrer, ca.utm_source, ca.utm_medium), coalesce(ca.utm_source, ca.referrer), 'application', 3, ca.created_at
      FROM public.coaching_applications ca
     WHERE _client IS NOT NULL AND ca.client_id = _client AND NOT coalesce(ca.is_test, false)
    UNION ALL
    SELECT public.bi_channel(NULL, c.source, NULL), c.source, 'recorded', 4, c.created_at
      FROM public.clients c WHERE _client IS NOT NULL AND c.id = _client AND coalesce(c.source, '') <> ''
       -- only a source that names a channel ('coaching_application' says how, not where from)
       AND public.bi_channel(NULL, c.source, NULL) NOT IN ('other', 'direct')
  ) x
  ORDER BY (x.channel = 'direct' AND x.method <> 'tracked'), x.pri, x.at
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.bi_first_touch(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bi_first_touch(uuid, uuid) TO service_role;

-- The last visit before a moment that came from somewhere (not Direct), on the person's login or a
-- browser they signed in on: last non-direct touch. 'direct' when every tracked visit was direct,
-- 'untracked' when there's no visit before it.
CREATE OR REPLACE FUNCTION public.bi_last_touch(_user uuid, _before timestamptz)
RETURNS TABLE (channel text, detail text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH mine AS (
    SELECT s.channel, coalesce(s.touch_source, s.utm_source, s.referrer_host) AS detail, s.started_at
      FROM public.app_sessions s
     WHERE _user IS NOT NULL AND s.started_at <= _before AND s.attribution_ok
       AND (s.user_id = _user OR s.visitor_id IN (SELECT av.visitor_id FROM public.analytics_visitors av WHERE av.user_id = _user))
  )
  SELECT coalesce(
           (SELECT m.channel FROM mine m WHERE m.channel IS NOT NULL AND m.channel <> 'direct' ORDER BY m.started_at DESC LIMIT 1),
           CASE WHEN EXISTS (SELECT 1 FROM mine) THEN 'direct' ELSE 'untracked' END),
         (SELECT m.detail FROM mine m WHERE m.channel IS NOT NULL AND m.channel <> 'direct' ORDER BY m.started_at DESC LIMIT 1);
$$;
REVOKE ALL ON FUNCTION public.bi_last_touch(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bi_last_touch(uuid, timestamptz) TO service_role;

-- Monthly recurring revenue now, from the live Stripe subscriptions on sales (purchase_records):
-- an open-ended subscription's recurring price before tax (the sale's installment, else its price),
-- in a month (every 2 weeks × 26 / 12, weekly × 52 / 12, yearly / 12). An installment plan for a
-- fixed number of payments is a package being paid off, never recurring revenue: counted apart.
CREATE OR REPLACE FUNCTION public.bi_mrr()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH live AS (
    SELECT p.*,
           (coalesce(p.payment_structure, '') ~* '\d+\s*payments' OR coalesce(p.is_fixed_term_commitment, false)) AS fixed,
           CASE
             WHEN coalesce(p.payment_frequency, p.payment_structure, '') ~* '(bi-?weekly|every 2 weeks|fortnight)' THEN 26.0 / 12
             WHEN coalesce(p.payment_frequency, p.payment_structure, '') ~* 'week' THEN 52.0 / 12
             WHEN coalesce(p.payment_frequency, p.payment_structure, '') ~* '(year|annual)' THEN 1.0 / 12
             WHEN coalesce(p.payment_frequency, p.payment_structure, '') ~* 'quarter' THEN 1.0 / 3
             ELSE 1.0 END AS per_month,
           round(coalesce(nullif(p.installment_amount, 0), p.full_payable_amount, 0) * 100)::bigint AS charge_cents,
           (SELECT pk.name FROM public.coaching_package_enrollments e JOIN public.coaching_packages pk ON pk.id = e.package_id
             WHERE e.sale_id = p.id ORDER BY e.created_at DESC LIMIT 1) AS package_name
      FROM public.purchase_records p
      JOIN public.clients c ON c.id = p.client_id
     WHERE p.stripe_subscription_id IS NOT NULL AND p.archived_at IS NULL
       AND coalesce(p.stripe_subscription_status, '') IN ('active', 'trialing', 'past_due')
       AND (c.user_id IS NULL OR NOT public.is_test_login(c.user_id))
  )
  SELECT jsonb_build_object(
    'mrr_cents', coalesce((SELECT round(sum(charge_cents * per_month)) FROM live WHERE NOT fixed), 0),
    'subscriptions', (SELECT count(*) FROM live WHERE NOT fixed),
    'ending', (SELECT count(*) FROM live WHERE NOT fixed AND coalesce(cancel_at_period_end, false)),
    'ending_mrr_cents', coalesce((SELECT round(sum(charge_cents * per_month)) FROM live WHERE NOT fixed AND coalesce(cancel_at_period_end, false)), 0),
    'failing', (SELECT count(*) FROM live WHERE stripe_subscription_status = 'past_due'),
    'installment_plans', (SELECT count(*) FROM live WHERE fixed),
    'installment_outstanding_cents', coalesce((SELECT sum(coalesce(amount_outstanding_cents, 0)) FROM live WHERE fixed), 0),
    'by_package', coalesce((SELECT jsonb_agg(jsonb_build_object('package', k, 'subscriptions', n, 'mrr_cents', m) ORDER BY m DESC) FROM (
        SELECT coalesce(package_name, offer_name, 'Other') k, count(*) n, round(sum(charge_cents * per_month)) m
          FROM live WHERE NOT fixed GROUP BY 1) x), '[]'::jsonb),
    'collected_30d_cents', coalesce((SELECT sum(l.amount_minor - coalesce(l.tax_minor, 0)) FROM public.payment_ledger l
        WHERE l.txn_type = 'payment' AND NOT coalesce(l.voided, false) AND l.stripe_subscription_id IN (SELECT stripe_subscription_id FROM live WHERE NOT fixed)
          AND l.transaction_date > (public.instant_to_local(now(), 'America/Winnipeg')::date - 30)), 0)
  );
$$;
REVOKE ALL ON FUNCTION public.bi_mrr() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bi_mrr() TO service_role;

-- ---------------------------------------------------------------------------
-- 6. The headline numbers for a range (Overview compares two of these)
-- ---------------------------------------------------------------------------
--
-- Definitions (the page says them too):
--   visitor        a browser (one random id) with a customer visit; the business's own browsers
--                  (any staff visit on them) and test logins never count
--   new visitor    first seen in the range; returning = seen before it
--   session        one visit (closing the app or 30 minutes away starts a new one)
--   engaged        a visit with 10+ seconds on screen or 2+ pages; bounce = the rest
--   active person  a client or member who did anything in the app that day (bi_activity)
--   registration   a new login (not staff, not a test login)
--   new paying     a client whose first-ever payment landed in the range
--   free → paid    a new paying client who had a free account first (a member record or an approved
--                  membership application before the payment)
--   revenue        payments less refunds, before tax (payment_ledger), plus credit packs and other
--                  income, by the day the money moved
CREATE OR REPLACE FUNCTION public.bi_kpis(_from date, _to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz text := 'America/Winnipeg';
  v_start timestamptz := public.local_to_instant(_from::timestamp, 'America/Winnipeg');
  v_end timestamptz := public.local_to_instant((_to + 1)::timestamp, 'America/Winnipeg');
  v_days int := (_to - _from) + 1;
  v jsonb;
BEGIN
  WITH
  people AS (SELECT * FROM public.bi_people()),
  internal AS (SELECT visitor_id FROM public.bi_internal_visitors()),
  sess AS (
    SELECT s.* FROM public.app_sessions s
     WHERE s.started_at >= v_start AND s.started_at < v_end
       AND s.audience IN ('visitor', 'member', 'client', 'pending') AND s.surface <> 'admin'
       AND s.visitor_id NOT IN (SELECT visitor_id FROM internal)
  ),
  first_seen AS (
    SELECT s.visitor_id, min(s.started_at) AS at FROM public.app_sessions s
     WHERE s.visitor_id IN (SELECT DISTINCT visitor_id FROM sess) GROUP BY 1
  ),
  act AS (
    SELECT a.user_id, a.day FROM public.bi_activity(v_start - interval '30 days') a
     WHERE a.user_id IN (SELECT user_id FROM people)
  ),
  payers AS (SELECT * FROM public.bi_payers()),
  new_payers AS (SELECT * FROM payers WHERE first_paid BETWEEN _from AND _to),
  coached AS (
    SELECT c.id, coalesce(c.converted_to_client_at, c.account_created_at, c.created_at) AS began,
           coalesce(c.deactivated_at, c.archived_at) AS ended
      FROM public.clients c
     WHERE c.service_tier = 'coaching' AND coalesce(c.status, '') <> 'Lead'
       AND (c.user_id IS NULL OR c.user_id IN (SELECT user_id FROM people))
  )
  SELECT jsonb_build_object(
    'from', _from, 'to', _to, 'days', v_days,
    'visitors', (SELECT count(DISTINCT visitor_id) FROM sess),
    'new_visitors', (SELECT count(*) FROM first_seen WHERE at >= v_start),
    'sessions', (SELECT count(*) FROM sess),
    'engaged_sessions', (SELECT count(*) FROM sess WHERE active_seconds >= 10 OR views >= 2),
    'avg_session_seconds', (SELECT round(avg(active_seconds)) FROM sess),
    'median_session_seconds', (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY active_seconds)) FROM sess),
    'page_views', (SELECT coalesce(sum(views), 0) FROM sess),
    'site_visitors', (SELECT count(DISTINCT visitor_id) FROM sess WHERE surface = 'site'),
    'app_sessions', (SELECT count(*) FROM sess WHERE surface = 'app'),
    'active_people', (SELECT count(DISTINCT user_id) FROM act WHERE day BETWEEN _from AND _to),
    'dau_avg', (SELECT round(count(*)::numeric / v_days, 1) FROM act WHERE day BETWEEN _from AND _to),
    'wau', (SELECT count(DISTINCT user_id) FROM act WHERE day BETWEEN _to - 6 AND _to),
    'mau', (SELECT count(DISTINCT user_id) FROM act WHERE day BETWEEN _to - 29 AND _to),
    'registrations', (SELECT count(*) FROM people WHERE created_at >= v_start AND created_at < v_end),
    'member_applications', (SELECT count(*) FROM public.membership_applications a
       WHERE NOT coalesce(a.is_test, false) AND a.created_at >= v_start AND a.created_at < v_end),
    'coaching_applications', (SELECT count(*) FROM public.coaching_applications a
       WHERE NOT coalesce(a.is_test, false) AND coalesce(a.submitted_at, a.created_at) >= v_start AND coalesce(a.submitted_at, a.created_at) < v_end),
    'new_paying', (SELECT count(*) FROM new_payers),
    'free_to_paid', (SELECT count(*) FROM new_payers np
       WHERE np.user_id IS NOT NULL AND (
         -- a member account first: a membership (every coaching client also has a legacy
         -- 'program_only' app_members row, which says nothing), an approved membership application,
         -- or a move from the membership to coaching
         EXISTS (SELECT 1 FROM public.app_members am WHERE am.user_id = np.user_id
                  AND am.account_type IN ('jf_member', 'app_member') AND am.created_at < np.first_paid_at)
         OR EXISTS (SELECT 1 FROM public.membership_applications ma WHERE ma.user_id = np.user_id AND ma.activated_at < np.first_paid_at)
         OR EXISTS (SELECT 1 FROM public.account_lifecycle_events e WHERE e.client_id = np.client_id
                     AND e.event = 'moved_to_coaching' AND e.created_at < np.first_paid_at + interval '1 day'))),
    'paying_clients', (SELECT count(DISTINCT l.client_id) FROM public.payment_ledger l
       WHERE l.txn_type = 'payment' AND NOT coalesce(l.voided, false) AND l.client_id IN (SELECT client_id FROM payers)
         AND l.transaction_date BETWEEN _from AND _to),
    'revenue_coaching_cents', coalesce((SELECT sum(CASE WHEN l.txn_type = 'payment' THEN l.amount_minor - coalesce(l.tax_minor, 0)
                                                        WHEN l.txn_type = 'refund' THEN -abs(l.amount_minor - coalesce(l.tax_minor, 0)) ELSE 0 END)
       FROM public.payment_ledger l WHERE NOT coalesce(l.voided, false) AND l.transaction_date BETWEEN _from AND _to
         AND l.client_id IN (SELECT client_id FROM payers)), 0),
    'revenue_credits_cents', coalesce((SELECT sum(cp.amount_minor - coalesce(round(cp.refunded_minor::numeric * cp.amount_minor / nullif(cp.total_minor, 0)), 0))
       FROM public.ai_credit_purchases cp WHERE cp.status = 'paid' AND cp.paid_at >= v_start AND cp.paid_at < v_end
         AND (cp.user_id IS NULL OR NOT public.is_test_login(cp.user_id))), 0),
    'revenue_other_cents', coalesce((SELECT sum(o.amount_minor) FROM public.business_other_income o WHERE o.received_on BETWEEN _from AND _to), 0),
    'clients_at_start', (SELECT count(*) FROM coached WHERE began < v_start AND (ended IS NULL OR ended >= v_start)),
    'clients_ended', (SELECT count(*) FROM coached WHERE ended >= v_start AND ended < v_end),
    'clients_ended_of_start', (SELECT count(*) FROM coached WHERE began < v_start AND ended >= v_start AND ended < v_end),
    'clients_started', (SELECT count(*) FROM coached WHERE began >= v_start AND began < v_end),
    'clients_now', (SELECT count(*) FROM coached WHERE began < v_end AND (ended IS NULL OR ended >= v_end))
  ) INTO v;
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public.bi_kpis(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bi_kpis(date, date) TO service_role;

-- Overview: the two ranges' headline numbers, a day-by-day series, and what's tracked since when.
CREATE OR REPLACE FUNCTION public.bi_overview(_from date, _to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days int := (_to - _from) + 1;
  v_start timestamptz := public.local_to_instant(_from::timestamp, 'America/Winnipeg');
  v_end timestamptz := public.local_to_instant((_to + 1)::timestamp, 'America/Winnipeg');
  v_daily jsonb;
BEGIN
  WITH
  people AS (SELECT * FROM public.bi_people()),
  internal AS (SELECT visitor_id FROM public.bi_internal_visitors()),
  days AS (SELECT generate_series(_from, _to, interval '1 day')::date AS day),
  sess AS (
    SELECT public.instant_to_local(s.started_at, 'America/Winnipeg')::date AS day, s.visitor_id
      FROM public.app_sessions s
     WHERE s.started_at >= v_start AND s.started_at < v_end
       AND s.audience IN ('visitor', 'member', 'client', 'pending') AND s.surface <> 'admin'
       AND s.visitor_id NOT IN (SELECT visitor_id FROM internal)
  ),
  by_sess AS (SELECT day, count(*) n, count(DISTINCT visitor_id) v FROM sess GROUP BY 1),
  act AS (
    SELECT a.day, count(DISTINCT a.user_id) n FROM public.bi_activity(v_start) a
     WHERE a.user_id IN (SELECT user_id FROM people) AND a.day BETWEEN _from AND _to GROUP BY 1
  ),
  reg AS (
    SELECT public.instant_to_local(p.created_at, 'America/Winnipeg')::date AS day, count(*) n
      FROM people p WHERE p.created_at >= v_start AND p.created_at < v_end GROUP BY 1
  ),
  apps AS (
    SELECT public.instant_to_local(x.at, 'America/Winnipeg')::date AS day, count(*) n FROM (
      SELECT a.created_at AS at FROM public.membership_applications a WHERE NOT coalesce(a.is_test, false) AND a.created_at >= v_start AND a.created_at < v_end
      UNION ALL
      SELECT coalesce(a.submitted_at, a.created_at) FROM public.coaching_applications a
       WHERE NOT coalesce(a.is_test, false) AND coalesce(a.submitted_at, a.created_at) >= v_start AND coalesce(a.submitted_at, a.created_at) < v_end
    ) x GROUP BY 1
  ),
  rev AS (
    SELECT l.transaction_date AS day,
           sum(CASE WHEN l.txn_type = 'payment' THEN l.amount_minor - coalesce(l.tax_minor, 0)
                    WHEN l.txn_type = 'refund' THEN -abs(l.amount_minor - coalesce(l.tax_minor, 0)) ELSE 0 END) AS cents
      FROM public.payment_ledger l
     WHERE NOT coalesce(l.voided, false) AND l.transaction_date BETWEEN _from AND _to
       AND l.client_id IN (SELECT client_id FROM public.bi_payers())
     GROUP BY 1
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'day', d.day, 'visitors', coalesce(bs.v, 0), 'sessions', coalesce(bs.n, 0), 'active', coalesce(ac.n, 0),
      'registrations', coalesce(rg.n, 0), 'applications', coalesce(ap.n, 0), 'revenue_cents', coalesce(rv.cents, 0)) ORDER BY d.day), '[]'::jsonb)
    INTO v_daily
    FROM days d
    LEFT JOIN by_sess bs ON bs.day = d.day
    LEFT JOIN act ac ON ac.day = d.day
    LEFT JOIN reg rg ON rg.day = d.day
    LEFT JOIN apps ap ON ap.day = d.day
    LEFT JOIN rev rv ON rv.day = d.day;

  RETURN jsonb_build_object(
    'current', public.bi_kpis(_from, _to),
    'previous', public.bi_kpis(_from - v_days, _from - 1),
    'daily', v_daily,
    'mrr', public.bi_mrr(),
    'live', (SELECT count(*) FROM public.app_sessions s
              WHERE s.last_seen_at > now() - interval '5 minutes' AND s.audience IN ('visitor', 'member', 'client', 'pending')
                AND s.visitor_id NOT IN (SELECT visitor_id FROM public.bi_internal_visitors())),
    'visits_since', (SELECT min(started_at) FROM public.app_sessions),
    'funnel_since', (SELECT min(created_at) FROM public.membership_funnel_events),
    'events_since', (SELECT min(at) FROM public.analytics_events)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.bi_overview(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bi_overview(date, date) TO service_role;

-- ---------------------------------------------------------------------------
-- 7. Acquisition: channels, campaigns, landing pages, referrers, and what each brought in
-- ---------------------------------------------------------------------------
--
-- Visits are by the visit's own channel (where it came from this time). Sign-ups, applications,
-- paying clients and revenue are by FIRST touch (bi_first_touch: where the person first came from),
-- and new paying clients also by LAST non-direct touch (bi_last_touch). 'untracked' is a person
-- nothing tells us about (most of them joined before visits were recorded, Nov 23 2026).
CREATE OR REPLACE FUNCTION public.bi_acquisition(_from date, _to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days int := (_to - _from) + 1;
  v_start timestamptz := public.local_to_instant(_from::timestamp, 'America/Winnipeg');
  v_end timestamptz := public.local_to_instant((_to + 1)::timestamp, 'America/Winnipeg');
  v_prev timestamptz := public.local_to_instant((_from - ((_to - _from) + 1))::timestamp, 'America/Winnipeg');
  v jsonb;
BEGIN
  WITH
  people AS (SELECT * FROM public.bi_people()),
  internal AS (SELECT visitor_id FROM public.bi_internal_visitors()),
  all_sess AS (
    SELECT s.* FROM public.app_sessions s
     WHERE s.started_at >= v_prev AND s.started_at < v_end
       AND s.audience IN ('visitor', 'member', 'client', 'pending') AND s.surface <> 'admin'
       AND s.visitor_id NOT IN (SELECT visitor_id FROM internal)
  ),
  sess AS (SELECT * FROM all_sess WHERE started_at >= v_start),
  prev_sess AS (SELECT * FROM all_sess WHERE started_at < v_start),
  regs AS (
    SELECT p.user_id, coalesce(ft.channel, 'untracked') AS channel, coalesce(ft.method, 'none') AS method
      FROM people p LEFT JOIN LATERAL public.bi_first_touch(p.user_id, p.client_id) ft ON true
     WHERE p.created_at >= v_start AND p.created_at < v_end
  ),
  mapps AS (
    SELECT coalesce(av.first_channel, public.bi_channel(a.referrer, a.utm_source, a.utm_medium)) AS channel, a.utm_campaign
      FROM public.membership_applications a
      LEFT JOIN public.analytics_visitors av ON av.visitor_id = a.visitor_id
     WHERE NOT coalesce(a.is_test, false) AND a.created_at >= v_start AND a.created_at < v_end
  ),
  capps AS (
    SELECT public.bi_channel(a.referrer, a.utm_source, a.utm_medium) AS channel, a.utm_campaign
      FROM public.coaching_applications a
     WHERE NOT coalesce(a.is_test, false) AND coalesce(a.submitted_at, a.created_at) >= v_start AND coalesce(a.submitted_at, a.created_at) < v_end
  ),
  payers AS (SELECT * FROM public.bi_payers()),
  payer_touch AS (
    SELECT p.client_id, p.user_id, p.first_paid, p.first_paid_at,
           coalesce(ft.channel, 'untracked') AS first_channel, coalesce(ft.method, 'none') AS method
      FROM payers p LEFT JOIN LATERAL public.bi_first_touch(p.user_id, p.client_id) ft ON true
  ),
  new_payers AS (
    SELECT pt.*, coalesce(lt.channel, 'untracked') AS last_channel
      FROM payer_touch pt LEFT JOIN LATERAL public.bi_last_touch(pt.user_id, pt.first_paid_at) lt ON true
     WHERE pt.first_paid BETWEEN _from AND _to
  ),
  rev AS (
    SELECT pt.first_channel AS channel, count(DISTINCT l.client_id) AS clients,
           sum(CASE WHEN l.txn_type = 'payment' THEN l.amount_minor - coalesce(l.tax_minor, 0)
                    WHEN l.txn_type = 'refund' THEN -abs(l.amount_minor - coalesce(l.tax_minor, 0)) ELSE 0 END) AS cents
      FROM public.payment_ledger l JOIN payer_touch pt ON pt.client_id = l.client_id
     WHERE NOT coalesce(l.voided, false) AND l.transaction_date BETWEEN _from AND _to
     GROUP BY 1
  ),
  keys AS (
    SELECT channel FROM sess UNION SELECT channel FROM prev_sess UNION SELECT channel FROM regs
    UNION SELECT channel FROM mapps UNION SELECT channel FROM capps UNION SELECT first_channel FROM new_payers
    UNION SELECT last_channel FROM new_payers UNION SELECT channel FROM rev
  ),
  funnel AS (
    SELECT f.visitor_id, f.event FROM public.membership_funnel_events f
     WHERE f.day BETWEEN _from AND _to AND f.event IN ('apply_submit', 'coaching_apply_submit')
  ),
  campaign_sess AS (
    SELECT coalesce(s.touch_campaign, s.utm_campaign) AS campaign, s.* FROM sess s
     WHERE coalesce(s.touch_campaign, s.utm_campaign) IS NOT NULL
  )
  SELECT jsonb_build_object(
    'channels', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'channel', k.channel,
        'sessions', (SELECT count(*) FROM sess s WHERE s.channel IS NOT DISTINCT FROM k.channel),
        'prev_sessions', (SELECT count(*) FROM prev_sess s WHERE s.channel IS NOT DISTINCT FROM k.channel),
        'visitors', (SELECT count(DISTINCT s.visitor_id) FROM sess s WHERE s.channel IS NOT DISTINCT FROM k.channel),
        'engaged', (SELECT count(*) FROM sess s WHERE s.channel IS NOT DISTINCT FROM k.channel AND (s.active_seconds >= 10 OR s.views >= 2)),
        'avg_seconds', (SELECT round(avg(s.active_seconds)) FROM sess s WHERE s.channel IS NOT DISTINCT FROM k.channel),
        'registrations', (SELECT count(*) FROM regs r WHERE r.channel = k.channel),
        'member_apps', (SELECT count(*) FROM mapps a WHERE a.channel = k.channel),
        'coaching_apps', (SELECT count(*) FROM capps a WHERE a.channel = k.channel),
        'new_paying_first', (SELECT count(*) FROM new_payers n WHERE n.first_channel = k.channel),
        'new_paying_last', (SELECT count(*) FROM new_payers n WHERE n.last_channel = k.channel),
        'paying_clients', coalesce((SELECT r.clients FROM rev r WHERE r.channel = k.channel), 0),
        'revenue_cents', coalesce((SELECT r.cents FROM rev r WHERE r.channel = k.channel), 0)
      )), '[]'::jsonb) FROM keys k WHERE k.channel IS NOT NULL),
    'campaigns', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'campaign', c.campaign, 'channel', c.channel, 'sessions', c.sessions, 'visitors', c.visitors, 'engaged', c.engaged,
        'member_apps', (SELECT count(*) FROM mapps a WHERE a.utm_campaign = c.campaign),
        'coaching_apps', (SELECT count(*) FROM capps a WHERE a.utm_campaign = c.campaign),
        'registrations', (SELECT count(DISTINCT p.user_id) FROM people p JOIN public.analytics_visitors av ON av.user_id = p.user_id
                           WHERE av.first_campaign = c.campaign AND p.created_at >= v_start AND p.created_at < v_end)
      ) ORDER BY c.sessions DESC), '[]'::jsonb) FROM (
        SELECT campaign, mode() WITHIN GROUP (ORDER BY channel) AS channel, count(*) AS sessions,
               count(DISTINCT visitor_id) AS visitors, count(*) FILTER (WHERE active_seconds >= 10 OR views >= 2) AS engaged
          FROM campaign_sess GROUP BY campaign ORDER BY count(*) DESC LIMIT 25) c),
    'landing_pages', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'path', x.path, 'sessions', x.sessions, 'visitors', x.visitors, 'engaged', x.engaged, 'avg_seconds', x.avg_seconds,
        'converted', (SELECT count(DISTINCT f.visitor_id) FROM funnel f
                       WHERE f.visitor_id IN (SELECT s.visitor_id FROM sess s WHERE s.surface = 'site' AND s.entry_path = x.path))
      ) ORDER BY x.sessions DESC), '[]'::jsonb) FROM (
        SELECT coalesce(entry_path, '/') AS path, count(*) AS sessions, count(DISTINCT visitor_id) AS visitors,
               count(*) FILTER (WHERE active_seconds >= 10 OR views >= 2) AS engaged, round(avg(active_seconds)) AS avg_seconds
          FROM sess WHERE surface = 'site' GROUP BY 1 ORDER BY count(*) DESC LIMIT 20) x),
    'referrers', (SELECT coalesce(jsonb_agg(jsonb_build_object('host', h, 'channel', ch, 'sessions', n, 'visitors', vis) ORDER BY n DESC), '[]'::jsonb) FROM (
        SELECT coalesce(touch_source, referrer_host) AS h, mode() WITHIN GROUP (ORDER BY channel) AS ch, count(*) AS n, count(DISTINCT visitor_id) AS vis
          FROM sess WHERE coalesce(touch_source, referrer_host) IS NOT NULL GROUP BY 1 ORDER BY 3 DESC LIMIT 20) r),
    'browsers', (SELECT coalesce(jsonb_object_agg(k, n), '{}'::jsonb) FROM (
        SELECT coalesce(browser, 'unknown') k, count(*) n FROM sess GROUP BY 1) b),
    'attribution', jsonb_build_object(
      'registrations', (SELECT coalesce(jsonb_object_agg(method, n), '{}'::jsonb) FROM (SELECT method, count(*) n FROM regs GROUP BY 1) m),
      'new_paying', (SELECT coalesce(jsonb_object_agg(method, n), '{}'::jsonb) FROM (SELECT method, count(*) n FROM new_payers GROUP BY 1) m),
      'paying_all', (SELECT coalesce(jsonb_object_agg(method, n), '{}'::jsonb) FROM (SELECT method, count(*) n FROM payer_touch GROUP BY 1) m)
    ),
    'totals', jsonb_build_object(
      'sessions', (SELECT count(*) FROM sess), 'prev_sessions', (SELECT count(*) FROM prev_sess),
      'registrations', (SELECT count(*) FROM regs), 'new_paying', (SELECT count(*) FROM new_payers),
      'revenue_cents', coalesce((SELECT sum(cents) FROM rev), 0)
    ),
    'prev_tracked', v_prev >= (SELECT min(started_at) FROM public.app_sessions),
    'days', v_days
  ) INTO v;
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public.bi_acquisition(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bi_acquisition(date, date) TO service_role;

-- ---------------------------------------------------------------------------
-- 8. Audience & geography
-- ---------------------------------------------------------------------------
--
-- A place is the visit's: the host's IP country, a province or state and a city only as the visit
-- recorded them (a time zone's main city, an approximation), never anything finer. A person's place
-- is where most of their visits came from. Nothing names anyone.
CREATE OR REPLACE FUNCTION public.bi_geography(_from date, _to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start timestamptz := public.local_to_instant(_from::timestamp, 'America/Winnipeg');
  v_end timestamptz := public.local_to_instant((_to + 1)::timestamp, 'America/Winnipeg');
  v_prev timestamptz := public.local_to_instant((_from - ((_to - _from) + 1))::timestamp, 'America/Winnipeg');
  v jsonb;
BEGIN
  WITH
  people AS (SELECT * FROM public.bi_people()),
  internal AS (SELECT visitor_id FROM public.bi_internal_visitors()),
  all_sess AS (
    SELECT s.* FROM public.app_sessions s
     WHERE s.started_at >= v_prev AND s.started_at < v_end
       AND s.audience IN ('visitor', 'member', 'client', 'pending') AND s.surface <> 'admin'
       AND s.visitor_id NOT IN (SELECT visitor_id FROM internal)
  ),
  sess AS (SELECT * FROM all_sess WHERE started_at >= v_start),
  prev_sess AS (SELECT * FROM all_sess WHERE started_at < v_start),
  -- each person's usual place, over every visit they've made
  person_place AS (
    SELECT DISTINCT ON (s.user_id) s.user_id, s.country, s.region, s.city
      FROM public.app_sessions s
     WHERE s.user_id IN (SELECT user_id FROM people) AND s.country IS NOT NULL
     GROUP BY s.user_id, s.country, s.region, s.city
     ORDER BY s.user_id, count(*) DESC
  ),
  payers AS (SELECT * FROM public.bi_payers()),
  paying_now AS (
    SELECT DISTINCT p.user_id FROM payers p
     WHERE p.user_id IS NOT NULL AND p.last_paid >= _to - 45
  ),
  regs AS (SELECT p.user_id FROM people p WHERE p.created_at >= v_start AND p.created_at < v_end),
  place_people AS (
    SELECT pp.*, (pp.user_id IN (SELECT user_id FROM regs)) AS new_in_range, (pp.user_id IN (SELECT user_id FROM paying_now)) AS paying
      FROM person_place pp
  )
  SELECT jsonb_build_object(
    'countries', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'country', c.country, 'sessions', c.sessions, 'visitors', c.visitors,
        'prev_sessions', (SELECT count(*) FROM prev_sess s WHERE s.country = c.country),
        'people', (SELECT count(*) FROM place_people pp WHERE pp.country = c.country),
        'registrations', (SELECT count(*) FROM place_people pp WHERE pp.country = c.country AND pp.new_in_range),
        'paying', (SELECT count(*) FROM place_people pp WHERE pp.country = c.country AND pp.paying)
      ) ORDER BY c.sessions DESC), '[]'::jsonb) FROM (
        SELECT country, count(*) sessions, count(DISTINCT visitor_id) visitors FROM sess WHERE country IS NOT NULL GROUP BY 1) c),
    'regions', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'country', r.country, 'region', r.region, 'sessions', r.sessions, 'visitors', r.visitors,
        'prev_sessions', (SELECT count(*) FROM prev_sess s WHERE s.country = r.country AND s.region = r.region),
        'people', (SELECT count(*) FROM place_people pp WHERE pp.country = r.country AND pp.region = r.region),
        'registrations', (SELECT count(*) FROM place_people pp WHERE pp.country = r.country AND pp.region = r.region AND pp.new_in_range),
        'paying', (SELECT count(*) FROM place_people pp WHERE pp.country = r.country AND pp.region = r.region AND pp.paying)
      ) ORDER BY r.sessions DESC), '[]'::jsonb) FROM (
        SELECT country, region, count(*) sessions, count(DISTINCT visitor_id) visitors
          FROM sess WHERE country IS NOT NULL AND region IS NOT NULL GROUP BY 1, 2) r),
    'cities', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'country', c.country, 'region', c.region, 'city', c.city, 'lat', c.lat, 'lng', c.lng,
        'sessions', c.sessions, 'visitors', c.visitors, 'live', c.live,
        'prev_sessions', (SELECT count(*) FROM prev_sess s WHERE s.country = c.country AND s.city IS NOT DISTINCT FROM c.city),
        'people', (SELECT count(*) FROM place_people pp WHERE pp.country = c.country AND pp.city IS NOT DISTINCT FROM c.city),
        'registrations', (SELECT count(*) FROM place_people pp WHERE pp.country = c.country AND pp.city IS NOT DISTINCT FROM c.city AND pp.new_in_range),
        'paying', (SELECT count(*) FROM place_people pp WHERE pp.country = c.country AND pp.city IS NOT DISTINCT FROM c.city AND pp.paying)
      ) ORDER BY c.sessions DESC), '[]'::jsonb) FROM (
        SELECT country, max(region) region, city, round(avg(lat), 1) lat, round(avg(lng), 1) lng, count(*) sessions,
               count(DISTINCT visitor_id) visitors, count(*) FILTER (WHERE last_seen_at > now() - interval '5 minutes') live
          FROM sess WHERE country IS NOT NULL GROUP BY country, city ORDER BY count(*) DESC LIMIT 200) c),
    'unplaced_sessions', (SELECT count(*) FROM sess WHERE country IS NULL),
    'placed_sessions', (SELECT count(*) FROM sess WHERE country IS NOT NULL),
    'people_placed', (SELECT count(*) FROM place_people),
    'people_total', (SELECT count(*) FROM people WHERE NOT archived),
    'prev_tracked', v_prev >= (SELECT min(started_at) FROM public.app_sessions)
  ) INTO v;
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public.bi_geography(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bi_geography(date, date) TO service_role;

-- ---------------------------------------------------------------------------
-- 9. Conversions: the main path and the other ways in
-- ---------------------------------------------------------------------------
--
-- Each step counts the people (or browsers, before there's a login) who reached it in the range; it
-- is not one cohort walked through, so a later step can be someone who started earlier. The page
-- says so. The website's steps come from membership_funnel_events (anonymous, once a browser a day);
-- accounts, checkouts and payments from their own records.
CREATE OR REPLACE FUNCTION public.bi_conversions(_from date, _to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start timestamptz := public.local_to_instant(_from::timestamp, 'America/Winnipeg');
  v_end timestamptz := public.local_to_instant((_to + 1)::timestamp, 'America/Winnipeg');
  v jsonb;
BEGIN
  WITH
  people AS (SELECT * FROM public.bi_people()),
  internal AS (SELECT visitor_id FROM public.bi_internal_visitors()),
  ev AS (
    SELECT f.* FROM public.membership_funnel_events f
     WHERE f.day BETWEEN _from AND _to AND f.visitor_id NOT IN (SELECT visitor_id FROM internal)
  ),
  site AS (
    SELECT DISTINCT s.visitor_id FROM public.app_sessions s
     WHERE s.started_at >= v_start AND s.started_at < v_end AND s.surface = 'site' AND s.audience = 'visitor'
       AND s.visitor_id NOT IN (SELECT visitor_id FROM internal)
  ),
  regs AS (SELECT * FROM people WHERE created_at >= v_start AND created_at < v_end),
  payers AS (SELECT * FROM public.bi_payers()),
  new_payers AS (SELECT * FROM payers WHERE first_paid BETWEEN _from AND _to),
  checkouts AS (
    SELECT pc.client_id, pc.status, pc.from_family, pc.to_family, pc.created_at FROM public.plan_changes pc
     WHERE pc.stripe_checkout_session_id IS NOT NULL AND pc.created_at >= v_start AND pc.created_at < v_end
  ),
  links AS (
    SELECT p.client_id, p.payment_status, coalesce(p.amount_paid_cents, 0) AS paid FROM public.purchase_records p
     WHERE p.stripe_checkout_session_id IS NOT NULL AND p.created_at >= v_start AND p.created_at < v_end AND p.archived_at IS NULL
  ),
  mapps AS (
    SELECT a.* FROM public.membership_applications a
     WHERE NOT coalesce(a.is_test, false) AND a.created_at >= v_start AND a.created_at < v_end
  ),
  capps AS (
    SELECT a.* FROM public.coaching_applications a
     WHERE NOT coalesce(a.is_test, false) AND coalesce(a.submitted_at, a.created_at) >= v_start AND coalesce(a.submitted_at, a.created_at) < v_end
  ),
  act AS (SELECT a.user_id, a.day FROM public.bi_activity(v_start) a),
  onboard AS (
    SELECT r.user_id, r.tier, r.created_at,
           public.instant_to_local(r.created_at, 'America/Winnipeg')::date AS d0,
           (SELECT am.setup_completed_at IS NOT NULL OR public.member_setup_complete(am.id) FROM public.app_members am
             WHERE am.user_id = r.user_id ORDER BY am.created_at LIMIT 1) AS setup_done,
           EXISTS (SELECT 1 FROM public.pl_day_completions d JOIN public.clients c ON c.id = d.client_id
                    WHERE c.user_id = r.user_id AND d.completed_at IS NOT NULL AND d.completed_at < r.created_at + interval '7 days') AS trained_week1
      FROM regs r
  ),
  retained_base AS (
    SELECT p.client_id, p.first_paid,
           EXISTS (SELECT 1 FROM public.clients c WHERE c.id = p.client_id
                    AND (coalesce(c.deactivated_at, c.archived_at) IS NULL
                         OR coalesce(c.deactivated_at, c.archived_at) > (p.first_paid_at + interval '60 days'))) AS stayed
      FROM payers p WHERE p.first_paid <= _to - 60
  )
  SELECT jsonb_build_object(
    'main', jsonb_build_object(
      -- visits are recorded since Nov 23 2026 and the site's steps since Nov 19: a period that reaches
      -- before visits has no website-visitor step, so the two are never compared across windows
      'site_visitors', CASE WHEN v_start >= (SELECT min(started_at) FROM public.app_sessions) THEN (SELECT count(*) FROM site) END,
      'visits_since', (SELECT min(started_at) FROM public.app_sessions),
      'landing', (SELECT count(DISTINCT visitor_id) FROM ev WHERE event IN ('landing_view', 'coaching_view')),
      'pricing', (SELECT count(DISTINCT visitor_id) FROM ev WHERE event IN ('pricing_view', 'price_reveal_view', 'free_reveal_view')),
      'started', (SELECT count(DISTINCT visitor_id) FROM ev WHERE event IN ('apply_start', 'coaching_apply_start')),
      'submitted', (SELECT count(DISTINCT visitor_id) FROM ev WHERE event IN ('apply_submit', 'coaching_apply_submit')),
      'applications', (SELECT count(*) FROM mapps) + (SELECT count(*) FROM capps),
      'accounts', (SELECT count(*) FROM regs),
      'checkout', (SELECT count(DISTINCT client_id) FROM checkouts) + (SELECT count(DISTINCT client_id) FROM links),
      'paid', (SELECT count(*) FROM new_payers),
      'retained_base', (SELECT count(*) FROM retained_base),
      'retained', (SELECT count(*) FROM retained_base WHERE stayed)
    ),
    'free_path', jsonb_build_object(
      'landing', (SELECT count(DISTINCT visitor_id) FROM ev WHERE event = 'landing_view'),
      'cta', (SELECT count(DISTINCT visitor_id) FROM ev WHERE event = 'cta_free'),
      'started', (SELECT count(DISTINCT visitor_id) FROM ev WHERE event = 'apply_start'),
      'sent', (SELECT count(DISTINCT visitor_id) FROM ev WHERE event = 'apply_submit'),
      'applications', (SELECT count(*) FROM mapps),
      'approved', (SELECT count(*) FROM mapps WHERE status = 'approved' OR activated_at IS NOT NULL),
      'activated', (SELECT count(*) FROM mapps WHERE activated_at IS NOT NULL),
      'trained_week1', (SELECT count(*) FROM onboard o WHERE o.tier = 'member' AND o.trained_week1)
    ),
    'coaching_path', jsonb_build_object(
      'coaching_page', (SELECT count(DISTINCT visitor_id) FROM ev WHERE event = 'coaching_view'),
      'pricing', (SELECT count(DISTINCT visitor_id) FROM ev WHERE event IN ('pricing_view', 'price_reveal_view')),
      'cta', (SELECT count(DISTINCT visitor_id) FROM ev WHERE event IN ('cta_coaching', 'package_select')),
      'started', (SELECT count(DISTINCT visitor_id) FROM ev WHERE event = 'coaching_apply_start'),
      'sent', (SELECT count(DISTINCT visitor_id) FROM ev WHERE event = 'coaching_apply_submit'),
      'applications', (SELECT count(*) FROM capps),
      'became_clients', (SELECT count(*) FROM capps a WHERE a.client_id IN (SELECT client_id FROM payers))
    ),
    'direct_checkout', jsonb_build_object(
      'applications', (SELECT count(*) FROM capps WHERE application_source = 'direct_checkout'),
      'paid', (SELECT count(*) FROM capps a WHERE a.application_source = 'direct_checkout' AND a.client_id IN (SELECT client_id FROM payers))
    ),
    'upgrades', jsonb_build_object(
      'started', (SELECT count(*) FROM public.plan_changes pc WHERE pc.created_at >= v_start AND pc.created_at < v_end
                    AND pc.from_family IN ('free', 'membership') AND pc.to_family = 'coaching'),
      'applied', (SELECT count(*) FROM public.plan_changes pc WHERE pc.applied_at >= v_start AND pc.applied_at < v_end
                    AND pc.from_family IN ('free', 'membership') AND pc.to_family = 'coaching')
    ),
    'apply_steps', (SELECT coalesce(jsonb_object_agg(step, n), '{}'::jsonb) FROM (
        SELECT step, count(DISTINCT visitor_id) n FROM ev WHERE event = 'coaching_apply_step' AND step <> '' GROUP BY 1) s),
    'join_steps', (SELECT coalesce(jsonb_object_agg(step, n), '{}'::jsonb) FROM (
        SELECT step, count(DISTINCT visitor_id) n FROM ev WHERE event = 'apply_step' AND step <> '' GROUP BY 1) s),
    'checkouts', jsonb_build_object(
      'plan_started', (SELECT count(*) FROM checkouts),
      'plan_completed', (SELECT count(*) FROM checkouts WHERE status = 'applied'),
      'plan_abandoned', (SELECT count(*) FROM checkouts WHERE status IN ('expired', 'cancelled')),
      'plan_open', (SELECT count(*) FROM checkouts WHERE status NOT IN ('applied', 'expired', 'cancelled')),
      'links_sent', (SELECT count(*) FROM links),
      'links_paid', (SELECT count(*) FROM links WHERE paid > 0)
    ),
    'timing', jsonb_build_object(
      'visit_to_account_days', (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (r.created_at - av.first_seen_at)) / 86400.0)::numeric, 1)
         FROM regs r JOIN LATERAL (SELECT min(x.first_seen_at) AS first_seen_at FROM public.analytics_visitors x WHERE x.user_id = r.user_id) av ON true
        WHERE av.first_seen_at IS NOT NULL AND av.first_seen_at <= r.created_at),
      'visit_to_account_n', (SELECT count(*) FROM regs r WHERE EXISTS (SELECT 1 FROM public.analytics_visitors x WHERE x.user_id = r.user_id AND x.first_seen_at <= r.created_at)),
      'account_to_paid_days', (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (np.first_paid_at - u.created_at)) / 86400.0)::numeric, 1)
         FROM new_payers np JOIN auth.users u ON u.id = np.user_id WHERE np.first_paid_at >= u.created_at),
      'account_to_paid_n', (SELECT count(*) FROM new_payers np JOIN auth.users u ON u.id = np.user_id WHERE np.first_paid_at >= u.created_at),
      'application_to_client_days', (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (p.first_paid_at - coalesce(a.submitted_at, a.created_at))) / 86400.0)::numeric, 1)
         FROM public.coaching_applications a JOIN payers p ON p.client_id = a.client_id
        WHERE NOT coalesce(a.is_test, false) AND p.first_paid BETWEEN _from AND _to AND p.first_paid_at >= coalesce(a.submitted_at, a.created_at)),
      'application_to_client_n', (SELECT count(*) FROM public.coaching_applications a JOIN payers p ON p.client_id = a.client_id
        WHERE NOT coalesce(a.is_test, false) AND p.first_paid BETWEEN _from AND _to AND p.first_paid_at >= coalesce(a.submitted_at, a.created_at))
    ),
    'onboarding', jsonb_build_object(
      'accounts', (SELECT count(*) FROM onboard),
      'members', (SELECT count(*) FROM onboard WHERE tier = 'member'),
      'setup_done', (SELECT count(*) FROM onboard WHERE tier = 'member' AND coalesce(setup_done, false)),
      'came_back', (SELECT count(*) FROM onboard o WHERE EXISTS (SELECT 1 FROM act a WHERE a.user_id = o.user_id AND a.day > o.d0)),
      'trained_week1', (SELECT count(*) FROM onboard WHERE trained_week1),
      'week2_base', (SELECT count(*) FROM onboard o WHERE o.d0 + 13 <= _to),
      'week2_active', (SELECT count(*) FROM onboard o WHERE o.d0 + 13 <= _to
                        AND EXISTS (SELECT 1 FROM act a WHERE a.user_id = o.user_id AND a.day BETWEEN o.d0 + 7 AND o.d0 + 13))
    )
  ) INTO v;
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public.bi_conversions(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bi_conversions(date, date) TO service_role;

-- ---------------------------------------------------------------------------
-- 10. App engagement: who uses what, how often, by kind of person
-- ---------------------------------------------------------------------------
--
-- Every feature is read from the records it keeps (a workout finished, a set logged, food logged,
-- a check-in sent…), so it reaches back before visits were recorded; Nutrition and Competition also
-- count their pages opened (visits, since Nov 23 2026). Segments: free members, coaching clients,
-- and logins waiting on an application; the business's own people are counted apart (staff tools).
-- "Early use and staying" compares people who used a feature in their first 14 days with people
-- who didn't: whether they were active in weeks 5 and 6. It's an association, never a cause.
CREATE OR REPLACE FUNCTION public.bi_engagement(_from date, _to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start timestamptz := public.local_to_instant(_from::timestamp, 'America/Winnipeg');
  v_end timestamptz := public.local_to_instant((_to + 1)::timestamp, 'America/Winnipeg');
  v_prev timestamptz := public.local_to_instant((_from - ((_to - _from) + 1))::timestamp, 'America/Winnipeg');
  v_assoc timestamptz := public.local_to_instant((_to - 230)::timestamp, 'America/Winnipeg');
  v_since timestamptz;
  v jsonb;
BEGIN
  v_since := least(v_prev, v_assoc);
  WITH
  people AS (SELECT * FROM public.bi_people()),
  uses AS (
    SELECT 'workouts'::text AS f, c.user_id AS u, d.completed_at AS at FROM public.pl_day_completions d JOIN public.clients c ON c.id = d.client_id
     WHERE d.completed_at >= v_since AND d.completed_at < v_end
    UNION ALL SELECT 'logging', c.user_id, r.completed_at FROM public.pl_row_results r JOIN public.clients c ON c.id = r.client_id
     WHERE r.completed_at >= v_since AND r.completed_at < v_end
    UNION ALL SELECT 'nutrition', ml.user_id, ml.created_at FROM public.member_meal_logs ml WHERE ml.created_at >= v_since AND ml.created_at < v_end
    UNION ALL SELECT 'nutrition', s.user_id, pv.at FROM public.app_page_views pv JOIN public.app_sessions s ON s.id = pv.session_id
     WHERE pv.feature IN ('Nutrition', 'Nutrition studio') AND pv.at >= v_since AND pv.at < v_end AND s.user_id IS NOT NULL
    UNION ALL SELECT 'cardio', c.user_id, cc.created_at FROM public.cardio_completions cc JOIN public.clients c ON c.id = cc.client_id
     WHERE cc.completed AND cc.created_at >= v_since AND cc.created_at < v_end
    UNION ALL SELECT 'checkins', c.user_id, k.submitted_at FROM public.messenger_checkins k JOIN public.clients c ON c.id = k.client_id
     WHERE k.submitted_at >= v_since AND k.submitted_at < v_end
    UNION ALL SELECT 'checkins', c.user_id, n.submitted_at FROM public.nf_submissions n JOIN public.clients c ON c.id = n.client_id
     WHERE n.submitted_at >= v_since AND n.submitted_at < v_end
    UNION ALL SELECT 'messaging', m.sender_id, m.created_at FROM public.messages m
     WHERE m.sender_role = 'client' AND m.created_at >= v_since AND m.created_at < v_end
    UNION ALL SELECT 'messaging', g.sender_id, g.created_at FROM public.group_messages g WHERE g.created_at >= v_since AND g.created_at < v_end
    UNION ALL SELECT 'messaging', sm.sender_user_id, sm.created_at FROM public.member_support_messages sm
     WHERE sm.created_at >= v_since AND sm.created_at < v_end
    UNION ALL SELECT 'cleo', ci.user_id, ci.read_at FROM public.cleo_inbox_messages ci WHERE ci.read_at >= v_since AND ci.read_at < v_end
    UNION ALL SELECT 'community', p.author_user_id, p.created_at FROM public.community_posts p WHERE p.created_at >= v_since AND p.created_at < v_end
    UNION ALL SELECT 'community', r.user_id, r.created_at FROM public.community_reactions r WHERE r.created_at >= v_since AND r.created_at < v_end
    UNION ALL SELECT 'community', cm.author_user_id, cm.created_at FROM public.community_comments cm WHERE cm.created_at >= v_since AND cm.created_at < v_end
    UNION ALL SELECT 'crew_browse', pvw.viewer_user_id, pvw.viewed_at FROM public.community_post_views pvw WHERE pvw.viewed_at >= v_since AND pvw.viewed_at < v_end
    UNION ALL SELECT 'progress', b.user_id, b.created_at FROM public.progress_bodyweight b WHERE b.created_at >= v_since AND b.created_at < v_end
    UNION ALL SELECT 'progress', ps.user_id, ps.submitted_at FROM public.progress_submissions ps WHERE ps.submitted_at >= v_since AND ps.submitted_at < v_end
    UNION ALL SELECT 'meetings', c.user_id, cs.scheduled_at FROM public.coaching_sessions cs JOIN public.clients c ON c.id = cs.client_id
     WHERE cs.scheduled_at >= v_since AND cs.scheduled_at < least(v_end, now())
    UNION ALL SELECT 'meetings', c.user_id, pt.starts_at FROM public.pt_sessions pt JOIN public.clients c ON c.id = pt.client_id
     WHERE pt.status = 'Completed' AND pt.starts_at >= v_since AND pt.starts_at < v_end
    UNION ALL SELECT 'competition', c.user_id, co.created_at FROM public.competitions co JOIN public.clients c ON c.id = co.client_id
     WHERE NOT coalesce(co.internal_test, false) AND co.created_at >= v_since AND co.created_at < v_end
    UNION ALL SELECT 'competition', s.user_id, pv.at FROM public.app_page_views pv JOIN public.app_sessions s ON s.id = pv.session_id
     WHERE pv.feature = 'Competition' AND pv.at >= v_since AND pv.at < v_end AND s.user_id IS NOT NULL
    UNION ALL SELECT 'programs', ap.owner_id, ap.created_at FROM public.athlete_programs ap WHERE ap.created_at >= v_since AND ap.created_at < v_end
  ),
  u AS (
    SELECT x.f, x.u, x.at, public.instant_to_local(x.at, 'America/Winnipeg')::date AS day, p.tier, p.created_at AS joined
      FROM uses x JOIN people p ON p.user_id = x.u
     WHERE x.u IS NOT NULL AND x.at IS NOT NULL
  ),
  cur AS (SELECT * FROM u WHERE at >= v_start),
  prev AS (SELECT * FROM u WHERE at >= v_prev AND at < v_start),
  act AS (
    SELECT a.user_id, a.day, p.tier FROM public.bi_activity(v_since) a JOIN people p ON p.user_id = a.user_id
  ),
  per_user AS (
    SELECT f, tier, u, count(*) AS events, count(DISTINCT day) AS days FROM cur GROUP BY 1, 2, 3
  ),
  assoc_people AS (
    SELECT p.user_id, p.created_at, public.instant_to_local(p.created_at, 'America/Winnipeg')::date AS d0
      FROM people p
     WHERE p.created_at >= v_assoc AND p.created_at < public.local_to_instant((_to - 41)::timestamp, 'America/Winnipeg')
  ),
  assoc AS (
    SELECT ap.user_id,
           EXISTS (SELECT 1 FROM act a WHERE a.user_id = ap.user_id AND a.day BETWEEN ap.d0 + 28 AND ap.d0 + 41) AS stayed,
           array(SELECT DISTINCT x.f FROM u x WHERE x.u = ap.user_id AND x.at >= ap.created_at AND x.at < ap.created_at + interval '14 days') AS early
      FROM assoc_people ap
  ),
  feats AS (SELECT DISTINCT f FROM u)
  SELECT jsonb_build_object(
    'base', (SELECT coalesce(jsonb_object_agg(tier, n), '{}'::jsonb) FROM (
        SELECT tier, count(DISTINCT user_id) n FROM act WHERE day BETWEEN _from AND _to GROUP BY 1) b),
    'base_prev', (SELECT coalesce(jsonb_object_agg(tier, n), '{}'::jsonb) FROM (
        SELECT tier, count(DISTINCT user_id) n FROM act WHERE day BETWEEN _from - ((_to - _from) + 1) AND _from - 1 GROUP BY 1) b),
    'features', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'feature', g.f, 'tier', g.tier, 'users', g.users, 'events', g.events, 'user_days', g.user_days, 'repeat_users', g.repeat_users,
        'prev_users', (SELECT count(DISTINCT p.u) FROM prev p WHERE p.f = g.f AND p.tier = g.tier)
      )), '[]'::jsonb) FROM (
        SELECT f, tier, count(*) AS users, sum(events) AS events, sum(days) AS user_days, count(*) FILTER (WHERE days >= 2) AS repeat_users
          FROM per_user GROUP BY 1, 2) g),
    'prev_only', (SELECT coalesce(jsonb_agg(jsonb_build_object('feature', f, 'tier', tier, 'prev_users', n)), '[]'::jsonb) FROM (
        SELECT p.f, p.tier, count(DISTINCT p.u) n FROM prev p
         WHERE NOT EXISTS (SELECT 1 FROM cur c WHERE c.f = p.f AND c.tier = p.tier) GROUP BY 1, 2) x),
    'pages', (SELECT coalesce(jsonb_agg(jsonb_build_object('feature', feature, 'views', views, 'people', people, 'prev_views', prev_views) ORDER BY views DESC), '[]'::jsonb) FROM (
        SELECT pv.feature,
               count(*) FILTER (WHERE pv.at >= v_start) AS views,
               count(DISTINCT coalesce(s.user_id::text, s.visitor_id::text)) FILTER (WHERE pv.at >= v_start) AS people,
               count(*) FILTER (WHERE pv.at < v_start) AS prev_views
          FROM public.app_page_views pv JOIN public.app_sessions s ON s.id = pv.session_id
         WHERE pv.at >= v_prev AND pv.at < v_end AND s.audience IN ('member', 'client', 'pending') AND s.surface = 'app'
         GROUP BY 1) pg),
    'staff_tools', (SELECT coalesce(jsonb_agg(jsonb_build_object('feature', feature, 'views', views, 'days', days, 'staff', staff) ORDER BY views DESC), '[]'::jsonb) FROM (
        SELECT pv.feature, count(*) AS views, count(DISTINCT public.instant_to_local(pv.at, 'America/Winnipeg')::date) AS days, count(DISTINCT s.user_id) AS staff
          FROM public.app_page_views pv JOIN public.app_sessions s ON s.id = pv.session_id
         WHERE pv.at >= v_start AND pv.at < v_end AND s.audience = 'staff'
         GROUP BY 1) st),
    'staff_cleo', jsonb_build_object(
      'questions', (SELECT count(*) FROM public.summer_messages m WHERE m.role = 'user' AND m.created_at >= v_start AND m.created_at < v_end),
      'people', (SELECT count(DISTINCT m.user_id) FROM public.summer_messages m WHERE m.role = 'user' AND m.created_at >= v_start AND m.created_at < v_end)
    ),
    'association', jsonb_build_object(
      'people', (SELECT count(*) FROM assoc),
      'stayed', (SELECT count(*) FROM assoc WHERE stayed),
      'by_feature', (SELECT coalesce(jsonb_agg(jsonb_build_object(
          'feature', ft.f,
          'used', (SELECT count(*) FROM assoc a WHERE ft.f = ANY (a.early)),
          'used_stayed', (SELECT count(*) FROM assoc a WHERE ft.f = ANY (a.early) AND a.stayed),
          'not_used', (SELECT count(*) FROM assoc a WHERE NOT (ft.f = ANY (a.early))),
          'not_used_stayed', (SELECT count(*) FROM assoc a WHERE NOT (ft.f = ANY (a.early)) AND a.stayed)
        )), '[]'::jsonb) FROM feats ft)
    )
  ) INTO v;
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public.bi_engagement(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bi_engagement(date, date) TO service_role;

-- ---------------------------------------------------------------------------
-- 11. Retention
-- ---------------------------------------------------------------------------
--
--   Day 1 / 7 / 30 / 90  of the people who joined, the share active on day 1, in days 7–13, days
--                        30–59 and days 90–119 after joining, counting only people who've had the
--                        whole window (a newer account isn't counted as lost)
--   cohorts              each signup week's / month's share active in each week / month after
--   at risk              a client or member active on 4+ days in the month before the last two weeks
--                        and on none of the last 10 days (only when the range ends today)
--   status               every client and member by their last active day
CREATE OR REPLACE FUNCTION public.bi_retention(_from date, _to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := public.instant_to_local(now(), 'America/Winnipeg')::date;
  v_since timestamptz := public.local_to_instant((_to - 400)::timestamp, 'America/Winnipeg');
  v_start timestamptz := public.local_to_instant(_from::timestamp, 'America/Winnipeg');
  v_end timestamptz := public.local_to_instant((_to + 1)::timestamp, 'America/Winnipeg');
  v jsonb;
BEGIN
  WITH
  people AS (SELECT p.*, public.instant_to_local(p.created_at, 'America/Winnipeg')::date AS d0 FROM public.bi_people() p),
  act AS (SELECT a.user_id, a.day FROM public.bi_activity(v_since) a WHERE a.user_id IN (SELECT user_id FROM people)),
  joined AS (SELECT * FROM people WHERE created_at >= v_since AND created_at < v_end),
  windows AS (
    SELECT * FROM (VALUES (1, 1, 1), (7, 7, 13), (30, 30, 59), (90, 90, 119)) w(n, lo, hi)
  ),
  dn AS (
    SELECT w.n, j.tier, (j.created_at >= v_start) AS in_range,
           EXISTS (SELECT 1 FROM act a WHERE a.user_id = j.user_id AND a.day BETWEEN j.d0 + w.lo AND j.d0 + w.hi) AS kept
      FROM joined j CROSS JOIN windows w
     WHERE j.d0 + w.hi <= _to
  ),
  week_cohorts AS (
    SELECT (j.d0 - ((extract(isodow FROM j.d0)::int) - 1)) AS wk, j.user_id, j.d0
      FROM joined j WHERE j.d0 >= _to - 7 * 12
  ),
  month_cohorts AS (
    SELECT date_trunc('month', j.d0)::date AS mo, j.user_id FROM joined j WHERE j.d0 >= (date_trunc('month', _to) - interval '11 months')::date
  ),
  last_act AS (SELECT user_id, max(day) AS last_day, count(*) FILTER (WHERE day >= v_today - 44 AND day < v_today - 14) AS prior_days
                 FROM act GROUP BY 1),
  current_people AS (SELECT * FROM people WHERE NOT archived AND tier IN ('client', 'member'))
  SELECT jsonb_build_object(
    'day_n', (SELECT coalesce(jsonb_agg(jsonb_build_object('n', n, 'tier', tier, 'in_range', in_range, 'eligible', e, 'kept', k)), '[]'::jsonb) FROM (
        SELECT n, tier, in_range, count(*) e, count(*) FILTER (WHERE kept) k FROM dn GROUP BY 1, 2, 3) x),
    'weekly', (SELECT coalesce(jsonb_agg(jsonb_build_object('cohort', wk, 'size', size, 'weeks', weeks) ORDER BY wk), '[]'::jsonb) FROM (
        SELECT c.wk, count(DISTINCT c.user_id) size,
               (SELECT coalesce(jsonb_agg(jsonb_build_object('w', w, 'active', n) ORDER BY w), '[]'::jsonb) FROM (
                  SELECT ((a.day - c2.wk) / 7) AS w, count(DISTINCT a.user_id) n
                    FROM week_cohorts c2 JOIN act a ON a.user_id = c2.user_id AND a.day >= c2.wk
                   WHERE c2.wk = c.wk AND a.day <= _to AND (a.day - c2.wk) / 7 <= 11 GROUP BY 1) y) weeks
          FROM week_cohorts c GROUP BY c.wk) x),
    'monthly', (SELECT coalesce(jsonb_agg(jsonb_build_object('cohort', to_char(mo, 'YYYY-MM'), 'size', size, 'months', months) ORDER BY mo), '[]'::jsonb) FROM (
        SELECT c.mo, count(DISTINCT c.user_id) size,
               (SELECT coalesce(jsonb_agg(jsonb_build_object('m', m, 'active', n) ORDER BY m), '[]'::jsonb) FROM (
                  SELECT ((extract(year FROM a.day)::int - extract(year FROM c2.mo)::int) * 12 + extract(month FROM a.day)::int - extract(month FROM c2.mo)::int) AS m,
                         count(DISTINCT a.user_id) n
                    FROM month_cohorts c2 JOIN act a ON a.user_id = c2.user_id AND a.day >= c2.mo
                   WHERE c2.mo = c.mo AND a.day <= _to GROUP BY 1) y) months
          FROM month_cohorts c GROUP BY c.mo) x),
    'status', (SELECT coalesce(jsonb_agg(jsonb_build_object('tier', tier, 'bucket', bucket, 'n', n)), '[]'::jsonb) FROM (
        SELECT cp.tier,
               CASE WHEN la.last_day IS NULL THEN 'never'
                    WHEN la.last_day >= v_today - 6 THEN 'week'
                    WHEN la.last_day >= v_today - 29 THEN 'month'
                    WHEN la.last_day >= v_today - 89 THEN 'quarter'
                    ELSE 'lapsed' END AS bucket,
               count(*) n
          FROM current_people cp LEFT JOIN last_act la ON la.user_id = cp.user_id GROUP BY 1, 2) s),
    'at_risk', CASE WHEN _to < v_today THEN '[]'::jsonb ELSE (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'client_id', cp.client_id, 'name', cp.name, 'tier', cp.tier, 'last_day', la.last_day, 'prior_days', la.prior_days
      ) ORDER BY la.prior_days DESC, la.last_day DESC), '[]'::jsonb)
        FROM current_people cp JOIN last_act la ON la.user_id = cp.user_id
       WHERE la.prior_days >= 4 AND la.last_day < v_today - 9) END,
    'returning', jsonb_build_object(
      'active', (SELECT count(DISTINCT user_id) FROM act WHERE day BETWEEN _from AND _to),
      'returning', (SELECT count(DISTINCT a.user_id) FROM act a WHERE a.day BETWEEN _from AND _to
                     AND EXISTS (SELECT 1 FROM act b WHERE b.user_id = a.user_id AND b.day BETWEEN _from - 90 AND _from - 1))
    ),
    'mau_by_month', (SELECT coalesce(jsonb_agg(jsonb_build_object('month', to_char(mo, 'YYYY-MM'), 'active', n) ORDER BY mo), '[]'::jsonb) FROM (
        SELECT date_trunc('month', day)::date mo, count(DISTINCT user_id) n FROM act
         WHERE day >= (date_trunc('month', _to) - interval '11 months')::date AND day <= _to GROUP BY 1) m),
    'clients_by_month', (SELECT coalesce(jsonb_agg(jsonb_build_object('month', to_char(mo, 'YYYY-MM'), 'started', st, 'ended', en, 'active_start', ac) ORDER BY mo), '[]'::jsonb) FROM (
        SELECT mo,
               (SELECT count(*) FROM public.clients c WHERE c.service_tier = 'coaching' AND coalesce(c.status, '') <> 'Lead'
                  AND (c.user_id IS NULL OR c.user_id IN (SELECT user_id FROM people))
                  AND coalesce(c.converted_to_client_at, c.account_created_at, c.created_at) >= mo
                  AND coalesce(c.converted_to_client_at, c.account_created_at, c.created_at) < mo + interval '1 month') st,
               (SELECT count(*) FROM public.clients c WHERE c.service_tier = 'coaching' AND coalesce(c.status, '') <> 'Lead'
                  AND (c.user_id IS NULL OR c.user_id IN (SELECT user_id FROM people))
                  AND coalesce(c.deactivated_at, c.archived_at) >= mo AND coalesce(c.deactivated_at, c.archived_at) < mo + interval '1 month') en,
               (SELECT count(*) FROM public.clients c WHERE c.service_tier = 'coaching' AND coalesce(c.status, '') <> 'Lead'
                  AND (c.user_id IS NULL OR c.user_id IN (SELECT user_id FROM people))
                  AND coalesce(c.converted_to_client_at, c.account_created_at, c.created_at) < mo
                  AND (coalesce(c.deactivated_at, c.archived_at) IS NULL OR coalesce(c.deactivated_at, c.archived_at) >= mo)) ac
          FROM generate_series(date_trunc('month', _to) - interval '11 months', date_trunc('month', _to), interval '1 month') mo) m),
    -- an account deactivated or deleted, or a coaching plan that ended or went to the free app
    'cancellations', (SELECT count(*) FROM public.account_lifecycle_events e
       WHERE e.event IN ('deactivated', 'deletion_requested', 'moved_to_membership') AND e.created_at >= v_start AND e.created_at < v_end)
     + (SELECT count(*) FROM public.plan_changes pc
       WHERE pc.applied_at >= v_start AND pc.applied_at < v_end AND (pc.to_family = 'free' OR pc.kind IN ('cancel', 'end'))),
    'plan_moves', (SELECT coalesce(jsonb_object_agg(k, n), '{}'::jsonb) FROM (
        SELECT CASE WHEN pc.to_family = 'free' OR coalesce(pc.to_price_cents, 0) < coalesce(pc.from_price_cents, 0) THEN 'downgrade'
                    WHEN coalesce(pc.to_price_cents, 0) > coalesce(pc.from_price_cents, 0) THEN 'upgrade' ELSE 'switch' END k,
               count(*) n
          FROM public.plan_changes pc WHERE pc.applied_at >= v_start AND pc.applied_at < v_end GROUP BY 1) pm),
    'activity_since', (SELECT min(day) FROM act)
  ) INTO v;
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public.bi_retention(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bi_retention(date, date) TO service_role;

-- ---------------------------------------------------------------------------
-- 12. Revenue (billing is the source of truth)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bi_revenue(_from date, _to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days int := (_to - _from) + 1;
  v jsonb;
BEGIN
  WITH
  payers AS (SELECT * FROM public.bi_payers()),
  led AS (
    SELECT l.*, (l.amount_minor - coalesce(l.tax_minor, 0)) AS pre_tax,
           p.id AS sale_id, p.offer_name, p.stripe_subscription_id AS sale_sub,
           (coalesce(p.payment_structure, '') ~* '\d+\s*payments' OR coalesce(p.is_fixed_term_commitment, false)) AS fixed,
           (SELECT pk.name FROM public.coaching_package_enrollments e JOIN public.coaching_packages pk ON pk.id = e.package_id
             WHERE e.sale_id = p.id ORDER BY e.created_at DESC LIMIT 1) AS package_name
      FROM public.payment_ledger l
      LEFT JOIN public.purchase_records p ON p.id = l.purchase_id
     WHERE NOT coalesce(l.voided, false) AND l.client_id IN (SELECT client_id FROM payers)
  ),
  months AS (SELECT generate_series(date_trunc('month', _to) - interval '11 months', date_trunc('month', _to), interval '1 month')::date AS mo)
  SELECT jsonb_build_object(
    'by_month', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'month', to_char(m.mo, 'YYYY-MM'),
        'coaching_cents', coalesce((SELECT sum(pre_tax) FROM led WHERE txn_type = 'payment' AND date_trunc('month', transaction_date)::date = m.mo), 0),
        'refunds_cents', coalesce((SELECT sum(abs(pre_tax)) FROM led WHERE txn_type = 'refund' AND date_trunc('month', transaction_date)::date = m.mo), 0),
        'recurring_cents', coalesce((SELECT sum(pre_tax) FROM led WHERE txn_type = 'payment' AND sale_sub IS NOT NULL AND NOT fixed
                                       AND date_trunc('month', transaction_date)::date = m.mo), 0),
        'credits_cents', coalesce((SELECT sum(cp.amount_minor) FROM public.ai_credit_purchases cp
                                    WHERE cp.status = 'paid' AND date_trunc('month', public.instant_to_local(cp.paid_at, 'America/Winnipeg'))::date = m.mo
                                      AND (cp.user_id IS NULL OR NOT public.is_test_login(cp.user_id))), 0),
        'other_cents', coalesce((SELECT sum(o.amount_minor) FROM public.business_other_income o WHERE date_trunc('month', o.received_on)::date = m.mo), 0),
        'paying_clients', (SELECT count(DISTINCT client_id) FROM led WHERE txn_type = 'payment' AND date_trunc('month', transaction_date)::date = m.mo),
        'new_paying', (SELECT count(*) FROM payers WHERE date_trunc('month', first_paid)::date = m.mo)
      ) ORDER BY m.mo), '[]'::jsonb) FROM months m),
    'current', jsonb_build_object(
      'revenue_cents', coalesce((SELECT sum(CASE WHEN txn_type = 'payment' THEN pre_tax WHEN txn_type = 'refund' THEN -abs(pre_tax) ELSE 0 END)
                                   FROM led WHERE transaction_date BETWEEN _from AND _to), 0),
      'refunds_cents', coalesce((SELECT sum(abs(pre_tax)) FROM led WHERE txn_type = 'refund' AND transaction_date BETWEEN _from AND _to), 0),
      'payments', (SELECT count(*) FROM led WHERE txn_type = 'payment' AND transaction_date BETWEEN _from AND _to),
      'paying_clients', (SELECT count(DISTINCT client_id) FROM led WHERE txn_type = 'payment' AND transaction_date BETWEEN _from AND _to)
    ),
    'previous', jsonb_build_object(
      'revenue_cents', coalesce((SELECT sum(CASE WHEN txn_type = 'payment' THEN pre_tax WHEN txn_type = 'refund' THEN -abs(pre_tax) ELSE 0 END)
                                   FROM led WHERE transaction_date BETWEEN _from - v_days AND _from - 1), 0),
      'paying_clients', (SELECT count(DISTINCT client_id) FROM led WHERE txn_type = 'payment' AND transaction_date BETWEEN _from - v_days AND _from - 1)
    ),
    'by_package', (SELECT coalesce(jsonb_agg(jsonb_build_object('package', k, 'revenue_cents', c, 'clients', n, 'payments', p) ORDER BY c DESC), '[]'::jsonb) FROM (
        SELECT coalesce(package_name, offer_name, 'Payments not on a sale') k,
               sum(CASE WHEN txn_type = 'payment' THEN pre_tax WHEN txn_type = 'refund' THEN -abs(pre_tax) ELSE 0 END) c,
               count(DISTINCT client_id) n, count(*) FILTER (WHERE txn_type = 'payment') p
          FROM led WHERE transaction_date BETWEEN _from AND _to GROUP BY 1) bp),
    'mrr', public.bi_mrr(),
    'lifetime', jsonb_build_object(
      'clients', (SELECT count(*) FROM payers),
      'paid_cents', coalesce((SELECT sum(paid_cents - refunded_cents) FROM payers), 0),
      'ended_clients', (SELECT count(*) FROM payers p JOIN public.clients c ON c.id = p.client_id WHERE coalesce(c.deactivated_at, c.archived_at) IS NOT NULL),
      'ended_paid_cents', coalesce((SELECT sum(p.paid_cents - p.refunded_cents) FROM payers p JOIN public.clients c ON c.id = p.client_id
                                     WHERE coalesce(c.deactivated_at, c.archived_at) IS NOT NULL), 0),
      'ended_months', (SELECT round(avg((p.last_paid - p.first_paid) / 30.44)::numeric, 1) FROM payers p JOIN public.clients c ON c.id = p.client_id
                        WHERE coalesce(c.deactivated_at, c.archived_at) IS NOT NULL),
      'first_payment', (SELECT min(first_paid) FROM payers)
    ),
    'failing', jsonb_build_object(
      'subscriptions', (SELECT count(*) FROM public.purchase_records p
         WHERE p.stripe_subscription_id IS NOT NULL AND p.archived_at IS NULL AND coalesce(p.stripe_subscription_status, '') IN ('past_due', 'unpaid', 'incomplete')),
      'plan_payments', (SELECT count(*) FROM public.plan_changes pc WHERE pc.status = 'awaiting_payment')
    ),
    'plan_moves', (SELECT coalesce(jsonb_agg(jsonb_build_object('from', from_label, 'to', to_label, 'from_cents', from_price_cents, 'to_cents', to_price_cents, 'at', applied_at) ORDER BY applied_at DESC), '[]'::jsonb)
       FROM (SELECT * FROM public.plan_changes pc WHERE pc.applied_at >= public.local_to_instant(_from::timestamp, 'America/Winnipeg')
               AND pc.applied_at < public.local_to_instant((_to + 1)::timestamp, 'America/Winnipeg') ORDER BY pc.applied_at DESC LIMIT 20) x)
  ) INTO v;
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public.bi_revenue(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bi_revenue(date, date) TO service_role;

-- ---------------------------------------------------------------------------
-- 13. Technical performance (customers' visits; the business's own are left out)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bi_technical(_from date, _to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start timestamptz := public.local_to_instant(_from::timestamp, 'America/Winnipeg');
  v_end timestamptz := public.local_to_instant((_to + 1)::timestamp, 'America/Winnipeg');
  v jsonb;
BEGIN
  WITH
  internal AS (SELECT visitor_id FROM public.bi_internal_visitors()),
  sess AS (
    SELECT s.* FROM public.app_sessions s
     WHERE s.started_at >= v_start AND s.started_at < v_end
       AND s.audience IN ('visitor', 'member', 'client', 'pending') AND s.surface <> 'admin'
       AND s.visitor_id NOT IN (SELECT visitor_id FROM internal)
  ),
  ev AS (
    SELECT e.*, s.device, s.platform, s.os, s.browser FROM public.analytics_events e JOIN sess s ON s.id = e.session_id
     WHERE e.at >= v_start AND e.at < v_end
  ),
  vit AS (SELECT * FROM ev WHERE name = 'web_vital'),
  errs AS (SELECT * FROM ev WHERE name = 'js_error'),
  pvs AS (
    SELECT pv.session_id, pv.feature FROM public.app_page_views pv WHERE pv.session_id IN (SELECT id FROM sess)
  )
  SELECT jsonb_build_object(
    'sessions', (SELECT count(*) FROM sess),
    'by_device', (SELECT coalesce(jsonb_object_agg(k, n), '{}'::jsonb) FROM (SELECT coalesce(device, 'unknown') k, count(*) n FROM sess GROUP BY 1) x),
    'by_platform', (SELECT coalesce(jsonb_object_agg(k, n), '{}'::jsonb) FROM (SELECT coalesce(platform, 'unknown') k, count(*) n FROM sess GROUP BY 1) x),
    'by_os', (SELECT coalesce(jsonb_object_agg(k, n), '{}'::jsonb) FROM (SELECT coalesce(os, 'unknown') k, count(*) n FROM sess GROUP BY 1) x),
    'by_browser', (SELECT coalesce(jsonb_object_agg(k, n), '{}'::jsonb) FROM (SELECT coalesce(browser, 'unknown') k, count(*) n FROM sess GROUP BY 1) x),
    'vitals', (SELECT coalesce(jsonb_agg(jsonb_build_object('metric', label, 'n', n, 'p75', p75, 'good', g, 'ni', ni, 'poor', po)), '[]'::jsonb) FROM (
        SELECT label, count(*) n, percentile_cont(0.75) WITHIN GROUP (ORDER BY value) p75,
               count(*) FILTER (WHERE rating = 'good') g, count(*) FILTER (WHERE rating = 'ni') ni, count(*) FILTER (WHERE rating = 'poor') po
          FROM vit GROUP BY label) x),
    'vitals_by_device', (SELECT coalesce(jsonb_agg(jsonb_build_object('metric', label, 'device', d, 'n', n, 'p75', p75)), '[]'::jsonb) FROM (
        SELECT label, coalesce(device, 'unknown') d, count(*) n, percentile_cont(0.75) WITHIN GROUP (ORDER BY value) p75 FROM vit GROUP BY 1, 2) x),
    'vitals_by_feature', (SELECT coalesce(jsonb_agg(jsonb_build_object('feature', feature, 'metric', label, 'n', n, 'p75', p75, 'poor', po)), '[]'::jsonb) FROM (
        SELECT feature, label, count(*) n, percentile_cont(0.75) WITHIN GROUP (ORDER BY value) p75, count(*) FILTER (WHERE rating = 'poor') po
          FROM vit WHERE label IN ('LCP', 'INP') GROUP BY 1, 2) x),
    'vitals_daily', (SELECT coalesce(jsonb_agg(jsonb_build_object('day', d, 'metric', label, 'p75', p75, 'n', n) ORDER BY d), '[]'::jsonb) FROM (
        SELECT public.instant_to_local(at, 'America/Winnipeg')::date d, label, percentile_cont(0.75) WITHIN GROUP (ORDER BY value) p75, count(*) n
          FROM vit WHERE label IN ('LCP', 'INP') GROUP BY 1, 2) x),
    'errors', jsonb_build_object(
      'events', (SELECT count(*) FROM errs),
      'sessions', (SELECT count(DISTINCT session_id) FROM errs),
      'people', (SELECT count(DISTINCT coalesce(user_id::text, visitor_id::text)) FROM errs),
      'top', (SELECT coalesce(jsonb_agg(jsonb_build_object('label', label, 'n', n, 'sessions', s, 'feature', f, 'last_at', la) ORDER BY n DESC), '[]'::jsonb) FROM (
          SELECT label, count(*) n, count(DISTINCT session_id) s, mode() WITHIN GROUP (ORDER BY feature) f, max(at) la
            FROM errs GROUP BY label ORDER BY count(*) DESC LIMIT 15) x)
    ),
    'error_rate_by_feature', (SELECT coalesce(jsonb_agg(jsonb_build_object('feature', f, 'sessions', vs, 'with_errors', es) ORDER BY es DESC), '[]'::jsonb) FROM (
        SELECT v2.feature f, count(DISTINCT v2.session_id) vs,
               count(DISTINCT v2.session_id) FILTER (WHERE EXISTS (SELECT 1 FROM errs e WHERE e.session_id = v2.session_id AND e.feature = v2.feature)) es
          FROM pvs v2 GROUP BY 1) x WHERE es > 0),
    'failed_requests', (SELECT coalesce(jsonb_agg(jsonb_build_object('area', label, 'kind', rating, 'n', n, 'sessions', s) ORDER BY n DESC), '[]'::jsonb) FROM (
        SELECT label, rating, count(*) n, count(DISTINCT session_id) s FROM ev WHERE name = 'request_failed' GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 25) x),
    'not_found', (SELECT coalesce(jsonb_agg(jsonb_build_object('path', label, 'n', n) ORDER BY n DESC), '[]'::jsonb) FROM (
        SELECT label, count(*) n FROM ev WHERE name = 'page_not_found' GROUP BY 1 ORDER BY 2 DESC LIMIT 15) x),
    'payments', jsonb_build_object(
      'failing_subscriptions', (SELECT count(*) FROM public.purchase_records p
         WHERE p.stripe_subscription_id IS NOT NULL AND p.archived_at IS NULL AND coalesce(p.stripe_subscription_status, '') IN ('past_due', 'unpaid', 'incomplete')),
      'plan_payments_waiting', (SELECT count(*) FROM public.plan_changes pc WHERE pc.status = 'awaiting_payment')
    ),
    'ai', jsonb_build_object(
      'calls', (SELECT count(*) FROM public.ai_call_log l WHERE l.at >= v_start AND l.at < v_end AND l.task <> 'probe'),
      'failed', (SELECT count(*) FROM public.ai_call_log l WHERE l.at >= v_start AND l.at < v_end AND l.task <> 'probe' AND NOT l.ok AND coalesce(l.failure, '') <> 'paused')
    ),
    'sms', jsonb_build_object(
      'sent', (SELECT count(*) FROM public.sms_log l WHERE l.created_at >= v_start AND l.created_at < v_end AND l.twilio_sid IS NOT NULL),
      'undelivered', (SELECT count(*) FROM public.sms_log l WHERE l.created_at >= v_start AND l.created_at < v_end AND l.twilio_status IN ('undelivered', 'failed'))
    ),
    'events_since', (SELECT min(at) FROM public.analytics_events)
  ) INTO v;
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public.bi_technical(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bi_technical(date, date) TO service_role;
