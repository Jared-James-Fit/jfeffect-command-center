-- A like belongs to the person, never the login (Nov 25 2026).
--
-- A coach can have two logins that are one person in the Crew: their staff
-- login and their own athlete login (community_profiles.same_person_as, the
-- "linked login"). Everything a post says about people already reads the
-- person (community_main_account): the author, "is_me", the Likes list and the
-- count by the heart (community_post_likers), reposts, notifications. Only the
-- likes themselves were keyed by login, (post_id, user_id) and
-- (comment_id, user_id), and "did I like this" (my_reaction / liked) compared
-- the login. So from the staff login a post the athlete login had liked showed
-- an empty heart; tapping it added a second row, the count went to 2 and the
-- Likes list named "You @jared" twice (Jared's Nov 25 bench post, the only
-- post it had happened on). Deleting either row would also have taken away the
-- one notification both rows share.
--
-- Now: every like row is stored under the person's main account (a BEFORE
-- trigger rewrites user_id on every insert and update, whatever path wrote it),
-- so the existing primary keys are one like per person per post / comment, and
-- two logins (or two phones) liking at once meet on the same key. The RPCs and
-- "did I like this" read the person. Rows already stored under a linked login
-- are moved to the person (the earlier like kept when both exist, every moved
-- or merged row copied to community_likes_person_backup first), and a login
-- linked later is moved the moment it's linked.

-- 1. Backup of every row this changes (server only).
CREATE TABLE IF NOT EXISTS public.community_likes_person_backup (
  id bigserial PRIMARY KEY,
  tbl text NOT NULL,
  row_data jsonb NOT NULL,
  backed_up_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.community_likes_person_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_likes_person_backup FROM PUBLIC, anon, authenticated;

-- 2. Stored under the person, whoever writes it.
CREATE OR REPLACE FUNCTION public.community_like_as_person()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  NEW.user_id := public.community_main_account(NEW.user_id);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.community_like_as_person() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS community_reactions_as_person ON public.community_reactions;
CREATE TRIGGER community_reactions_as_person
  BEFORE INSERT OR UPDATE OF user_id ON public.community_reactions
  FOR EACH ROW EXECUTE FUNCTION public.community_like_as_person();

DROP TRIGGER IF EXISTS community_comment_likes_as_person ON public.community_comment_likes;
CREATE TRIGGER community_comment_likes_as_person
  BEFORE INSERT OR UPDATE OF user_id ON public.community_comment_likes
  FOR EACH ROW EXECUTE FUNCTION public.community_like_as_person();

-- 3. Merging never takes a notification away: a like folded into the
--    person's own is the same like, and its notification (keyed by the
--    person) stays.
CREATE OR REPLACE FUNCTION public.community_notify_on_reaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_author uuid;
BEGIN
  IF current_setting('jf.likes_merging', true) = 'on' THEN RETURN NULL; END IF;
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
$$;

CREATE OR REPLACE FUNCTION public.community_notify_on_comment_like()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_author uuid;
BEGIN
  IF current_setting('jf.likes_merging', true) = 'on' THEN RETURN NULL; END IF;
  BEGIN
    IF TG_OP = 'DELETE' THEN
      DELETE FROM public.community_notifications n
       WHERE n.kind = 'comment_like' AND n.comment_id = OLD.comment_id AND n.actor_user_id = public.community_main_account(OLD.user_id);
      RETURN NULL;
    END IF;
    SELECT c.author_user_id INTO v_author FROM public.community_comments c WHERE c.id = NEW.comment_id;
    PERFORM public.community_notify(v_author, NEW.user_id, 'comment_like', NEW.post_id, NEW.comment_id, NULL);
  EXCEPTION WHEN others THEN
    RAISE WARNING 'community_notify_on_comment_like: %', sqlerrm;
  END;
  RETURN NULL;
END;
$$;

