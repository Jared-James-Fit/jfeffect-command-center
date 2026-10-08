-- Community opens to members, with report, hide and block first.
--
-- 1. Moderation (Apple guideline 1.2 for user-generated content):
--    * report a post or comment (reason + optional note). Reporting also hides
--      it for the reporter, raises a Support Alert, and lands in the staff
--      queue (community_open_reports / community_resolve_report);
--    * hide a post for yourself;
--    * block a person: their posts and comments disappear for you and yours
--      for them, in both directions, including linked accounts.
--    Tables are reachable only through these functions, like the rest of
--    community.
-- 2. Access: can_view_community() admits members whose membership grants the
--    'community' access key (member_access / member_has_access), on top of
--    coaching clients and staff. 'community' is already in the JF Membership
--    and App Member defaults, so applying this opens the community to them.
--
-- community_feed / community_comments / community_post are their latest
-- definitions verbatim plus the hide/block filters.

CREATE TABLE IF NOT EXISTS public.community_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- SET NULL, not CASCADE: a report outlives the content it got removed.
  target_type text NOT NULL CHECK (target_type IN ('post', 'comment')),
  post_id uuid REFERENCES public.community_posts(id) ON DELETE SET NULL,
  comment_id uuid REFERENCES public.community_comments(id) ON DELETE SET NULL,
  reason text NOT NULL CHECK (reason IN ('spam', 'harassment', 'hate', 'sexual', 'violence', 'self_harm', 'other')),
  details text CHECK (details IS NULL OR char_length(details) <= 1000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'removed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  handled_by uuid,
  handled_at timestamptz,
  CHECK (NOT (post_id IS NOT NULL AND comment_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS community_reports_once_per_reporter
  ON public.community_reports (reporter_user_id, coalesce(post_id, comment_id))
  WHERE post_id IS NOT NULL OR comment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS community_reports_open ON public.community_reports (created_at) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS public.community_hidden_posts (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
);

CREATE TABLE IF NOT EXISTS public.community_blocks (
  blocker_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_user_id, blocked_user_id),
  CHECK (blocker_user_id <> blocked_user_id)
);

ALTER TABLE public.community_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_hidden_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_blocks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_reports, public.community_hidden_posts, public.community_blocks FROM anon, authenticated;
GRANT ALL ON public.community_reports, public.community_hidden_posts, public.community_blocks TO service_role;

-- True when either person (or a linked account of theirs) blocked the other.
CREATE OR REPLACE FUNCTION public.community_blocked_between(_a uuid, _b uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _a IS NOT NULL AND _b IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.community_blocks k
     WHERE (k.blocker_user_id IN (_a, public.community_main_account(_a)) AND k.blocked_user_id IN (_b, public.community_main_account(_b)))
        OR (k.blocker_user_id IN (_b, public.community_main_account(_b)) AND k.blocked_user_id IN (_a, public.community_main_account(_a))))
$$;
REVOKE ALL ON FUNCTION public.community_blocked_between(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Members with the 'community' access key, alongside coaching clients and staff.
CREATE OR REPLACE FUNCTION public.can_view_community()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND (
    public.is_community_staff()
    OR EXISTS (
      SELECT 1 FROM public.clients c
       WHERE c.user_id = auth.uid()
         AND coalesce(c.archived, false) = false
         AND c.archived_at IS NULL
         AND coalesce(c.status, '') <> 'Archived'
         AND coalesce(c.portal_access_disabled, false) = false
         AND c.athlete_kind = 'coaching')
    OR EXISTS (
      SELECT 1 FROM public.app_members m
       WHERE m.user_id = auth.uid()
         AND NOT coalesce(m.is_admin_sandbox, false)
         AND public.member_has_access(m.id, 'community')))
$$;

CREATE OR REPLACE FUNCTION public.community_report(_post_id uuid, _comment_id uuid, _reason text, _details text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  v_post uuid := _post_id;
BEGIN
  IF uid IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF (_post_id IS NULL) = (_comment_id IS NULL) THEN RAISE EXCEPTION 'Report a post or a comment'; END IF;
  IF _comment_id IS NOT NULL THEN
    SELECT post_id INTO v_post FROM public.community_comments WHERE id = _comment_id;
    IF v_post IS NULL THEN RAISE EXCEPTION 'Comment not found'; END IF;
  END IF;
  INSERT INTO public.community_reports (reporter_user_id, target_type, post_id, comment_id, reason, details)
  VALUES (uid, CASE WHEN _post_id IS NOT NULL THEN 'post' ELSE 'comment' END,
          _post_id, _comment_id, _reason, nullif(btrim(coalesce(_details, '')), ''))
  ON CONFLICT DO NOTHING;
  -- What you report, you stop seeing.
  IF _post_id IS NOT NULL THEN
    INSERT INTO public.community_hidden_posts (user_id, post_id) VALUES (uid, _post_id) ON CONFLICT DO NOTHING;
  END IF;
  INSERT INTO public.support_alerts (error_type, error_message, page_route, details, status)
  VALUES ('community_report', 'Community ' || CASE WHEN _post_id IS NOT NULL THEN 'post' ELSE 'comment' END || ' reported: ' || _reason,
          '/admin/community', jsonb_build_object('post_id', v_post, 'comment_id', _comment_id, 'reason', _reason), 'open');
END;
$$;

CREATE OR REPLACE FUNCTION public.community_hide_post(_post_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.community_hidden_posts (user_id, post_id) VALUES (auth.uid(), _post_id) ON CONFLICT DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.community_block_user(_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  target uuid := public.community_main_account(_user_id);
BEGIN
  IF uid IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF target IS NULL OR target = public.community_main_account(uid) THEN RAISE EXCEPTION 'You can''t block yourself'; END IF;
  INSERT INTO public.community_blocks (blocker_user_id, blocked_user_id) VALUES (uid, target) ON CONFLICT DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.community_unblock_user(_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  DELETE FROM public.community_blocks
   WHERE blocker_user_id = auth.uid() AND blocked_user_id IN (_user_id, public.community_main_account(_user_id));
END;
$$;

CREATE OR REPLACE FUNCTION public.community_my_blocks()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(public.community_author(k.blocked_user_id) ORDER BY k.created_at DESC), '[]'::jsonb)
    FROM public.community_blocks k WHERE k.blocker_user_id = auth.uid()
$$;

-- Staff queue.
CREATE OR REPLACE FUNCTION public.community_open_reports()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'id', r.id, 'reason', r.reason, 'details', r.details, 'created_at', r.created_at,
             'post_id', coalesce(r.post_id, c.post_id), 'comment_id', r.comment_id,
             'comment_body', c.body,
             'post_caption', p.caption,
             'author', public.community_author(coalesce(c.author_user_id, p.author_user_id)),
             'reporter', public.community_author(r.reporter_user_id),
             'reports', (SELECT count(*) FROM public.community_reports r2
                          WHERE r2.status = 'open' AND coalesce(r2.post_id, r2.comment_id) = coalesce(r.post_id, r.comment_id)))
           ORDER BY r.created_at)
      FROM public.community_reports r
      LEFT JOIN public.community_comments c ON c.id = r.comment_id
      LEFT JOIN public.community_posts p ON p.id = coalesce(r.post_id, c.post_id)
     WHERE r.status = 'open' AND (r.post_id IS NOT NULL OR r.comment_id IS NOT NULL)), '[]'::jsonb);
END;
$$;

-- 'dismiss' keeps the content; 'remove' deletes the post or comment for
-- everyone. Either way every open report on the same item is closed.
CREATE OR REPLACE FUNCTION public.community_resolve_report(_report_id uuid, _action text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
BEGIN
  IF NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF _action NOT IN ('dismiss', 'remove') THEN RAISE EXCEPTION 'Unknown action'; END IF;
  SELECT * INTO r FROM public.community_reports WHERE id = _report_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Report not found'; END IF;
  UPDATE public.community_reports
     SET status = CASE WHEN _action = 'remove' THEN 'removed' ELSE 'dismissed' END,
         handled_by = auth.uid(), handled_at = now()
   WHERE status = 'open' AND coalesce(post_id, comment_id) = coalesce(r.post_id, r.comment_id);
  IF _action = 'remove' THEN
    IF r.comment_id IS NOT NULL THEN
      DELETE FROM public.community_comments WHERE id = r.comment_id;
    ELSE
      DELETE FROM public.community_posts WHERE id = r.post_id;
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.community_report(uuid, uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.community_hide_post(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.community_block_user(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.community_unblock_user(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.community_my_blocks() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.community_open_reports() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.community_resolve_report(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_report(uuid, uuid, text, text), public.community_hide_post(uuid),
  public.community_block_user(uuid), public.community_unblock_user(uuid), public.community_my_blocks(),
  public.community_open_reports(), public.community_resolve_report(uuid, text) TO authenticated;

-- community_feed: from from 20261009090000_community_edit_archive.sql
CREATE OR REPLACE FUNCTION public.community_feed(_limit integer DEFAULT 10, _before_at timestamp with time zone DEFAULT NULL::timestamp with time zone, _before_id uuid DEFAULT NULL::uuid, _author_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  lim int := least(greatest(coalesce(_limit, 10), 1), 30);
  result jsonb;
BEGIN
  IF NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  WITH page AS (
    SELECT p.id, p.created_at FROM public.community_posts p
     WHERE (p.visibility = 'community'
            OR (p.visibility = 'coach' AND p.author_user_id <> uid AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id))
            OR (p.author_user_id = uid AND _author_user_id = uid))
       AND p.archived_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.community_hidden_posts h WHERE h.user_id = uid AND h.post_id = p.id)
       AND NOT public.community_blocked_between(uid, p.author_user_id)
       AND (_author_user_id IS NULL OR p.author_user_id = _author_user_id)
       AND (_before_at IS NULL OR (p.created_at, p.id) < (_before_at, coalesce(_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
     ORDER BY p.created_at DESC, p.id DESC
     LIMIT lim + 1
  ),
  numbered AS (SELECT page.*, row_number() OVER (ORDER BY page.created_at DESC, page.id DESC) rn FROM page)
  SELECT jsonb_build_object(
           'posts', coalesce((SELECT jsonb_agg(public.community_post_json(n.id, uid) ORDER BY n.rn) FROM numbered n WHERE n.rn <= lim), '[]'::jsonb),
           'has_more', (SELECT count(*) FROM page) > lim)
    INTO result;
  RETURN result;
END;
$function$;

-- community_comments: from from 20261007150000_community_audience.sql
CREATE OR REPLACE FUNCTION public.community_comments(_post_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  v_owner uuid;
BEGIN
  IF uid IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT p.author_user_id INTO v_owner FROM public.community_posts p
   WHERE p.id = _post_id AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id);
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Post not found'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'id', c.id, 'body', c.body, 'created_at', c.created_at,
             'author', public.community_author(c.author_user_id),
             'can_delete', (c.author_user_id = uid OR v_owner = uid OR public.is_community_staff()))
           ORDER BY c.created_at)
      FROM (SELECT * FROM public.community_comments WHERE post_id = _post_id
              AND NOT public.community_blocked_between(uid, author_user_id)
            ORDER BY created_at LIMIT 100) c
  ), '[]'::jsonb);
END;
$$;

-- community_post: from from 20261008090000_community_coach_posts.sql
CREATE OR REPLACE FUNCTION public.community_post(_post_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  v_completion uuid;
  v_hide boolean;
  v_found boolean := false;
BEGIN
  IF NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT true, p.completion_id, p.hide_loads AND p.author_user_id <> uid INTO v_found, v_completion, v_hide FROM public.community_posts p
   WHERE p.id = _post_id AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id)
     AND NOT public.community_blocked_between(uid, p.author_user_id);
  IF NOT coalesce(v_found, false) THEN RAISE EXCEPTION 'Post not found'; END IF;
  RETURN public.community_post_json(_post_id, uid)
         || jsonb_build_object('exercises', CASE WHEN v_completion IS NULL THEN '[]'::jsonb WHEN v_hide THEN public.community_hide_exercise_loads(public.community_workout_exercises(v_completion))
                                                ELSE public.community_workout_exercises(v_completion) END);
END;
$$;
