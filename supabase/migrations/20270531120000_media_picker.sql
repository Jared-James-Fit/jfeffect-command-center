-- GIFs and stickers everywhere (Nov 25 2026).
--
-- 1. The app's own library can hold stickers too (`chat_gifs.kind`), with its
--    size so bubbles keep their shape.
-- 2. One place for a person's favourite and recent GIFs / stickers, from any
--    provider (`user_media_saved`, own rows only). The old library-only
--    favourites / recents are copied in and kept untouched.
-- 3. A comment or post may carry a GIF or sticker from the library OR from
--    KLIPY's CDN (`is_allowed_media_url`), never any other link; comments take
--    `sticker` as a media type. Media-only comments stay allowed.
--
-- Additive and reversible: supabase/rollbacks/20270531120000_media_picker.down.sql

-- 1. Library stickers -------------------------------------------------------
ALTER TABLE public.chat_gifs ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'gif';
ALTER TABLE public.chat_gifs ADD COLUMN IF NOT EXISTS width integer;
ALTER TABLE public.chat_gifs ADD COLUMN IF NOT EXISTS height integer;
DO $$ BEGIN
  ALTER TABLE public.chat_gifs ADD CONSTRAINT chat_gifs_kind_check CHECK (kind IN ('gif', 'sticker'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS chat_gifs_media_url_idx ON public.chat_gifs (media_url);

-- 2. Favourites and recents, any provider ------------------------------------
CREATE TABLE IF NOT EXISTS public.user_media_saved (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ref text NOT NULL CHECK (char_length(ref) BETWEEN 3 AND 300),
  kind text NOT NULL CHECK (kind IN ('gif', 'sticker')),
  -- what's needed to draw and resend it without asking the provider again
  item jsonb NOT NULL CHECK (pg_column_size(item) < 4096),
  is_favorite boolean NOT NULL DEFAULT false,
  favorited_at timestamptz,
  last_used_at timestamptz,
  use_count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, ref)
);
CREATE INDEX IF NOT EXISTS user_media_saved_recent_idx ON public.user_media_saved (user_id, kind, last_used_at DESC) WHERE last_used_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS user_media_saved_fav_idx ON public.user_media_saved (user_id, kind, favorited_at DESC) WHERE is_favorite;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_media_saved TO authenticated;
GRANT ALL ON public.user_media_saved TO service_role;
ALTER TABLE public.user_media_saved ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Own saved media" ON public.user_media_saved;
CREATE POLICY "Own saved media" ON public.user_media_saved FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Keep a person's recents short: their 40 newest per kind (favourites never trimmed).
CREATE OR REPLACE FUNCTION public.tg_user_media_saved_trim()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  DELETE FROM public.user_media_saved s
   WHERE s.user_id = NEW.user_id AND s.kind = NEW.kind AND NOT s.is_favorite
     AND s.ref IN (
       SELECT x.ref FROM public.user_media_saved x
        WHERE x.user_id = NEW.user_id AND x.kind = NEW.kind AND NOT x.is_favorite
        ORDER BY x.last_used_at DESC NULLS LAST OFFSET 40);
  RETURN NULL;
END $f$;
DROP TRIGGER IF EXISTS user_media_saved_trim ON public.user_media_saved;
CREATE TRIGGER user_media_saved_trim AFTER INSERT ON public.user_media_saved
  FOR EACH ROW EXECUTE FUNCTION public.tg_user_media_saved_trim();

-- Copy the old library favourites / recents in (the old tables stay as they are).
INSERT INTO public.user_media_saved (user_id, ref, kind, item, is_favorite, favorited_at, last_used_at, use_count)
SELECT f.user_id, 'library:gif:' || g.id, 'gif',
       jsonb_build_object('ref', 'library:gif:' || g.id, 'provider', 'library', 'kind', 'gif', 'providerId', g.id,
                          'title', g.title, 'url', g.media_url, 'preview', coalesce(g.thumb_url, g.media_url),
                          'still', NULL, 'mp4', NULL, 'width', NULL, 'height', NULL, 'blur', NULL, 'category', g.category),
       true, f.created_at, r.used_at, CASE WHEN r.used_at IS NULL THEN 0 ELSE 1 END
  FROM public.chat_gif_favorites f
  JOIN public.chat_gifs g ON g.id = f.gif_id
  LEFT JOIN public.chat_gif_recent r ON r.user_id = f.user_id AND r.gif_id = f.gif_id
ON CONFLICT (user_id, ref) DO NOTHING;
INSERT INTO public.user_media_saved (user_id, ref, kind, item, is_favorite, last_used_at, use_count)
SELECT r.user_id, 'library:gif:' || g.id, 'gif',
       jsonb_build_object('ref', 'library:gif:' || g.id, 'provider', 'library', 'kind', 'gif', 'providerId', g.id,
                          'title', g.title, 'url', g.media_url, 'preview', coalesce(g.thumb_url, g.media_url),
                          'still', NULL, 'mp4', NULL, 'width', NULL, 'height', NULL, 'blur', NULL, 'category', g.category),
       false, r.used_at, 1
  FROM public.chat_gif_recent r
  JOIN public.chat_gifs g ON g.id = r.gif_id
ON CONFLICT (user_id, ref) DO NOTHING;

-- 3. Which links a comment / post may carry ----------------------------------
-- Comments take stickers (the old check only knew image / video / gif / audio).
ALTER TABLE public.community_comments DROP CONSTRAINT IF EXISTS community_comments_media_check;
ALTER TABLE public.community_comments ADD CONSTRAINT community_comments_media_check
  CHECK (((media_path IS NULL) = (media_type IS NULL)) AND ((media_type IS NULL) OR (media_type = ANY (ARRAY['image', 'video', 'gif', 'sticker', 'audio']))));

-- The app's library, or KLIPY's CDN (https, klipy.com or a subdomain, no
-- credentials / port). A post's sticker is marked by a `#sticker` fragment
-- (never sent to the CDN), so the library is matched without it.
-- Keep in step with isAllowedMediaUrl (src/lib/media/media.ts).
CREATE OR REPLACE FUNCTION public.is_allowed_media_url(_url text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT _url IS NOT NULL AND char_length(_url) <= 1000 AND (
    _url ~ '^https://([a-z0-9-]+\.)*klipy\.com/[^\s@]*$'
    OR EXISTS (SELECT 1 FROM public.chat_gifs g
                WHERE g.media_url = split_part(_url, '#', 1) OR g.thumb_url = split_part(_url, '#', 1))
  );
$f$;
REVOKE ALL ON FUNCTION public.is_allowed_media_url(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.is_allowed_media_url(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.community_add_comment(_post_id uuid, _body text, _parent_id uuid DEFAULT NULL::uuid, _media jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  v_body text := btrim(coalesce(_body, ''));
  v_path text := nullif(btrim(coalesce(_media->>'path', '')), '');
  v_thumb text := nullif(btrim(coalesce(_media->>'thumb', '')), '');
  v_type text := _media->>'type';
  v_dur numeric := CASE WHEN _media->>'duration' ~ '^[0-9]{1,4}(\.[0-9]+)?$' THEN (_media->>'duration')::numeric END;
  v_owner uuid;
  v_vis text;
  v_parent public.community_comments;
  v_top uuid;
  v_reply_to uuid;
  r public.community_comments;
BEGIN
  IF uid IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF char_length(v_body) > 300 THEN RAISE EXCEPTION 'Keep it under 300 characters'; END IF;
  IF v_body = '' AND v_path IS NULL THEN RAISE EXCEPTION 'Write something or add a photo'; END IF;
  IF v_path IS NOT NULL THEN
    IF v_type IS NULL OR v_type NOT IN ('image', 'video', 'gif', 'sticker', 'audio') THEN RAISE EXCEPTION 'Photos, videos, GIFs, stickers and voice memos only'; END IF;
    IF v_type IN ('gif', 'sticker') THEN
      -- a GIF / sticker is a link to the library or KLIPY, never anything else
      IF NOT public.is_allowed_media_url(v_path) THEN RAISE EXCEPTION 'Pick a GIF or sticker from the picker'; END IF;
      IF v_thumb IS NOT NULL AND NOT public.is_allowed_media_url(v_thumb) THEN v_thumb := NULL; END IF;
      IF v_thumb IS NULL THEN
        SELECT g.thumb_url INTO v_thumb FROM public.chat_gifs g WHERE g.media_url = v_path LIMIT 1;
      END IF;
    ELSIF split_part(v_path, '/', 1) <> uid::text OR (v_thumb IS NOT NULL AND split_part(v_thumb, '/', 1) <> uid::text) THEN
      RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
    END IF;
    IF v_type = 'audio' AND (v_dur IS NULL OR v_dur <= 0 OR v_dur > 121) THEN RAISE EXCEPTION 'Voice memos are up to 2 minutes'; END IF;
  END IF;
  SELECT p.author_user_id, p.visibility INTO v_owner, v_vis FROM public.community_posts p
   WHERE p.id = _post_id AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id);
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Post not found'; END IF;
  IF _parent_id IS NOT NULL THEN
    SELECT * INTO v_parent FROM public.community_comments c WHERE c.id = _parent_id AND c.post_id = _post_id;
    IF v_parent.id IS NULL OR NOT public.community_comment_readable(v_parent.post_id, v_parent.author_user_id, v_parent.hidden_at) THEN
      RAISE EXCEPTION 'That comment is gone';
    END IF;
    v_top := coalesce(v_parent.parent_id, v_parent.id);
    v_reply_to := v_parent.author_user_id;
  END IF;
  INSERT INTO public.community_comments (post_id, author_user_id, body, parent_id, reply_to_user_id,
                                         media_path, media_thumb_path, media_type, media_width, media_height, media_duration)
  VALUES (_post_id, uid, v_body, v_top, v_reply_to, v_path, CASE WHEN v_path IS NOT NULL THEN v_thumb END,
          CASE WHEN v_path IS NOT NULL THEN v_type END,
          CASE WHEN v_path IS NOT NULL AND _media->>'width' ~ '^[0-9]{1,5}(\.[0-9]+)?$' THEN (_media->>'width')::numeric::int END,
          CASE WHEN v_path IS NOT NULL AND _media->>'height' ~ '^[0-9]{1,5}(\.[0-9]+)?$' THEN (_media->>'height')::numeric::int END,
          CASE WHEN v_type = 'audio' THEN round(v_dur, 1) END)
  RETURNING * INTO r;
  RETURN public.community_comment_json(r, uid, v_owner, public.is_community_staff(), v_vis = 'community');
END;
$function$;

-- Posts: the GIF / sticker on a post follows the same rule.
CREATE OR REPLACE FUNCTION public.community_set_post_extras(_post_id uuid, _gif_url text, _audio_path text, _audio_duration numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  v_gif text := nullif(btrim(coalesce(_gif_url, '')), '');
  v_audio text := nullif(btrim(coalesce(_audio_path, '')), '');
  v_old text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT p.audio_path INTO v_old FROM public.community_posts p
   WHERE p.id = _post_id AND p.author_user_id = public.community_main_account(uid) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF v_gif IS NOT NULL AND NOT public.is_allowed_media_url(v_gif) THEN
    RAISE EXCEPTION 'Pick a GIF or sticker from the picker';
  END IF;
  IF v_audio IS NOT NULL AND v_audio IS DISTINCT FROM v_old THEN
    IF split_part(v_audio, '/', 1) <> uid::text THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
    IF _audio_duration IS NULL OR _audio_duration <= 0 OR _audio_duration > 121 THEN RAISE EXCEPTION 'Voice memos are up to 2 minutes'; END IF;
  END IF;
  UPDATE public.community_posts p
     SET gif_url = v_gif,
         audio_path = v_audio,
         audio_duration = CASE WHEN v_audio IS NULL THEN NULL WHEN v_audio IS DISTINCT FROM v_old THEN round(_audio_duration, 1) ELSE p.audio_duration END,
         auto_shared = false,
         updated_at = now()
   WHERE p.id = _post_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.community_set_post_extras(uuid, text, text, numeric) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.community_set_post_extras(uuid, text, text, numeric) TO authenticated;

-- 4. Story / post replies can be a GIF or sticker ---------------------------
-- The picked item as one chat attachment, checked: a library or KLIPY link
-- only, every field trimmed and typed. '[]' when nothing was picked.
CREATE OR REPLACE FUNCTION public.picked_media_attachment(_media jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  v_kind text := _media->>'kind';
  v_url text := btrim(coalesce(_media->>'url', ''));
  v_preview text := nullif(btrim(coalesce(_media->>'preview', '')), '');
  v_still text := nullif(btrim(coalesce(_media->>'still', '')), '');
BEGIN
  IF _media IS NULL OR jsonb_typeof(_media) <> 'object' THEN RETURN '[]'::jsonb; END IF;
  IF v_kind NOT IN ('gif', 'sticker') OR NOT public.is_allowed_media_url(v_url) THEN
    RAISE EXCEPTION 'Pick a GIF or sticker from the picker';
  END IF;
  RETURN jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
    'type', 'image',
    'kind', v_kind,
    'url', v_url,
    'name', left(coalesce(_media->>'name', ''), 120),
    'mime', CASE WHEN v_kind = 'sticker' THEN 'image/webp' ELSE 'image/gif' END,
    'width', CASE WHEN _media->>'width' ~ '^[0-9]{1,5}$' THEN (_media->>'width')::int END,
    'height', CASE WHEN _media->>'height' ~ '^[0-9]{1,5}$' THEN (_media->>'height')::int END,
    'preview', CASE WHEN public.is_allowed_media_url(v_preview) THEN v_preview END,
    'still', CASE WHEN public.is_allowed_media_url(v_still) THEN v_still END,
    'fallback_emoji', left(coalesce(_media->>'fallback_emoji', ''), 8))));
END $f$;
REVOKE ALL ON FUNCTION public.picked_media_attachment(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.picked_media_attachment(jsonb) TO authenticated, service_role;

-- community_message_author gains `_media` (rebuilt from the live definition,
-- one change each, so nothing else in it moves). The old 3-argument version
-- is dropped so calls never become ambiguous.
DO $$
DECLARE def text;
BEGIN
  def := pg_get_functiondef('public.community_message_author(uuid, text, boolean)'::regprocedure);
  def := replace(def, '_story boolean DEFAULT false)', '_story boolean DEFAULT false, _media jsonb DEFAULT NULL::jsonb)');
  IF position('_media jsonb DEFAULT NULL' in def) = 0 THEN RAISE EXCEPTION 'community_message_author: signature not found'; END IF;
  def := replace(def, $r$IF v_body = '' THEN RAISE EXCEPTION 'Write a message first'; END IF;$r$,
                      $r$IF v_body = '' AND public.picked_media_attachment(_media) = '[]'::jsonb THEN RAISE EXCEPTION 'Write a message first'; END IF;$r$);
  IF position('picked_media_attachment(_media) = ' in def) = 0 THEN RAISE EXCEPTION 'community_message_author: empty check not found'; END IF;
  def := replace(def, 'jsonb_build_array(v_card)', '(jsonb_build_array(v_card) || public.picked_media_attachment(_media))');
  IF position('|| public.picked_media_attachment(_media))' in def) = 0 THEN RAISE EXCEPTION 'community_message_author: attachments not found'; END IF;
  DROP FUNCTION public.community_message_author(uuid, text, boolean);
  EXECUTE def;
END $$;
REVOKE ALL ON FUNCTION public.community_message_author(uuid, text, boolean, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_message_author(uuid, text, boolean, jsonb) TO authenticated, service_role;
