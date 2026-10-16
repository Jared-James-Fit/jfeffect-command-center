-- (After 20261207090000_crew_saves_reposts: it patches the repost-aware activity count.)
--
-- Crew: STORY on the camera (a post that lives in the story rail only) and
-- a clip's framing (which part shows where the feed's 4:5 or the profile
-- grid's 3:4 crops it).
--
--   story_only   set when a story is posted (community_create_post _story):
--                24h in the story rail, never in the feed, the "N new" count
--                or the profile grid (the app reads `story` off the post).
--   media_focus  {x, y} 0..1 for the cover (CSS object-position); extra
--                slides keep theirs in extra_media. Photos are framed and
--                baked in on the phone, so theirs is normally unset; a clip
--                (or an older photo) gets one.

ALTER TABLE public.community_posts
  ADD COLUMN IF NOT EXISTS story_only boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS media_focus jsonb;

-- A focus as sent, checked: two numbers kept to 0..1, else nothing.
CREATE OR REPLACE FUNCTION public.community_media_focus(_f jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN jsonb_typeof(_f) = 'object' AND jsonb_typeof(_f->'x') = 'number' AND jsonb_typeof(_f->'y') = 'number'
    THEN jsonb_build_object('x', round(least(1, greatest(0, (_f->>'x')::numeric)), 4),
                            'y', round(least(1, greatest(0, (_f->>'y')::numeric)), 4))
  END
$$;

-- Slides keep their focus (when they have one).
DO $$
DECLARE def text;
BEGIN
  def := pg_get_functiondef('public.community_clean_media(jsonb, uuid, jsonb)'::regprocedure);
  def := replace(def,
    $r$THEN round((x.e->>'height')::numeric)::int END)
         ORDER BY x.i)$r$,
    $r$THEN round((x.e->>'height')::numeric)::int END)
           || CASE WHEN public.community_media_focus(x.e->'focus') IS NOT NULL
                   THEN jsonb_build_object('focus', public.community_media_focus(x.e->'focus')) ELSE '{}'::jsonb END
         ORDER BY x.i)$r$);
  IF position('community_media_focus(x.e->''focus'')' in def) = 0 THEN
    RAISE EXCEPTION 'community_clean_media: anchor not found';
  END IF;
  EXECUTE def;
END $$;

-- The cover's focus lands in its own column (the rest stay in extra_media).
DO $$
DECLARE def text;
BEGIN
  def := pg_get_functiondef('public.community_apply_media(uuid, jsonb)'::regprocedure);
  def := replace(def,
    $r$media_width = (_media->0->>'width')::int, media_height = (_media->0->>'height')::int,$r$,
    $r$media_width = (_media->0->>'width')::int, media_height = (_media->0->>'height')::int,
         media_focus = public.community_media_focus(_media->0->'focus'),$r$);
  IF position('media_focus = public.community_media_focus' in def) = 0 THEN
    RAISE EXCEPTION 'community_apply_media: anchor not found';
  END IF;
  EXECUTE def;
END $$;

-- A post's slides as they're saved, cover first, focus and all (editing keeps it).
DO $$
DECLARE def text;
BEGIN
  def := pg_get_functiondef('public.community_post_media_list(uuid)'::regprocedure);
  def := replace(def,
    $r$'width', p.media_width, 'height', p.media_height)) || p.extra_media END$r$,
    $r$'width', p.media_width, 'height', p.media_height)
                                        || CASE WHEN p.media_focus IS NOT NULL THEN jsonb_build_object('focus', p.media_focus) ELSE '{}'::jsonb END)
                   || p.extra_media END$r$);
  IF position('p.media_focus IS NOT NULL' in def) = 0 THEN
    RAISE EXCEPTION 'community_post_media_list: anchor not found';
  END IF;
  EXECUTE def;
END $$;

