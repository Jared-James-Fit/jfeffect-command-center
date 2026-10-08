-- Community sharing: optional, intentional posts about a finished workout.
--
-- Design rules
--   * A post REFERENCES the canonical completion (pl_day_completions.id). It
--     stores only social data: author, caption, media, visibility, timestamps.
--     Every workout number (duration, sets, PRs, top lift) is derived on read
--     from the same sources the recap uses, so edits / reopened workouts can
--     never leave a stale number on a post.
--   * One post per completion (unique) → idempotent re-saves, no duplicates.
--   * Nothing is auto-published. Rows are only written by community_save_post,
--     which derives author + client from the completion (never trusts the
--     caller) and refuses anyone but the athlete who finished it — including a
--     coach in "View as client" mode.
--   * Visibility: 'community' (all active clients + coaches) or 'private'
--     (only the author). Private posts are never returned to anyone else,
--     staff included, and their media is not readable by anyone else either.
--   * Reactions: one per person per post, from a fixed set. No totals per
--     person, no ranking, no XP.
--   * Coach recognition = reactions / comments from admin or coach roles,
--     flagged at read time (never stored, so role changes stay honest).

-- ── Access helpers ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_community_staff()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL
     AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'coach'))
$$;

-- Same population the Performance League already shows to each other:
-- active (non-archived) clients, plus coaching staff.
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
         AND coalesce(c.portal_access_disabled, false) = false))
$$;

REVOKE ALL ON FUNCTION public.is_community_staff() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_view_community() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_community_staff() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_view_community() TO authenticated, service_role;

-- ── Tables ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.community_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  completion_id uuid NOT NULL REFERENCES public.pl_day_completions(id) ON DELETE CASCADE,
  caption text CHECK (caption IS NULL OR char_length(caption) <= 280),
  media_path text,
  media_thumb_path text,
  media_type text CHECK (media_type IN ('image', 'video')),
  media_width integer,
  media_height integer,
  visibility text NOT NULL DEFAULT 'community' CHECK (visibility IN ('community', 'private')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT community_posts_media_consistent CHECK ((media_path IS NULL) = (media_type IS NULL)),
  CONSTRAINT community_posts_one_per_completion UNIQUE (completion_id)
);
CREATE INDEX IF NOT EXISTS community_posts_feed_idx
  ON public.community_posts (created_at DESC, id DESC) WHERE visibility = 'community';
