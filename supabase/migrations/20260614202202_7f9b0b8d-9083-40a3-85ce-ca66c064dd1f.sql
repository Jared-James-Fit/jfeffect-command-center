
-- Volume tracking Phase 1: add tagging columns to exercises.
-- All nullable / defaulted so existing rows and code keep working.

ALTER TABLE public.exercises
  ADD COLUMN IF NOT EXISTS primary_movement_pattern text,
  ADD COLUMN IF NOT EXISTS muscle_groups text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS lift_family text,
  ADD COLUMN IF NOT EXISTS variation_type text,
  ADD COLUMN IF NOT EXISTS counts_toward_volume boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS volume_multiplier numeric(3,2);

-- Constrain enums (drop-if-exists pattern so re-runs are safe).
ALTER TABLE public.exercises
  DROP CONSTRAINT IF EXISTS exercises_primary_movement_pattern_check;
ALTER TABLE public.exercises
  ADD CONSTRAINT exercises_primary_movement_pattern_check
  CHECK (primary_movement_pattern IS NULL OR primary_movement_pattern = ANY (ARRAY[
    'squat','bench','deadlift',
    'horizontal_push','vertical_push',
    'horizontal_pull','vertical_pull',
    'knee_extension','hip_hinge','hamstring_curl',
    'glutes','arms','delts','core',
    'conditioning','rehab','other'
  ]));

ALTER TABLE public.exercises
  DROP CONSTRAINT IF EXISTS exercises_lift_family_check;
ALTER TABLE public.exercises
  ADD CONSTRAINT exercises_lift_family_check
  CHECK (lift_family IS NULL OR lift_family = ANY (ARRAY[
    'squat','bench','deadlift','accessory','conditioning','rehab'
  ]));

ALTER TABLE public.exercises
  DROP CONSTRAINT IF EXISTS exercises_variation_type_check;
ALTER TABLE public.exercises
  ADD CONSTRAINT exercises_variation_type_check
  CHECK (variation_type IS NULL OR variation_type = ANY (ARRAY[
    'competition','close_variation','secondary_compound',
    'accessory','isolation','rehab','conditioning'
  ]));

ALTER TABLE public.exercises
  DROP CONSTRAINT IF EXISTS exercises_volume_multiplier_check;
ALTER TABLE public.exercises
  ADD CONSTRAINT exercises_volume_multiplier_check
  CHECK (volume_multiplier IS NULL OR (volume_multiplier >= 0 AND volume_multiplier <= 2));

-- Auto-fill volume_multiplier from variation_type when caller leaves it null.
CREATE OR REPLACE FUNCTION public.tg_exercises_default_volume_multiplier()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.volume_multiplier IS NULL AND NEW.variation_type IS NOT NULL THEN
    NEW.volume_multiplier := CASE NEW.variation_type
      WHEN 'competition'        THEN 1.00
      WHEN 'close_variation'    THEN 0.80
      WHEN 'secondary_compound' THEN 0.70
      WHEN 'accessory'          THEN 0.50
      WHEN 'isolation'          THEN 0.40
      WHEN 'rehab'              THEN 0.25
      WHEN 'conditioning'       THEN 0.00
      ELSE NULL
    END;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS exercises_default_volume_multiplier ON public.exercises;
CREATE TRIGGER exercises_default_volume_multiplier
  BEFORE INSERT OR UPDATE ON public.exercises
  FOR EACH ROW EXECUTE FUNCTION public.tg_exercises_default_volume_multiplier();

-- Helpful index for dashboards filtering by pattern.
CREATE INDEX IF NOT EXISTS idx_exercises_primary_movement_pattern
  ON public.exercises (primary_movement_pattern)
  WHERE primary_movement_pattern IS NOT NULL;