-- 4. Move a login's likes to its person: one like per post / comment, the
--    earlier kept.
CREATE OR REPLACE FUNCTION public.community_likes_merge_to_person(_login uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_main uuid := public.community_main_account(_login);
  n integer := 0;
  k integer;
BEGIN
  IF _login IS NULL OR v_main IS NULL OR v_main = _login THEN RETURN 0; END IF;
  PERFORM set_config('jf.likes_merging', 'on', true);

  INSERT INTO public.community_likes_person_backup (tbl, row_data)
  SELECT 'community_reactions', to_jsonb(r) FROM public.community_reactions r WHERE r.user_id = _login;
  INSERT INTO public.community_likes_person_backup (tbl, row_data)
  SELECT 'community_comment_likes', to_jsonb(l) FROM public.community_comment_likes l WHERE l.user_id = _login;

  -- post likes
  UPDATE public.community_reactions m SET created_at = least(m.created_at, d.created_at)
    FROM public.community_reactions d
   WHERE d.user_id = _login AND m.user_id = v_main AND m.post_id = d.post_id;
  DELETE FROM public.community_reactions d
   WHERE d.user_id = _login
     AND EXISTS (SELECT 1 FROM public.community_reactions m WHERE m.user_id = v_main AND m.post_id = d.post_id);
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  UPDATE public.community_reactions SET user_id = v_main WHERE user_id = _login;
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;

  -- comment likes
  UPDATE public.community_comment_likes m SET created_at = least(m.created_at, d.created_at)
    FROM public.community_comment_likes d
   WHERE d.user_id = _login AND m.user_id = v_main AND m.comment_id = d.comment_id;
  DELETE FROM public.community_comment_likes d
   WHERE d.user_id = _login
     AND EXISTS (SELECT 1 FROM public.community_comment_likes m WHERE m.user_id = v_main AND m.comment_id = d.comment_id);
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  UPDATE public.community_comment_likes SET user_id = v_main WHERE user_id = _login;
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;

  PERFORM set_config('jf.likes_merging', 'off', true);
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.community_likes_merge_to_person(uuid) FROM PUBLIC, anon, authenticated;

-- a login linked later is moved the moment it's linked
CREATE OR REPLACE FUNCTION public.community_profiles_merge_likes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.same_person_as IS NOT NULL AND NEW.same_person_as IS DISTINCT FROM NEW.user_id THEN
    PERFORM public.community_likes_merge_to_person(NEW.user_id);
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.community_profiles_merge_likes() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS community_profiles_merge_likes ON public.community_profiles;
CREATE TRIGGER community_profiles_merge_likes
  AFTER INSERT OR UPDATE OF same_person_as ON public.community_profiles
  FOR EACH ROW EXECUTE FUNCTION public.community_profiles_merge_likes();

-- every linked login there is now
SELECT public.community_likes_merge_to_person(cp.user_id)
  FROM public.community_profiles cp
 WHERE cp.same_person_as IS NOT NULL AND cp.same_person_as <> cp.user_id;

-- 5. Like / unlike as the person. Setting a state, never a toggle, so a
--    retry or a second phone lands on the same answer.
CREATE OR REPLACE FUNCTION public.community_react(_post_id uuid, _emoji text DEFAULT NULL::text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  uid uuid := auth.uid();
  me uuid := public.community_main_account(auth.uid());
  -- 💪 / 👏 from very old app versions count as ❤️
  v text := CASE WHEN _emoji IN ('muscle', 'clap') THEN 'heart' ELSE nullif(_emoji, '') END;
BEGIN
  IF uid IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.community_posts p
                  WHERE p.id = _post_id AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id)) THEN
    RAISE EXCEPTION 'Post not found';
  END IF;
  IF v IS NULL THEN
    DELETE FROM public.community_reactions WHERE post_id = _post_id AND user_id IN (me, uid);
  ELSE
    IF v NOT IN ('heart', 'thumbs', 'bang', 'fire', 'laugh') THEN RAISE EXCEPTION 'Invalid reaction'; END IF;
    INSERT INTO public.community_reactions (post_id, user_id, emoji) VALUES (_post_id, me, v)
    ON CONFLICT (post_id, user_id) DO UPDATE SET emoji = EXCLUDED.emoji
      WHERE public.community_reactions.emoji IS DISTINCT FROM EXCLUDED.emoji;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.community_react(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_react(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.community_like_comment(_comment_id uuid, _liked boolean DEFAULT true)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  uid uuid := auth.uid();
  me uuid := public.community_main_account(auth.uid());
  c public.community_comments;
BEGIN
  IF uid IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO c FROM public.community_comments WHERE id = _comment_id;
  IF c.id IS NULL OR NOT public.community_comment_readable(c.post_id, c.author_user_id, c.hidden_at) THEN
    RAISE EXCEPTION 'That comment is gone';
  END IF;
  IF coalesce(_liked, true) THEN
    INSERT INTO public.community_comment_likes (comment_id, post_id, user_id) VALUES (c.id, c.post_id, me) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.community_comment_likes WHERE comment_id = c.id AND user_id IN (me, uid);
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.community_like_comment(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_like_comment(uuid, boolean) TO authenticated;

-- 6. "Did I like this" reads the person, like the count and the list.
CREATE OR REPLACE FUNCTION pg_temp.patch_fn(_sig text, _pairs text[])
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  d text := pg_get_functiondef(_sig::regprocedure);
  i int;
BEGIN
  FOR i IN 1 .. array_length(_pairs, 1) / 2 LOOP
    IF position(_pairs[2 * i] IN d) > 0 THEN
      CONTINUE; -- already applied
    END IF;
    IF position(_pairs[2 * i - 1] IN d) = 0 THEN
      RAISE EXCEPTION '% : fragment % not found', _sig, i;
    END IF;
    d := replace(d, _pairs[2 * i - 1], _pairs[2 * i]);
  END LOOP;
  EXECUTE d;
END $$;

SELECT pg_temp.patch_fn('public.community_post_json(uuid, uuid)', ARRAY[
$old$'my_reaction', (SELECT r.emoji FROM public.community_reactions r WHERE r.post_id = n.id AND r.user_id = _viewer),$old$,
$new$'my_reaction', (SELECT r.emoji FROM public.community_reactions r WHERE r.post_id = n.id AND r.user_id = public.community_main_account(_viewer)),$new$
]);

SELECT pg_temp.patch_fn('public.community_comment_json(public.community_comments, uuid, uuid, boolean, boolean)', ARRAY[
$old$'liked', EXISTS (SELECT 1 FROM public.community_comment_likes l WHERE l.comment_id = c.id AND l.user_id = _viewer),$old$,
$new$'liked', EXISTS (SELECT 1 FROM public.community_comment_likes l WHERE l.comment_id = c.id AND l.user_id = public.community_main_account(_viewer)),$new$
]);
