-- Polls on the coach's text posts: 2-4 options, one vote each (change it or
-- take it back any time). Everyone sees the counts once they've voted; only
-- the person who posted it (and the coach) sees who picked what, like
-- Instagram. No pushes: voting is a tap, not a notification.

CREATE TABLE IF NOT EXISTS public.community_poll_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  pos int NOT NULL,
  label text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 60),
  UNIQUE (post_id, pos)
);
ALTER TABLE public.community_poll_options ENABLE ROW LEVEL SECURITY;  -- read through the functions only

CREATE TABLE IF NOT EXISTS public.community_poll_votes (
  post_id uuid NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  option_id uuid NOT NULL REFERENCES public.community_poll_options(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX IF NOT EXISTS community_poll_votes_option ON public.community_poll_votes (option_id);
ALTER TABLE public.community_poll_votes ENABLE ROW LEVEL SECURITY;  -- written through community_poll_vote only

-- A post's poll for one viewer (null when it has none). Votes count once per
-- person: a coach's admin login and community account are the same voter.
CREATE OR REPLACE FUNCTION public.community_poll_json(_post_id uuid, _viewer uuid)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH me AS (SELECT public.community_main_account(_viewer) AS uid),
  opts AS (
    SELECT o.id, o.label, o.pos,
           (SELECT count(*) FROM public.community_poll_votes v WHERE v.option_id = o.id) AS votes
      FROM public.community_poll_options o
     WHERE o.post_id = _post_id)
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM opts) THEN NULL ELSE jsonb_build_object(
    'options', (SELECT jsonb_agg(jsonb_build_object('id', opts.id, 'label', opts.label, 'votes', opts.votes) ORDER BY opts.pos) FROM opts),
    'total', (SELECT count(*) FROM public.community_poll_votes v WHERE v.post_id = _post_id),
    'my_vote', (SELECT v.option_id FROM public.community_poll_votes v, me WHERE v.post_id = _post_id AND v.user_id = me.uid),
    -- who picked what: the poster and the coach only
    'voters', CASE WHEN public.community_is_coach(_viewer)
                     OR EXISTS (SELECT 1 FROM public.community_posts p, me WHERE p.id = _post_id AND p.author_user_id = me.uid)
                   THEN coalesce((SELECT jsonb_object_agg(x.option_id, x.people)
                                    FROM (SELECT v.option_id, jsonb_agg(public.community_author(v.user_id) ORDER BY v.created_at DESC) AS people
                                            FROM public.community_poll_votes v WHERE v.post_id = _post_id GROUP BY v.option_id) x), '{}'::jsonb)
              END)
  END
$function$;
REVOKE ALL ON FUNCTION public.community_poll_json(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Vote (or switch), or take it back with a null option. Anyone who can see the post.
CREATE OR REPLACE FUNCTION public.community_poll_vote(_post_id uuid, _option_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  v_me uuid;
BEGIN
  IF uid IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.community_posts p
                  WHERE p.id = _post_id AND p.archived_at IS NULL
                    AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id)) THEN
    RAISE EXCEPTION 'Post not found';
  END IF;
  v_me := public.community_main_account(uid);
  IF _option_id IS NULL THEN
    DELETE FROM public.community_poll_votes WHERE post_id = _post_id AND user_id = v_me;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.community_poll_options o WHERE o.id = _option_id AND o.post_id = _post_id) THEN
      RAISE EXCEPTION 'That option isn''t on this poll';
    END IF;
    INSERT INTO public.community_poll_votes (post_id, option_id, user_id) VALUES (_post_id, _option_id, v_me)
    ON CONFLICT (post_id, user_id) DO UPDATE SET option_id = EXCLUDED.option_id, created_at = now();
  END IF;
  RETURN public.community_poll_json(_post_id, uid);
END;
$function$;
REVOKE ALL ON FUNCTION public.community_poll_vote(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_poll_vote(uuid, uuid) TO authenticated;

-- A coach's text post, now with an optional poll (the text is the question).
-- Older app versions call it with _body only; the default keeps that working.
DROP FUNCTION IF EXISTS public.community_create_note(text);
CREATE OR REPLACE FUNCTION public.community_create_note(_body text, _poll text[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  v_author uuid;
  v_body text := btrim(coalesce(_body, ''));
  v_id uuid;
  v_opts text[];
BEGIN
  IF uid IS NULL OR NOT public.community_is_coach(uid) THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF v_body = '' OR char_length(v_body) > 1200 THEN RAISE EXCEPTION 'Write 1–1200 characters'; END IF;
  IF _poll IS NOT NULL THEN
    SELECT array_agg(btrim(u.x) ORDER BY u.i) INTO v_opts
      FROM unnest(_poll) WITH ORDINALITY AS u(x, i)
     WHERE btrim(coalesce(u.x, '')) <> '';
    IF coalesce(array_length(v_opts, 1), 0) NOT BETWEEN 2 AND 4 THEN RAISE EXCEPTION 'A poll needs 2 to 4 options'; END IF;
    IF EXISTS (SELECT 1 FROM unnest(v_opts) AS o(x) WHERE char_length(o.x) > 60) THEN RAISE EXCEPTION 'Keep each option to 60 characters'; END IF;
    IF (SELECT count(DISTINCT lower(o.x)) FROM unnest(v_opts) AS o(x)) < array_length(v_opts, 1) THEN RAISE EXCEPTION 'Each option needs to be different'; END IF;
  END IF;
  v_author := public.community_main_account(uid);
  INSERT INTO public.community_posts (author_user_id, client_id, kind, visibility, caption)
  VALUES (v_author, (SELECT c.id FROM public.clients c WHERE c.user_id = v_author LIMIT 1), 'note', 'community', v_body)
  RETURNING id INTO v_id;
  IF v_opts IS NOT NULL THEN
    INSERT INTO public.community_poll_options (post_id, pos, label)
    SELECT v_id, u.i, u.x FROM unnest(v_opts) WITH ORDINALITY AS u(x, i);
  END IF;
  RETURN jsonb_build_object('id', v_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.community_create_note(text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_create_note(text, text[]) TO authenticated;

-- Every post carries its poll (rebuilt from the live definition; only 'poll' is new).
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
    'mentions', coalesce((SELECT jsonb_agg(public.community_author(m.user_id) || jsonb_build_object('text', m.text) ORDER BY m.pos, m.created_at)
                            FROM public.community_post_mentions m WHERE m.post_id = n.id AND m.removed_at IS NULL), '[]'::jsonb),
    'collaborators', coalesce((SELECT jsonb_agg(public.community_author(x.uid) ORDER BY x.ord)
                                 FROM unnest(public.community_post_collab_ids(n.id)) WITH ORDINALITY AS x(uid, ord)), '[]'::jsonb),
    'poll', public.community_poll_json(n.id, _viewer),
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
