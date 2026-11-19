-- Free membership by application (Nov 19 2026; membership-apply.ts).
--
-- JF Effect stays free, but nobody walks straight in any more: people apply
-- at /join (no account, no password), the coach reads every application,
-- may message them first, and approves it. Approving sends an activation
-- link; only then is there a login that can become a free member.
--
--   1. membership_applications: one row per application, server only (no
--      client policies; every read and write goes through the server after
--      an admin check).
--   2. membership_funnel_events: anonymous page steps (a random id per
--      browser, never a person) so the coach can see where people drop.
--   3. _member_free_join refuses anyone who isn't approved: a login made any
--      other way (a public sign-up through the API, an old link) gets nothing.
--      Logins made before this went live keep the old rule.
--   4. When an approved applicant comes in, their application is stamped and
--      their goal and experience fill the member setup, so it never asks twice.
--   5. membership_funnel(): the counts the coach's funnel card reads.

-- ---------------------------------------------------------------------------
-- 1. Applications
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.membership_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  full_name text NOT NULL CHECK (char_length(btrim(full_name)) BETWEEN 2 AND 120),
  email text NOT NULL CHECK (char_length(email) <= 254 AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$'),
  instagram text CHECK (instagram IS NULL OR instagram ~ '^@[A-Za-z0-9._]{1,30}$'),
  phone text CHECK (phone IS NULL OR char_length(phone) <= 40),
  goal text NOT NULL CHECK (goal IN ('build_muscle', 'lose_fat', 'get_stronger', 'powerlifting', 'back_in_shape', 'general_fitness')),
  experience text NOT NULL CHECK (experience IN ('new', 'beginner', 'intermediate', 'advanced')),
  coaching_interest text CHECK (coaching_interest IS NULL OR coaching_interest IN ('yes', 'maybe', 'no')),
  contact_method text NOT NULL CHECK (contact_method IN ('instagram', 'text', 'email')),
  contact_consent_at timestamptz NOT NULL,
  consent_text text NOT NULL CHECK (char_length(consent_text) <= 300),
  -- the coach's side
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
  flagged boolean NOT NULL DEFAULT false,
  contact_status text NOT NULL DEFAULT 'not_contacted' CHECK (contact_status IN ('not_contacted', 'messaged', 'talking')),
  contacted_at timestamptz,
  admin_notes text CHECK (admin_notes IS NULL OR char_length(admin_notes) <= 4000),
  decided_at timestamptz,
  decided_by uuid,
  -- getting them in
  invite_sent_at timestamptz,
  invite_count integer NOT NULL DEFAULT 0,
  code_hash text,
  code_expires_at timestamptz,
  code_attempts integer NOT NULL DEFAULT 0,
  code_sent_at timestamptz,
  activated_at timestamptz,
  user_id uuid,
  client_id uuid,
  -- approved, but the email already had an account (they just sign in)
  existing_account boolean NOT NULL DEFAULT false,
  -- where they came from (trimmed, never a reason to refuse)
  source_page text CHECK (source_page IS NULL OR char_length(source_page) <= 80),
  referrer text CHECK (referrer IS NULL OR char_length(referrer) <= 500),
  utm_source text CHECK (utm_source IS NULL OR char_length(utm_source) <= 120),
  utm_medium text CHECK (utm_medium IS NULL OR char_length(utm_medium) <= 120),
  utm_campaign text CHECK (utm_campaign IS NULL OR char_length(utm_campaign) <= 120),
  visitor_id uuid,
  ip_hash text CHECK (ip_hash IS NULL OR char_length(ip_hash) <= 64),
  is_test boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS membership_applications_status_idx ON public.membership_applications (status, created_at DESC);
CREATE INDEX IF NOT EXISTS membership_applications_email_idx ON public.membership_applications (lower(email));
CREATE INDEX IF NOT EXISTS membership_applications_ip_idx ON public.membership_applications (ip_hash, created_at DESC);
-- One open application per email: applying again while it's pending updates it.
CREATE UNIQUE INDEX IF NOT EXISTS membership_applications_one_pending
  ON public.membership_applications (lower(email)) WHERE status = 'pending';

ALTER TABLE public.membership_applications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.membership_applications FROM anon, authenticated;
GRANT ALL ON public.membership_applications TO service_role;

CREATE OR REPLACE FUNCTION public.tg_membership_applications_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS membership_applications_touch ON public.membership_applications;
CREATE TRIGGER membership_applications_touch BEFORE UPDATE ON public.membership_applications
  FOR EACH ROW EXECUTE FUNCTION public.tg_membership_applications_touch();

-- ---------------------------------------------------------------------------
-- 2. Funnel events (anonymous)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.membership_funnel_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- the coach's calendar day, worked out by the server
  day date NOT NULL,
  visitor_id uuid NOT NULL,
  event text NOT NULL CHECK (event IN ('landing_view', 'apply_start', 'apply_step', 'apply_submit')),
  step text NOT NULL DEFAULT '' CHECK (char_length(step) <= 40),
  source text CHECK (source IS NULL OR char_length(source) <= 80),
  referrer_host text CHECK (referrer_host IS NULL OR char_length(referrer_host) <= 120),
  utm_source text CHECK (utm_source IS NULL OR char_length(utm_source) <= 120),
  utm_medium text CHECK (utm_medium IS NULL OR char_length(utm_medium) <= 120),
  utm_campaign text CHECK (utm_campaign IS NULL OR char_length(utm_campaign) <= 120)
);
-- A visitor counts once per event (and step) per day: refreshing never inflates it.
CREATE UNIQUE INDEX IF NOT EXISTS membership_funnel_events_once
  ON public.membership_funnel_events (visitor_id, event, step, day);
