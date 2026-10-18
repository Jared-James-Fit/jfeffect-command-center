-- Focus moves by swiping now (taps no longer change exercise), and its "how it
-- works" tips were rewritten. The app treats a stamp from before the swipe
-- version (FOCUS_TIPS_SINCE in use-workout-view.ts) as not seen, so this
-- records the latest time the tips were seen instead of keeping the first.
CREATE OR REPLACE FUNCTION public.workout_view_tips_seen()
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  INSERT INTO public.workout_view_prefs (user_id, focus_tips_at)
  VALUES ((SELECT auth.uid()), now())
  ON CONFLICT (user_id) DO UPDATE
    SET focus_tips_at = now();
$$;
GRANT EXECUTE ON FUNCTION public.workout_view_tips_seen() TO authenticated;
