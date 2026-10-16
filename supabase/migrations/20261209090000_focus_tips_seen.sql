-- Focus's "how it works" tips (tap right / left, swipe to delete): shown once per
-- account the first time someone is in Focus, then only from the ? in its top bar.
ALTER TABLE public.workout_view_prefs ADD COLUMN IF NOT EXISTS focus_tips_at timestamptz;

CREATE OR REPLACE FUNCTION public.workout_view_tips_seen()
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  INSERT INTO public.workout_view_prefs (user_id, focus_tips_at)
  VALUES ((SELECT auth.uid()), now())
  ON CONFLICT (user_id) DO UPDATE
    SET focus_tips_at = coalesce(public.workout_view_prefs.focus_tips_at, now());
$$;
GRANT EXECUTE ON FUNCTION public.workout_view_tips_seen() TO authenticated;
