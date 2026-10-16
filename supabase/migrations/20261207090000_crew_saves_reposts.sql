-- Crew: Save and Repost, Instagram's way.
--
-- Save (the bookmark) is private: only you ever see what you saved. Saved
-- posts sit in "All posts", and you can sort them into your own albums
-- (Instagram's collections). An album only ever holds posts that are saved,
-- so unsaving a post takes it out of every album too (the foreign key does it).
--
-- Repost puts someone's crew post in front of the people who follow you, with
-- an optional note (≤60 characters, an emoji is enough) that floats on the
-- post. Only posts shared with the whole crew can be reposted, never your own
-- (or one you're on as a collaborator), never an automatic workout story. In
-- the feed a reposted post moves up to its latest repost the viewer may see
-- (one card per post, never a copy), with who reposted it. A private account's
-- reposts only count for the people who follow it; a block hides them both ways.
-- Reposting tells the author (Activity + push), like a like does.
--
-- Everything goes through the RPCs below; the tables are closed to clients.

-- ── Shape ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.community_saves (
  user_id uuid NOT NULL,
  post_id uuid NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
);
CREATE INDEX IF NOT EXISTS community_saves_user_idx ON public.community_saves (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS community_saves_post_idx ON public.community_saves (post_id);
ALTER TABLE public.community_saves ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_saves FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.community_save_albums (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT community_save_albums_name_len CHECK (char_length(btrim(name)) BETWEEN 1 AND 40)
);
CREATE UNIQUE INDEX IF NOT EXISTS community_save_albums_name_uq ON public.community_save_albums (user_id, lower(btrim(name)));
CREATE INDEX IF NOT EXISTS community_save_albums_user_idx ON public.community_save_albums (user_id, updated_at DESC);
ALTER TABLE public.community_save_albums ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_save_albums FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.community_save_album_posts (
  album_id uuid NOT NULL REFERENCES public.community_save_albums(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  post_id uuid NOT NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (album_id, post_id),
  -- unsaving a post takes it out of every album
  FOREIGN KEY (user_id, post_id) REFERENCES public.community_saves (user_id, post_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS community_save_album_posts_post_idx ON public.community_save_album_posts (user_id, post_id);
CREATE INDEX IF NOT EXISTS community_save_album_posts_album_idx ON public.community_save_album_posts (album_id, added_at DESC);
ALTER TABLE public.community_save_album_posts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_save_album_posts FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.community_reposts (
  user_id uuid NOT NULL,
  post_id uuid NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  note_at timestamptz,
  PRIMARY KEY (user_id, post_id),
  CONSTRAINT community_reposts_note_len CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 60)
);
CREATE INDEX IF NOT EXISTS community_reposts_post_idx ON public.community_reposts (post_id, created_at DESC);
CREATE INDEX IF NOT EXISTS community_reposts_user_idx ON public.community_reposts (user_id, created_at DESC);
ALTER TABLE public.community_reposts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_reposts FROM anon, authenticated;

ALTER TABLE public.community_notifications DROP CONSTRAINT IF EXISTS community_notifications_kind_check;
ALTER TABLE public.community_notifications ADD CONSTRAINT community_notifications_kind_check
  CHECK (kind = ANY (ARRAY['reaction'::text, 'comment'::text, 'reply'::text, 'comment_like'::text, 'follow'::text, 'follow_request'::text, 'repost'::text]));
CREATE UNIQUE INDEX IF NOT EXISTS community_notifications_repost_uq
  ON public.community_notifications (recipient_user_id, post_id, actor_user_id) WHERE kind = 'repost';

-- ── Helpers ─────────────────────────────────────────────────────────────────
/** A repost note as it's kept: one line, trimmed, at most 60 characters; nothing = no note. */
CREATE OR REPLACE FUNCTION public.community_repost_note_clean(_note text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT nullif(btrim(left(btrim(regexp_replace(coalesce(_note, ''), '\s+', ' ', 'g')), 60)), '')
$$;

/** Why _viewer can't repost this post, or null when they can. */
CREATE OR REPLACE FUNCTION public.community_repost_refusal(_post_id uuid, _viewer uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN p.id IS NULL OR p.archived_at IS NOT NULL THEN 'Post not found'
    WHEN p.author_user_id IN (_viewer, public.community_main_account(_viewer))
      OR public.community_main_account(_viewer) = ANY (public.community_post_collab_ids(p.id)) THEN 'That''s already on your profile'
    WHEN coalesce(p.auto_shared, false) THEN 'Automatic workout stories can''t be reposted'
    WHEN p.visibility <> 'community' THEN 'Only posts shared with the whole crew can be reposted'
  END
    FROM (SELECT 1) one
    LEFT JOIN public.community_posts p ON p.id = _post_id
$$;

-- ── Save ────────────────────────────────────────────────────────────────────
/** A post _me may keep in Saved: one they can still see (an archived one only if it's theirs). */
CREATE OR REPLACE FUNCTION public.community_saveable(_post_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.community_posts p
     WHERE p.id = _post_id
       AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id)
       AND (p.archived_at IS NULL OR p.author_user_id IN (auth.uid(), public.community_main_account(auth.uid())))
       AND (public.community_is_staff(auth.uid()) OR p.author_user_id NOT IN (SELECT public.community_blocked_authors())))
$$;

/** Save (or unsave) a post; with an album, also put it in that album. Unsaving takes it out of every album. */
CREATE OR REPLACE FUNCTION public.community_save(_post_id uuid, _on boolean DEFAULT true, _album_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_me uuid := public.community_main_account(auth.uid());
  v_was jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF NOT coalesce(_on, true) THEN
    -- the albums it was in come back, so Undo can put it back where it was
    SELECT coalesce(jsonb_agg(ap.album_id), '[]'::jsonb) INTO v_was
      FROM public.community_save_album_posts ap WHERE ap.user_id = v_me AND ap.post_id = _post_id;
    DELETE FROM public.community_saves s WHERE s.user_id = v_me AND s.post_id = _post_id;
    RETURN jsonb_build_object('saved', false, 'albums', '[]'::jsonb, 'removed_from', v_was);
  END IF;
  IF NOT public.community_saveable(_post_id) THEN RAISE EXCEPTION 'Post not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.community_saves s WHERE s.user_id = v_me AND s.post_id = _post_id)
     AND (SELECT count(*) FROM public.community_saves s WHERE s.user_id = v_me) >= 5000 THEN
    RAISE EXCEPTION 'Saved is full. Unsave a few first.';
  END IF;
  INSERT INTO public.community_saves (user_id, post_id) VALUES (v_me, _post_id) ON CONFLICT DO NOTHING;
  IF _album_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.community_save_albums a WHERE a.id = _album_id AND a.user_id = v_me) THEN
      RAISE EXCEPTION 'Album not found';
    END IF;
    INSERT INTO public.community_save_album_posts (album_id, user_id, post_id) VALUES (_album_id, v_me, _post_id) ON CONFLICT DO NOTHING;
    UPDATE public.community_save_albums a SET updated_at = now() WHERE a.id = _album_id;
  END IF;
  RETURN jsonb_build_object('saved', true,
    'albums', coalesce((SELECT jsonb_agg(ap.album_id) FROM public.community_save_album_posts ap WHERE ap.user_id = v_me AND ap.post_id = _post_id), '[]'::jsonb));
END;
$$;

/** An album's name as it's kept: trimmed, single spaces, at most 40 characters. */
CREATE OR REPLACE FUNCTION public.community_album_name_clean(_name text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT nullif(btrim(left(btrim(regexp_replace(coalesce(_name, ''), '\s+', ' ', 'g')), 40)), '')
$$;

/** Put posts in an album (saving any that aren't saved yet) or take them out of it. */
CREATE OR REPLACE FUNCTION public.community_album_posts(_album_id uuid, _post_ids uuid[], _in boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_me uuid := public.community_main_account(auth.uid());
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.community_save_albums a WHERE a.id = _album_id AND a.user_id = v_me) THEN
    RAISE EXCEPTION 'Album not found';
  END IF;
  IF coalesce(array_length(_post_ids, 1), 0) > 200 THEN RAISE EXCEPTION 'Up to 200 posts at a time'; END IF;
  IF coalesce(_in, true) THEN
    FOREACH v_id IN ARRAY coalesce(_post_ids, '{}'::uuid[]) LOOP
      IF public.community_saveable(v_id) THEN
        INSERT INTO public.community_saves (user_id, post_id) VALUES (v_me, v_id) ON CONFLICT DO NOTHING;
        INSERT INTO public.community_save_album_posts (album_id, user_id, post_id) VALUES (_album_id, v_me, v_id) ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;
  ELSE
    DELETE FROM public.community_save_album_posts ap WHERE ap.album_id = _album_id AND ap.post_id = ANY (coalesce(_post_ids, '{}'::uuid[]));
  END IF;
  UPDATE public.community_save_albums a SET updated_at = now() WHERE a.id = _album_id;
  RETURN jsonb_build_object('id', _album_id,
    'count', (SELECT count(*) FROM public.community_save_album_posts ap WHERE ap.album_id = _album_id));
END;
$$;

/** A new album, named, with any posts to start it. */
CREATE OR REPLACE FUNCTION public.community_album_create(_name text, _post_ids uuid[] DEFAULT '{}'::uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_me uuid := public.community_main_account(auth.uid());
  v_name text := public.community_album_name_clean(_name);
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF v_name IS NULL THEN RAISE EXCEPTION 'Give the album a name'; END IF;
  IF EXISTS (SELECT 1 FROM public.community_save_albums a WHERE a.user_id = v_me AND lower(btrim(a.name)) = lower(v_name)) THEN
    RAISE EXCEPTION 'You already have an album called that';
  END IF;
  IF (SELECT count(*) FROM public.community_save_albums a WHERE a.user_id = v_me) >= 100 THEN
    RAISE EXCEPTION 'That''s 100 albums. Delete one to make another.';
  END IF;
  INSERT INTO public.community_save_albums (user_id, name) VALUES (v_me, v_name) RETURNING id INTO v_id;
  IF coalesce(array_length(_post_ids, 1), 0) > 0 THEN PERFORM public.community_album_posts(v_id, _post_ids, true); END IF;
  RETURN jsonb_build_object('id', v_id, 'name', v_name,
    'count', (SELECT count(*) FROM public.community_save_album_posts ap WHERE ap.album_id = v_id));
END;
$$;

CREATE OR REPLACE FUNCTION public.community_album_rename(_album_id uuid, _name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_me uuid := public.community_main_account(auth.uid());
  v_name text := public.community_album_name_clean(_name);
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF v_name IS NULL THEN RAISE EXCEPTION 'Give the album a name'; END IF;
  IF EXISTS (SELECT 1 FROM public.community_save_albums a
              WHERE a.user_id = v_me AND a.id <> _album_id AND lower(btrim(a.name)) = lower(v_name)) THEN
    RAISE EXCEPTION 'You already have an album called that';
  END IF;
  UPDATE public.community_save_albums a SET name = v_name, updated_at = now() WHERE a.id = _album_id AND a.user_id = v_me;
  IF NOT FOUND THEN RAISE EXCEPTION 'Album not found'; END IF;
  RETURN jsonb_build_object('id', _album_id, 'name', v_name);
END;
$$;

/** Delete an album. Its posts stay in Saved. */
CREATE OR REPLACE FUNCTION public.community_album_delete(_album_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  DELETE FROM public.community_save_albums a WHERE a.id = _album_id AND a.user_id = public.community_main_account(auth.uid());
END;
$$;

/** Up to 4 covers for an album tile: newest first, only posts the viewer can still see. */
CREATE OR REPLACE FUNCTION public.community_save_covers(_post_ids uuid[])
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id,
           'path', coalesce(p.media_thumb_path, CASE WHEN p.media_type = 'image' THEN p.media_path END),
           'text', CASE WHEN p.media_path IS NULL THEN nullif(left(btrim(coalesce(p.quote, p.caption, '')), 40), '') END,
           'kind', CASE WHEN p.kind = 'note' THEN 'note' ELSE 'workout' END)
         ORDER BY x.o), '[]'::jsonb)
    FROM unnest(_post_ids) WITH ORDINALITY x(id, o)
    JOIN public.community_posts p ON p.id = x.id
$$;

/**
 * Your Saved, for the Saved page and the "Save to album" sheet: All posts and
 * every album, each with its count and up to 4 covers, newest album activity
 * first. With a post, each album says whether it holds it.
 */
CREATE OR REPLACE FUNCTION public.community_saved_albums(_post_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_me uuid := public.community_main_account(auth.uid());
  v_out jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  WITH saved AS (
    SELECT s.post_id, s.created_at FROM public.community_saves s
     WHERE s.user_id = v_me AND public.community_saveable(s.post_id)
  )
  SELECT jsonb_build_object(
    'all', jsonb_build_object(
      'count', (SELECT count(*) FROM saved),
      'covers', public.community_save_covers(ARRAY(SELECT sv.post_id FROM saved sv ORDER BY sv.created_at DESC LIMIT 4))),
    'albums', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', a.id, 'name', a.name, 'updated_at', a.updated_at,
               'count', (SELECT count(*) FROM public.community_save_album_posts ap JOIN saved sv ON sv.post_id = ap.post_id WHERE ap.album_id = a.id),
               'covers', public.community_save_covers(ARRAY(
                  SELECT ap.post_id FROM public.community_save_album_posts ap JOIN saved sv ON sv.post_id = ap.post_id
                   WHERE ap.album_id = a.id ORDER BY ap.added_at DESC LIMIT 4)),
               'has_post', CASE WHEN _post_id IS NOT NULL THEN EXISTS (
                  SELECT 1 FROM public.community_save_album_posts ap WHERE ap.album_id = a.id AND ap.post_id = _post_id) END)
             ORDER BY a.updated_at DESC, a.created_at DESC)
        FROM public.community_save_albums a WHERE a.user_id = v_me), '[]'::jsonb))
    INTO v_out;
  RETURN v_out;
END;
$$;

/** Saved posts (All, or one album), newest saved first, pages like the feed (feed_at = when it was saved / added). */
CREATE OR REPLACE FUNCTION public.community_saved_posts(_album_id uuid DEFAULT NULL, _limit integer DEFAULT 24,
                                                       _before_at timestamptz DEFAULT NULL, _before_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  uid uuid := auth.uid();
  v_me uuid := public.community_main_account(auth.uid());
  lim int := least(greatest(coalesce(_limit, 24), 1), 60);
  v_out jsonb;
BEGIN
  IF uid IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF _album_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.community_save_albums a WHERE a.id = _album_id AND a.user_id = v_me) THEN
    RAISE EXCEPTION 'Album not found';
  END IF;
  WITH src AS (
    SELECT s.post_id, coalesce(ap.added_at, s.created_at) AS at
      FROM public.community_saves s
      LEFT JOIN public.community_save_album_posts ap ON ap.album_id = _album_id AND ap.post_id = s.post_id
     WHERE s.user_id = v_me AND (_album_id IS NULL OR ap.album_id IS NOT NULL)
  ), page AS (
    SELECT src.post_id, src.at FROM src
     WHERE public.community_saveable(src.post_id)
       AND (_before_at IS NULL OR (src.at, src.post_id) < (_before_at, coalesce(_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
     ORDER BY src.at DESC, src.post_id DESC
     LIMIT lim + 1
  ), numbered AS (SELECT page.*, row_number() OVER (ORDER BY page.at DESC, page.post_id DESC) rn FROM page)
  SELECT jsonb_build_object(
           'posts', coalesce((SELECT jsonb_agg(public.community_post_json(n.post_id, uid) || jsonb_build_object('feed_at', n.at) ORDER BY n.rn)
                                FROM numbered n WHERE n.rn <= lim), '[]'::jsonb),
           'has_more', (SELECT count(*) FROM page) > lim)
    INTO v_out;
  RETURN v_out;
END;
$$;

-- ── Repost ──────────────────────────────────────────────────────────────────
/**
 * Repost (or take it back). `_set_note` sets the floating note to `_note`
 * (empty clears it); without it a repost keeps the note it has.
 */
CREATE OR REPLACE FUNCTION public.community_repost(_post_id uuid, _on boolean DEFAULT true, _note text DEFAULT NULL, _set_note boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  uid uuid := auth.uid();
  v_me uuid := public.community_main_account(auth.uid());
  v_note text := public.community_repost_note_clean(_note);
  v_why text;
  v_row public.community_reposts;
BEGIN
  IF uid IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF NOT coalesce(_on, true) THEN
    DELETE FROM public.community_reposts r WHERE r.user_id = v_me AND r.post_id = _post_id;
    RETURN jsonb_build_object('reposted', false, 'note', null,
      'count', (SELECT count(*) FROM public.community_reposts r WHERE r.post_id = _post_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.community_posts p
                  WHERE p.id = _post_id AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id)
                    AND (public.community_is_staff(uid) OR p.author_user_id NOT IN (SELECT public.community_blocked_authors()))) THEN
    RAISE EXCEPTION 'Post not found';
  END IF;
  v_why := public.community_repost_refusal(_post_id, uid);
  IF v_why IS NOT NULL THEN RAISE EXCEPTION '%', v_why; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.community_reposts r WHERE r.user_id = v_me AND r.post_id = _post_id)
     AND (SELECT count(*) FROM public.community_reposts r WHERE r.user_id = v_me AND r.created_at > now() - interval '1 day') >= 50 THEN
    RAISE EXCEPTION 'That''s a lot of reposts today. Try again tomorrow.';
  END IF;
  INSERT INTO public.community_reposts AS r (user_id, post_id, note, note_at)
  VALUES (v_me, _post_id, CASE WHEN _set_note THEN v_note END, CASE WHEN _set_note AND v_note IS NOT NULL THEN now() END)
  ON CONFLICT (user_id, post_id) DO UPDATE
    SET note = CASE WHEN _set_note THEN EXCLUDED.note ELSE r.note END,
        note_at = CASE WHEN _set_note THEN EXCLUDED.note_at ELSE r.note_at END
  RETURNING r.* INTO v_row;
  RETURN jsonb_build_object('reposted', true, 'note', v_row.note, 'at', v_row.created_at,
    'count', (SELECT count(*) FROM public.community_reposts r WHERE r.post_id = _post_id));
END;
$$;

/** Tells the author (Activity + push, like a like); taking a repost back takes the line away. */
CREATE OR REPLACE FUNCTION public.community_notify_on_repost()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_author uuid;
BEGIN
  BEGIN
    IF TG_OP = 'DELETE' THEN
      DELETE FROM public.community_notifications n
       WHERE n.kind = 'repost' AND n.post_id = OLD.post_id AND n.actor_user_id = public.community_main_account(OLD.user_id);
      RETURN NULL;
    END IF;
    PERFORM public.community_fill_win_label(NEW.post_id);
    SELECT p.author_user_id INTO v_author FROM public.community_posts p WHERE p.id = NEW.post_id;
    PERFORM public.community_notify(v_author, NEW.user_id, 'repost', NEW.post_id, NULL, NULL);
  EXCEPTION WHEN others THEN
    RAISE WARNING 'community_notify_on_repost: %', sqlerrm;
  END;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS community_reposts_notify ON public.community_reposts;
CREATE TRIGGER community_reposts_notify AFTER INSERT OR DELETE ON public.community_reposts
  FOR EACH ROW EXECUTE FUNCTION public.community_notify_on_repost();

/**
 * What someone reposted, for the Reposts tab on their profile, newest first
 * (feed_at = when they reposted it). Nothing when you can't see their account.
 */
CREATE OR REPLACE FUNCTION public.community_user_reposts(_user_id uuid, _limit integer DEFAULT 24,
                                                        _before_at timestamptz DEFAULT NULL, _before_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  uid uuid := auth.uid();
  v_them uuid := public.community_main_account(_user_id);
  v_staff boolean := public.community_is_staff(auth.uid());
  lim int := least(greatest(coalesce(_limit, 24), 1), 60);
  v_out jsonb;
BEGIN
  IF uid IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF NOT public.community_can_see_account(v_them)
     OR (NOT v_staff AND v_them IN (SELECT public.community_blocked_authors())) THEN
    RETURN jsonb_build_object('posts', '[]'::jsonb, 'has_more', false);
  END IF;
  WITH page AS (
    SELECT r.post_id, r.created_at AS at, r.note
      FROM public.community_reposts r
      JOIN public.community_posts p ON p.id = r.post_id
     WHERE r.user_id = v_them
       AND p.archived_at IS NULL
       AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id)
       AND (v_staff OR p.author_user_id NOT IN (SELECT public.community_blocked_authors()))
       AND (_before_at IS NULL OR (r.created_at, r.post_id) < (_before_at, coalesce(_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
     ORDER BY r.created_at DESC, r.post_id DESC
     LIMIT lim + 1
  ), numbered AS (SELECT page.*, row_number() OVER (ORDER BY page.at DESC, page.post_id DESC) rn FROM page)
  SELECT jsonb_build_object(
           'posts', coalesce((SELECT jsonb_agg(public.community_post_json(n.post_id, uid)
                                               || jsonb_build_object('feed_at', n.at,
                                                    'reposted_by', jsonb_build_array(public.community_author(v_them)
                                                      || jsonb_build_object('note', n.note, 'at', n.at, 'is_me', v_them = public.community_main_account(uid)))) ORDER BY n.rn)
                                FROM numbered n WHERE n.rn <= lim), '[]'::jsonb),
           'has_more', (SELECT count(*) FROM page) > lim)
    INTO v_out;
  RETURN v_out;
END;
$$;

-- ── The feed: a reposted post moves up to its latest repost you may see ──────
CREATE OR REPLACE FUNCTION public.community_feed(_limit integer DEFAULT 10, _before_at timestamptz DEFAULT NULL::timestamptz,
                                                _before_id uuid DEFAULT NULL::uuid, _author_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  v_me uuid := public.community_main_account(auth.uid());
  v_staff boolean := public.community_is_staff(auth.uid());
  lim int := least(greatest(coalesce(_limit, 10), 1), 30);
  result jsonb;
BEGIN
  IF NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  WITH blocked AS (SELECT public.community_blocked_authors() AS id),
  followed AS (SELECT public.community_followed_authors() AS id),
  -- reposts this viewer may see (none on a profile's own grid): their own, a
  -- public account's or one they follow (staff: all), never across a block
  seen_reposts AS (
    SELECT r.user_id, r.post_id, r.note, r.created_at
      FROM public.community_reposts r
      JOIN public.community_posts rp ON rp.id = r.post_id
      LEFT JOIN public.community_profiles cp ON cp.user_id = r.user_id
     WHERE _author_user_id IS NULL
       AND (v_staff OR r.user_id NOT IN (SELECT id FROM blocked))
       AND (r.user_id = v_me OR v_staff OR NOT coalesce(cp.is_private, false) OR r.user_id IN (SELECT id FROM followed))
       AND NOT public.chat_has_blocked(rp.author_user_id, r.user_id)
       AND NOT public.chat_has_blocked(r.user_id, rp.author_user_id)
       AND public.community_is_member(r.user_id)
  ),
  bumped AS (SELECT sr.post_id, max(sr.created_at) AS at FROM seen_reposts sr GROUP BY sr.post_id),
  page AS (
    SELECT p.id, greatest(p.created_at, coalesce(b.at, p.created_at)) AS at FROM public.community_posts p
      LEFT JOIN bumped b ON b.post_id = p.id
     WHERE (p.visibility = 'community'
            OR (p.visibility = 'coach' AND p.author_user_id <> uid AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id))
            OR (p.visibility = 'followers' AND (p.author_user_id = uid OR v_staff
                                                OR p.author_user_id IN (SELECT id FROM followed)))
            OR (p.visibility = 'close_friends' AND (p.author_user_id = uid OR v_staff
                                                    OR p.author_user_id IN (SELECT public.community_close_friend_authors())))
            OR (p.author_user_id = uid AND _author_user_id = uid))
       AND p.archived_at IS NULL
       AND (v_staff OR p.author_user_id NOT IN (SELECT id FROM blocked))
       AND (_author_user_id IS NULL OR p.author_user_id = _author_user_id
            OR _author_user_id = ANY (public.community_post_collab_ids(p.id)))
       AND (_before_at IS NULL OR (greatest(p.created_at, coalesce(b.at, p.created_at)), p.id)
                                  < (_before_at, coalesce(_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
     ORDER BY 2 DESC, p.id DESC
     LIMIT lim + 1
  ),
  numbered AS (SELECT page.*, row_number() OVER (ORDER BY page.at DESC, page.id DESC) rn FROM page)
  SELECT jsonb_build_object(
           'posts', coalesce((
             SELECT jsonb_agg(public.community_post_json(n.id, uid)
                              || jsonb_build_object(
                                   'feed_at', n.at,
                                   -- who reposted it, people you follow first, then you, then the newest
                                   'reposted_by', (SELECT jsonb_agg(public.community_author(x.user_id)
                                                                    || jsonb_build_object('note', x.note, 'at', x.created_at, 'is_me', x.user_id = v_me)
                                                                    ORDER BY x.rk, x.created_at DESC)
                                                     FROM (SELECT sr.user_id, sr.note, sr.created_at,
                                                                  CASE WHEN sr.user_id IN (SELECT id FROM followed) THEN 0 WHEN sr.user_id = v_me THEN 1 ELSE 2 END AS rk
                                                             FROM seen_reposts sr WHERE sr.post_id = n.id
                                                            ORDER BY rk, sr.created_at DESC LIMIT 3) x),
                                   'reposters_count', (SELECT count(*) FROM seen_reposts sr WHERE sr.post_id = n.id))
                              ORDER BY n.rn)
               FROM numbered n WHERE n.rn <= lim), '[]'::jsonb),
           'has_more', (SELECT count(*) FROM page) > lim)
    INTO result;
  RETURN result;
END;
$function$;

-- ── Crew's "N new": a repost you haven't seen counts like a new post ─────────
CREATE OR REPLACE FUNCTION public.community_activity()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  v_me uuid := public.community_main_account(auth.uid());
  v_staff boolean := public.community_is_staff(auth.uid());
  v_seen timestamptz;
  v_since timestamptz;
BEGIN
  IF NOT public.can_view_community() THEN RETURN jsonb_build_object('unseen', 0, 'seen_at', null, 'enabled', false); END IF;
  SELECT s.seen_at INTO v_seen FROM public.community_seen s WHERE s.user_id = uid;
  v_since := coalesce(v_seen, now() - interval '7 days');
  RETURN jsonb_build_object(
    'enabled', true,
    'seen_at', v_seen,
    'unseen', (SELECT count(*) FROM (
                 SELECT p.id FROM public.community_posts p
                  WHERE (p.visibility = 'community' OR (p.visibility = 'coach' AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id))
                      OR (p.visibility = 'followers' AND (v_staff OR p.author_user_id IN (SELECT public.community_followed_authors())))
                      OR (p.visibility = 'close_friends' AND (v_staff OR p.author_user_id IN (SELECT public.community_close_friend_authors()))))
                    AND p.author_user_id <> uid
                    AND NOT coalesce(p.auto_shared, false)
                    AND (v_staff OR p.author_user_id NOT IN (SELECT public.community_blocked_authors()))
                    AND p.created_at > v_since
                 UNION
                 SELECT p.id FROM public.community_reposts r
                   JOIN public.community_posts p ON p.id = r.post_id
                   LEFT JOIN public.community_profiles cp ON cp.user_id = r.user_id
                  WHERE r.created_at > v_since
                    AND r.user_id <> v_me
                    AND p.author_user_id NOT IN (uid, v_me)
                    AND p.archived_at IS NULL
                    AND (p.visibility = 'community'
                         OR (p.visibility = 'followers' AND (v_staff OR p.author_user_id IN (SELECT public.community_followed_authors()))))
                    AND (v_staff OR (p.author_user_id NOT IN (SELECT public.community_blocked_authors())
                                     AND r.user_id NOT IN (SELECT public.community_blocked_authors())))
                    AND (v_staff OR NOT coalesce(cp.is_private, false) OR r.user_id IN (SELECT public.community_followed_authors()))
                  LIMIT 99) x));
END;
$function$;

-- ── Existing functions, patched in place ─────────────────────────────────────
DO $patch$
DECLARE
  v_def text;
BEGIN
  -- Every post says whether you saved / reposted it, how many reposted it, and whether you can.
  -- (A second object: the first is at jsonb_build_object's 100-argument limit.)
  v_def := pg_get_functiondef('public.community_post_json(uuid, uuid)'::regprocedure);
  IF position('''repost_count''' IN v_def) = 0 THEN
    IF position('  FROM public.community_posts n' || E'\n' || '  LEFT JOIN public.pl_day_completions pc' IN v_def) = 0 THEN
      RAISE EXCEPTION 'community_post_json changed shape; patch by hand';
    END IF;
    v_def := replace(v_def, '  FROM public.community_posts n' || E'\n' || '  LEFT JOIN public.pl_day_completions pc',
         '  || jsonb_build_object(' || E'\n    '
      || '''saved'', EXISTS (SELECT 1 FROM public.community_saves sv WHERE sv.post_id = n.id AND sv.user_id = public.community_main_account(_viewer)),' || E'\n    '
      || '''my_repost'', (SELECT jsonb_build_object(''note'', rp.note, ''at'', rp.created_at) FROM public.community_reposts rp WHERE rp.post_id = n.id AND rp.user_id = public.community_main_account(_viewer)),' || E'\n    '
      || '''repost_count'', (SELECT count(*) FROM public.community_reposts rp WHERE rp.post_id = n.id),' || E'\n    '
      || '''can_repost'', public.community_repost_refusal(n.id, _viewer) IS NULL)' || E'\n'
      || '  FROM public.community_posts n' || E'\n' || '  LEFT JOIN public.pl_day_completions pc');
    EXECUTE v_def;
  END IF;

  -- Activity: "Kayla and 2 others reposted your post", with the latest note.
  v_def := pg_get_functiondef('public.community_my_notifications()'::regprocedure);
  IF position('''repost''' IN v_def) = 0 THEN
    IF position('CASE n.kind WHEN ''reaction'' THEN ''r:'' || n.post_id' IN v_def) = 0
       OR position('CASE WHEN n.kind = ''reaction'' THEN n.post_id' IN v_def) = 0
       OR position('''snippet'', (SELECT left(c.body, 90) FROM public.community_comments c WHERE c.id = g.comment_id),' IN v_def) = 0 THEN
      RAISE EXCEPTION 'community_my_notifications changed shape; patch by hand';
    END IF;
    v_def := replace(v_def, 'CASE n.kind WHEN ''reaction'' THEN ''r:'' || n.post_id',
                            'CASE n.kind WHEN ''reaction'' THEN ''r:'' || n.post_id WHEN ''repost'' THEN ''p:'' || n.post_id');
    v_def := replace(v_def, 'CASE WHEN n.kind = ''reaction'' THEN n.post_id',
                            'CASE WHEN n.kind IN (''reaction'', ''repost'') THEN n.post_id');
    v_def := replace(v_def, '''snippet'', (SELECT left(c.body, 90) FROM public.community_comments c WHERE c.id = g.comment_id),',
                            '''snippet'', coalesce((SELECT left(c.body, 90) FROM public.community_comments c WHERE c.id = g.comment_id),' || E'\n                        '
                         || '(SELECT rp.note FROM public.community_reposts rp WHERE g.kind = ''repost'' AND rp.post_id = g.post_id AND rp.user_id = g.actors[1])),');
    EXECUTE v_def;
  END IF;

  -- Pushes: several reposts of one post within the hour are one alert ("Kayla and 2 others reposted…").
  v_def := pg_get_functiondef('public.community_claim_pushes(uuid)'::regprocedure);
  IF position('''repost''' IN v_def) = 0 THEN
    IF position('AND CASE WHEN c.kind = ''reaction'' THEN o.post_id = c.post_id ELSE o.comment_id = c.comment_id END' IN v_def) = 0
       OR position('AND c.kind IN (''reaction'', ''comment_like'')' IN v_def) = 0 THEN
      RAISE EXCEPTION 'community_claim_pushes changed shape; patch by hand';
    END IF;
    v_def := replace(v_def, 'AND CASE WHEN c.kind = ''reaction'' THEN o.post_id = c.post_id ELSE o.comment_id = c.comment_id END',
                            'AND CASE WHEN c.kind IN (''reaction'', ''repost'') THEN o.post_id = c.post_id ELSE o.comment_id = c.comment_id END');
    v_def := replace(v_def, 'AND c.kind IN (''reaction'', ''comment_like'')',
                            'AND c.kind IN (''reaction'', ''comment_like'', ''repost'')');
    EXECUTE v_def;
  END IF;

  -- A profile says how many posts its person reposted (the Reposts tab shows when there are some).
  v_def := pg_get_functiondef('public.community_profile(uuid)'::regprocedure);
  IF position('''reposts''' IN v_def) = 0 THEN
    IF position('''training_since'', (SELECT min(pc.completed_at)' IN v_def) = 0 THEN
      RAISE EXCEPTION 'community_profile changed shape; patch by hand';
    END IF;
    v_def := replace(v_def, '''training_since'', (SELECT min(pc.completed_at)',
                            '''reposts'', CASE WHEN v_blocked THEN 0 ELSE (SELECT count(*) FROM public.community_reposts rp WHERE rp.user_id = v_them) END,' || E'\n    '
                         || '''training_since'', (SELECT min(pc.completed_at)');
    EXECUTE v_def;
  END IF;
END;
$patch$;

-- ── Who may call what ───────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.community_repost_note_clean(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.community_repost_note_clean(text) TO service_role;
REVOKE ALL ON FUNCTION public.community_album_name_clean(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.community_album_name_clean(text) TO service_role;
REVOKE ALL ON FUNCTION public.community_repost_refusal(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.community_repost_refusal(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.community_saveable(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.community_saveable(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.community_save_covers(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.community_save_covers(uuid[]) TO service_role;
REVOKE ALL ON FUNCTION public.community_notify_on_repost() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.community_save(uuid, boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_save(uuid, boolean, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.community_album_posts(uuid, uuid[], boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_album_posts(uuid, uuid[], boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.community_album_create(text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_album_create(text, uuid[]) TO authenticated;
REVOKE ALL ON FUNCTION public.community_album_rename(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_album_rename(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.community_album_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_album_delete(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.community_saved_albums(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_saved_albums(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.community_saved_posts(uuid, integer, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_saved_posts(uuid, integer, timestamptz, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.community_repost(uuid, boolean, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_repost(uuid, boolean, text, boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.community_user_reposts(uuid, integer, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_user_reposts(uuid, integer, timestamptz, uuid) TO authenticated;
