-- Athlete Insights in the anime house style (Nov 8 2026, daily-visuals.ts
-- FILM_LOOK_VERSION = 'anime_v1'): no schema change, the look lives in the
-- prompts. The coach asked for the two live posts (Nov 6 and Nov 7) to get the
-- new look, captions, post ids, likes, comments and timestamps kept
-- (community_daily_visual_sync_post updates a posted day in place and puts its
-- updated_at back; the photo stays in Versions), and every post still to come
-- is made in it: a ready one gets a new image, its caption kept.
-- Applied after the anime look is published, so the worker draws anime frames.
UPDATE public.community_daily_visuals v
   SET regen = 'picture', regen_reason = 'restyle', regen_style = NULL, candidate = NULL, attempts = 0, error = NULL,
       approved_at = NULL, updated_at = now()
 WHERE v.picture IS NOT NULL AND v.regen IS NULL
   AND coalesce(v.concept->>'look', '') <> 'anime_v1'
   AND (
     (v.status = 'posted' AND v.day IN ('2026-11-06', '2026-11-07')
       AND EXISTS (SELECT 1 FROM public.community_posts p WHERE p.id = v.post_id AND p.archived_at IS NULL))
     OR (v.status = 'ready' AND v.post_id IS NULL AND v.day >= public.instant_to_local(now(), 'America/Winnipeg')::date)
   );
SELECT public.community_daily_visuals_kick(true);
