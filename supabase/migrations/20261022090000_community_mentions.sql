-- Mentions and collab posts. Type "@" in a caption and pick someone:
--   * their name in the caption becomes tappable (opens their profile);
--   * a post about 1-3 people is a collab: "Jared McIntyre and Dwayne" in the
--     header, and it shows on their profiles too (they can take themselves off);
--   * name 4 or more and it's a shout-out: names tappable, no collab, so weekly
--     recaps don't land on a dozen profiles.
-- Wednesday Wins / Sunday Recap name people without "@" (the app writes those
-- captions), so those names count too. A birthday post's person is on it.
-- No new pushes (the community only ever pushes coach recognition).

CREATE TABLE IF NOT EXISTS public.community_post_mentions (
  post_id uuid NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- how the caption names them ("@Dwayne", "Dwayne"); null = on the post without being named
  text text,
  pos int NOT NULL DEFAULT 0,
  -- they took themselves off the post
  removed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX IF NOT EXISTS community_post_mentions_user ON public.community_post_mentions (user_id) WHERE removed_at IS NULL;
ALTER TABLE public.community_post_mentions ENABLE ROW LEVEL SECURITY;  -- read through the functions only

-- Everyone in the community, by the name the community shows.
CREATE OR REPLACE FUNCTION public.community_member_directory()
RETURNS TABLE (user_id uuid, name text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.user_id, public.community_author(m.user_id)->>'name'
    FROM (SELECT DISTINCT x.user_id FROM (
            SELECT c.user_id FROM public.clients c
             WHERE c.user_id IS NOT NULL AND coalesce(c.archived, false) = false AND c.archived_at IS NULL
               AND coalesce(c.status, '') <> 'Archived' AND coalesce(c.portal_access_disabled, false) = false
            UNION ALL
            SELECT ur.user_id FROM public.user_roles ur WHERE ur.role IN ('admin', 'coach')) x) m
   WHERE NOT EXISTS (SELECT 1 FROM public.community_profiles l WHERE l.user_id = m.user_id AND l.same_person_as IS NOT NULL)
$$;
REVOKE ALL ON FUNCTION public.community_member_directory() FROM PUBLIC, anon, authenticated;

-- Who a caption names: "@Name" (or, for app-written recaps, the bare name) as
-- a whole word. Names two people share are skipped (no guessing), the author
-- isn't their own mention, and "@Alyssa Amanda" beats someone called "Alyssa".
CREATE OR REPLACE FUNCTION public.community_caption_mentions(_caption text, _author uuid, _plain boolean DEFAULT false)
RETURNS TABLE (user_id uuid, text text, pos int) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH all_dir AS (SELECT d.user_id, btrim(d.name) AS name FROM public.community_member_directory() d WHERE nullif(btrim(d.name), '') IS NOT NULL),
  dir AS (
    SELECT a.user_id, a.name FROM all_dir a
     WHERE lower(a.name) IN (SELECT lower(a2.name) FROM all_dir a2 GROUP BY 1 HAVING count(*) = 1)
       AND a.user_id <> public.community_main_account(_author)
  ),
  cap AS (SELECT lower(coalesce(_caption, '')) AS c),
  hits AS (
    SELECT dir.user_id, CASE WHEN _plain THEN dir.name ELSE '@' || dir.name END AS text, x.pos, length(dir.name) AS len
      FROM dir, cap
     CROSS JOIN LATERAL (SELECT strpos(cap.c, CASE WHEN _plain THEN '' ELSE '@' END || lower(dir.name)) AS pos) x
     WHERE x.pos > 0
       AND substr(cap.c, x.pos + length(dir.name) + CASE WHEN _plain THEN 0 ELSE 1 END, 1) !~ '[[:alnum:]_]'
       AND (NOT _plain OR x.pos = 1 OR substr(cap.c, x.pos - 1, 1) !~ '[[:alnum:]_@]')
  )
  SELECT h.user_id, h.text, h.pos FROM hits h
   WHERE NOT EXISTS (SELECT 1 FROM hits h2 WHERE h2.pos = h.pos AND h2.len > h.len)
$$;
REVOKE ALL ON FUNCTION public.community_caption_mentions(text, uuid, boolean) FROM PUBLIC, anon, authenticated;

-- Keep a post's mentions in step with its caption (every way a caption is
-- written goes through here: share, edit, notes, the daily posts).
CREATE OR REPLACE FUNCTION public.community_posts_sync_mentions()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cap text := lower(coalesce(NEW.caption, ''));
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.caption IS NOT DISTINCT FROM OLD.caption THEN RETURN NULL; END IF;
  -- named no more: off the post
  DELETE FROM public.community_post_mentions m
   WHERE m.post_id = NEW.id AND m.text IS NOT NULL AND strpos(cap, lower(m.text)) = 0;
  INSERT INTO public.community_post_mentions (post_id, user_id, text, pos)
  SELECT NEW.id, x.user_id, x.text, x.pos
    FROM public.community_caption_mentions(NEW.caption, NEW.author_user_id, false) x
  ON CONFLICT (post_id, user_id) DO NOTHING;
  IF NEW.series IN ('wednesday_wins', 'sunday_recap') THEN
    INSERT INTO public.community_post_mentions (post_id, user_id, text, pos)
    SELECT NEW.id, x.user_id, x.text, x.pos
      FROM public.community_caption_mentions(NEW.caption, NEW.author_user_id, true) x
    ON CONFLICT (post_id, user_id) DO NOTHING;
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS community_posts_mentions ON public.community_posts;
CREATE TRIGGER community_posts_mentions AFTER INSERT OR UPDATE OF caption ON public.community_posts
  FOR EACH ROW EXECUTE FUNCTION public.community_posts_sync_mentions();

-- A birthday post has its person on it.
CREATE OR REPLACE FUNCTION public.community_birthday_post_mention()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c public.clients;
  v_caption text;
  v_text text;
BEGIN
  IF NEW.post_id IS NULL OR NEW.post_id IS NOT DISTINCT FROM OLD.post_id THEN RETURN NULL; END IF;
  SELECT * INTO c FROM public.clients WHERE id = NEW.client_id;
  IF c.user_id IS NULL THEN RETURN NULL; END IF;
  SELECT p.caption INTO v_caption FROM public.community_posts p WHERE p.id = NEW.post_id;
  -- the name the post uses for them, if it uses one
  SELECT btrim(t.n) INTO v_text
    FROM unnest(ARRAY[public.community_author(c.user_id)->>'name', c.preferred_name, c.first_name, split_part(coalesce(c.full_name, ''), ' ', 1)]) WITH ORDINALITY AS t(n, i)
   WHERE nullif(btrim(t.n), '') IS NOT NULL AND strpos(lower(coalesce(v_caption, '')), lower(btrim(t.n))) > 0
   ORDER BY t.i LIMIT 1;
  INSERT INTO public.community_post_mentions (post_id, user_id, text, pos)
  VALUES (NEW.post_id, c.user_id, v_text, CASE WHEN v_text IS NULL THEN 0 ELSE strpos(lower(v_caption), lower(v_text)) END)
  ON CONFLICT (post_id, user_id) DO NOTHING;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS community_birthday_post_mention ON public.community_birthday_posts;
CREATE TRIGGER community_birthday_post_mention AFTER UPDATE OF post_id ON public.community_birthday_posts
  FOR EACH ROW EXECUTE FUNCTION public.community_birthday_post_mention();

-- Collaborators: the people a community post names, when it names 1-3 of them.
CREATE OR REPLACE FUNCTION public.community_post_collab_ids(_post_id uuid)
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN count(*) BETWEEN 1 AND 3 THEN array_agg(m.user_id ORDER BY m.pos, m.created_at) ELSE '{}'::uuid[] END
    FROM public.community_post_mentions m JOIN public.community_posts p ON p.id = m.post_id
   WHERE m.post_id = _post_id AND m.removed_at IS NULL AND p.visibility = 'community'
$$;
REVOKE ALL ON FUNCTION public.community_post_collab_ids(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_post_collab_ids(uuid) TO authenticated;

-- Take yourself off a post (no longer a collaborator, name no longer a link).
CREATE OR REPLACE FUNCTION public.community_leave_post(_post_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  UPDATE public.community_post_mentions SET removed_at = now()
   WHERE post_id = _post_id AND user_id = public.community_main_account(auth.uid()) AND removed_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'You''re not on this post'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.community_leave_post(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_leave_post(uuid) TO authenticated;

-- A profile shows the posts they're a collaborator on too.
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
       AND (_author_user_id IS NULL OR p.author_user_id = _author_user_id
            OR _author_user_id = ANY (public.community_post_collab_ids(p.id)))
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

CREATE OR REPLACE FUNCTION public.community_profile(_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'author', public.community_author(_user_id),
    'bio', (SELECT cp.bio FROM public.community_profiles cp WHERE cp.user_id = _user_id),
    'is_me', _user_id = uid,
    'posts', (SELECT count(*) FROM public.community_posts p
               WHERE (p.author_user_id = _user_id OR _user_id = ANY (public.community_post_collab_ids(p.id)))
                 AND p.archived_at IS NULL
                 AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id)),
    'archived', CASE WHEN _user_id = uid OR _user_id = public.community_main_account(uid)
                     THEN (SELECT count(*) FROM public.community_posts p WHERE p.author_user_id = _user_id AND p.archived_at IS NOT NULL) END,
    'training_since', (SELECT min(pc.completed_at) FROM public.pl_day_completions pc
                         JOIN public.clients c ON c.id = pc.client_id
                        WHERE c.user_id = _user_id AND pc.completed_at IS NOT NULL));
END;
$function$;

-- The post as the app gets it (as of 20261021090000), plus who it names and its collaborators.
CREATE OR REPLACE FUNCTION public.community_post_json(_post_id uuid, _viewer uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'id', n.id,
    'created_at', n.created_at,
    'visibility', n.visibility,
    'caption', n.caption,
    'media_path', n.media_path,
    'media_thumb_path', n.media_thumb_path,
    'media_type', n.media_type,
    'media_width', n.media_width,
    'media_height', n.media_height,
    'extra_media', CASE WHEN jsonb_array_length(n.extra_media) > 0 THEN n.extra_media END,
    'completion_id', n.completion_id,
    'kind', n.kind,
    'series', n.series,
    'quote', n.quote,
    'quote_author', n.quote_author,
    'quote_source', n.quote_source,
    'series_data', CASE WHEN n.series IS NULL OR n.series IN ('wednesday_wins', 'sunday_recap') THEN n.series_data END,
    'series_extra', CASE WHEN n.series IN ('tuesday_tips', 'try_it_thursday', 'saturday_spirit') THEN n.series_data END,
    'shared_comment', CASE WHEN n.shared_comment_id IS NOT NULL THEN coalesce((
      SELECT jsonb_build_object('id', c.id, 'post_id', c.post_id, 'body', c.body, 'created_at', c.created_at,
                                'author', public.community_author(c.author_user_id),
                                'post_author', public.community_author(op.author_user_id)->>'name',
                                'media', CASE WHEN c.media_path IS NOT NULL THEN jsonb_build_object(
                                  'path', c.media_path, 'thumb', c.media_thumb_path, 'type', c.media_type,
                                  'width', c.media_width, 'height', c.media_height) END)
        FROM public.community_comments c JOIN public.community_posts op ON op.id = c.post_id
       WHERE c.id = n.shared_comment_id AND op.visibility = 'community'
         AND public.community_comment_readable(c.post_id, c.author_user_id, c.hidden_at)),
      jsonb_build_object('gone', true)) END,
    -- everyone the caption names (tappable), in caption order
    'mentions', coalesce((SELECT jsonb_agg(public.community_author(m.user_id) || jsonb_build_object('text', m.text) ORDER BY m.pos, m.created_at)
                            FROM public.community_post_mentions m WHERE m.post_id = n.id AND m.removed_at IS NULL), '[]'::jsonb),
    -- a community post about 1-3 people: theirs too
    'collaborators', coalesce((SELECT jsonb_agg(public.community_author(x.uid) ORDER BY x.ord)
                                 FROM unnest(public.community_post_collab_ids(n.id)) WITH ORDINALITY AS x(uid, ord)), '[]'::jsonb),
    'edited_at', n.edited_at,
    'archived_at', n.archived_at,
    'archived_from', n.archived_from,
    'locked_in_at', n.locked_in_at,
    'hide_loads', n.hide_loads,
    'live', n.kind = 'workout' AND pc.completed_at IS NULL,
    'session_title', CASE WHEN n.kind = 'workout' THEN coalesce(nullif(btrim(d.title), ''), nullif(btrim(d.focus), ''), 'Workout') END,
    'is_mine', n.author_user_id = public.community_main_account(_viewer),
    'author', public.community_author(n.author_user_id),
    'stats', CASE WHEN n.hide_loads AND n.author_user_id IS DISTINCT FROM _viewer
                  THEN public.community_hide_loads(public.community_workout_stats(n.completion_id))
                  ELSE public.community_workout_stats(n.completion_id) END,
    'reactions', coalesce((SELECT jsonb_object_agg(x.emoji, x.c)
                             FROM (SELECT r.emoji, count(*) c FROM public.community_reactions r
                                    WHERE r.post_id = n.id GROUP BY r.emoji) x), '{}'::jsonb),
    'my_reaction', (SELECT r.emoji FROM public.community_reactions r WHERE r.post_id = n.id AND r.user_id = _viewer),
    'reaction_count', (SELECT count(*) FROM public.community_reactions r WHERE r.post_id = n.id),
    'reactors', coalesce((SELECT jsonb_agg(x.j ORDER BY x.coach DESC, x.at DESC)
                            FROM (SELECT public.community_author(r.user_id)
                                         || jsonb_build_object('is_me', public.community_main_account(r.user_id) = public.community_main_account(_viewer)) AS j,
                                         public.community_is_coach(r.user_id) AS coach, r.created_at AS at
                                    FROM public.community_reactions r WHERE r.post_id = n.id
                                   ORDER BY public.community_is_coach(r.user_id) DESC, r.created_at DESC LIMIT 3) x), '[]'::jsonb),
    'coach_reactions', coalesce((SELECT jsonb_agg(jsonb_build_object(
                                    'name', public.community_author(r.user_id)->>'name', 'emoji', r.emoji)
                                    ORDER BY r.created_at)
                                   FROM public.community_reactions r
                                  WHERE r.post_id = n.id
                                    AND public.community_is_coach(r.user_id)), '[]'::jsonb),
    'pinned_comment_id', n.pinned_comment_id,
    'comment_preview', public.community_comment_preview(n.id, n.pinned_comment_id),
    'comment_count', (SELECT count(*) FROM public.community_comments c WHERE c.post_id = n.id AND c.hidden_at IS NULL),
    'coach_commented', EXISTS (SELECT 1 FROM public.community_comments c
                                WHERE c.post_id = n.id
                                  AND public.community_is_coach(c.author_user_id)))
  FROM public.community_posts n
  LEFT JOIN public.pl_day_completions pc ON pc.id = n.completion_id
  LEFT JOIN public.pl_days d ON d.id = pc.day_id
  WHERE n.id = _post_id
$function$;

-- One-off (prod): the posts written before mentions existed, named as they're written.
--   Dwayne's and Amanda's birthday posts -> collabs; Wednesday Wins (12 names) -> shout-out.
INSERT INTO public.community_post_mentions (post_id, user_id, text, pos)
SELECT p.id, v.uid, v.t, strpos(lower(p.caption), lower(v.t))
  FROM (VALUES
    ('779ae763-5af3-4bda-ba9d-e5db28992fd7'::uuid, 'dcdb75f3-85d4-44f4-b8b7-a2a36e3672ce'::uuid, 'Dwayne'),
    ('c79c0a5f-191f-4333-a254-f3588c7ea3a4', '8e71e846-853e-418e-be95-1b78fe030417', 'Amanda')
  ) v(pid, uid, t)
  JOIN public.community_posts p ON p.id = v.pid
  JOIN auth.users u ON u.id = v.uid
 WHERE strpos(lower(p.caption), lower(v.t)) > 0
ON CONFLICT (post_id, user_id) DO NOTHING;
INSERT INTO public.community_post_mentions (post_id, user_id, text, pos)
SELECT p.id, x.user_id, x.text, x.pos
  FROM public.community_posts p
 CROSS JOIN LATERAL public.community_caption_mentions(p.caption, p.author_user_id, true) x
 WHERE p.series IN ('wednesday_wins', 'sunday_recap')
ON CONFLICT (post_id, user_id) DO NOTHING;

-- New posts stream to an open feed (the "New posts" pill), read through the same visibility rule.
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.community_posts;
EXCEPTION WHEN duplicate_object OR undefined_object THEN NULL; END $$;
