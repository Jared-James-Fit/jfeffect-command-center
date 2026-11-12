-- The set video point-out: a small bubble on a coaching client's camera the
-- first time they log a set in a workout, showing that a set can be filmed
-- and sent to their coach. Kept on the account (never the phone), so it shows
-- at most once a day across phones and stops after a few days or once they've
-- sent a video.

ALTER TABLE public.workout_view_prefs
  ADD COLUMN IF NOT EXISTS set_video_tip_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS set_video_tip_last_at timestamptz;

-- 'shown': the bubble was on screen (one more time, now).
CREATE OR REPLACE FUNCTION public.workout_view_set_video_tip_shown()
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  INSERT INTO public.workout_view_prefs (user_id, set_video_tip_count, set_video_tip_last_at)
  VALUES ((SELECT auth.uid()), 1, now())
  ON CONFLICT (user_id) DO UPDATE
    SET set_video_tip_count = public.workout_view_prefs.set_video_tip_count + 1,
        set_video_tip_last_at = now();
$$;

REVOKE ALL ON FUNCTION public.workout_view_set_video_tip_shown() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workout_view_set_video_tip_shown() TO authenticated;