CREATE INDEX IF NOT EXISTS community_posts_author_idx
  ON public.community_posts (author_user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS community_posts_media_idx
  ON public.community_posts (media_path) WHERE media_path IS NOT NULL;
CREATE INDEX IF NOT EXISTS community_posts_thumb_idx
  ON public.community_posts (media_thumb_path) WHERE media_thumb_path IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.community_reactions (
  post_id uuid NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji text NOT NULL CHECK (emoji IN ('fire', 'muscle', 'clap', 'heart')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.community_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  author_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 300),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS community_comments_post_idx
  ON public.community_comments (post_id, created_at);

ALTER TABLE public.community_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_comments ENABLE ROW LEVEL SECURITY;
-- Explicit, least-privilege grants (don't lean on the project's default
-- privileges). People can read + delete their own posts via RLS; everything
-- else (create / edit / react / comment) is RPC-only.
REVOKE ALL ON public.community_posts, public.community_reactions, public.community_comments FROM anon, authenticated;
GRANT SELECT, DELETE ON public.community_posts TO authenticated;
GRANT ALL ON public.community_posts, public.community_reactions, public.community_comments TO service_role;

-- Reads of a post: its author, or anyone allowed in the community when the
-- post is shared. Writes go through the RPCs below; the only direct write a
-- person may do is delete (own post; coaches/admins moderate).
DROP POLICY IF EXISTS community_posts_select ON public.community_posts;
CREATE POLICY community_posts_select ON public.community_posts FOR SELECT TO authenticated
  USING (author_user_id = auth.uid() OR (visibility = 'community' AND public.can_view_community()));
DROP POLICY IF EXISTS community_posts_delete ON public.community_posts;
CREATE POLICY community_posts_delete ON public.community_posts FOR DELETE TO authenticated
  USING (author_user_id = auth.uid() OR public.is_community_staff());
-- Reactions / comments: no direct policies → RPC only.

-- ── Display helpers (no table access for callers) ───────────────────────────
-- Athletes: first name (their preferred name when set) + avatar. Staff: first
-- name + is_coach so the UI can mark "Coach". Same avatar source the League uses.
CREATE OR REPLACE FUNCTION public.community_author(_user_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN public.has_role(_user_id, 'admin') OR public.has_role(_user_id, 'coach') THEN
      jsonb_build_object(
        'user_id', _user_id,
        'is_coach', true,
        'name', coalesce(
          nullif(btrim(co.first_name), ''),
          nullif(split_part(btrim(coalesce(co.full_name, p.full_name, '')), ' ', 1), ''),
          'Coach'),
        'avatar_url', coalesce(co.profile_picture_url, p.avatar_url))
    ELSE
      jsonb_build_object(
        'user_id', _user_id,
        'is_coach', false,
        'name', coalesce(
          nullif(btrim(c.preferred_name), ''),
          nullif(btrim(c.first_name), ''),
          nullif(split_part(btrim(coalesce(c.full_name, p.full_name, '')), ' ', 1), ''),
          'Athlete'),
        'avatar_url', coalesce(c.profile_picture_url, p.avatar_url))
  END
  FROM (SELECT 1) one
  LEFT JOIN public.profiles p ON p.id = _user_id
  LEFT JOIN public.coaches co ON co.user_id = _user_id
  LEFT JOIN public.clients c ON c.user_id = _user_id
$$;
REVOKE ALL ON FUNCTION public.community_author(uuid) FROM PUBLIC, anon, authenticated;

-- ── Workout stats, derived live from the canonical records ─────────────────
-- Internal only. Mirrors the recap: same qualifying-set rule (completed,
-- external load, not a warm-up) and the same ATPR / PROGRAM / BLOCK record
-- functions, so a post can never disagree with the athlete's own recap.
--   top_lift  = best set (highest estimated 1RM) of the FIRST programmed
--               exercise that has a qualifying set — the session's primary lift.
--   pr_count  = lifts that earned any record this workout (a lift that set a
--               rep record AND a weight record counts once).
CREATE OR REPLACE FUNCTION public.community_workout_stats(_completion_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pc record;
  k text;
  v_title text;
  v_working int := 0;
  v_tonnage numeric := 0;
  v_top jsonb;
  v_prs jsonb := '[]'::jsonb;
  v_pr_count int := 0;
BEGIN
  SELECT * INTO pc FROM public.pl_day_completions WHERE id = _completion_id AND completed_at IS NOT NULL;
  IF pc.id IS NULL THEN RETURN NULL; END IF;
  k := CASE WHEN pc.scheduled_workout_id IS NOT NULL THEN 'sw:' || pc.scheduled_workout_id ELSE 'day:' || pc.day_id END;

  SELECT coalesce(nullif(btrim(d.title), ''), nullif(btrim(d.focus), ''), 'Workout')
    INTO v_title FROM public.pl_days d WHERE d.id = pc.day_id;

  SELECT count(*)::int INTO v_working
    FROM public.pl_row_results r
    JOIN public.pl_exercise_rows e ON e.id = r.row_id
   WHERE r.client_id = pc.client_id
     AND r.completed_at IS NOT NULL
     AND coalesce(r.is_working_set, true)
     AND ((pc.scheduled_workout_id IS NOT NULL AND r.scheduled_workout_id = pc.scheduled_workout_id)
       OR (pc.scheduled_workout_id IS NULL AND r.scheduled_workout_id IS NULL AND e.day_id = pc.day_id));

  SELECT coalesce(round(sum(s.load_kg * s.reps), 1), 0) INTO v_tonnage
    FROM public.client_qualifying_sets(pc.client_id) s WHERE s.workout_key = k;

  SELECT jsonb_build_object('exercise_name', t.exercise_name, 'reps', t.reps, 'load_kg', t.load_kg)
    INTO v_top
    FROM (
      SELECT s.exercise_name, s.reps, s.load_kg
        FROM public.client_qualifying_sets(pc.client_id) s
        JOIN public.pl_row_results r ON r.id = s.set_id
        JOIN public.pl_exercise_rows e ON e.id = r.row_id
       WHERE s.workout_key = k
       ORDER BY e.sort_order ASC, (s.load_kg * (1 + s.reps / 30.0)) DESC, s.load_kg DESC
       LIMIT 1) t;

  WITH rec AS (
    SELECT x.exercise_key, x.exercise_name, x.reps, x.load_kg,
           CASE WHEN x.is_atpr THEN 3 WHEN x.is_program_pr THEN 2 WHEN x.is_block_pr THEN 1 ELSE 0 END AS tier
      FROM public.client_rep_records(pc.client_id) x
     WHERE x.workout_key = k AND (x.is_atpr OR x.is_program_pr OR x.is_block_pr)
    UNION ALL
    SELECT y.exercise_key, y.exercise_name, y.reps, y.load_kg,
           CASE WHEN y.is_atpr THEN 3 WHEN y.is_program_pr THEN 2 WHEN y.is_block_pr THEN 1 ELSE 0 END
      FROM public.client_load_records(pc.client_id) y
     WHERE y.workout_key = k AND (y.is_atpr OR y.is_program_pr OR y.is_block_pr)
  ),
  per_lift AS (
    SELECT DISTINCT ON (exercise_key) exercise_key, exercise_name, reps, load_kg, tier
      FROM rec ORDER BY exercise_key, tier DESC, load_kg DESC, reps DESC
  )
  SELECT (SELECT count(*) FROM per_lift)::int,
         coalesce((SELECT jsonb_agg(jsonb_build_object(
                     'exercise_name', q.exercise_name, 'reps', q.reps, 'load_kg', q.load_kg,
                     'scope', CASE q.tier WHEN 3 THEN 'atpr' WHEN 2 THEN 'program_pr' ELSE 'block_pr' END)
                   ORDER BY q.tier DESC, q.load_kg DESC)
                     FROM (SELECT * FROM per_lift ORDER BY tier DESC, load_kg DESC LIMIT 3) q), '[]'::jsonb)
    INTO v_pr_count, v_prs;

  RETURN jsonb_build_object(
    'workout_title', v_title,
    'completed_at', pc.completed_at,
    'duration_min', nullif(pc.actual_duration_min, 0),
    'working_sets', v_working,
    'tonnage_kg', v_tonnage,
    'top_lift', v_top,
    'pr_count', v_pr_count,
    'prs', v_prs);
END;
$$;
REVOKE ALL ON FUNCTION public.community_workout_stats(uuid) FROM PUBLIC, anon, authenticated;

-- Composer: the athlete's own finished workout, in the shape a post shows.
CREATE OR REPLACE FUNCTION public.community_completion_preview(_completion_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.pl_day_completions pc JOIN public.clients c ON c.id = pc.client_id
     WHERE pc.id = _completion_id AND c.user_id = auth.uid() AND pc.completed_at IS NOT NULL
  ) THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  RETURN public.community_workout_stats(_completion_id);
END;
$$;
REVOKE ALL ON FUNCTION public.community_completion_preview(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_completion_preview(uuid) TO authenticated;

-- ── Create / update the post for a completion ──────────────────────────────
-- _media_action: 'keep' (default) leaves media untouched, 'set' replaces it
-- with the supplied paths, 'remove' clears it. Safe to call repeatedly.
CREATE OR REPLACE FUNCTION public.community_save_post(
  _completion_id uuid,
  _caption text DEFAULT NULL,
  _visibility text DEFAULT 'community',
  _media_action text DEFAULT 'keep',
  _media_path text DEFAULT NULL,
  _media_thumb_path text DEFAULT NULL,
  _media_type text DEFAULT NULL,
  _media_width int DEFAULT NULL,
  _media_height int DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  v_client uuid;
  v_cap text := nullif(btrim(coalesce(_caption, '')), '');
  v_id uuid;
  v_prefix text := uid::text || '/';
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF _visibility NOT IN ('community', 'private') THEN RAISE EXCEPTION 'Invalid visibility'; END IF;
  IF _media_action NOT IN ('keep', 'set', 'remove') THEN RAISE EXCEPTION 'Invalid media action'; END IF;
  IF v_cap IS NOT NULL AND char_length(v_cap) > 280 THEN RAISE EXCEPTION 'Caption too long'; END IF;

  -- Author and client come from the completion, never from the caller.
  SELECT pc.client_id INTO v_client
    FROM public.pl_day_completions pc JOIN public.clients c ON c.id = pc.client_id
   WHERE pc.id = _completion_id AND pc.completed_at IS NOT NULL AND c.user_id = uid;
  IF v_client IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF _visibility = 'community' AND NOT public.can_view_community() THEN
    RAISE EXCEPTION 'Community is not available on this account' USING ERRCODE = '42501';
  END IF;

  IF _media_action = 'set' THEN
    IF _media_type NOT IN ('image', 'video') OR _media_path IS NULL
       OR left(_media_path, length(v_prefix)) <> v_prefix
       OR (_media_thumb_path IS NOT NULL AND left(_media_thumb_path, length(v_prefix)) <> v_prefix) THEN
      RAISE EXCEPTION 'Invalid media';
    END IF;
  END IF;

  INSERT INTO public.community_posts AS p (
    author_user_id, client_id, completion_id, caption, visibility,
    media_path, media_thumb_path, media_type, media_width, media_height)
  VALUES (
    uid, v_client, _completion_id, v_cap, _visibility,
    CASE WHEN _media_action = 'set' THEN _media_path END,
    CASE WHEN _media_action = 'set' THEN _media_thumb_path END,
    CASE WHEN _media_action = 'set' THEN _media_type END,
    CASE WHEN _media_action = 'set' THEN _media_width END,
    CASE WHEN _media_action = 'set' THEN _media_height END)
  ON CONFLICT ON CONSTRAINT community_posts_one_per_completion DO UPDATE SET
    caption = EXCLUDED.caption,
    visibility = EXCLUDED.visibility,
    media_path = CASE _media_action WHEN 'keep' THEN p.media_path ELSE EXCLUDED.media_path END,
    media_thumb_path = CASE _media_action WHEN 'keep' THEN p.media_thumb_path ELSE EXCLUDED.media_thumb_path END,
    media_type = CASE _media_action WHEN 'keep' THEN p.media_type ELSE EXCLUDED.media_type END,
    media_width = CASE _media_action WHEN 'keep' THEN p.media_width ELSE EXCLUDED.media_width END,
    media_height = CASE _media_action WHEN 'keep' THEN p.media_height ELSE EXCLUDED.media_height END,
    updated_at = now()
  RETURNING p.id INTO v_id;

  RETURN jsonb_build_object('id', v_id);
END;
$$;
REVOKE ALL ON FUNCTION public.community_save_post(uuid, text, text, text, text, text, text, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_save_post(uuid, text, text, text, text, text, text, int, int) TO authenticated;

-- ── Feed (keyset-paginated, one round trip per page) ───────────────────────
-- Main feed = shared posts only. With _author_user_id = a person: that
-- person's shared posts; when that person is YOU, your private posts too.
CREATE OR REPLACE FUNCTION public.community_feed(
  _limit int DEFAULT 10,
  _before_at timestamptz DEFAULT NULL,
  _before_id uuid DEFAULT NULL,
  _author_user_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  lim int := least(greatest(coalesce(_limit, 10), 1), 20);
  result jsonb;
BEGIN
  IF NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;

  WITH page AS (
    SELECT p.* FROM public.community_posts p
     WHERE (p.visibility = 'community' OR (p.author_user_id = uid AND _author_user_id = uid))
       AND (_author_user_id IS NULL OR p.author_user_id = _author_user_id)
       AND (_before_at IS NULL OR (p.created_at, p.id) < (_before_at, coalesce(_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
     ORDER BY p.created_at DESC, p.id DESC
     LIMIT lim + 1
  ),
  numbered AS (SELECT page.*, row_number() OVER (ORDER BY page.created_at DESC, page.id DESC) rn FROM page),
  shaped AS (
    SELECT n.rn, jsonb_build_object(
      'id', n.id,
      'created_at', n.created_at,
      'visibility', n.visibility,
      'caption', n.caption,
      'media_path', n.media_path,
      'media_thumb_path', n.media_thumb_path,
      'media_type', n.media_type,
      'media_width', n.media_width,
      'media_height', n.media_height,
      'completion_id', n.completion_id,
      'is_mine', n.author_user_id = uid,
      'author', public.community_author(n.author_user_id),
      'stats', public.community_workout_stats(n.completion_id),
      'reactions', coalesce((SELECT jsonb_object_agg(x.emoji, x.c)
                               FROM (SELECT r.emoji, count(*) c FROM public.community_reactions r
                                      WHERE r.post_id = n.id GROUP BY r.emoji) x), '{}'::jsonb),
      'my_reaction', (SELECT r.emoji FROM public.community_reactions r WHERE r.post_id = n.id AND r.user_id = uid),
      'coach_reactions', coalesce((SELECT jsonb_agg(jsonb_build_object(
                                      'name', public.community_author(r.user_id)->>'name', 'emoji', r.emoji)
                                      ORDER BY r.created_at)
                                     FROM public.community_reactions r
                                    WHERE r.post_id = n.id
                                      AND (public.has_role(r.user_id, 'admin') OR public.has_role(r.user_id, 'coach'))), '[]'::jsonb),
      'comment_count', (SELECT count(*) FROM public.community_comments c WHERE c.post_id = n.id),
      'coach_commented', EXISTS (SELECT 1 FROM public.community_comments c
                                  WHERE c.post_id = n.id
                                    AND (public.has_role(c.author_user_id, 'admin') OR public.has_role(c.author_user_id, 'coach')))
    ) AS j
    FROM numbered n WHERE n.rn <= lim
  )
  SELECT jsonb_build_object(
           'posts', coalesce((SELECT jsonb_agg(s.j ORDER BY s.rn) FROM shaped s), '[]'::jsonb),
           'has_more', (SELECT count(*) FROM page) > lim)
    INTO result;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.community_feed(int, timestamptz, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_feed(int, timestamptz, uuid, uuid) TO authenticated;

-- ── Reactions ──────────────────────────────────────────────────────────────
-- One reaction per person per post. _emoji NULL removes it.
CREATE OR REPLACE FUNCTION public.community_react(_post_id uuid, _emoji text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.community_posts p
                  WHERE p.id = _post_id AND (p.visibility = 'community' OR p.author_user_id = uid)) THEN
    RAISE EXCEPTION 'Post not found';
  END IF;
  IF _emoji IS NULL OR _emoji = '' THEN
    DELETE FROM public.community_reactions WHERE post_id = _post_id AND user_id = uid;
  ELSE
    IF _emoji NOT IN ('fire', 'muscle', 'clap', 'heart') THEN RAISE EXCEPTION 'Invalid reaction'; END IF;
    INSERT INTO public.community_reactions (post_id, user_id, emoji) VALUES (_post_id, uid, _emoji)
    ON CONFLICT (post_id, user_id) DO UPDATE SET emoji = EXCLUDED.emoji, created_at = now();
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.community_react(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_react(uuid, text) TO authenticated;

-- ── Comments (light social chatter; coaching stays in Messages) ────────────
CREATE OR REPLACE FUNCTION public.community_comments(_post_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  v_owner uuid;
BEGIN
  IF uid IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT p.author_user_id INTO v_owner FROM public.community_posts p
   WHERE p.id = _post_id AND (p.visibility = 'community' OR p.author_user_id = uid);
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Post not found'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'id', c.id, 'body', c.body, 'created_at', c.created_at,
             'author', public.community_author(c.author_user_id),
             'can_delete', (c.author_user_id = uid OR v_owner = uid OR public.is_community_staff()))
           ORDER BY c.created_at)
      FROM (SELECT * FROM public.community_comments WHERE post_id = _post_id ORDER BY created_at LIMIT 100) c
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.community_comments(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_comments(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.community_add_comment(_post_id uuid, _body text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  v_body text := btrim(coalesce(_body, ''));
  v_id uuid;
BEGIN
  IF uid IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF v_body = '' OR char_length(v_body) > 300 THEN RAISE EXCEPTION 'Comment must be 1–300 characters'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.community_posts p
                  WHERE p.id = _post_id AND (p.visibility = 'community' OR p.author_user_id = uid)) THEN
    RAISE EXCEPTION 'Post not found';
  END IF;
  INSERT INTO public.community_comments (post_id, author_user_id, body) VALUES (_post_id, uid, v_body) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.community_add_comment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_add_comment(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.community_delete_comment(_comment_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  DELETE FROM public.community_comments c
   WHERE c.id = _comment_id
     AND (c.author_user_id = uid
       OR public.is_community_staff()
       OR EXISTS (SELECT 1 FROM public.community_posts p WHERE p.id = c.post_id AND p.author_user_id = uid));
END;
$$;
REVOKE ALL ON FUNCTION public.community_delete_comment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_delete_comment(uuid) TO authenticated;

-- ── Media storage ──────────────────────────────────────────────────────────
-- Private bucket, `${user_id}/…` paths, viewed through short-lived signed URLs.
-- Image uploads are compressed client-side (≤1440px + 640px thumbnail); video
-- is capped at 50 MB / ~45 s in the composer.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('community-media', 'community-media', false, 52428800,
        ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
              'video/mp4', 'video/quicktime', 'video/webm'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "community media owner insert" ON storage.objects;
CREATE POLICY "community media owner insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'community-media' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "community media owner delete" ON storage.objects;
CREATE POLICY "community media owner delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'community-media' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Owner always; everyone else only while the file belongs to a SHARED post.
DROP POLICY IF EXISTS "community media read" ON storage.objects;
CREATE POLICY "community media read" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'community-media'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR (public.can_view_community() AND EXISTS (
            SELECT 1 FROM public.community_posts p
             WHERE p.visibility = 'community' AND (p.media_path = name OR p.media_thumb_path = name)))
    ));
