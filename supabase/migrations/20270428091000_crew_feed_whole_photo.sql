-- The Nov 20 2026 feed audit, one older photo: Jared's Oct 8 post is a
-- "Locked in" story card saved as a 9:16 photo, its own words in its lower
-- third. Filling its screen (what a 9:16 photo now does) put the post's name
-- and caption on top of them, so it's shown whole between Crew's bar and the
-- words instead (`"fit": "whole"`, read by cleanFocus / screenFit in
-- src/lib/photo-frame.ts). Only while its focus is still unset; undo with
--   UPDATE public.community_posts SET media_focus = NULL WHERE id = '8901bf28-80bf-4f48-b14a-2b20750e076c';
UPDATE public.community_posts
   SET media_focus = '{"x": 0.5, "y": 0.5, "fit": "whole"}'::jsonb
 WHERE id = '8901bf28-80bf-4f48-b14a-2b20750e076c'
   AND media_focus IS NULL;
