-- Members post like they would anywhere: a photo, a carousel, a clip or a
-- few words, without it having to be a workout. Same shape as the coach's
-- notes (kind 'note': a caption + media), so the feed, cards, edits,
-- comments, reactions, mentions, reports and the coach's Remove all work on
-- it unchanged.
--   * Never League points: those only follow shared workouts
--     (community_post_xp_sync looks at kind = 'workout').
--   * Who sees it: the crew, just the coach, or only me.
--   * Media must be the poster's own uploads (community_clean_media).
--   * At most 25 a day, so a stuck button or a script can't flood the feed.
CREATE OR REPLACE FUNCTION public.community_create_post(_caption text DEFAULT NULL::text, _media jsonb DEFAULT NULL::jsonb, _visibility text DEFAULT 'community'::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  v_author uuid;
  v_client uuid;
  v_cap text := nullif(btrim(coalesce(_caption, '')), '');
  v_media jsonb;
  v_id uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF _visibility NOT IN ('community', 'coach', 'private') THEN RAISE EXCEPTION 'Invalid visibility'; END IF;
  IF _visibility = 'community' AND NOT public.can_view_community() THEN
    RAISE EXCEPTION 'Community is not available on this account' USING ERRCODE = '42501';
  END IF;
  IF v_cap IS NOT NULL AND char_length(v_cap) > 1200 THEN RAISE EXCEPTION 'Keep it to 1200 characters'; END IF;
  v_media := public.community_clean_media(_media, uid);
  IF v_cap IS NULL AND jsonb_array_length(v_media) = 0 THEN RAISE EXCEPTION 'Add a photo or write something'; END IF;
  v_author := public.community_main_account(uid);
  SELECT c.id INTO v_client FROM public.clients c WHERE c.user_id = v_author LIMIT 1;
  IF v_client IS NULL AND NOT public.community_is_coach(uid) THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF (SELECT count(*) FROM public.community_posts p WHERE p.author_user_id = v_author AND p.kind = 'note' AND p.created_at > now() - interval '1 day') >= 25 THEN
    RAISE EXCEPTION 'That''s a lot of posts today. Try again tomorrow.';
  END IF;
  INSERT INTO public.community_posts (author_user_id, client_id, kind, visibility, caption)
  VALUES (v_author, v_client, 'note', _visibility, v_cap)
  RETURNING id INTO v_id;
  IF jsonb_array_length(v_media) > 0 THEN PERFORM public.community_apply_media(v_id, v_media); END IF;
  RETURN jsonb_build_object('id', v_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.community_create_post(text, jsonb, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.community_create_post(text, jsonb, text) TO authenticated;

-- A photo post can go without words: editing one may clear its caption.
DO $$
DECLARE def text;
BEGIN
  def := pg_get_functiondef('public.community_update_note(uuid, text)'::regprocedure);
  def := replace(def,
    $r$  IF v_body = '' OR char_length(v_body) > 1200 THEN RAISE EXCEPTION 'Write 1–1200 characters'; END IF;$r$,
    $r$  IF char_length(v_body) > 1200 THEN RAISE EXCEPTION 'Write 1–1200 characters'; END IF;
  IF v_body = '' AND NOT EXISTS (SELECT 1 FROM public.community_posts p WHERE p.id = _post_id AND p.media_path IS NOT NULL) THEN
    RAISE EXCEPTION 'Write 1–1200 characters';
  END IF;$r$);
  def := replace(def, $r$SET caption = v_body,$r$, $r$SET caption = nullif(v_body, ''),$r$);
  IF position('p.media_path IS NOT NULL' in def) = 0 OR position('nullif(v_body, '''')' in def) = 0 THEN
    RAISE EXCEPTION 'community_update_note: anchors not found';
  END IF;
  EXECUTE def;
END $$;
