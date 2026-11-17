-- "Fastest way to log" (quick-log-tips.tsx): a short demo of the logger's
-- quickest moves (pre-filled reps and RPE, one tap on a set's number, typing a
-- weight, the optional last warm-up, a set video), shown once per account the
-- first time someone logs their own workout after it shipped, on any phone.
-- Seen is the account's, like Focus's tips (workout_view_prefs.focus_tips_at).
ALTER TABLE public.workout_view_prefs ADD COLUMN IF NOT EXISTS logging_tips_at timestamptz;

CREATE OR REPLACE FUNCTION public.workout_view_logging_tips_seen()
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  INSERT INTO public.workout_view_prefs (user_id, logging_tips_at)
  VALUES ((SELECT auth.uid()), now())
  ON CONFLICT (user_id) DO UPDATE
    SET logging_tips_at = now();
$$;
REVOKE ALL ON FUNCTION public.workout_view_logging_tips_seen() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workout_view_logging_tips_seen() TO authenticated;
