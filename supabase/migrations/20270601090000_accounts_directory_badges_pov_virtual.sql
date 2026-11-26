-- One account directory, membership badges, audited account views and disclosed virtual Crew
-- accounts (Nov 26 2026).
--
-- 1. Who an account is. Member Management listed `app_members` only, minus coaching clients, so
--    any login without a membership row (a login with no athlete record, a self-serve record a
--    membership row never followed) was in neither Client nor Member Management. The directory is
--    now read from every login and every athlete record (`admin_account_directory`), classified
--    real / test / demo / virtual, with what doesn't add up listed (`issues`) and the safe fixes
--    one admin action away (`admin_account_reconcile`). Nothing is deleted or merged.
-- 2. Membership badges (`_membership_badge`): coaching > premium / paid membership > free, read
--    from actual access, never stored; `community_author` carries it, `community_badges` serves
--    the surfaces that don't read authors (League, chats). A person can hide theirs.
-- 3. Account view (POV) sessions: started on the server for an account the staff member may
--    reach, with a reason, short-lived, view-only unless edits are switched on with a fresh
--    two-step confirmation, every step kept (`admin_pov_sessions`, `admin_pov_events`).
-- 4. Virtual Crew accounts: fictional, disclosed (`virtual` on every author card), free, no
--    media of any kind, managed by the admin only, likes the only automation and off until the
--    admin turns it on (global switch + per account), never a notification, never counted in
--    memberships, analytics, post scores or rankings.
SET lock_timeout = '5s';

/* ─────────────────────────── 1. Account classes and virtual accounts ─────────────────────────── */

CREATE TABLE IF NOT EXISTS public.account_classifications (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  class text NOT NULL CHECK (class IN ('real', 'test', 'demo')),
  note text CHECK (note IS NULL OR char_length(note) <= 300),
  set_by uuid,
  set_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.account_classifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.account_classifications FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.account_classifications TO authenticated;
DROP POLICY IF EXISTS "Admins read account classes" ON public.account_classifications;
CREATE POLICY "Admins read account classes" ON public.account_classifications FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')) OR (SELECT public.is_admin_viewer()));

CREATE TABLE IF NOT EXISTS public.virtual_accounts (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9._]{3,24}$'),
  first_name text NOT NULL CHECK (char_length(btrim(first_name)) BETWEEN 1 AND 40),
  last_name text CHECK (last_name IS NULL OR char_length(last_name) <= 40),
  background text CHECK (background IS NULL OR char_length(background) <= 600),
  active boolean NOT NULL DEFAULT true,
  likes_enabled boolean NOT NULL DEFAULT false,
  daily_like_limit smallint NOT NULL DEFAULT 4 CHECK (daily_like_limit BETWEEN 0 AND 20),
  quiet_start smallint NOT NULL DEFAULT 22 CHECK (quiet_start BETWEEN 0 AND 23),
  quiet_end smallint NOT NULL DEFAULT 7 CHECK (quiet_end BETWEEN 0 AND 23),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 600),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.virtual_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.virtual_accounts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.virtual_accounts TO authenticated;
DROP POLICY IF EXISTS "Admins read virtual accounts" ON public.virtual_accounts;
CREATE POLICY "Admins read virtual accounts" ON public.virtual_accounts FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')) OR (SELECT public.is_admin_viewer()));

