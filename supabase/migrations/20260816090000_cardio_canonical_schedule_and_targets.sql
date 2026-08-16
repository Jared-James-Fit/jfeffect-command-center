-- Canonical cardio schedule and target metadata.
-- Additive only: legacy day_type/frequency rows remain readable until explicitly edited.

ALTER TABLE public.cardio_targets
  ADD COLUMN IF NOT EXISTS scheduled_weekdays text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS incline numeric,
  ADD COLUMN IF NOT EXISTS speed_min_mph numeric,
  ADD COLUMN IF NOT EXISTS speed_max_mph numeric,
  ADD COLUMN IF NOT EXISTS step_target_mode text NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS calorie_target_mode text NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS completion_rule text NOT NULL DEFAULT 'any_target';

ALTER TABLE public.cardio_targets
  DROP CONSTRAINT IF EXISTS cardio_targets_step_target_mode_check,
  ADD CONSTRAINT cardio_targets_step_target_mode_check CHECK (step_target_mode IN ('auto', 'custom')),
  DROP CONSTRAINT IF EXISTS cardio_targets_calorie_target_mode_check,
  ADD CONSTRAINT cardio_targets_calorie_target_mode_check CHECK (calorie_target_mode IN ('auto', 'custom')),
  DROP CONSTRAINT IF EXISTS cardio_targets_completion_rule_check,
  ADD CONSTRAINT cardio_targets_completion_rule_check CHECK (completion_rule = 'any_target');

-- Preserve existing coach-entered targets as custom; never silently overwrite them.
UPDATE public.cardio_targets
SET step_target_mode = CASE WHEN step_target IS NULL THEN 'auto' ELSE 'custom' END,
    calorie_target_mode = CASE
      WHEN calorie_target_min IS NULL AND calorie_target_max IS NULL THEN 'auto'
      ELSE 'custom'
    END
WHERE step_target_mode = 'auto' OR calorie_target_mode = 'auto';

CREATE INDEX IF NOT EXISTS idx_cardio_targets_client_schedule_active
  ON public.cardio_targets (client_id, start_date DESC)
  WHERE enabled = true AND status = 'Active' AND visible_to_client = true;

ALTER TABLE public.cardio_completions
  ADD COLUMN IF NOT EXISTS steps integer,
  ADD COLUMN IF NOT EXISTS completion_target text;

ALTER TABLE public.cardio_completions
  DROP CONSTRAINT IF EXISTS cardio_completions_completion_target_check,
  ADD CONSTRAINT cardio_completions_completion_target_check
    CHECK (completion_target IS NULL OR completion_target IN ('time', 'steps', 'calories', 'manual'));

COMMENT ON COLUMN public.cardio_targets.scheduled_weekdays IS
  'Canonical weekly schedule. Empty array means legacy day_type resolver applies until the target is next edited.';
COMMENT ON COLUMN public.cardio_targets.completion_rule IS
  'All cardio sessions use OR semantics: time OR steps OR calories completes a session.';
COMMENT ON COLUMN public.cardio_completions.completion_target IS
  'First achieved prescribed target, or manual when the client/coach marks completion without metric evidence.';
