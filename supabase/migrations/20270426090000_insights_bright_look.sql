-- Athlete Insights, the bright look (daily-visuals.ts FILM_LOOK_VERSION 'anime_v2', Nov 20 2026):
-- bright, balanced light with a neutral white balance, real people built like who
-- they are (concept.cast), a palette that changes post to post (concept.palette),
-- places that aren't always a gym (concept.setting), four treatments of the house
-- style (concept.rendering) and the post read before its picture (concept.read).
-- Everything new lives in the concept jsonb; only the shot is a column, so the two
-- new shots join its check. 'backlit' stays for the days that used it.

ALTER TABLE public.community_daily_visuals DROP CONSTRAINT IF EXISTS community_daily_visuals_style_check;
ALTER TABLE public.community_daily_visuals ADD CONSTRAINT community_daily_visuals_style_check CHECK (style IS NULL OR style IN (
  'wide_moment', 'medium_candid', 'two_people', 'group', 'in_action', 'close_detail', 'over_shoulder', 'low_angle',
  'framed_view', 'overhead', 'two_frames', 'side_profile', 'still_life',
  -- earlier looks, kept for their history
  'backlit', 'phone_story', 'cinematic_photo', 'minimal_illustration', 'pencil_sketch', 'ink_drawing', 'watercolor', 'vintage_fitness',
  'editorial_illustration', 'conceptual', 'comic', 'typography', 'mixed_media', 'graphic_design', 'photo', 'illustration'));