-- Every change and every automated like, kept. No foreign key: the record outlives the account.
CREATE TABLE IF NOT EXISTS public.virtual_account_activity (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('created', 'updated', 'activated', 'deactivated', 'likes_on', 'likes_off',
                                         'like', 'unlike', 'likes_cleared', 'settings')),
  post_id uuid,
  actor_user_id uuid,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS virtual_account_activity_user_idx ON public.virtual_account_activity (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS virtual_account_activity_at_idx ON public.virtual_account_activity (created_at DESC);
ALTER TABLE public.virtual_account_activity ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.virtual_account_activity FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.virtual_account_activity TO authenticated;
DROP POLICY IF EXISTS "Admins read virtual activity" ON public.virtual_account_activity;
CREATE POLICY "Admins read virtual activity" ON public.virtual_account_activity FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')) OR (SELECT public.is_admin_viewer()));

CREATE OR REPLACE FUNCTION public.is_virtual_account(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.virtual_accounts v WHERE v.user_id = _uid)
$$;
REVOKE ALL ON FUNCTION public.is_virtual_account(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_virtual_account(uuid) TO authenticated, service_role;

-- A virtual account's address is on .invalid on purpose (nothing can ever reach it): it's not a
-- test login, it's a disclosed Crew account.
CREATE OR REPLACE FUNCTION public.is_test_login(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce((
    SELECT (lower(split_part(u.email, '@', 2)) IN ('example.com', 'example.org', 'example.net')
            OR lower(u.email) ~ '\.(test|example|invalid|localhost)$')
           AND NOT EXISTS (SELECT 1 FROM public.virtual_accounts v WHERE v.user_id = u.id)
      FROM auth.users u
     WHERE u.id = _uid
  ), false)
$$;

/* ─────────────────────────── 2. Membership badges ─────────────────────────── */

ALTER TABLE public.community_profiles ADD COLUMN IF NOT EXISTS show_membership_badge boolean NOT NULL DEFAULT true;

/**
 * The membership a person's badge shows, from what they actually have: an active coaching client
 * is 'coaching'; Premium access 'premium'; a paid or complimentary membership 'member'; everyone
 * else 'free' (a program bought on its own included: it isn't a membership). Null when they hid
 * it. Staff aren't decided here: callers show the coach mark for them.
 */
CREATE OR REPLACE FUNCTION public._membership_badge(_uid uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN _uid IS NULL THEN NULL
    WHEN EXISTS (SELECT 1 FROM public.community_profiles cp WHERE cp.user_id = _uid AND NOT cp.show_membership_badge) THEN NULL
    WHEN EXISTS (SELECT 1 FROM public.virtual_accounts v WHERE v.user_id = _uid) THEN 'free'
    WHEN EXISTS (SELECT 1 FROM public.clients c
                  WHERE c.user_id = _uid AND c.service_tier = 'coaching'
                    AND NOT coalesce(c.archived, false)
                    AND coalesce(c.status, '') NOT IN ('Deactivated', 'Deleted', 'Lead', 'Archived')) THEN 'coaching'
    WHEN public.premium_active(_uid) THEN 'premium'
    WHEN EXISTS (SELECT 1 FROM public.coaching_package_enrollments e
                   JOIN public.coaching_packages k ON k.id = e.package_id AND k.kind = 'membership'
                   JOIN public.clients c ON c.id = e.client_id AND c.user_id = _uid
                  WHERE e.status = 'active') THEN 'member'
    WHEN EXISTS (SELECT 1 FROM public.app_members m
                  WHERE m.user_id = _uid AND m.account_type = 'jf_member' AND m.status = 'Active'
                    AND (m.subscription_status IN ('Active', 'Trialing', 'Complimentary')
                         OR (m.subscription_status = 'Active (Cancels at period end)'
                             AND coalesce(m.cancel_at, m.current_period_end) > now()))) THEN 'member'
    ELSE 'free'
  END
$$;
REVOKE ALL ON FUNCTION public._membership_badge(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._membership_badge(uuid) TO service_role;

-- The person card everywhere in Crew: + their badge and whether it's a virtual account.
CREATE OR REPLACE FUNCTION public.community_author(_user_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH me AS (
    SELECT coalesce((SELECT cp0.same_person_as FROM public.community_profiles cp0 WHERE cp0.user_id = _user_id), _user_id) AS uid
  ),
  -- materialized: has_role runs on these one or two accounts, never on every profile
  accounts AS MATERIALIZED (
    SELECT me.uid AS user_id FROM me
    UNION
    SELECT cpl.user_id FROM public.community_profiles cpl JOIN me ON cpl.same_person_as = me.uid
  )
  SELECT jsonb_build_object(
    'user_id', me.uid,
    'is_coach', (staff.yes OR cp.title IS NOT NULL),
    'title', CASE WHEN staff.yes OR cp.title IS NOT NULL THEN coalesce(cp.title, 'Coach · JF Effect') END,
    'name', CASE
      WHEN cp.title IS NOT NULL THEN coalesce(nullif(btrim(c.full_name), ''), nullif(btrim(co.full_name), ''), nullif(btrim(p.full_name), ''), 'Coach')
      WHEN staff.yes THEN coalesce(nullif(btrim(co.first_name), ''), nullif(split_part(btrim(coalesce(co.full_name, p.full_name, '')), ' ', 1), ''), 'Coach')
      ELSE coalesce(nullif(btrim(c.preferred_name), ''), nullif(btrim(c.first_name), ''),
                    nullif(split_part(btrim(coalesce(c.full_name, p.full_name, '')), ' ', 1), ''), 'Athlete') END,
    'avatar_url', public.community_avatar(me.uid),
    'username', cp.username,
    'badge', CASE WHEN staff.yes OR cp.title IS NOT NULL THEN NULL ELSE public._membership_badge(me.uid) END,
    'virtual', EXISTS (SELECT 1 FROM public.virtual_accounts va WHERE va.user_id = me.uid))
  FROM me
  LEFT JOIN public.community_profiles cp ON cp.user_id = me.uid
  LEFT JOIN public.profiles p ON p.id = me.uid
  LEFT JOIN LATERAL (SELECT * FROM public.clients c1 WHERE c1.user_id = me.uid LIMIT 1) c ON true
  LEFT JOIN LATERAL (SELECT * FROM public.coaches c2 WHERE c2.user_id = me.uid LIMIT 1) co ON true
  LEFT JOIN LATERAL (SELECT EXISTS (SELECT 1 FROM accounts a WHERE public.has_role(a.user_id, 'admin') OR public.has_role(a.user_id, 'coach')) AS yes) staff ON true
$function$;

/**
 * Badges for the surfaces that list people without author cards (League, Hall, chats): one call
 * for a screen's people, at most 200, by login id or athlete-record id (League rows are keyed by
 * record). Each answer comes back under the id it was asked for. Signed-in callers only.
 */
CREATE OR REPLACE FUNCTION public.community_badges(_ids uuid[])
RETURNS TABLE (user_id uuid, badge text, is_virtual boolean, is_coach boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH ids AS (SELECT DISTINCT x AS id FROM unnest(coalesce(_ids, '{}'::uuid[])) x WHERE x IS NOT NULL LIMIT 200),
       resolved AS (
         SELECT i.id, coalesce((SELECT c.user_id FROM public.clients c WHERE c.id = i.id), i.id) AS uid FROM ids i
       ),
       staff AS MATERIALIZED (SELECT s FROM public.community_staff_people() s WHERE s IS NOT NULL)
  SELECT r.id,
         CASE WHEN r.uid IN (SELECT s FROM staff) THEN NULL
              ELSE public._membership_badge(public.community_main_account(r.uid)) END,
         EXISTS (SELECT 1 FROM public.virtual_accounts v WHERE v.user_id = r.uid),
         r.uid IN (SELECT s FROM staff)
    FROM resolved r
   WHERE (SELECT auth.uid()) IS NOT NULL
$$;
REVOKE ALL ON FUNCTION public.community_badges(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_badges(uuid[]) TO authenticated, service_role;

/** Show or hide your own membership badge (Edit profile → Privacy). */
CREATE OR REPLACE FUNCTION public.community_set_show_badge(_on boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_me uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  v_me := public.community_main_account(auth.uid());
  INSERT INTO public.community_profiles (user_id, show_membership_badge)
  VALUES (v_me, coalesce(_on, true))
  ON CONFLICT (user_id) DO UPDATE SET show_membership_badge = EXCLUDED.show_membership_badge, updated_at = now();
  RETURN coalesce(_on, true);
END;
$$;
REVOKE ALL ON FUNCTION public.community_set_show_badge(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_set_show_badge(boolean) TO authenticated;

/* ─────────────────────────── 3. The account directory ─────────────────────────── */

CREATE INDEX IF NOT EXISTS app_sessions_user_seen_idx ON public.app_sessions (user_id, last_seen_at DESC) WHERE user_id IS NOT NULL;

/**
 * Every account that isn't a team login, one row per person: their login (if any), their athlete
 * record and membership row (if any), what they're on, their badge, whether they're real, test,
 * demo or virtual, where the account stands, and what doesn't add up. Admins (and the view-only
 * admin login) only. Coaching clients are included for the counts; the Members page lists the
 * rest.
 */
CREATE OR REPLACE FUNCTION public.admin_account_directory()
RETURNS TABLE (
  user_id uuid, client_id uuid, member_id uuid,
  name text, email text, phone text, avatar_url text, username text,
  created_at timestamptz, last_sign_in_at timestamptz, last_seen_at timestamptz,
  last_workout_at timestamptz, workouts_30d integer,
  kind text, plan_key text, plan_label text, badge text,
  account_class text, lifecycle text,
  subscription_status text, billing_issue boolean, confirmed boolean, starred boolean,
  issues text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_demo jsonb;
BEGIN
  IF NOT ((SELECT public.has_role(v_uid, 'admin')) OR (SELECT public.is_admin_viewer())) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  BEGIN
    SELECT nullif(btrim(s.value), '')::jsonb INTO v_demo FROM public.app_settings s WHERE s.key = 'app_review_demo_accounts';
  EXCEPTION WHEN others THEN v_demo := NULL;
  END;

  RETURN QUERY
  WITH staff AS MATERIALIZED (
    SELECT r.user_id AS id FROM public.user_roles r WHERE r.role::text <> 'client' AND r.user_id IS NOT NULL
  ),
  logins AS MATERIALIZED (
    SELECT u.id, u.email::text AS email, u.created_at, u.last_sign_in_at,
           u.email_confirmed_at IS NOT NULL AS confirmed, u.raw_user_meta_data AS meta
      FROM auth.users u
     WHERE u.deleted_at IS NULL AND u.id NOT IN (SELECT id FROM staff)
  ),
  people AS (
    SELECT l.id AS uid,
           (SELECT c1.id FROM public.clients c1 WHERE c1.user_id = l.id
             ORDER BY (c1.service_tier = 'coaching') DESC, c1.created_at LIMIT 1) AS cid,
           (SELECT m1.id FROM public.app_members m1 WHERE m1.user_id = l.id
             ORDER BY coalesce(m1.is_admin_sandbox, false), m1.created_at LIMIT 1) AS mid
      FROM logins l
    UNION ALL
    -- a member record made before their login
    SELECT NULL, c.id,
           (SELECT m1.id FROM public.app_members m1 WHERE m1.user_id IS NULL AND lower(m1.email) = lower(c.email) LIMIT 1)
      FROM public.clients c
     WHERE c.user_id IS NULL AND c.service_tier = 'self_serve'
    UNION ALL
    SELECT NULL, NULL, m.id
      FROM public.app_members m
     WHERE m.user_id IS NULL AND m.account_type <> 'program_only' AND NOT coalesce(m.is_admin_sandbox, false)
       AND NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.user_id IS NULL AND c.service_tier = 'self_serve'
                         AND lower(c.email) = lower(m.email))
  ),
  base AS (
    SELECT p.uid, p.cid, p.mid, l.email AS l_email, l.created_at AS l_created, l.last_sign_in_at AS l_last_in,
           l.confirmed AS l_confirmed, l.meta,
           c.full_name AS c_name, c.email AS c_email, c.phone AS c_phone, c.profile_picture_url,
           c.service_tier, c.status AS c_status, coalesce(c.archived, false) AS c_archived, c.coaching_package,
           c.created_at AS c_created,
           m.full_name AS m_name, m.email AS m_email, m.phone AS m_phone, m.account_type, m.status AS m_status,
           m.subscription_status AS m_sub, m.stripe_subscription_id AS m_stripe_sub, m.payment_failed_at,
           m.payment_recovered_at, m.last_active_at AS m_active, m.created_at AS m_created,
           coalesce(m.is_admin_sandbox, false) AS sandbox,
           va.user_id AS va_id, va.first_name AS va_first, va.last_name AS va_last, va.active AS va_active,
           cp.username AS cp_username, ac.class AS ac_class,
           w.last_at AS w_last, coalesce(w.n30, 0)::integer AS w_n30,
           seen.at AS seen_at,
           enr.slug AS enr_slug, enr.name AS enr_name, enr.kind AS enr_kind,
           pr.stripe_subscription_status AS pr_sub, pr.payment_status AS pr_pay,
           del.id AS del_id
      FROM people p
      LEFT JOIN logins l ON l.id = p.uid
      LEFT JOIN public.clients c ON c.id = p.cid
      LEFT JOIN public.app_members m ON m.id = p.mid
      LEFT JOIN public.virtual_accounts va ON va.user_id = p.uid
      LEFT JOIN public.community_profiles cp ON cp.user_id = p.uid
      LEFT JOIN public.account_classifications ac ON ac.user_id = p.uid
      LEFT JOIN LATERAL (
        SELECT max(d.completed_at) AS last_at,
               count(*) FILTER (WHERE d.completed_at > now() - interval '30 days') AS n30
          FROM public.pl_day_completions d
         WHERE d.client_id = p.cid AND d.completed_at IS NOT NULL
      ) w ON true
      LEFT JOIN LATERAL (
        SELECT max(s.last_seen_at) AS at FROM public.app_sessions s WHERE s.user_id = p.uid
      ) seen ON true
      LEFT JOIN LATERAL (
        SELECT k.slug, k.name, k.kind
          FROM public.coaching_package_enrollments e
          JOIN public.coaching_packages k ON k.id = e.package_id
         WHERE e.client_id = p.cid AND e.status = 'active'
         ORDER BY e.created_at DESC LIMIT 1
      ) enr ON true
      LEFT JOIN LATERAL (
        SELECT r.stripe_subscription_status, r.payment_status
          FROM public.purchase_records r
         WHERE r.client_id = p.cid AND r.stripe_subscription_id IS NOT NULL
         ORDER BY r.purchased_at DESC NULLS LAST LIMIT 1
      ) pr ON true
      LEFT JOIN LATERAL (
        SELECT ad.id FROM public.account_deletions ad
         WHERE ad.status = 'pending'
           AND ((p.uid IS NOT NULL AND ad.user_id = p.uid) OR (p.cid IS NOT NULL AND ad.client_id = p.cid)
                OR (p.mid IS NOT NULL AND ad.member_id = p.mid))
         LIMIT 1
      ) del ON true
  ),
  shaped AS (
    SELECT r.*,
           CASE WHEN r.va_id IS NOT NULL THEN 'member'
                WHEN r.service_tier = 'coaching' THEN 'coaching'
                WHEN r.cid IS NOT NULL OR r.mid IS NOT NULL THEN 'member'
                ELSE 'pending' END AS k,
           (r.uid IS NOT NULL AND r.va_id IS NULL AND public.premium_active(r.uid)) AS premium
      FROM base r
  )
  SELECT s.uid, s.cid, s.mid,
         coalesce(CASE WHEN s.va_id IS NOT NULL THEN btrim(s.va_first || coalesce(' ' || s.va_last, '')) END,
                  nullif(btrim(s.c_name), ''), nullif(btrim(s.m_name), ''),
                  nullif(btrim(s.meta->>'full_name'), ''),
                  nullif(btrim(concat_ws(' ', s.meta->>'first_name', s.meta->>'last_name')), ''),
                  split_part(coalesce(s.l_email, s.c_email, s.m_email, ''), '@', 1)),
         CASE WHEN s.va_id IS NOT NULL THEN NULL ELSE coalesce(s.l_email, s.c_email, s.m_email) END,
         coalesce(s.c_phone, s.m_phone),
         CASE WHEN s.va_id IS NOT NULL THEN NULL
              ELSE coalesce(s.profile_picture_url, CASE WHEN s.uid IS NOT NULL THEN public.community_avatar(s.uid) END) END,
         s.cp_username::text,
         coalesce(s.l_created, s.c_created, s.m_created),
         s.l_last_in,
         greatest(s.seen_at, s.m_active, s.l_last_in),
         s.w_last, s.w_n30,
         s.k,
         CASE
           WHEN s.k = 'coaching' THEN coalesce(CASE WHEN s.enr_kind = 'subscription' THEN s.enr_slug END, 'coaching')
           WHEN s.k = 'pending' THEN 'none'
           WHEN s.va_id IS NOT NULL THEN 'free'
           WHEN s.premium THEN 'premium'
           WHEN s.enr_kind = 'membership' THEN s.enr_slug
           WHEN s.account_type = 'jf_member' AND s.m_sub IN ('Active', 'Trialing', 'Active (Cancels at period end)') THEN 'member'
           WHEN s.account_type = 'jf_member' AND s.m_sub = 'Complimentary' THEN 'member'
           WHEN s.account_type = 'program_only' THEN 'program_only'
           ELSE 'free' END,
         CASE
           WHEN s.k = 'coaching' THEN coalesce(s.enr_name, nullif(btrim(s.coaching_package), ''), 'Coaching')
           WHEN s.k = 'pending' THEN 'No plan yet'
           WHEN s.va_id IS NOT NULL THEN 'Free'
           WHEN s.premium THEN 'Premium'
           WHEN s.enr_kind = 'membership' THEN s.enr_name
           WHEN s.account_type = 'jf_member' AND s.m_sub IN ('Active', 'Trialing', 'Active (Cancels at period end)') THEN 'Member'
           WHEN s.account_type = 'jf_member' AND s.m_sub = 'Complimentary' THEN 'Member (complimentary)'
           WHEN s.account_type = 'program_only' THEN 'Program only'
           ELSE 'Free' END,
         CASE WHEN s.uid IS NOT NULL THEN public._membership_badge(s.uid) END,
         CASE
           WHEN s.va_id IS NOT NULL THEN 'virtual'
           WHEN s.sandbox THEN 'sandbox'
           WHEN s.ac_class IS NOT NULL THEN s.ac_class
           WHEN s.uid IS NOT NULL AND public.is_test_login(s.uid) THEN 'test'
           WHEN v_demo IS NOT NULL AND lower(coalesce(s.l_email, s.c_email, s.m_email, ''))
                IN (lower(coalesce(v_demo->>'client_email', '-')), lower(coalesce(v_demo->>'member_email', '-'))) THEN 'demo'
           ELSE 'real' END,
         CASE
           WHEN s.del_id IS NOT NULL THEN 'pending_deletion'
           WHEN s.c_status IN ('Deactivated', 'Deleted') THEN 'deactivated'
           WHEN s.va_id IS NOT NULL AND NOT s.va_active THEN 'paused'
           WHEN s.c_archived OR (s.cid IS NULL AND s.m_status IN ('Archived', 'Cancelled', 'Deactivated')) THEN 'archived'
           WHEN s.uid IS NULL THEN 'not_set_up'
           WHEN NOT s.l_confirmed THEN 'unconfirmed'
           ELSE 'active' END,
         CASE WHEN s.k = 'coaching' THEN s.pr_sub ELSE s.m_sub END,
         (s.m_sub IN ('Past Due', 'Payment Failed')
          OR (s.payment_failed_at IS NOT NULL AND (s.payment_recovered_at IS NULL OR s.payment_recovered_at < s.payment_failed_at))
          OR coalesce(s.pr_pay, '') IN ('Overdue', 'Payment Failed', 'Failed')),
         coalesce(s.l_confirmed, false),
         (s.cid IS NOT NULL AND EXISTS (SELECT 1 FROM public.staff_client_stars st WHERE st.user_id = v_uid AND st.client_id = s.cid)),
         array_remove(ARRAY[
           CASE WHEN s.uid IS NOT NULL AND s.l_confirmed AND s.cid IS NULL AND s.mid IS NULL AND s.va_id IS NULL THEN 'no_record' END,
           CASE WHEN s.uid IS NOT NULL AND s.cid IS NOT NULL AND s.service_tier = 'self_serve' AND s.mid IS NULL
                     AND s.va_id IS NULL THEN 'no_member_row' END,
           CASE WHEN s.uid IS NOT NULL AND s.mid IS NOT NULL AND s.account_type = 'jf_member' AND NOT s.sandbox
                     AND s.cid IS NULL THEN 'no_client_row' END,
           CASE WHEN s.cid IS NOT NULL AND s.service_tier = 'self_serve' AND NOT s.c_archived
                     AND coalesce(s.c_status, '') NOT IN ('Deactivated', 'Deleted')
                     AND s.m_status IN ('Archived', 'Cancelled', 'Deactivated') THEN 'member_row_archived' END,
           CASE WHEN s.service_tier = 'self_serve' AND s.enr_kind = 'subscription' THEN 'coaching_package_on_member' END,
           CASE WHEN s.service_tier = 'coaching' AND NOT s.c_archived AND s.enr_kind IN ('membership', 'free') THEN 'member_package_on_client' END,
           CASE WHEN s.account_type = 'jf_member' AND s.m_sub IN ('Active', 'Trialing') AND s.m_stripe_sub IS NULL THEN 'paid_without_subscription' END,
           CASE WHEN s.k = 'coaching' AND NOT s.c_archived AND s.pr_sub IN ('canceled', 'incomplete_expired')
                     AND s.enr_kind = 'subscription' THEN 'stripe_ended_package_active' END,
           CASE WHEN s.uid IS NOT NULL AND NOT s.l_confirmed THEN 'unconfirmed' END
         ]::text[], NULL)
    FROM shaped s;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_account_directory() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_account_directory() TO authenticated;

-- Each check and each fix, kept: what the Members page's sync status reads.
CREATE TABLE IF NOT EXISTS public.account_sync_runs (
  id bigserial PRIMARY KEY,
  ran_at timestamptz NOT NULL DEFAULT now(),
  ran_by uuid,
  applied boolean NOT NULL DEFAULT false,
  accounts integer NOT NULL DEFAULT 0,
  issues jsonb NOT NULL DEFAULT '[]'::jsonb,
  fixed jsonb NOT NULL DEFAULT '[]'::jsonb
);
ALTER TABLE public.account_sync_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.account_sync_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.account_sync_runs TO authenticated;
DROP POLICY IF EXISTS "Admins read account sync runs" ON public.account_sync_runs;
CREATE POLICY "Admins read account sync runs" ON public.account_sync_runs FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')) OR (SELECT public.is_admin_viewer()));

/** Run writes as the server (the clients guards let trusted work through), then put the caller back. */
CREATE OR REPLACE FUNCTION public._account_fix_member_row(_client_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  c record;
  v_member uuid;
  v_claims text := current_setting('request.jwt.claims', true);
  v_sub text := current_setting('request.jwt.claim.sub', true);
BEGIN
  SELECT cl.id, cl.user_id, cl.full_name, cl.phone, cl.service_tier, u.email INTO c
    FROM public.clients cl JOIN auth.users u ON u.id = cl.user_id
   WHERE cl.id = _client_id;
  IF NOT FOUND OR c.service_tier <> 'self_serve' THEN RETURN NULL; END IF;
  SELECT m.id INTO v_member FROM public.app_members m WHERE m.user_id = c.user_id LIMIT 1;
  IF v_member IS NOT NULL THEN RETURN v_member; END IF;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  INSERT INTO public.app_members (user_id, email, full_name, phone, account_type, status, subscription_status)
  VALUES (c.user_id, lower(c.email), coalesce(nullif(btrim(c.full_name), ''), split_part(c.email, '@', 1)), c.phone,
          'jf_member', 'Active', 'Free')
  RETURNING id INTO v_member;
  PERFORM public.apply_default_member_access(v_member);
  PERFORM public.ensure_member_client(v_member);
  PERFORM set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  PERFORM set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  RETURN v_member;
END;
$$;
REVOKE ALL ON FUNCTION public._account_fix_member_row(uuid) FROM PUBLIC, anon, authenticated;

/**
 * The sync check: every account's issues, and with `_apply` the safe fixes (a self-serve record
 * with no membership row gets one, a membership row with no record gets its record). Everything
 * else is listed for a decision, never changed here. Admins apply; the view-only login checks.
 */
CREATE OR REPLACE FUNCTION public.admin_account_reconcile(_apply boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_admin boolean := public.has_role(auth.uid(), 'admin');
  r record;
  v_issues jsonb := '[]'::jsonb;
  v_fixed jsonb := '[]'::jsonb;
  v_n integer := 0;
  v_id uuid;
  v_claims text;
  v_sub text;
BEGIN
  IF NOT (v_admin OR (NOT coalesce(_apply, false) AND public.is_admin_viewer())) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  FOR r IN SELECT d.* FROM public.admin_account_directory() d LOOP
    v_n := v_n + 1;
    IF cardinality(r.issues) = 0 THEN CONTINUE; END IF;
    v_issues := v_issues || jsonb_build_object(
      'user_id', r.user_id, 'client_id', r.client_id, 'member_id', r.member_id, 'name', r.name,
      'account_class', r.account_class, 'kind', r.kind, 'issues', to_jsonb(r.issues));
    IF coalesce(_apply, false) AND r.account_class IN ('real') THEN
      IF 'no_member_row' = ANY (r.issues) THEN
        v_id := public._account_fix_member_row(r.client_id);
        IF v_id IS NOT NULL THEN
          v_fixed := v_fixed || jsonb_build_object('issue', 'no_member_row', 'client_id', r.client_id, 'member_id', v_id);
        END IF;
      END IF;
      IF 'no_client_row' = ANY (r.issues) THEN
        v_claims := current_setting('request.jwt.claims', true);
        v_sub := current_setting('request.jwt.claim.sub', true);
        PERFORM set_config('request.jwt.claims', '', true);
        PERFORM set_config('request.jwt.claim.sub', '', true);
        v_id := public.ensure_member_client(r.member_id);
        PERFORM set_config('request.jwt.claims', coalesce(v_claims, ''), true);
        PERFORM set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
        IF v_id IS NOT NULL THEN
          v_fixed := v_fixed || jsonb_build_object('issue', 'no_client_row', 'member_id', r.member_id, 'client_id', v_id);
        END IF;
      END IF;
    END IF;
  END LOOP;
  INSERT INTO public.account_sync_runs (ran_by, applied, accounts, issues, fixed)
  VALUES (v_uid, coalesce(_apply, false), v_n, v_issues, v_fixed);
  RETURN jsonb_build_object('checked_at', now(), 'accounts', v_n, 'issues', v_issues, 'fixed', v_fixed);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_account_reconcile(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_account_reconcile(boolean) TO authenticated;

/**
 * A login with no athlete record, made a free member by the admin's decision (the admin approving
 * is what an application would have done). Never staff, never a virtual account, never someone
 * who already has a record.
 */
CREATE OR REPLACE FUNCTION public.admin_account_make_free_member(_uid uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  u record;
  v_member uuid;
  v_client uuid;
  v_claims text := current_setting('request.jwt.claims', true);
  v_sub text := current_setting('request.jwt.claim.sub', true);
  v_admin uuid := auth.uid();
BEGIN
  IF NOT public.has_role(v_admin, 'admin') THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT id, email, email_confirmed_at, raw_user_meta_data INTO u FROM auth.users WHERE id = _uid;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'no_user'); END IF;
  IF u.email_confirmed_at IS NULL THEN RETURN jsonb_build_object('status', 'unconfirmed'); END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _uid AND r.role::text <> 'client') THEN
    RETURN jsonb_build_object('status', 'staff');
  END IF;
  IF EXISTS (SELECT 1 FROM public.virtual_accounts v WHERE v.user_id = _uid) THEN RETURN jsonb_build_object('status', 'virtual'); END IF;
  IF EXISTS (SELECT 1 FROM public.clients c WHERE c.user_id = _uid) THEN RETURN jsonb_build_object('status', 'athlete'); END IF;
  SELECT m.id INTO v_member FROM public.app_members m WHERE m.user_id = _uid LIMIT 1;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF v_member IS NULL THEN
    INSERT INTO public.app_members (user_id, email, full_name, account_type, status, subscription_status)
    VALUES (_uid, lower(u.email),
            left(coalesce(nullif(btrim(u.raw_user_meta_data->>'full_name'), ''), split_part(u.email, '@', 1)), 120),
            'jf_member', 'Active', 'Free')
    RETURNING id INTO v_member;
  END IF;
  PERFORM public.apply_default_member_access(v_member);
  v_client := public.ensure_member_client(v_member);
  PERFORM set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  PERFORM set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  INSERT INTO public.account_sync_runs (ran_by, applied, accounts, issues, fixed)
  VALUES (v_admin, true, 1, '[]'::jsonb,
          jsonb_build_array(jsonb_build_object('issue', 'no_record', 'user_id', _uid, 'member_id', v_member, 'client_id', v_client)));
  RETURN jsonb_build_object('status', 'member', 'member_id', v_member, 'client_id', v_client);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_account_make_free_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_account_make_free_member(uuid) TO authenticated;

/** Mark an account real, test or demo ('auto' goes back to the rules). Admins only. */
CREATE OR REPLACE FUNCTION public.admin_account_set_class(_uid uuid, _class text, _note text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF _class = 'auto' THEN
    DELETE FROM public.account_classifications WHERE user_id = _uid;
    RETURN 'auto';
  END IF;
  IF _class NOT IN ('real', 'test', 'demo') THEN RAISE EXCEPTION 'Unknown class' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.account_classifications (user_id, class, note, set_by)
  VALUES (_uid, _class, left(nullif(btrim(_note), ''), 300), auth.uid())
  ON CONFLICT (user_id) DO UPDATE SET class = EXCLUDED.class, note = EXCLUDED.note, set_by = EXCLUDED.set_by, set_at = now();
  RETURN _class;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_account_set_class(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_account_set_class(uuid, text, text) TO authenticated;

/* ─────────────────────────── 4. Account view (POV) sessions ─────────────────────────── */

CREATE TABLE IF NOT EXISTS public.admin_pov_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id uuid NOT NULL,
  client_id uuid NOT NULL,
  target_user_id uuid,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 300),
  mode text NOT NULL DEFAULT 'view' CHECK (mode IN ('view', 'edit')),
  edit_until timestamptz,
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  max_until timestamptz NOT NULL,
  ended_at timestamptz,
  end_reason text,
  auth_session_id uuid
);
CREATE INDEX IF NOT EXISTS admin_pov_sessions_client_idx ON public.admin_pov_sessions (client_id, started_at DESC);
CREATE INDEX IF NOT EXISTS admin_pov_sessions_open_idx ON public.admin_pov_sessions (staff_user_id) WHERE ended_at IS NULL;
ALTER TABLE public.admin_pov_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_pov_sessions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.admin_pov_sessions TO authenticated;
DROP POLICY IF EXISTS "Admins read account views; staff their own" ON public.admin_pov_sessions;
CREATE POLICY "Admins read account views; staff their own" ON public.admin_pov_sessions FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')) OR staff_user_id = (SELECT auth.uid()));

CREATE TABLE IF NOT EXISTS public.admin_pov_events (
  id bigserial PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES public.admin_pov_sessions(id) ON DELETE CASCADE,
  at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL CHECK (kind IN ('start', 'view', 'edit_on', 'edit_off', 'write', 'blocked', 'end', 'expired')),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS admin_pov_events_session_idx ON public.admin_pov_events (session_id, at);
ALTER TABLE public.admin_pov_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_pov_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.admin_pov_events TO authenticated;
DROP POLICY IF EXISTS "Read events of readable account views" ON public.admin_pov_events;
CREATE POLICY "Read events of readable account views" ON public.admin_pov_events FOR SELECT TO authenticated
  USING (session_id IN (SELECT s.id FROM public.admin_pov_sessions s));

/**
 * Has this sign-in been confirmed with two-step in the last 30 minutes? 'ok', 'confirm' (confirm
 * again first), or 'no_two_step' (no way set up, so edits can't be switched on).
 */
CREATE OR REPLACE FUNCTION public._pov_step_up_state()
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_sid uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN 'confirm'; END IF;
  BEGIN
    v_sid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  EXCEPTION WHEN others THEN v_sid := NULL;
  END;
  IF NOT EXISTS (SELECT 1 FROM public.two_step_methods m WHERE m.user_id = v_uid AND m.removed_at IS NULL)
     AND NOT EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = v_uid AND f.status = 'verified') THEN
    RETURN 'no_two_step';
  END IF;
  IF v_sid IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.two_step_sessions t
        WHERE t.session_id = v_sid AND t.user_id = v_uid AND t.verified_at > now() - interval '30 minutes') THEN
    RETURN 'ok';
  END IF;
  RETURN 'confirm';
END;
$$;
REVOKE ALL ON FUNCTION public._pov_step_up_state() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._pov_step_up_state() TO authenticated;

/**
 * Edits in an account view need a fresh two-step confirmation unless the account is a coaching
 * client in active coaching: logging their session or fixing their program is the coach's daily
 * work. Members, archived and deactivated accounts always need it.
 */
CREATE OR REPLACE FUNCTION public._pov_needs_step_up(_client_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.clients c
     WHERE c.id = _client_id AND c.service_tier = 'coaching' AND NOT coalesce(c.archived, false)
       AND coalesce(c.status, '') NOT IN ('Deactivated', 'Deleted'))
$$;
REVOKE ALL ON FUNCTION public._pov_needs_step_up(uuid) FROM PUBLIC, anon, authenticated;

/** The state the app needs about one session. */
CREATE OR REPLACE FUNCTION public._pov_state(_s public.admin_pov_sessions)
RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT jsonb_build_object(
    'status', CASE WHEN _s.ended_at IS NULL THEN 'ok' ELSE 'ended' END,
    'id', _s.id, 'client_id', _s.client_id, 'mode', _s.mode, 'edit_until', _s.edit_until,
    'expires_at', _s.expires_at, 'max_until', _s.max_until, 'ended_at', _s.ended_at, 'end_reason', _s.end_reason)
$$;

/**
 * Start viewing an account as its person: admins any client or member record, a coach only their
 * own coaching clients. A reason is required; it starts view-only unless `_mode` is 'edit' and the
 * sign-in was confirmed in the last 30 minutes. One open view per staff member: a new one ends the
 * last. 30 minutes from the last activity, 4 hours at most.
 */
CREATE OR REPLACE FUNCTION public.admin_pov_start(_client_id uuid, _reason text, _mode text DEFAULT 'view')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_reason text := left(btrim(coalesce(_reason, '')), 300);
  v_mode text := CASE WHEN _mode = 'edit' THEN 'edit' ELSE 'view' END;
  v_target uuid;
  v_step text;
  v_sid uuid;
  s public.admin_pov_sessions;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT c.user_id INTO v_target FROM public.clients c WHERE c.id = _client_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'not_found'); END IF;
  IF NOT (public.has_role(v_uid, 'admin')
          OR (public.has_role(v_uid, 'coach') AND _client_id IN (SELECT public.coached_client_ids()))) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_reason) < 3 THEN RETURN jsonb_build_object('status', 'reason_required'); END IF;
  IF v_mode = 'edit' AND public._pov_needs_step_up(_client_id) THEN
    v_step := public._pov_step_up_state();
    IF v_step <> 'ok' THEN RETURN jsonb_build_object('status', v_step); END IF;
  END IF;
  BEGIN
    v_sid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  EXCEPTION WHEN others THEN v_sid := NULL;
  END;
  UPDATE public.admin_pov_sessions SET ended_at = now(), end_reason = 'replaced'
   WHERE staff_user_id = v_uid AND ended_at IS NULL;
  INSERT INTO public.admin_pov_sessions (staff_user_id, client_id, target_user_id, reason, mode, edit_until,
                                         expires_at, max_until, auth_session_id)
  VALUES (v_uid, _client_id, v_target, v_reason, v_mode,
          CASE WHEN v_mode = 'edit' THEN now() + interval '15 minutes' END,
          now() + interval '30 minutes', now() + interval '4 hours', v_sid)
  RETURNING * INTO s;
  INSERT INTO public.admin_pov_events (session_id, kind, detail)
  VALUES (s.id, 'start', jsonb_build_object('mode', v_mode, 'reason', v_reason));
  IF v_mode = 'edit' THEN
    INSERT INTO public.admin_pov_events (session_id, kind, detail) VALUES (s.id, 'edit_on', jsonb_build_object('reason', v_reason));
  END IF;
  RETURN public._pov_state(s);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_pov_start(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_pov_start(uuid, text, text) TO authenticated;

/** Switch edits on (a reason, and for a member's account a recent two-step confirmation) or back off. Edits last 15 minutes. */
CREATE OR REPLACE FUNCTION public.admin_pov_set_mode(_session uuid, _mode text, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_reason text := left(btrim(coalesce(_reason, '')), 300);
  v_step text;
  s public.admin_pov_sessions;
BEGIN
  SELECT * INTO s FROM public.admin_pov_sessions WHERE id = _session AND staff_user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF s.ended_at IS NOT NULL OR s.expires_at < now() OR s.max_until < now() THEN
    IF s.ended_at IS NULL THEN
      UPDATE public.admin_pov_sessions SET ended_at = now(), end_reason = 'expired' WHERE id = s.id RETURNING * INTO s;
      INSERT INTO public.admin_pov_events (session_id, kind) VALUES (s.id, 'expired');
    END IF;
    RETURN public._pov_state(s);
  END IF;
  IF _mode = 'edit' THEN
    IF char_length(v_reason) < 3 THEN RETURN jsonb_build_object('status', 'reason_required'); END IF;
    IF public._pov_needs_step_up(s.client_id) THEN
      v_step := public._pov_step_up_state();
      IF v_step <> 'ok' THEN RETURN jsonb_build_object('status', v_step); END IF;
    END IF;
    UPDATE public.admin_pov_sessions
       SET mode = 'edit', edit_until = least(now() + interval '15 minutes', max_until),
           expires_at = least(now() + interval '30 minutes', max_until)
     WHERE id = s.id RETURNING * INTO s;
    INSERT INTO public.admin_pov_events (session_id, kind, detail) VALUES (s.id, 'edit_on', jsonb_build_object('reason', v_reason));
  ELSE
    IF s.mode = 'edit' THEN
      UPDATE public.admin_pov_sessions SET mode = 'view', edit_until = NULL WHERE id = s.id RETURNING * INTO s;
      INSERT INTO public.admin_pov_events (session_id, kind, detail) VALUES (s.id, 'edit_off', '{}'::jsonb);
    END IF;
  END IF;
  RETURN public._pov_state(s);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_pov_set_mode(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_pov_set_mode(uuid, text, text) TO authenticated;

/**
 * Keep a view alive and record what was opened and changed: `_events` is up to 60 of
 * {kind: view|write|blocked, path?, method?, target?, at?}. An expired view ends here; edits that
 * ran out go back to view-only.
 */
CREATE OR REPLACE FUNCTION public.admin_pov_touch(_session uuid, _events jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  s public.admin_pov_sessions;
BEGIN
  SELECT * INTO s FROM public.admin_pov_sessions WHERE id = _session AND staff_user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(_events) = 'array' THEN
    INSERT INTO public.admin_pov_events (session_id, at, kind, detail)
    SELECT s.id,
           CASE WHEN e->>'at' ~ '^\d{4}-\d{2}-\d{2}T' THEN least(greatest((e->>'at')::timestamptz, s.started_at), now()) ELSE now() END,
           e->>'kind',
           jsonb_strip_nulls(jsonb_build_object(
             'path', left(e->>'path', 200), 'method', left(e->>'method', 10), 'target', left(e->>'target', 120)))
      FROM (SELECT e FROM jsonb_array_elements(_events) e LIMIT 60) x
     WHERE e->>'kind' IN ('view', 'write', 'blocked');
  END IF;
  IF s.ended_at IS NOT NULL THEN RETURN public._pov_state(s); END IF;
  IF s.expires_at < now() OR s.max_until < now() THEN
    UPDATE public.admin_pov_sessions SET ended_at = now(), end_reason = 'expired' WHERE id = s.id RETURNING * INTO s;
    INSERT INTO public.admin_pov_events (session_id, kind) VALUES (s.id, 'expired');
    RETURN public._pov_state(s);
  END IF;
  IF s.mode = 'edit' AND (s.edit_until IS NULL OR s.edit_until < now()) THEN
    UPDATE public.admin_pov_sessions SET mode = 'view', edit_until = NULL WHERE id = s.id;
    INSERT INTO public.admin_pov_events (session_id, kind, detail) VALUES (s.id, 'edit_off', '{"why":"timed_out"}'::jsonb);
  END IF;
  UPDATE public.admin_pov_sessions SET expires_at = least(now() + interval '30 minutes', max_until)
   WHERE id = s.id RETURNING * INTO s;
  RETURN public._pov_state(s);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_pov_touch(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_pov_touch(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_pov_end(_session uuid, _why text DEFAULT 'exit')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  s public.admin_pov_sessions;
BEGIN
  SELECT * INTO s FROM public.admin_pov_sessions WHERE id = _session AND staff_user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF s.ended_at IS NULL THEN
    UPDATE public.admin_pov_sessions SET ended_at = now(), end_reason = left(coalesce(_why, 'exit'), 40)
     WHERE id = s.id RETURNING * INTO s;
    INSERT INTO public.admin_pov_events (session_id, kind, detail) VALUES (s.id, 'end', jsonb_build_object('why', left(coalesce(_why, 'exit'), 40)));
  END IF;
  RETURN public._pov_state(s);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_pov_end(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_pov_end(uuid, text) TO authenticated;

/**
 * Who opened an account, when, why, and what they looked at and changed. Admins see every view of
 * the account; a coach only their own.
 */
CREATE OR REPLACE FUNCTION public.admin_pov_log(_client_id uuid, _limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'started_at' DESC), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
               'id', s.id, 'staff_user_id', s.staff_user_id,
               'staff_name', coalesce(nullif(btrim(co.full_name), ''), nullif(btrim(p.full_name), ''), 'Staff'),
               'reason', s.reason, 'started_at', s.started_at, 'ended_at', s.ended_at, 'end_reason', s.end_reason,
               'edited', EXISTS (SELECT 1 FROM public.admin_pov_events e WHERE e.session_id = s.id AND e.kind = 'edit_on'),
               'views', (SELECT count(*) FROM public.admin_pov_events e WHERE e.session_id = s.id AND e.kind = 'view'),
               'writes', (SELECT count(*) FROM public.admin_pov_events e WHERE e.session_id = s.id AND e.kind = 'write'),
               'events', (SELECT coalesce(jsonb_agg(jsonb_build_object('at', e.at, 'kind', e.kind, 'detail', e.detail) ORDER BY e.at), '[]'::jsonb)
                            FROM (SELECT * FROM public.admin_pov_events e2 WHERE e2.session_id = s.id ORDER BY e2.at DESC LIMIT 40) e)
             ) AS x
        FROM public.admin_pov_sessions s
        LEFT JOIN public.profiles p ON p.id = s.staff_user_id
        LEFT JOIN LATERAL (SELECT c2.full_name FROM public.coaches c2 WHERE c2.user_id = s.staff_user_id LIMIT 1) co ON true
       WHERE s.client_id = _client_id
         AND (public.has_role(auth.uid(), 'admin') OR s.staff_user_id = auth.uid())
       ORDER BY s.started_at DESC
       LIMIT least(greatest(coalesce(_limit, 20), 1), 100)
    ) q
$$;
REVOKE ALL ON FUNCTION public.admin_pov_log(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_pov_log(uuid, integer) TO authenticated;

/* ─────────────────────────── 5. Virtual accounts: management ─────────────────────────── */

INSERT INTO public.app_settings (key, value)
VALUES ('virtual_accounts', '{"automation_enabled":false,"per_post_max":2,"max_post_age_hours":36,"min_post_age_minutes":20,"include_coach_posts":false}')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.virtual_accounts_settings()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v jsonb;
BEGIN
  BEGIN
    SELECT nullif(btrim(s.value), '')::jsonb INTO v FROM public.app_settings s WHERE s.key = 'virtual_accounts';
  EXCEPTION WHEN others THEN v := NULL;
  END;
  RETURN jsonb_build_object(
    'automation_enabled', coalesce((v->>'automation_enabled')::boolean, false),
    'per_post_max', least(greatest(coalesce((v->>'per_post_max')::int, 2), 1), 5),
    'max_post_age_hours', least(greatest(coalesce((v->>'max_post_age_hours')::int, 36), 6), 96),
    'min_post_age_minutes', least(greatest(coalesce((v->>'min_post_age_minutes')::int, 20), 5), 240),
    'include_coach_posts', coalesce((v->>'include_coach_posts')::boolean, false));
END;
$$;
REVOKE ALL ON FUNCTION public.virtual_accounts_settings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.virtual_accounts_settings() TO service_role;

/** Read for the admin page. */
CREATE OR REPLACE FUNCTION public.admin_virtual_settings()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT ((SELECT public.has_role(auth.uid(), 'admin')) OR (SELECT public.is_admin_viewer())) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN public.virtual_accounts_settings();
END;
$$;
REVOKE ALL ON FUNCTION public.admin_virtual_settings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_virtual_settings() TO authenticated;

/** The global switch and the limits. Admins only; every change kept. */
CREATE OR REPLACE FUNCTION public.admin_virtual_settings_set(_patch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_now jsonb;
  v_next jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  v_now := public.virtual_accounts_settings();
  v_next := v_now || (coalesce(_patch, '{}'::jsonb) - ARRAY(SELECT k FROM jsonb_object_keys(coalesce(_patch, '{}'::jsonb)) k
                                                              WHERE k NOT IN ('automation_enabled', 'per_post_max', 'max_post_age_hours',
                                                                              'min_post_age_minutes', 'include_coach_posts')));
  INSERT INTO public.app_settings (key, value) VALUES ('virtual_accounts', v_next::text)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  INSERT INTO public.virtual_account_activity (user_id, action, actor_user_id, detail)
  VALUES (auth.uid(), 'settings', auth.uid(), jsonb_build_object('before', v_now, 'after', public.virtual_accounts_settings()));
  RETURN public.virtual_accounts_settings();
END;
$$;
REVOKE ALL ON FUNCTION public.admin_virtual_settings_set(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_virtual_settings_set(jsonb) TO authenticated;

/**
 * Create one virtual account: a login nobody can sign in to (banned, a random password, an
 * address on .invalid), a Crew profile with a username and bio, no photo, no media of any kind,
 * no athlete record, no membership row, no subscription. Admins only (or the server).
 */
CREATE OR REPLACE FUNCTION public.admin_virtual_account_create(
  _slug text, _first text, _last text, _bio text, _background text DEFAULT NULL, _disciplines text[] DEFAULT '{}')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_id uuid := gen_random_uuid();
  v_slug text := lower(btrim(coalesce(_slug, '')));
  v_email text;
  v_full text := btrim(btrim(coalesce(_first, '')) || ' ' || btrim(coalesce(_last, '')));
BEGIN
  IF v_actor IS NOT NULL AND NOT public.has_role(v_actor, 'admin') THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF v_slug !~ '^[a-z0-9._]{3,24}$' OR v_slug ~ '^[._]|[._]$|\.\.' THEN
    RAISE EXCEPTION 'Usernames are 3 to 24 letters, numbers, dots or underscores' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.community_profiles cp WHERE cp.username = v_slug)
     OR EXISTS (SELECT 1 FROM public.virtual_accounts va WHERE va.slug = v_slug) THEN
    RAISE EXCEPTION 'That username is taken' USING ERRCODE = '23505';
  END IF;
  v_email := v_slug || '@virtual.jfeffect.invalid';
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change,
                          email_change_token_current, phone_change, phone_change_token, reauthentication_token,
                          banned_until, is_sso_user, is_anonymous)
  VALUES ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
          extensions.crypt(gen_random_uuid()::text || clock_timestamp()::text, extensions.gen_salt('bf')), now(),
          jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'jf_virtual', true),
          jsonb_build_object('full_name', v_full, 'jf_virtual', true), now(), now(),
          '', '', '', '', '', '', '', '', now() + interval '100 years', false, false);
  INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
  VALUES (v_id::text, v_id, jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true), 'email', now(), now());
  INSERT INTO public.virtual_accounts (user_id, slug, first_name, last_name, background, created_by, updated_by)
  VALUES (v_id, v_slug, btrim(_first), nullif(btrim(coalesce(_last, '')), ''), nullif(btrim(coalesce(_background, '')), ''), v_actor, v_actor);
  INSERT INTO public.community_profiles (user_id, username, username_set_at, bio, disciplines, discoverable)
  VALUES (v_id, v_slug, now(), nullif(left(btrim(coalesce(_bio, '')), 150), ''),
          coalesce(ARRAY(SELECT d FROM unnest(coalesce(_disciplines, '{}')) d
                          WHERE d IN ('powerlifting', 'bodybuilding', 'strength', 'glutes', 'fitness') LIMIT 3), '{}'), false)
  ON CONFLICT (user_id) DO UPDATE
     SET username = EXCLUDED.username, username_set_at = EXCLUDED.username_set_at, bio = EXCLUDED.bio,
         disciplines = EXCLUDED.disciplines, discoverable = false, avatar_path = NULL;
  INSERT INTO public.virtual_account_activity (user_id, action, actor_user_id, detail)
  VALUES (v_id, 'created', v_actor, jsonb_build_object('slug', v_slug));
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_virtual_account_create(text, text, text, text, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_virtual_account_create(text, text, text, text, text, text[]) TO authenticated, service_role;

/**
 * Change a virtual account: its names, bio, sports, background, notes, whether it's active,
 * whether it likes posts, how many a day and its quiet hours. A photo can never be set here.
 */
CREATE OR REPLACE FUNCTION public.admin_virtual_account_update(_uid uuid, _patch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_actor uuid := auth.uid();
  va public.virtual_accounts;
  p jsonb := coalesce(_patch, '{}'::jsonb);
BEGIN
  IF NOT public.has_role(v_actor, 'admin') THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO va FROM public.virtual_accounts WHERE user_id = _uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not a virtual account' USING ERRCODE = '22023'; END IF;
  UPDATE public.virtual_accounts SET
    first_name = CASE WHEN p ? 'first_name' AND char_length(btrim(p->>'first_name')) BETWEEN 1 AND 40 THEN btrim(p->>'first_name') ELSE first_name END,
    last_name = CASE WHEN p ? 'last_name' THEN nullif(left(btrim(coalesce(p->>'last_name', '')), 40), '') ELSE last_name END,
    background = CASE WHEN p ? 'background' THEN nullif(left(btrim(coalesce(p->>'background', '')), 600), '') ELSE background END,
    notes = CASE WHEN p ? 'notes' THEN nullif(left(btrim(coalesce(p->>'notes', '')), 600), '') ELSE notes END,
    active = CASE WHEN p ? 'active' THEN (p->>'active')::boolean ELSE active END,
    likes_enabled = CASE WHEN p ? 'likes_enabled' THEN (p->>'likes_enabled')::boolean ELSE likes_enabled END,
    daily_like_limit = CASE WHEN p ? 'daily_like_limit' THEN least(greatest((p->>'daily_like_limit')::int, 0), 20) ELSE daily_like_limit END,
    quiet_start = CASE WHEN p ? 'quiet_start' THEN least(greatest((p->>'quiet_start')::int, 0), 23) ELSE quiet_start END,
    quiet_end = CASE WHEN p ? 'quiet_end' THEN least(greatest((p->>'quiet_end')::int, 0), 23) ELSE quiet_end END,
    updated_by = v_actor, updated_at = now()
  WHERE user_id = _uid;
  IF p ? 'first_name' OR p ? 'last_name' THEN
    UPDATE public.profiles pr SET full_name = btrim(v.first_name || coalesce(' ' || v.last_name, ''))
      FROM public.virtual_accounts v WHERE v.user_id = _uid AND pr.id = _uid;
  END IF;
  IF p ? 'bio' OR p ? 'disciplines' THEN
    UPDATE public.community_profiles SET
      bio = CASE WHEN p ? 'bio' THEN nullif(left(btrim(coalesce(p->>'bio', '')), 150), '') ELSE bio END,
      disciplines = CASE WHEN p ? 'disciplines' AND jsonb_typeof(p->'disciplines') = 'array'
                         THEN coalesce(ARRAY(SELECT d FROM jsonb_array_elements_text(p->'disciplines') d
                                              WHERE d IN ('powerlifting', 'bodybuilding', 'strength', 'glutes', 'fitness') LIMIT 3), '{}')
                         ELSE disciplines END,
      avatar_path = NULL,
      updated_at = now()
     WHERE user_id = _uid;
  END IF;
  INSERT INTO public.virtual_account_activity (user_id, action, actor_user_id, detail)
  VALUES (_uid,
          CASE WHEN p ? 'active' AND (p->>'active')::boolean IS DISTINCT FROM va.active
                 THEN CASE WHEN (p->>'active')::boolean THEN 'activated' ELSE 'deactivated' END
               WHEN p ? 'likes_enabled' AND (p->>'likes_enabled')::boolean IS DISTINCT FROM va.likes_enabled
                 THEN CASE WHEN (p->>'likes_enabled')::boolean THEN 'likes_on' ELSE 'likes_off' END
               ELSE 'updated' END,
          v_actor, jsonb_build_object('patch', p));
  SELECT * INTO va FROM public.virtual_accounts WHERE user_id = _uid;
  RETURN to_jsonb(va);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_virtual_account_update(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_virtual_account_update(uuid, jsonb) TO authenticated;

/** Take back every like a virtual account gave (kept in the activity log). Admins only. */
CREATE OR REPLACE FUNCTION public.admin_virtual_account_clear_likes(_uid uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  n integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.virtual_accounts WHERE user_id = _uid) THEN
    RAISE EXCEPTION 'Not a virtual account' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.community_reactions WHERE user_id = _uid;
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO public.virtual_account_activity (user_id, action, actor_user_id, detail)
  VALUES (_uid, 'likes_cleared', auth.uid(), jsonb_build_object('removed', n));
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_virtual_account_clear_likes(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_virtual_account_clear_likes(uuid) TO authenticated;

/** The admin page: every virtual account with its counts. */
CREATE OR REPLACE FUNCTION public.admin_virtual_accounts()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT ((SELECT public.has_role(auth.uid(), 'admin')) OR (SELECT public.is_admin_viewer())) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'user_id', va.user_id, 'slug', va.slug, 'first_name', va.first_name, 'last_name', va.last_name,
             'background', va.background, 'notes', va.notes, 'active', va.active, 'likes_enabled', va.likes_enabled,
             'daily_like_limit', va.daily_like_limit, 'quiet_start', va.quiet_start, 'quiet_end', va.quiet_end,
             'bio', cp.bio, 'disciplines', to_jsonb(coalesce(cp.disciplines, '{}')), 'username', cp.username,
             'created_at', va.created_at,
             'likes_24h', (SELECT count(*) FROM public.virtual_account_activity a
                            WHERE a.user_id = va.user_id AND a.action = 'like' AND a.created_at > now() - interval '24 hours'),
             'likes_total', (SELECT count(*) FROM public.community_reactions r WHERE r.user_id = va.user_id),
             'followers', (SELECT count(*) FROM public.community_follows f WHERE f.followee_id = va.user_id),
             'last_like_at', (SELECT max(a.created_at) FROM public.virtual_account_activity a WHERE a.user_id = va.user_id AND a.action = 'like')
           ) ORDER BY va.created_at), '[]'::jsonb)
      FROM public.virtual_accounts va
      LEFT JOIN public.community_profiles cp ON cp.user_id = va.user_id
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_virtual_accounts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_virtual_accounts() TO authenticated;

/* ─────────────────────────── 6. Virtual accounts: the like automation ─────────────────────────── */

/**
 * Every 20 minutes: while the global switch is on, each active virtual account with likes on may
 * like one recent crew-wide post by a real person (never a virtual account's, a story, an
 * automatic workout card, a followers-only or Close Friends post, a post whose author blocked it,
 * or one that already has the most virtual likes a post may get), outside its quiet hours
 * (Winnipeg), at most its daily limit and one an account per 45 minutes, by chance so it doesn't
 * run like a clock. Each like is kept in the activity log; a like is never a notification.
 */
CREATE OR REPLACE FUNCTION public.virtual_accounts_tick()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  s jsonb := public.virtual_accounts_settings();
  v record;
  v_hour integer;
  v_post uuid;
  v_n integer := 0;
  v_quiet boolean;
BEGIN
  IF NOT (s->>'automation_enabled')::boolean THEN RETURN 0; END IF;
  v_hour := extract(hour FROM public.instant_to_local(now(), 'America/Winnipeg'))::int;
  FOR v IN SELECT * FROM public.virtual_accounts WHERE active AND likes_enabled AND daily_like_limit > 0 ORDER BY random() LOOP
    v_quiet := CASE
      WHEN v.quiet_start = v.quiet_end THEN false
      WHEN v.quiet_start > v.quiet_end THEN v_hour >= v.quiet_start OR v_hour < v.quiet_end
      ELSE v_hour >= v.quiet_start AND v_hour < v.quiet_end END;
    CONTINUE WHEN v_quiet;
    CONTINUE WHEN (SELECT count(*) FROM public.virtual_account_activity a
                    WHERE a.user_id = v.user_id AND a.action = 'like' AND a.actor_user_id IS NULL
                      AND a.created_at > now() - interval '24 hours') >= v.daily_like_limit;
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.virtual_account_activity a
                           WHERE a.user_id = v.user_id AND a.action = 'like' AND a.created_at > now() - interval '45 minutes');
    CONTINUE WHEN random() > least(1.0, v.daily_like_limit::numeric / 40.0);
    SELECT p.id INTO v_post
      FROM public.community_posts p
     WHERE p.archived_at IS NULL
       AND p.visibility = 'community'
       AND NOT coalesce(p.story_only, false)
       AND NOT coalesce(p.auto_shared, false)
       AND p.author_user_id IS NOT NULL
       AND p.created_at > now() - make_interval(hours => (s->>'max_post_age_hours')::int)
       AND p.created_at < now() - make_interval(mins => (s->>'min_post_age_minutes')::int)
       AND NOT EXISTS (SELECT 1 FROM public.virtual_accounts va WHERE va.user_id = p.author_user_id)
       AND ((s->>'include_coach_posts')::boolean
            OR (p.series IS NULL AND p.author_user_id NOT IN (SELECT x FROM public.community_staff_people() x WHERE x IS NOT NULL)))
       AND NOT EXISTS (SELECT 1 FROM public.community_reactions r WHERE r.post_id = p.id AND r.user_id = v.user_id)
       AND (SELECT count(*) FROM public.community_reactions r JOIN public.virtual_accounts va ON va.user_id = r.user_id
             WHERE r.post_id = p.id) < (s->>'per_post_max')::int
       AND NOT public.chat_has_blocked(p.author_user_id, v.user_id)
     ORDER BY random()
     LIMIT 1;
    CONTINUE WHEN v_post IS NULL;
    INSERT INTO public.community_reactions (post_id, user_id, emoji) VALUES (v_post, v.user_id, 'heart')
    ON CONFLICT DO NOTHING;
    IF FOUND THEN
      INSERT INTO public.virtual_account_activity (user_id, action, post_id, detail)
      VALUES (v.user_id, 'like', v_post, '{"by":"automation"}'::jsonb);
      v_n := v_n + 1;
    END IF;
  END LOOP;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.virtual_accounts_tick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.virtual_accounts_tick() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.unschedule(j.jobid) FROM cron.job j WHERE j.jobname = 'virtual-accounts-tick';
    PERFORM cron.schedule('virtual-accounts-tick', '*/20 * * * *', $cron$SELECT public.virtual_accounts_tick()$cron$);
  END IF;
END $$;

/* ─────────────────────────── 7. Keeping virtual activity out of what's measured ─────────────────────────── */

-- A virtual account's like never notifies anyone.
CREATE OR REPLACE FUNCTION public.community_notify_on_reaction()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_author uuid;
BEGIN
  IF current_setting('jf.likes_merging', true) = 'on' THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM public.virtual_accounts va
              WHERE va.user_id = CASE WHEN TG_OP = 'DELETE' THEN OLD.user_id ELSE NEW.user_id END) THEN
    RETURN NULL;
  END IF;
  BEGIN
    IF TG_OP = 'DELETE' THEN
      DELETE FROM public.community_notifications n
       WHERE n.kind = 'reaction' AND n.post_id = OLD.post_id AND n.actor_user_id = public.community_main_account(OLD.user_id);
      RETURN NULL;
    END IF;
    UPDATE public.community_notifications n SET emoji = NEW.emoji
     WHERE n.kind = 'reaction' AND n.post_id = NEW.post_id AND n.actor_user_id = public.community_main_account(NEW.user_id);
    IF NOT FOUND THEN
      PERFORM public.community_fill_win_label(NEW.post_id);
      SELECT p.author_user_id INTO v_author FROM public.community_posts p WHERE p.id = NEW.post_id;
      PERFORM public.community_notify(v_author, NEW.user_id, 'reaction', NEW.post_id, NULL, NEW.emoji);
    END IF;
  EXCEPTION WHEN others THEN
    RAISE WARNING 'community_notify_on_reaction: %', sqlerrm;
  END;
  RETURN NULL;
END;
$function$;

-- Business analytics count people: never a virtual account.
CREATE OR REPLACE FUNCTION public.bi_people()
 RETURNS TABLE(user_id uuid, created_at timestamp with time zone, tier text, client_id uuid, archived boolean, ended_at timestamp with time zone, name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH staff AS (
    SELECT r.user_id FROM public.user_roles r WHERE r.role::text <> 'client'
    UNION SELECT s.u FROM public.community_staff_people() s(u)
    UNION SELECT va.user_id FROM public.virtual_accounts va
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
$function$;

-- Post scores: a virtual account is never the audience or the engagement (same as a coach).
DO $patch$
DECLARE
  d text;
  v_from constant text := 'SELECT s AS user_id FROM public.community_staff_people() s WHERE s IS NOT NULL';
  v_to constant text := 'SELECT s AS user_id FROM public.community_staff_people() s WHERE s IS NOT NULL UNION SELECT va.user_id FROM public.virtual_accounts va';
BEGIN
  IF to_regprocedure('public.community_post_scores(uuid[], integer)') IS NULL THEN RETURN; END IF;
  d := pg_get_functiondef('public.community_post_scores(uuid[], integer)'::regprocedure);
  IF position('virtual_accounts' IN d) > 0 THEN RETURN; END IF;
  IF position(v_from IN d) = 0 THEN
    RAISE WARNING 'community_post_scores: staff set not found; virtual accounts not excluded';
    RETURN;
  END IF;
  EXECUTE replace(d, v_from, v_to);
END
$patch$;
