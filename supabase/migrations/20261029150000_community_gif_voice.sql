-- GIFs and voice memos, in comments and on posts.
--   GIF: one from the app's GIF library (chat_gifs), stored by its URL.
--   Voice memo: the author's own recording in the community bucket
--   ("<uid>/…"), up to 2 minutes, played in place.
UPDATE storage.buckets
   SET allowed_mime_types = (SELECT array_agg(DISTINCT t) FROM unnest(coalesce(allowed_mime_types, '{}') || ARRAY['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/aac', 'audio/x-m4a', 'audio/wav']) t)
 WHERE id = 'community-media';

-- Comments
ALTER TABLE public.community_comments ADD COLUMN IF NOT EXISTS media_duration numeric;
ALTER TABLE public.community_comments DROP CONSTRAINT IF EXISTS community_comments_media_check;
ALTER TABLE public.community_comments ADD CONSTRAINT community_comments_media_check
  CHECK (((media_path IS NULL) = (media_type IS NULL)) AND ((media_type IS NULL) OR (media_type = ANY (ARRAY['image', 'video', 'gif', 'audio']))));

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
    IF v_type IS NULL OR v_type NOT IN ('image', 'video', 'gif', 'audio') THEN RAISE EXCEPTION 'Photos, videos, GIFs and voice memos only'; END IF;
    IF v_type = 'gif' THEN
      SELECT g.thumb_url INTO v_thumb FROM public.chat_gifs g WHERE g.media_url = v_path LIMIT 1;
      IF NOT FOUND THEN RAISE EXCEPTION 'Pick a GIF from the library'; END IF;
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
          CASE WHEN v_path IS NOT NULL THEN nullif(_media->>'width', '')::numeric::int END,
          CASE WHEN v_path IS NOT NULL THEN nullif(_media->>'height', '')::numeric::int END,
          CASE WHEN v_type = 'audio' THEN round(v_dur, 1) END)
  RETURNING * INTO r;
  RETURN public.community_comment_json(r, uid, v_owner, public.is_community_staff(), v_vis = 'community');
END;
$function$;

-- Posts: one GIF and / or one voice memo.
ALTER TABLE public.community_posts ADD COLUMN IF NOT EXISTS gif_url text;
ALTER TABLE public.community_posts ADD COLUMN IF NOT EXISTS audio_path text;
ALTER TABLE public.community_posts ADD COLUMN IF NOT EXISTS audio_duration numeric;

-- Set (or clear, with nulls) a post's GIF and voice memo: its author only.
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
  IF v_gif IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.chat_gifs g WHERE g.media_url = v_gif) THEN
    RAISE EXCEPTION 'Pick a GIF from the library';
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

-- Rebuilt from the live definitions, one expression each:
DO $$
DECLARE def text;
BEGIN
  def := pg_get_functiondef('public.community_comment_json(community_comments, uuid, uuid, boolean, boolean)'::regprocedure);
  def := replace(def, $r$'width', c.media_width, 'height', c.media_height) END,$r$, $r$'width', c.media_width, 'height', c.media_height, 'duration', c.media_duration) END,$r$);
  IF position('''duration'', c.media_duration' in def) = 0 THEN RAISE EXCEPTION 'community_comment_json: media not found'; END IF;
  EXECUTE def;

  def := pg_get_functiondef('public.community_post_json(uuid, uuid)'::regprocedure);
  def := replace(def, $r$    'hide_loads', n.hide_loads,$r$, $r$    'hide_loads', n.hide_loads,
    'gif_url', n.gif_url,
    'audio', CASE WHEN n.audio_path IS NOT NULL THEN jsonb_build_object('path', n.audio_path, 'duration', n.audio_duration) END,$r$);
  IF position('''gif_url'', n.gif_url' in def) = 0 THEN RAISE EXCEPTION 'community_post_json: hide_loads not found'; END IF;
  EXECUTE def;
END $$;
