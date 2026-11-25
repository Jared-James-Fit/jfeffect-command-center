-- Rollback for 20270529090000_post_design_system.sql (Nov 25 2026).
-- Run section by section in the SQL editor, as postgres. Nothing here
-- touches likes, comments, views, saves, reposts or any post's id or date.
--
-- The painted cards themselves need no rollback in the database: they are
-- painted on the phone from each post's data, keyed by POST_ART_VERSION
-- (src/lib/post-art.ts). Reverting the app's commit repaints the old look.

-- 1. Stop the headline job.
SELECT cron.unschedule('community-post-headlines') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'community-post-headlines');

-- 2. Put every tightened cover headline back (only where the new title is still the one on the post / item).
DO $$
DECLARE h record;
BEGIN
  FOR h IN SELECT id FROM public.community_post_headlines WHERE status = 'done' ORDER BY created_at DESC LOOP
    PERFORM public.community_post_headline_undo(h.id);
  END LOOP;
END $$;
-- check: SELECT status, count(*) FROM public.community_post_headlines GROUP BY 1;

-- 3. Athlete Insight pictures remade in the athletic look: each old picture is a
--    version (community_daily_visual_versions, reason 'restyle' / 'replaced').
--    Put one back from Crew → Posts → Manage → Athlete Insights → the post →
--    Versions → Restore (same post, in place). To list them:
-- SELECT v.day, x.id AS version_id, x.created_at, x.picture->>'path' AS old_picture
--   FROM public.community_daily_visual_versions x JOIN public.community_daily_visuals v ON v.id = x.visual_id
--  WHERE x.created_at >= '2026-11-25' ORDER BY v.day, x.created_at;
-- Stop any remake still waiting:
-- UPDATE public.community_daily_visuals SET regen = NULL, regen_reason = NULL WHERE regen = 'picture' AND regen_reason = 'restyle';

-- 4. (optional, after 2) drop the job's objects.
-- DROP FUNCTION IF EXISTS public.community_post_headlines_kick();
-- DROP FUNCTION IF EXISTS public.community_post_headline_undo(uuid);
-- DROP FUNCTION IF EXISTS public.community_post_headline_apply(uuid, uuid, text, text);
-- DROP FUNCTION IF EXISTS public.community_post_headlines_next(int, int);
-- DROP TABLE IF EXISTS public.community_post_headlines;
