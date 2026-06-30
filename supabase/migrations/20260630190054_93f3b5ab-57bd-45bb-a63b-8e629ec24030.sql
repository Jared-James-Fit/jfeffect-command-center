
CREATE OR REPLACE FUNCTION public.exercises_autoclassify()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  guess TEXT;
BEGIN
  IF NEW.primary_muscle_group IS NULL OR NEW.primary_muscle_group = '' THEN
    guess := public.classify_exercise_muscle(NEW.name, NEW.muscle_group);
    IF guess IS NOT NULL THEN
      NEW.primary_muscle_group := guess;
      NEW.needs_muscle_review := false;
    ELSE
      NEW.primary_muscle_group := 'Other';
      NEW.needs_muscle_review := true;
    END IF;
  END IF;
  -- Otherwise respect what the caller stored (admin explicitly chose).
  RETURN NEW;
END;
$$;

-- Reset Other rows and re-run classification so review flags land correctly
UPDATE public.exercises ex
SET primary_muscle_group = NULL,
    needs_muscle_review = false
WHERE primary_muscle_group = 'Other';

UPDATE public.exercises ex
SET primary_muscle_group = COALESCE(public.classify_exercise_muscle(ex.name, ex.muscle_group), 'Other'),
    needs_muscle_review  = (public.classify_exercise_muscle(ex.name, ex.muscle_group) IS NULL)
WHERE ex.primary_muscle_group IS NULL;
