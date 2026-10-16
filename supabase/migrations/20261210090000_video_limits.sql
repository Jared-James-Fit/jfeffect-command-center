-- Video limits, enforced by the server (src/lib/video-edit/limits.ts holds the same numbers).
--
-- Any recording up to 20 minutes can be picked; the phone trims it to the part
-- that's published (and shrinks it) before anything uploads. Nothing a phone
-- says can be trusted, so the server re-reads every uploaded video's header
-- (verifyVideoUploadFn, src/lib/video-verify.functions.ts) and records what it
-- found in media_video_checks. Every table that publishes a video then refuses
-- one that wasn't checked, was replaced after its check, or runs longer or
-- weighs more than its place allows:
--
--   Crew story 60 s, workout post 90 s, post 180 s, comment 60 s   50 MB (the bucket's own limit)
--   member 1:1 and crew chats                    300 s            120 MB
--   coach chats, coach-run groups, progress
--   videos, check-in videos, broadcasts          600 s            200 MB
--
-- Files uploaded before checking began (media_video_checks_since) stay as they
-- were: forwarding an old video still works.

CREATE TABLE IF NOT EXISTS public.media_video_checks (
  bucket      text        NOT NULL,
  path        text        NOT NULL,
  -- the storage object that was checked: a file replaced afterwards no longer passes
  object_id   uuid,
  owner       uuid        NOT NULL,
  duration_s  numeric(10,3) NOT NULL CHECK (duration_s >= 0),
  width       int,
  height      int,
  video_codec text,
  bytes       bigint      NOT NULL DEFAULT 0,
  mime        text,
  -- where the phone said it was going (the database decides by the table it lands in)
  context     text,
  -- what the phone did (mode, prep time, source length): for diagnosing real devices
  client      jsonb,
  checked_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket, path)
);
CREATE INDEX IF NOT EXISTS media_video_checks_owner_idx ON public.media_video_checks (owner, checked_at DESC);
ALTER TABLE public.media_video_checks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.media_video_checks FROM anon, authenticated;
GRANT ALL ON public.media_video_checks TO service_role;

-- When checking began: anything uploaded before it is grandfathered.
CREATE OR REPLACE FUNCTION public.media_video_checks_since()
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$ SELECT timestamptz '2026-10-16 09:00:00+00' $$;

