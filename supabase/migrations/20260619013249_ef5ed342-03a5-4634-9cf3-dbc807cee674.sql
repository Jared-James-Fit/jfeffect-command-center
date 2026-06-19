
CREATE TABLE IF NOT EXISTS public.member_exercise_swaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid NOT NULL REFERENCES public.member_plan_enrollments(id) ON DELETE CASCADE,
  week_index integer NOT NULL,
  day_index integer NOT NULL,
  exercise_index integer NOT NULL,
  exercise_id uuid NOT NULL REFERENCES public.exercises(id) ON DELETE RESTRICT,
  scope text NOT NULL DEFAULT 'today' CHECK (scope IN ('today','future')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (enrollment_id, week_index, day_index, exercise_index)
);

CREATE INDEX IF NOT EXISTS idx_member_exercise_swaps_enrollment
  ON public.member_exercise_swaps (enrollment_id, week_index, day_index);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_exercise_swaps TO authenticated;
GRANT ALL ON public.member_exercise_swaps TO service_role;

ALTER TABLE public.member_exercise_swaps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members manage own swaps"
ON public.member_exercise_swaps
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.member_plan_enrollments e
    JOIN public.app_members m ON m.id = e.member_id
    WHERE e.id = member_exercise_swaps.enrollment_id
      AND m.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.member_plan_enrollments e
    JOIN public.app_members m ON m.id = e.member_id
    WHERE e.id = member_exercise_swaps.enrollment_id
      AND m.user_id = auth.uid()
  )
);

CREATE POLICY "admins view all swaps"
ON public.member_exercise_swaps
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.touch_member_exercise_swaps_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_member_exercise_swaps_updated_at ON public.member_exercise_swaps;
CREATE TRIGGER trg_member_exercise_swaps_updated_at
BEFORE UPDATE ON public.member_exercise_swaps
FOR EACH ROW EXECUTE FUNCTION public.touch_member_exercise_swaps_updated_at();
