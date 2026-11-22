-- Rollback for 20270503090000_lift_videos_in_chat.sql (lift videos sent in the
-- coach chat). Run only if that change has to come out; the app code that
-- calls chat_video_lift / chat_video_unlift and selects pl_set_videos.origin
-- must be reverted first, or chat videos and the logger's set videos stop
-- loading.
--
-- 1. chat lift videos come off (their reads go with them by the
--    set_video_analysis_follows_move trigger; the videos stay in the chat)
SET lock_timeout = '5s';
UPDATE public.messages m
   SET attachments = (
     SELECT jsonb_agg(CASE WHEN a -> 'set_video' ->> 'origin' = 'chat' THEN a - 'set_video' ELSE a END ORDER BY t.ord)
       FROM jsonb_array_elements(m.attachments) WITH ORDINALITY AS t(a, ord))
 WHERE jsonb_typeof(m.attachments) = 'array'
   AND m.attachments @> '[{"set_video": {"origin": "chat"}}]'::jsonb;
DELETE FROM public.pl_set_video_analyses a USING public.pl_set_videos v
 WHERE a.set_video_id = v.id AND v.origin = 'chat';
UPDATE public.pl_row_results r SET mean_concentric_velocity_mps = NULL, velocity_source = NULL, velocity_set_video_id = NULL
  FROM public.pl_set_videos v
 WHERE r.velocity_set_video_id = v.id AND v.origin = 'chat' AND r.velocity_source = 'video';
DELETE FROM public.pl_set_videos WHERE origin = 'chat';

-- 2. the functions as they were
DROP FUNCTION IF EXISTS public.chat_video_lift(uuid, text, uuid, integer, uuid, text, text, jsonb);
DROP FUNCTION IF EXISTS public.chat_video_unlift(uuid);
DROP FUNCTION IF EXISTS public._chat_lift_set_attachment(uuid, text, jsonb);

CREATE OR REPLACE FUNCTION public.set_video_needs_server_copy(v pl_set_videos)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $function$
  SELECT v.deleted_at IS NULL
     AND v.set_index > 0
     AND v.feed_path IS NULL
     AND v.storage_path ~ ('^' || v.client_id::text || '/set-videos/[A-Za-z0-9_]+(-[A-Za-z0-9_]+)*\.(mp4|mov|webm)$')
     AND v.storage_path !~ '-feed\.(mp4|mov|webm)$'
     AND coalesce(v.duration_s, 0) BETWEEN 0.5 AND 91.5
     AND coalesce(v.size_bytes, 0) >= 4194304
     AND (greatest(coalesce(v.width, 0), coalesce(v.height, 0)) > 1300 OR coalesce(v.size_bytes, 0) > 46137344)
$function$;

CREATE OR REPLACE FUNCTION public.set_video_remove(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v     public.pl_set_videos;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v FROM public.pl_set_videos WHERE id = _id;
  IF NOT FOUND OR v.deleted_at IS NOT NULL THEN RETURN; END IF;
  IF NOT (v.uploaded_by = v_uid
          OR EXISTS (SELECT 1 FROM public.clients c WHERE c.id = v.client_id AND c.user_id = v_uid)
          OR (SELECT public.has_role(v_uid, 'admin'::public.app_role))) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  UPDATE public.pl_set_videos SET deleted_at = now() WHERE id = _id;
  IF v.message_id IS NOT NULL THEN
    UPDATE public.messages
       SET deleted_at = now(), body = '', attachments = '[]'::jsonb
     WHERE id = v.message_id AND deleted_at IS NULL;
  END IF;
END
$function$;

-- set_video_move: REQUIRED before step 3 (the current version reads
-- pl_set_videos.origin and would fail once the column is gone): re-run its
-- definition from 20270420090000_set_video_move_warmups.sql here.

-- 3. the column
ALTER TABLE public.pl_set_videos DROP CONSTRAINT IF EXISTS pl_set_videos_set_needs_index;
ALTER TABLE public.pl_set_videos ALTER COLUMN set_index SET NOT NULL;
ALTER TABLE public.pl_set_videos DROP CONSTRAINT IF EXISTS pl_set_videos_origin_check;
ALTER TABLE public.pl_set_videos DROP COLUMN IF EXISTS origin;
NOTIFY pgrst, 'reload schema';