-- The post as the app reads it: its cover's focus and whether it's a story.
-- (Joined on rather than added to the long list: jsonb_build_object takes 100 arguments at most.)
DO $$
DECLARE def text;
BEGIN
  def := pg_get_functiondef('public.community_post_json(uuid, uuid)'::regprocedure);
  def := replace(def,
    $r$  SELECT jsonb_build_object(
    'id', n.id,$r$,
    $r$  SELECT jsonb_build_object('media_focus', n.media_focus, 'story', n.story_only) || jsonb_build_object(
    'id', n.id,$r$);
  IF position('''story'', n.story_only' in def) = 0 THEN
    RAISE EXCEPTION 'community_post_json: anchor not found';
  END IF;
  EXECUTE def;
END $$;

-- Crew's "N new" counts posts in the feed (and reposts of them): stories aren't.
DO $$
DECLARE def text;
BEGIN
  def := pg_get_functiondef('public.community_activity()'::regprocedure);
  IF position('story_only' in def) > 0 THEN RETURN; END IF;
  def := replace(def,
    $r$AND NOT coalesce(p.auto_shared, false)$r$,
    $r$AND NOT coalesce(p.auto_shared, false)
                    AND NOT p.story_only$r$);
  -- (the repost half, when there is one: a story can't be reposted, but never count one)
  def := replace(def,
    $r$                    AND p.archived_at IS NULL
                    AND (p.visibility = 'community'$r$,
    $r$                    AND p.archived_at IS NULL
                    AND NOT p.story_only
                    AND (p.visibility = 'community'$r$);
  IF position('AND NOT p.story_only' in def) = 0 THEN
    RAISE EXCEPTION 'community_activity: anchor not found';
  END IF;
  EXECUTE def;
END $$;

-- A story is in the rail for a day, not a post to put in front of followers.
DO $$
DECLARE def text;
BEGIN
  IF to_regprocedure('public.community_repost_refusal(uuid, uuid)') IS NULL THEN RETURN; END IF;
  def := pg_get_functiondef('public.community_repost_refusal(uuid, uuid)'::regprocedure);
  IF position('story_only' in def) > 0 THEN RETURN; END IF;
  def := replace(def,
    $r$    WHEN coalesce(p.auto_shared, false) THEN 'Automatic workout stories can''t be reposted'$r$,
    $r$    WHEN coalesce(p.auto_shared, false) THEN 'Automatic workout stories can''t be reposted'
    WHEN p.story_only THEN 'Stories can''t be reposted'$r$);
  IF position('story_only' in def) = 0 THEN
    RAISE EXCEPTION 'community_repost_refusal: anchor not found';
  END IF;
  EXECUTE def;
END $$;

-- A profile's post count is its grid: stories aren't on it.
DO $$
DECLARE def text;
BEGIN
  def := pg_get_functiondef('public.community_profile(uuid)'::regprocedure);
  def := replace(def,
    $r$                 AND p.archived_at IS NULL
                 AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id)),$r$,
    $r$                 AND p.archived_at IS NULL
                 AND NOT p.story_only
                 AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id)),$r$);
  IF position('AND NOT p.story_only' in def) = 0 THEN
    RAISE EXCEPTION 'community_profile: anchor not found';
  END IF;
  EXECUTE def;
END $$;

-- Posting a story: the same as a post, flagged in the same insert (so it's
-- never in anyone's feed, even for a moment). A story is a picture or a
-- clip, for the crew (followers, on a private account) or Close friends.
DO $$
DECLARE def text;
BEGIN
  def := pg_get_functiondef('public.community_create_post(text, jsonb, text)'::regprocedure);
  def := replace(def,
    $r$_visibility text DEFAULT 'community'::text)$r$,
    $r$_visibility text DEFAULT 'community'::text, _story boolean DEFAULT false)$r$);
  def := replace(def,
    $r$  IF v_cap IS NULL AND jsonb_array_length(v_media) = 0 THEN RAISE EXCEPTION 'Add a photo or write something'; END IF;$r$,
    $r$  IF v_cap IS NULL AND jsonb_array_length(v_media) = 0 THEN RAISE EXCEPTION 'Add a photo or write something'; END IF;
  IF coalesce(_story, false) AND jsonb_array_length(v_media) = 0 THEN RAISE EXCEPTION 'A story needs a photo or a clip'; END IF;
  IF coalesce(_story, false) AND _visibility NOT IN ('community', 'followers', 'close_friends') THEN
    RAISE EXCEPTION 'A story is for the crew or Close friends';
  END IF;$r$);
  def := replace(def,
    $r$  INSERT INTO public.community_posts (author_user_id, client_id, kind, visibility, caption)
  VALUES (v_author, v_client, 'note', _visibility, v_cap)$r$,
    $r$  INSERT INTO public.community_posts (author_user_id, client_id, kind, visibility, caption, story_only)
  VALUES (v_author, v_client, 'note', _visibility, v_cap, coalesce(_story, false))$r$);
  IF position('_story boolean DEFAULT false' in def) = 0
     OR position('A story needs a photo or a clip' in def) = 0
     OR position('coalesce(_story, false))' in def) = 0 THEN
    RAISE EXCEPTION 'community_create_post: anchors not found';
  END IF;
  -- a new signature: the old one goes in the same breath (one function for the API to find)
  DROP FUNCTION public.community_create_post(text, jsonb, text);
  EXECUTE def;
END $$;

REVOKE ALL ON FUNCTION public.community_create_post(text, jsonb, text, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.community_create_post(text, jsonb, text, boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.community_media_focus(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.community_media_focus(jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
