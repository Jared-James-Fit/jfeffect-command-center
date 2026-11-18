-- No automatic stories (Nov 18 2026).
--
-- A finished workout used to post itself to the athlete's story (a Pulse) by
-- this trigger. 20270407090000 switched it off for everyone and left a switch
-- in Privacy; this takes the trigger out, so a story only ever goes up when
-- someone shares one (the recap's Share to Story, the camera's STORY, Add to
-- your story). In the 30 days to Nov 18, 144 automatic stories (110 of them
-- tagged PR, since 73% of workouts held a record of some kind) were seen by
-- 0.95 people each and 16 drew a single reaction: they filled the story row
-- without anyone choosing them.
--
-- Nothing already posted changes: the 197 automatic stories stay on their
-- athletes' profiles as they are, and the column and community_set_auto_share
-- stay so an older app's switch still saves (it just does nothing now).

DROP TRIGGER IF EXISTS trg_community_pulse ON public.pl_day_completions;
DROP FUNCTION IF EXISTS public.community_pulse_on_completion();
