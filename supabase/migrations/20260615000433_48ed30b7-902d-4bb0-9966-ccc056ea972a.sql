CREATE TABLE public.pl_exercise_favorites (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  exercise_id uuid NOT NULL REFERENCES public.exercises(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, exercise_id)
);

CREATE INDEX pl_exercise_favorites_user_idx ON public.pl_exercise_favorites(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pl_exercise_favorites TO authenticated;
GRANT ALL ON public.pl_exercise_favorites TO service_role;

ALTER TABLE public.pl_exercise_favorites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own exercise favorites"
  ON public.pl_exercise_favorites
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());