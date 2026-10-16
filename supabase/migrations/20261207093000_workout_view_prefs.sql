-- How a person likes to log a workout: the list of cards (default) or story view
-- (one exercise at a time, full screen). Saved on the account every time they
-- switch, so every workout and every device opens the way they left it.
-- Its own table (not user_preferences): inserting there creates a theme row with
-- defaults, which the theme sync would treat as a fresh "light" choice.

CREATE TABLE IF NOT EXISTS public.workout_view_prefs (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  view text NOT NULL DEFAULT 'list' CHECK (view IN ('list', 'story')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.workout_view_prefs TO authenticated;
GRANT ALL ON public.workout_view_prefs TO service_role;
ALTER TABLE public.workout_view_prefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Own workout view - read" ON public.workout_view_prefs;
CREATE POLICY "Own workout view - read" ON public.workout_view_prefs FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "Own workout view - insert" ON public.workout_view_prefs;
CREATE POLICY "Own workout view - insert" ON public.workout_view_prefs FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "Own workout view - update" ON public.workout_view_prefs;
CREATE POLICY "Own workout view - update" ON public.workout_view_prefs FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