CREATE INDEX IF NOT EXISTS membership_funnel_events_at_idx ON public.membership_funnel_events (created_at DESC, event);

ALTER TABLE public.membership_funnel_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.membership_funnel_events FROM anon, authenticated;
GRANT ALL ON public.membership_funnel_events TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Who may become a free member
-- ---------------------------------------------------------------------------
-- When applying went live: logins made before keep the old rule (anyone
-- confirmed could join), so nobody mid-sign-up is stranded.
INSERT INTO public.app_settings (key, value)
VALUES ('membership_applications_since', now()::text)
ON CONFLICT (key) DO NOTHING;

-- The application goal as the member setup wizard's goal (membership-apply.ts MEMBER_GOALS.tag).
CREATE OR REPLACE FUNCTION public.membership_goal_tag(_goal text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE _goal
    WHEN 'build_muscle' THEN 'Build muscle'
    WHEN 'lose_fat' THEN 'Lose fat'
    WHEN 'get_stronger' THEN 'Get stronger'
    WHEN 'powerlifting' THEN 'Powerlifting meet'
    WHEN 'back_in_shape' THEN 'Get back in shape'
    WHEN 'general_fitness' THEN 'General fitness'
  END
$$;

-- 'ok' (approved, or a login from before applications), 'pending' (applied,
-- not decided yet) or 'not_approved'.
CREATE OR REPLACE FUNCTION public._membership_join_allowed(_uid uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  u record;
  v_since timestamptz;
BEGIN
  SELECT id, email, created_at INTO u FROM auth.users WHERE id = _uid;
  IF NOT FOUND OR u.email IS NULL THEN RETURN 'not_approved'; END IF;
  BEGIN
    SELECT nullif(btrim(s.value), '')::timestamptz INTO v_since
      FROM public.app_settings s WHERE s.key = 'membership_applications_since';
  EXCEPTION WHEN others THEN
    v_since := NULL;
  END;
  IF v_since IS NULL OR u.created_at < v_since THEN RETURN 'ok'; END IF;
  IF EXISTS (SELECT 1 FROM public.membership_applications a
              WHERE lower(a.email) = lower(u.email) AND a.status = 'approved') THEN
    RETURN 'ok';
  END IF;
  IF EXISTS (SELECT 1 FROM public.membership_applications a
              WHERE lower(a.email) = lower(u.email) AND a.status = 'pending') THEN
    RETURN 'pending';
  END IF;
  RETURN 'not_approved';
END;
$$;
REVOKE ALL ON FUNCTION public._membership_join_allowed(uuid) FROM PUBLIC, anon, authenticated;

-- The live definition (20270201090000_free_platform_hardening.sql), with the
-- approval gate before anything is made and the application stamped after.
CREATE OR REPLACE FUNCTION public._member_free_join(_uid uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  u record;
  v_member uuid;
  v_type text;
  v_client uuid;
  v_lead uuid;
  v_name text;
  v_claims text;
  v_sub text;
  v_gate text;
  v_app record;
BEGIN
  SELECT id, email, email_confirmed_at, raw_user_meta_data INTO u FROM auth.users WHERE id = _uid;
  IF NOT FOUND OR u.email IS NULL THEN
    RETURN jsonb_build_object('status', 'no_user');
  END IF;
  IF u.email_confirmed_at IS NULL THEN
    RETURN jsonb_build_object('status', 'unconfirmed');
  END IF;
  -- staff logins never become members
  IF EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _uid AND r.role IN ('admin', 'coach', 'finance')) THEN
    RETURN jsonb_build_object('status', 'staff');
  END IF;
  -- already an athlete (a coaching client or a member)
  SELECT c.id INTO v_client FROM public.clients c WHERE c.user_id = _uid;
  IF v_client IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'athlete', 'client_id', v_client);
  END IF;
  -- a coach already set this person up: their invite links it, never a second
  -- record. A coaching application nobody has taken on (a Lead with no coach)
  -- isn't that: it's only what they typed in, and it becomes their member record.
  IF EXISTS (SELECT 1 FROM public.clients c
              WHERE c.user_id IS NULL AND lower(c.email) = lower(u.email)
                AND coalesce(c.archived, false) = false
                AND NOT (c.status = 'Lead' AND c.assigned_coach_id IS NULL)) THEN
    RETURN jsonb_build_object('status', 'coach_account');
  END IF;

  -- Free membership is by application: nothing is made until the coach approves.
  v_gate := public._membership_join_allowed(_uid);
  IF v_gate <> 'ok' THEN
    RETURN jsonb_build_object('status', v_gate);
  END IF;

  SELECT c.id INTO v_lead FROM public.clients c
   WHERE c.user_id IS NULL AND lower(c.email) = lower(u.email)
     AND coalesce(c.archived, false) = false
     AND c.status = 'Lead' AND c.assigned_coach_id IS NULL
   ORDER BY c.created_at DESC
   LIMIT 1;

  v_name := left(coalesce(nullif(btrim(u.raw_user_meta_data->>'full_name'), ''), split_part(u.email, '@', 1)), 120);

  SELECT m.id, m.account_type INTO v_member, v_type FROM public.app_members m WHERE m.user_id = _uid;
  IF v_member IS NOT NULL AND v_type <> 'jf_member' THEN
    RETURN jsonb_build_object('status', 'other_account');
  END IF;

  -- Joining is the server's step, so it runs as the server even when the
  -- person's own /welcome call got here: the clients guards
  -- (guard_clients_service_tier, clients_block_self_privileged_updates) let
  -- trusted server work through and still refuse the person changing those
  -- fields themselves. The application is linked before the member row,
  -- whose insert makes their client record (app_members_ensure_client):
  -- ensure_member_client then finds the Lead and turns it self-serve.
  v_claims := current_setting('request.jwt.claims', true);
  v_sub := current_setting('request.jwt.claim.sub', true);
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF v_lead IS NOT NULL THEN
    UPDATE public.clients
       SET user_id = _uid, account_status = 'Account Created', account_created_at = now()
     WHERE id = v_lead AND user_id IS NULL;
  END IF;
  IF v_member IS NULL THEN
    INSERT INTO public.app_members (user_id, email, full_name, account_type, status, subscription_status)
    VALUES (_uid, lower(u.email), v_name, 'jf_member', 'Active', 'Free')
    RETURNING id INTO v_member;
  ELSE
    -- a member row with no billing state (never checked out) is a free member
    UPDATE public.app_members SET subscription_status = 'Free'
     WHERE id = v_member AND nullif(btrim(coalesce(subscription_status, '')), '') IS NULL;
  END IF;
  PERFORM public.apply_default_member_access(v_member);
  v_client := public.ensure_member_client(v_member);

  -- Their application: stamped as joined, and its answers fill the member
  -- setup (goal, experience) so the wizard only asks for their training days.
  SELECT a.id, a.goal, a.experience INTO v_app
    FROM public.membership_applications a
   WHERE lower(a.email) = lower(u.email) AND a.status = 'approved'
   ORDER BY a.decided_at DESC NULLS LAST, a.created_at DESC
   LIMIT 1;
  IF v_app.id IS NOT NULL THEN
    UPDATE public.membership_applications
       SET activated_at = coalesce(activated_at, now()), user_id = _uid, client_id = v_client,
           code_hash = NULL, code_expires_at = NULL
     WHERE id = v_app.id;
    UPDATE public.app_members m
       SET goals_tags = CASE WHEN coalesce(array_length(m.goals_tags, 1), 0) = 0 AND public.membership_goal_tag(v_app.goal) IS NOT NULL
                             THEN ARRAY[public.membership_goal_tag(v_app.goal)] ELSE m.goals_tags END,
           experience_level = coalesce(m.experience_level, v_app.experience)
     WHERE m.id = v_member;
  END IF;

  PERFORM set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  PERFORM set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  RETURN jsonb_build_object('status', 'member', 'member_id', v_member, 'client_id', v_client);
END;
$$;
REVOKE ALL ON FUNCTION public._member_free_join(uuid) FROM PUBLIC, anon, authenticated;

-- The activation page's server step (service role only): an approved
-- applicant whose email is proven gets made a member now.
CREATE OR REPLACE FUNCTION public.membership_activate_login(_uid uuid)
RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public._member_free_join(_uid)
$$;
REVOKE ALL ON FUNCTION public.membership_activate_login(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.membership_activate_login(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. The funnel (service role only; the coach's card asks through the server)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.membership_funnel(_since timestamptz)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH ev AS (
    SELECT * FROM public.membership_funnel_events WHERE created_at >= _since
  ), apps AS (
    SELECT * FROM public.membership_applications WHERE NOT is_test
  ), joined AS (
    SELECT a.* FROM apps a WHERE a.activated_at >= _since
  )
  SELECT jsonb_build_object(
    'visitors', (SELECT count(DISTINCT visitor_id) FROM ev WHERE event = 'landing_view'),
    'starts', (SELECT count(DISTINCT visitor_id) FROM ev WHERE event = 'apply_start'),
    'steps', coalesce((SELECT jsonb_object_agg(step, n) FROM (
        SELECT step, count(DISTINCT visitor_id) AS n FROM ev WHERE event = 'apply_step' AND step <> '' GROUP BY step) s), '{}'::jsonb),
    'submitted', (SELECT count(*) FROM apps WHERE created_at >= _since),
    'pending', (SELECT count(*) FROM apps WHERE status = 'pending'),
    'approved', (SELECT count(*) FROM apps WHERE created_at >= _since AND status = 'approved'),
    'declined', (SELECT count(*) FROM apps WHERE created_at >= _since AND status = 'declined'),
    'activated', (SELECT count(*) FROM joined),
    'engaged', (SELECT count(*) FROM joined j WHERE
        EXISTS (SELECT 1 FROM public.pl_day_completions d
                 WHERE d.client_id = j.client_id AND d.completed_at BETWEEN j.activated_at AND j.activated_at + interval '7 days')
     OR EXISTS (SELECT 1 FROM public.pl_blocks b
                 WHERE b.client_id = j.client_id AND b.created_at BETWEEN j.activated_at AND j.activated_at + interval '7 days')
     OR EXISTS (SELECT 1 FROM public.community_posts p
                 WHERE p.author_user_id = j.user_id AND p.created_at BETWEEN j.activated_at AND j.activated_at + interval '7 days')),
    'trained', (SELECT count(*) FROM joined j WHERE EXISTS (
        SELECT 1 FROM public.pl_day_completions d
         WHERE d.client_id = j.client_id AND d.completed_at BETWEEN j.activated_at AND j.activated_at + interval '7 days')),
    'started_program', (SELECT count(*) FROM joined j WHERE EXISTS (
        SELECT 1 FROM public.pl_blocks b
         WHERE b.client_id = j.client_id AND b.created_at BETWEEN j.activated_at AND j.activated_at + interval '7 days')),
    'posted', (SELECT count(*) FROM joined j WHERE EXISTS (
        SELECT 1 FROM public.community_posts p
         WHERE p.author_user_id = j.user_id AND p.created_at BETWEEN j.activated_at AND j.activated_at + interval '7 days')),
    'coaching_interest', (SELECT count(*) FROM apps WHERE created_at >= _since AND coaching_interest = 'yes'),
    'sources', coalesce((SELECT jsonb_agg(jsonb_build_object('source', src, 'count', n) ORDER BY n DESC) FROM (
        SELECT coalesce(nullif(utm_source, ''), nullif(source_page, ''), 'direct') AS src, count(*) AS n
          FROM apps WHERE created_at >= _since GROUP BY 1 ORDER BY 2 DESC LIMIT 6) s), '[]'::jsonb)
  )
$$;
REVOKE ALL ON FUNCTION public.membership_funnel(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.membership_funnel(timestamptz) TO service_role;
