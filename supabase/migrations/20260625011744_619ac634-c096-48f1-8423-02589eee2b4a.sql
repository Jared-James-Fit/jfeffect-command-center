-- 1. Per-exercise weight unit preferences for membership users.
CREATE TABLE IF NOT EXISTS public.member_exercise_unit_prefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  exercise_id uuid NOT NULL REFERENCES public.exercises(id) ON DELETE CASCADE,
  unit text NOT NULL CHECK (unit IN ('lb','kg')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, exercise_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_exercise_unit_prefs TO authenticated;
GRANT ALL ON public.member_exercise_unit_prefs TO service_role;
ALTER TABLE public.member_exercise_unit_prefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members manage own unit prefs"
  ON public.member_exercise_unit_prefs FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 2. Per-exercise notes for membership users (parity with pl_exercise_notes).
CREATE TABLE IF NOT EXISTS public.member_exercise_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  enrollment_id uuid NOT NULL REFERENCES public.member_plan_enrollments(id) ON DELETE CASCADE,
  week_index int NOT NULL,
  day_index int NOT NULL,
  exercise_index int NOT NULL,
  exercise_id uuid NULL REFERENCES public.exercises(id) ON DELETE SET NULL,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (enrollment_id, week_index, day_index, exercise_index)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_exercise_notes TO authenticated;
GRANT ALL ON public.member_exercise_notes TO service_role;
ALTER TABLE public.member_exercise_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members manage own exercise notes"
  ON public.member_exercise_notes FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 3. Add exercise_id to member_set_logs so exercise history can filter
-- correctly across days. Nullable for backfill; new writes populate it.
ALTER TABLE public.member_set_logs
  ADD COLUMN IF NOT EXISTS exercise_id uuid NULL REFERENCES public.exercises(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS member_set_logs_exercise_id_idx
  ON public.member_set_logs(enrollment_id, exercise_id);

-- 4. updated_at trigger for new tables.
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$
LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS member_exercise_unit_prefs_updated ON public.member_exercise_unit_prefs;
CREATE TRIGGER member_exercise_unit_prefs_updated
  BEFORE UPDATE ON public.member_exercise_unit_prefs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS member_exercise_notes_updated ON public.member_exercise_notes;
CREATE TRIGGER member_exercise_notes_updated
  BEFORE UPDATE ON public.member_exercise_notes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();