-- The stored file (who uploaded it, how big): for the verify server function only.
CREATE OR REPLACE FUNCTION public.media_video_object(_bucket text, _path text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
           'id', o.id,
           'owner', coalesce(o.owner_id, o.owner::text),
           'created_at', o.created_at,
           'bytes', coalesce((o.metadata->>'size')::bigint, 0),
           'mime', o.metadata->>'mimetype')
  FROM storage.objects o
  WHERE o.bucket_id = _bucket AND o.name = _path
  ORDER BY o.created_at DESC
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.media_video_object(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.media_video_object(text, text) TO service_role;

/**
 * Raises (with words the app shows as they are) unless the video at
 * bucket/path was checked by the server, is still the file that was checked,
 * and fits: at most _max_s seconds (+1.5 s for container rounding) and
 * _max_bytes. Links and files shipped with the app aren't uploads.
 */
CREATE OR REPLACE FUNCTION public.media_video_allowed(_bucket text, _path text, _max_s numeric, _max_bytes bigint)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  c public.media_video_checks;
  v_obj uuid;
  v_at timestamptz;
BEGIN
  IF _path IS NULL OR _path = '' OR _path LIKE 'app:%' OR _path ~ '^https?://' THEN RETURN; END IF;
  SELECT * INTO c FROM public.media_video_checks WHERE bucket = _bucket AND path = _path;
  SELECT o.id, o.created_at INTO v_obj, v_at
    FROM storage.objects o WHERE o.bucket_id = _bucket AND o.name = _path
    ORDER BY o.created_at DESC LIMIT 1;
  IF c.path IS NULL THEN
    -- uploaded before videos were checked: as it was
    IF v_obj IS NOT NULL AND v_at < public.media_video_checks_since() THEN RETURN; END IF;
    RAISE EXCEPTION 'That video wasn''t checked yet. Close the app, open it again and send it once more.'
      USING ERRCODE = 'P0001', HINT = 'video_unchecked';
  END IF;
  IF v_obj IS NULL OR (c.object_id IS NOT NULL AND c.object_id <> v_obj) THEN
    RAISE EXCEPTION 'That video changed after it was checked. Pick it again.' USING ERRCODE = 'P0001', HINT = 'video_changed';
  END IF;
  IF c.duration_s > _max_s + 1.5 THEN
    RAISE EXCEPTION 'Videos here can be up to %. Trim it and try again.',
      CASE WHEN _max_s <= 90 THEN round(_max_s)::text || ' seconds' ELSE round(_max_s / 60)::text || ' minutes' END
      USING ERRCODE = 'P0001', HINT = 'video_too_long';
  END IF;
  IF c.bytes > _max_bytes THEN
    RAISE EXCEPTION 'That video is too big to send. Trim it shorter.' USING ERRCODE = 'P0001', HINT = 'video_too_big';
  END IF;
END
$$;
REVOKE ALL ON FUNCTION public.media_video_allowed(text, text, numeric, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.media_video_allowed(text, text, numeric, bigint) TO authenticated, service_role;

/* ---- Crew posts and stories --------------------------------------- */

CREATE OR REPLACE FUNCTION public.community_posts_video_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  -- a story 60 s, a workout's post 90 s, any other post 3 minutes
  v_max numeric := CASE WHEN NEW.story_only THEN 60 WHEN NEW.completion_id IS NOT NULL THEN 90 ELSE 180 END;
  v_stricter boolean := TG_OP = 'UPDATE' AND NEW.story_only AND NOT coalesce(OLD.story_only, false);
  s jsonb;
BEGIN
  IF NEW.media_type = 'video' AND (TG_OP = 'INSERT' OR v_stricter OR NEW.media_path IS DISTINCT FROM OLD.media_path) THEN
    PERFORM public.media_video_allowed('community-media', NEW.media_path, v_max, 52428800);
  END IF;
  FOR s IN
    SELECT e FROM jsonb_array_elements(CASE WHEN jsonb_typeof(NEW.extra_media) = 'array' THEN NEW.extra_media ELSE '[]'::jsonb END) e
    WHERE e->>'type' = 'video'
  LOOP
    -- only slides that are new here (or a post becoming a story)
    IF TG_OP = 'INSERT' OR v_stricter
       OR NOT (CASE WHEN jsonb_typeof(OLD.extra_media) = 'array' THEN OLD.extra_media ELSE '[]'::jsonb END) @> jsonb_build_array(jsonb_build_object('path', s->>'path')) THEN
      PERFORM public.media_video_allowed('community-media', s->>'path', v_max, 52428800);
    END IF;
  END LOOP;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS community_posts_video_guard ON public.community_posts;
CREATE TRIGGER community_posts_video_guard
  BEFORE INSERT OR UPDATE OF media_path, media_type, extra_media, story_only ON public.community_posts
  FOR EACH ROW EXECUTE FUNCTION public.community_posts_video_guard();

CREATE OR REPLACE FUNCTION public.community_comments_video_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.media_type = 'video' AND (TG_OP = 'INSERT' OR NEW.media_path IS DISTINCT FROM OLD.media_path) THEN
    PERFORM public.media_video_allowed('community-media', NEW.media_path, 60, 52428800);
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS community_comments_video_guard ON public.community_comments;
CREATE TRIGGER community_comments_video_guard
  BEFORE INSERT OR UPDATE OF media_path, media_type ON public.community_comments
  FOR EACH ROW EXECUTE FUNCTION public.community_comments_video_guard();

/* ---- Chats ---------------------------------------------------------- */

-- Each new video in a message's attachments (one already on the message is left alone).
CREATE OR REPLACE FUNCTION public.chat_attachments_video_guard(_new jsonb, _old jsonb, _max_s numeric, _max_bytes bigint)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  a jsonb;
  v_path text;
BEGIN
  IF jsonb_typeof(_new) <> 'array' THEN RETURN; END IF;
  FOR a IN SELECT e FROM jsonb_array_elements(_new) e WHERE e->>'type' = 'video' LOOP
    v_path := a->>'storage_path';
    IF v_path IS NULL THEN CONTINUE; END IF;
    IF jsonb_typeof(_old) = 'array' AND _old @> jsonb_build_array(jsonb_build_object('storage_path', v_path)) THEN CONTINUE; END IF;
    PERFORM public.media_video_allowed('message-attachments', v_path, _max_s, _max_bytes);
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION public.messages_video_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  -- a coach thread: 10 minutes
  IF jsonb_typeof(NEW.attachments) = 'array' AND NEW.attachments @> '[{"type":"video"}]'::jsonb THEN
    PERFORM public.chat_attachments_video_guard(NEW.attachments, CASE WHEN TG_OP = 'UPDATE' THEN OLD.attachments END, 600, 209715200);
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS messages_video_guard ON public.messages;
CREATE TRIGGER messages_video_guard
  BEFORE INSERT OR UPDATE OF attachments ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.messages_video_guard();

CREATE OR REPLACE FUNCTION public.group_messages_video_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_kind text;
BEGIN
  IF jsonb_typeof(NEW.attachments) = 'array' AND NEW.attachments @> '[{"type":"video"}]'::jsonb THEN
    v_kind := public.chat_kind(NEW.group_id);
    -- a member 1:1 or crew: 5 minutes; a coach-run group: 10
    PERFORM public.chat_attachments_video_guard(
      NEW.attachments,
      CASE WHEN TG_OP = 'UPDATE' THEN OLD.attachments END,
      CASE WHEN v_kind IN ('direct', 'crew') THEN 300 ELSE 600 END,
      CASE WHEN v_kind IN ('direct', 'crew') THEN 125829120 ELSE 209715200 END);
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS group_messages_video_guard ON public.group_messages;
CREATE TRIGGER group_messages_video_guard
  BEFORE INSERT OR UPDATE OF attachments ON public.group_messages
  FOR EACH ROW EXECUTE FUNCTION public.group_messages_video_guard();

/* ---- Progress videos, check-in videos, broadcasts (for / from the coach: 10 minutes) ---- */

CREATE OR REPLACE FUNCTION public.progress_media_video_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.media_type::text = 'video' AND (TG_OP = 'INSERT' OR NEW.storage_path IS DISTINCT FROM OLD.storage_path) THEN
    PERFORM public.media_video_allowed('progress-media', NEW.storage_path, 600, 209715200);
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS progress_media_video_guard ON public.progress_media;
CREATE TRIGGER progress_media_video_guard
  BEFORE INSERT OR UPDATE OF storage_path, media_type ON public.progress_media
  FOR EACH ROW EXECUTE FUNCTION public.progress_media_video_guard();

CREATE OR REPLACE FUNCTION public.nf_files_video_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.mime_type LIKE 'video/%' AND (TG_OP = 'INSERT' OR NEW.storage_path IS DISTINCT FROM OLD.storage_path) THEN
    PERFORM public.media_video_allowed('form-uploads', NEW.storage_path, 600, 209715200);
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS nf_files_video_guard ON public.nf_files;
CREATE TRIGGER nf_files_video_guard
  BEFORE INSERT OR UPDATE OF storage_path, mime_type ON public.nf_files
  FOR EACH ROW EXECUTE FUNCTION public.nf_files_video_guard();

CREATE OR REPLACE FUNCTION public.broadcasts_video_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.video_path IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.video_path IS DISTINCT FROM OLD.video_path) THEN
    PERFORM public.media_video_allowed('broadcast-media', NEW.video_path, 600, 209715200);
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS broadcasts_video_guard ON public.broadcasts;
CREATE TRIGGER broadcasts_video_guard
  BEFORE INSERT OR UPDATE OF video_path ON public.broadcasts
  FOR EACH ROW EXECUTE FUNCTION public.broadcasts_video_guard();
