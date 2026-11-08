-- No Bible verses in coach posts (Nov 8 2026).
--
-- The coach: "I don't want full on bible verses in post remove the verses.
-- It can use some biblical principals but not that extreme". Sunday's
-- Athlete Insight carried a King James verse under its caption
-- (FAITH_VERSES); it doesn't any more. Sunday's post can still lean on a
-- principle the Bible teaches that good training shares (rest, gratitude,
-- patience), in plain lifting terms (SUNDAY_PRINCIPLE, daily-visuals.ts), and
-- the writer's checks refuse a verse, a scripture quote or sermon language.
--
-- 1. A day's words as posted are the caption alone, Sunday's too (the same
--    as dailyCaption in daily-visuals.ts). Every path that writes a post's
--    caption (the publisher, a remake synced in place, a restore) goes
--    through this function.
-- 2. No day keeps a verse.
-- 3. A post already out loses the verse under it, in place: the same post
--    id, date, likes, comments and feed spot (only the caption and its
--    series_data's verse change). Nov 8's is the only one.

CREATE OR REPLACE FUNCTION public.community_daily_visual_caption(_line text, _faith boolean, _verse_text text, _verse_ref text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT btrim(_line)
$$;

UPDATE public.community_daily_visuals
   SET verse_ref = NULL, verse_text = NULL
 WHERE verse_ref IS NOT NULL OR verse_text IS NOT NULL;

UPDATE public.community_posts p
   SET caption = regexp_replace(p.caption, E'\\s*\\n\\n“[^”]+”\\s+([1-3]\\s?)?[A-Za-z]+\\s+[0-9]{1,3}:[0-9]{1,3}(-[0-9]{1,3})?\\s*$', ''),
       series_data = coalesce(p.series_data, '{}'::jsonb) - 'verse'
 WHERE p.series = 'daily_visual'
   AND p.caption ~ E'\\n\\n“[^”]+”\\s+([1-3]\\s?)?[A-Za-z]+\\s+[0-9]{1,3}:[0-9]{1,3}(-[0-9]{1,3})?\\s*$';
