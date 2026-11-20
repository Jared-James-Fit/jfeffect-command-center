-- Rollback for supabase/migrations/20270428090000_crew_feed_no_workout_cards.sql.
-- Puts every post the cleanup archived back exactly as it was (from
-- community_feed_cleanup_backup), then the four functions as production had
-- them on Nov 20 2026 (read with pg_get_functiondef before the change), then
-- drops what the migration added. Run as the database owner.

SET lock_timeout = '5s';
BEGIN;

-- the posts, as they were
UPDATE public.community_posts p
   SET visibility = b.visibility, archived_at = b.archived_at, archived_from = b.archived_from, archived_reason = NULL
  FROM public.community_feed_cleanup_backup b
 WHERE b.post_id = p.id AND b.batch = 'crew_feed_cleanup_2026_11_20' AND p.archived_reason IS NOT NULL;

CREATE OR REPLACE FUNCTION public.community_post_xp_sync(_client uuid, _day date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  k text := 'community_post:' || _day::text;
  v_id uuid;
  v_at timestamptz;
begin
  if _client is null or _day is null then return; end if;

  select cp.id, cp.created_at into v_id, v_at
  from public.community_posts cp
  join public.pl_day_completions pc on pc.id = cp.completion_id
  where cp.client_id = _client
    and cp.kind = 'workout'
    and cp.visibility in ('community', 'followers')
    and cp.archived_at is null
    and not cp.auto_shared
    and pc.completed_at is not null
    and pc.completed_at >= cp.created_at - interval '7 days'
    and (cp.created_at at time zone public.league_tz())::date = _day
  order by cp.created_at, cp.id
  limit 1;

  if not found then
    delete from public.athlete_xp_events where client_id = _client and source_key = k;
    return;
  end if;

  perform public.award_athlete_xp(_client, 'community_post', 'community_posts', v_id, k, 40,
    'Shared a workout to the Community', v_at);
  -- The day's event follows whichever eligible post came first.
  update public.athlete_xp_events set source_id = v_id, occurred_at = v_at
   where client_id = _client and source_key = k and source_id is distinct from v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.community_my_archived()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(public.community_post_json(p.id, uid) ORDER BY p.archived_at DESC)
      FROM public.community_posts p
     WHERE p.archived_at IS NOT NULL
       AND (p.author_user_id = uid OR p.author_user_id = public.community_main_account(uid))), '[]'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.community_archive_post(_post_id uuid, _archive boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.community_is_post_author(_post_id) THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF coalesce(_archive, true) THEN
    UPDATE public.community_posts SET archived_from = visibility, visibility = 'private', archived_at = now(), updated_at = now()
     WHERE id = _post_id AND archived_at IS NULL;
  ELSE
    UPDATE public.community_posts SET visibility = coalesce(archived_from, 'community'), archived_from = NULL, archived_at = NULL, updated_at = now()
     WHERE id = _post_id AND archived_at IS NOT NULL;
  END IF;
END;
$function$;

-- community_save_post as it was (no archived_reason, no photo-or-clip rule)
CREATE OR REPLACE FUNCTION public.community_save_post(_completion_id uuid, _caption text DEFAULT NULL::text, _visibility text DEFAULT 'community'::text, _media_action text DEFAULT 'keep'::text, _media_path text DEFAULT NULL::text, _media_thumb_path text DEFAULT NULL::text, _media_type text DEFAULT NULL::text, _media_width integer DEFAULT NULL::integer, _media_height integer DEFAULT NULL::integer, _hide_loads boolean DEFAULT NULL::boolean, _extra_media jsonb DEFAULT NULL::jsonb, _lock_in boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  v_client uuid;
  v_cap text := nullif(btrim(coalesce(_caption, '')), '');
  v_id uuid;
  v_done boolean;
  v_lock boolean;
  v_prefix text := uid::text || '/';
  v_extra jsonb;
  v_cover_type text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF _visibility NOT IN ('community', 'followers', 'close_friends', 'coach', 'private') THEN RAISE EXCEPTION 'Invalid visibility'; END IF;
  IF _media_action NOT IN ('keep', 'set', 'remove') THEN RAISE EXCEPTION 'Invalid media action'; END IF;
  IF v_cap IS NOT NULL AND char_length(v_cap) > 2200 THEN RAISE EXCEPTION 'Caption too long'; END IF;
  SELECT pc.client_id, pc.completed_at IS NOT NULL INTO v_client, v_done
    FROM public.pl_day_completions pc JOIN public.clients c ON c.id = pc.client_id
   WHERE pc.id = _completion_id AND c.user_id = uid
     AND (pc.completed_at IS NOT NULL OR pc.started_at IS NOT NULL OR pc.in_progress_at IS NOT NULL);
  IF v_client IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF _visibility IN ('community', 'followers', 'close_friends') AND NOT public.can_view_community() THEN
    RAISE EXCEPTION 'Community is not available on this account' USING ERRCODE = '42501';
  END IF;
  v_lock := coalesce(_lock_in, false) OR NOT v_done;
  IF _media_action = 'set' THEN
    IF _media_type NOT IN ('image', 'video') OR _media_path IS NULL
       OR left(_media_path, length(v_prefix)) <> v_prefix
       OR (_media_thumb_path IS NOT NULL AND left(_media_thumb_path, length(v_prefix)) <> v_prefix) THEN
      RAISE EXCEPTION 'Invalid media';
    END IF;
  END IF;
  IF _extra_media IS NOT NULL AND _media_action <> 'remove' THEN
    IF jsonb_typeof(_extra_media) <> 'array' THEN RAISE EXCEPTION 'Invalid media'; END IF;
    IF jsonb_array_length(_extra_media) > 9 THEN RAISE EXCEPTION 'Up to 10 photos or videos on a post'; END IF;
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'path', x.e->>'path', 'thumb', nullif(x.e->>'thumb', ''), 'type', x.e->>'type',
             'width', CASE WHEN x.e->>'width' ~ '^[0-9]{1,5}(\.[0-9]+)?$' THEN round((x.e->>'width')::numeric)::int END,
             'height', CASE WHEN x.e->>'height' ~ '^[0-9]{1,5}(\.[0-9]+)?$' THEN round((x.e->>'height')::numeric)::int END)
           ORDER BY x.i), '[]'::jsonb)
      INTO v_extra
      FROM jsonb_array_elements(_extra_media) WITH ORDINALITY AS x(e, i);
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_extra) e
                WHERE e->>'type' IS NULL OR e->>'type' NOT IN ('image', 'video')
                   OR e->>'path' IS NULL OR left(e->>'path', length(v_prefix)) <> v_prefix
                   OR (e->>'thumb' IS NOT NULL AND left(e->>'thumb', length(v_prefix)) <> v_prefix)) THEN
      RAISE EXCEPTION 'Invalid media';
    END IF;
  END IF;
  v_cover_type := CASE _media_action
                    WHEN 'set' THEN _media_type
                    WHEN 'remove' THEN NULL
                    ELSE (SELECT p.media_type FROM public.community_posts p
                           WHERE p.completion_id = _completion_id AND (p.locked_in_at IS NOT NULL) = v_lock) END;
  IF (CASE WHEN v_cover_type = 'video' THEN 1 ELSE 0 END)
     + coalesce((SELECT count(*) FROM jsonb_array_elements(coalesce(v_extra,
          CASE WHEN _media_action = 'remove' THEN '[]'::jsonb
               ELSE (SELECT p.extra_media FROM public.community_posts p
                      WHERE p.completion_id = _completion_id AND (p.locked_in_at IS NOT NULL) = v_lock) END,
          '[]'::jsonb)) e WHERE e->>'type' = 'video'), 0) > 3 THEN
    RAISE EXCEPTION 'Up to 3 videos on a post';
  END IF;
  INSERT INTO public.community_posts AS p (
    author_user_id, client_id, completion_id, caption, visibility,
    media_path, media_thumb_path, media_type, media_width, media_height, locked_in_at, hide_loads, extra_media)
  VALUES (
    uid, v_client, _completion_id, v_cap, _visibility,
    CASE WHEN _media_action = 'set' THEN _media_path END,
    CASE WHEN _media_action = 'set' THEN _media_thumb_path END,
    CASE WHEN _media_action = 'set' THEN _media_type END,
    CASE WHEN _media_action = 'set' THEN _media_width END,
    CASE WHEN _media_action = 'set' THEN _media_height END,
    CASE WHEN v_lock THEN now() ELSE NULL END,
    coalesce(_hide_loads, false),
    coalesce(v_extra, '[]'::jsonb))
  ON CONFLICT (completion_id, (locked_in_at IS NOT NULL)) DO UPDATE SET
    caption = EXCLUDED.caption,
    visibility = EXCLUDED.visibility,
    media_path = CASE _media_action WHEN 'keep' THEN p.media_path ELSE EXCLUDED.media_path END,
    media_thumb_path = CASE _media_action WHEN 'keep' THEN p.media_thumb_path ELSE EXCLUDED.media_thumb_path END,
    media_type = CASE _media_action WHEN 'keep' THEN p.media_type ELSE EXCLUDED.media_type END,
    media_width = CASE _media_action WHEN 'keep' THEN p.media_width ELSE EXCLUDED.media_width END,
    media_height = CASE _media_action WHEN 'keep' THEN p.media_height ELSE EXCLUDED.media_height END,
    extra_media = CASE WHEN _media_action = 'remove' THEN '[]'::jsonb WHEN v_extra IS NOT NULL THEN v_extra ELSE p.extra_media END,
    hide_loads = coalesce(_hide_loads, p.hide_loads),
    edited_at = CASE WHEN p.caption IS DISTINCT FROM EXCLUDED.caption THEN now() ELSE p.edited_at END,
    archived_at = NULL,
    archived_from = NULL,
    auto_shared = false,
    updated_at = now()
  RETURNING p.id INTO v_id;
  UPDATE public.community_posts p
     SET media_path = p.extra_media->0->>'path', media_thumb_path = p.extra_media->0->>'thumb',
         media_type = p.extra_media->0->>'type', media_width = (p.extra_media->0->>'width')::int,
         media_height = (p.extra_media->0->>'height')::int, extra_media = p.extra_media - 0
   WHERE p.id = v_id AND p.media_path IS NULL AND jsonb_array_length(p.extra_media) > 0;
  RETURN jsonb_build_object('id', v_id);
END;
$function$;

DROP TRIGGER IF EXISTS community_posts_clear_archived_reason ON public.community_posts;
DROP FUNCTION IF EXISTS public.community_posts_clear_archived_reason();
DROP FUNCTION IF EXISTS public.community_is_workout_card(uuid);
ALTER TABLE public.community_posts DROP CONSTRAINT IF EXISTS community_posts_archived_reason_check;
ALTER TABLE public.community_posts DROP COLUMN IF EXISTS archived_reason;
-- keep community_feed_cleanup_backup until you're sure; then:
-- DROP TABLE public.community_feed_cleanup_backup;

COMMIT;
