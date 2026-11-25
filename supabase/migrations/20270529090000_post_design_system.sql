-- Automated posts' design system (Nov 25 2026, post-design.ts).
--
-- Every automated post's card is painted on the viewer's phone from the
-- post's own data, keyed by a design version (post-art.ts), so the new look
-- reaches every existing post in place the moment the app updates: nothing
-- here touches a card. What this migration does for posts already out:
--
--   1. Deck cover headlines too long to read in the profile grid are
--      tightened by a background job (post-headlines.server.ts), checked by
--      code, written in place (same id, date, likes, comments, views, saves,
--      reposts; updated_at put back), the old title kept in
--      community_post_headlines for Undo. A post the coach edited is skipped.
--   2. Athlete Insight pictures in the old anime look are remade in the new
--      athletic look (FILM_LOOK_VERSION athletic_v3), captions kept, each old
--      picture kept by community_daily_visuals_keep_version for Restore, the
--      post updated in place by community_daily_visual_sync_post.
--
-- Idempotent: every statement can run twice. Rollback:
-- docs/rollback/2026-11-25-post-design-system-rollback.sql.

SET lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Cover headlines
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.community_post_headlines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid REFERENCES public.community_posts(id) ON DELETE CASCADE,
  item_id uuid REFERENCES public.community_series_items(id) ON DELETE CASCADE,
  version int NOT NULL,
  -- kept (it reads in the grid), done (rewritten in place), failed (no rewrite passed), skipped (edited / changed / no deck)
  status text NOT NULL CHECK (status IN ('kept', 'done', 'failed', 'skipped', 'undone')),
  old_title text,
  new_title text,
  problems jsonb,
  model text,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (post_id IS NOT NULL OR item_id IS NOT NULL),
  UNIQUE (post_id, version),
  UNIQUE (item_id, version)
);

ALTER TABLE public.community_post_headlines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_post_headlines FROM anon, authenticated;
GRANT SELECT ON public.community_post_headlines TO authenticated;
DROP POLICY IF EXISTS "Staff read headline passes" ON public.community_post_headlines;
CREATE POLICY "Staff read headline passes" ON public.community_post_headlines FOR SELECT TO authenticated
  USING ((SELECT public.is_community_staff()));

-- The next decks not looked at for this version: posts out first (newest first, what the grid shows), then the library.
CREATE OR REPLACE FUNCTION public.community_post_headlines_next(_version int, _limit int DEFAULT 4)
RETURNS TABLE (kind text, id uuid, title text, deck jsonb, edited boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  (SELECT 'post'::text, p.id, p.series_data #>> '{deck,slides,0,title}', p.series_data -> 'deck', p.edited_at IS NOT NULL
     FROM public.community_posts p
    WHERE p.series IS NOT NULL AND p.archived_at IS NULL AND coalesce(p.story_only, false) = false
      AND jsonb_typeof(p.series_data -> 'deck') = 'object'
      AND NOT EXISTS (SELECT 1 FROM public.community_post_headlines h WHERE h.post_id = p.id AND h.version = _version)
    ORDER BY p.created_at DESC
    LIMIT _limit)
  UNION ALL
  (SELECT 'item'::text, i.id, i.data #>> '{deck,slides,0,title}', i.data -> 'deck', false
     FROM public.community_series_items i
    WHERE jsonb_typeof(i.data -> 'deck') = 'object'
      AND NOT EXISTS (SELECT 1 FROM public.community_post_headlines h WHERE h.item_id = i.id AND h.version = _version)
      -- an item whose post is out is handled with the post
      AND NOT EXISTS (SELECT 1 FROM public.community_posts p WHERE p.series_item_id = i.id AND p.archived_at IS NULL AND jsonb_typeof(p.series_data -> 'deck') = 'object')
    ORDER BY i.created_at
    LIMIT _limit)
  LIMIT _limit;
$$;

-- Write a tightened cover in place: only while the title is still the one read; the post keeps its updated_at.
CREATE OR REPLACE FUNCTION public.community_post_headline_apply(_post uuid, _item uuid, _old text, _new text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated timestamptz;
  v_item uuid;
  v_n int;
BEGIN
  IF coalesce(btrim(_new), '') = '' OR coalesce(btrim(_old), '') = '' THEN RETURN 'empty'; END IF;
  IF _post IS NOT NULL THEN
    SELECT p.updated_at, p.series_item_id INTO v_updated, v_item FROM public.community_posts p WHERE p.id = _post FOR UPDATE;
    IF NOT FOUND THEN RETURN 'missing'; END IF;
    UPDATE public.community_posts p
       SET series_data = jsonb_set(p.series_data, '{deck,slides,0,title}', to_jsonb(_new))
     WHERE p.id = _post AND p.edited_at IS NULL AND p.series_data #>> '{deck,slides,0,title}' = _old;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n = 0 THEN RETURN 'changed'; END IF;
    UPDATE public.community_posts SET updated_at = v_updated WHERE id = _post;
    -- the library item it came from, while its deck still says the same
    IF v_item IS NOT NULL THEN
      UPDATE public.community_series_items i
         SET data = jsonb_set(i.data, '{deck,slides,0,title}', to_jsonb(_new))
       WHERE i.id = v_item AND i.data #>> '{deck,slides,0,title}' = _old;
    END IF;
    RETURN 'applied';
  END IF;
  IF _item IS NOT NULL THEN
    UPDATE public.community_series_items i
       SET data = jsonb_set(i.data, '{deck,slides,0,title}', to_jsonb(_new))
     WHERE i.id = _item AND i.data #>> '{deck,slides,0,title}' = _old;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN CASE WHEN v_n > 0 THEN 'applied' ELSE 'changed' END;
  END IF;
  RETURN 'missing';
END;
$$;

-- Undo one: the old title back, only while the new one is still there.
CREATE OR REPLACE FUNCTION public.community_post_headline_undo(_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  h public.community_post_headlines%ROWTYPE;
  v_res text;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT (SELECT public.is_community_staff()) THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO h FROM public.community_post_headlines WHERE id = _id FOR UPDATE;
  IF NOT FOUND OR h.status <> 'done' THEN RETURN 'not applied'; END IF;
  v_res := public.community_post_headline_apply(h.post_id, h.item_id, h.new_title, h.old_title);
  IF v_res = 'applied' THEN UPDATE public.community_post_headlines SET status = 'undone' WHERE id = _id; END IF;
  RETURN v_res;
END;
$$;

-- Wake the job while anything's left (one batch at a time).
CREATE OR REPLACE FUNCTION public.community_post_headlines_kick()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.community_post_headlines_next(1, 1)) THEN RETURN false; END IF;
  PERFORM net.http_post(
    url := 'https://project--5f1f340c-5afa-4262-90c8-1f9406568c6c.lovable.app/api/public/hooks/post-headlines-tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-hook-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_hook_secret' LIMIT 1)),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000);
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.community_post_headlines_next(int, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.community_post_headline_apply(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.community_post_headline_undo(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.community_post_headlines_kick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.community_post_headlines_next(int, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.community_post_headline_apply(uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.community_post_headline_undo(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.community_post_headlines_kick() TO service_role;

DO $$
BEGIN
  PERFORM cron.unschedule('community-post-headlines') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'community-post-headlines');
  PERFORM cron.schedule('community-post-headlines', '7,22,37,52 * * * *', 'select public.community_post_headlines_kick();');
END $$;

-- ---------------------------------------------------------------------------
-- 2. Athlete Insight pictures: the old anime look remade in the athletic look
--    (captions kept; the remake picks photography or a technical drawing)
-- ---------------------------------------------------------------------------
UPDATE public.community_daily_visuals v
   SET regen = 'picture', regen_reason = 'restyle', regen_style = NULL, candidate = NULL, attempts = 0, error = NULL,
       approved_at = NULL, updated_at = now()
 WHERE v.status IN ('ready', 'posted') AND v.picture IS NOT NULL AND v.regen IS NULL
   AND coalesce(v.concept->>'look', '') <> 'athletic_v3'
   AND NOT EXISTS (SELECT 1 FROM public.community_posts p WHERE p.id = v.post_id AND p.archived_at IS NOT NULL);

SELECT public.community_daily_visuals_kick(true);
SELECT public.community_post_headlines_kick();
