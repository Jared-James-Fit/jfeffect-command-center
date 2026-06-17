
-- =========================================================================
-- Phase 1: Unified workout completion & review
-- =========================================================================

-- 1) Dedupe pl_row_results so the unique constraint can be added safely.
--    Keep the row with completed_at NOT NULL (the real log); tie-break by
--    most recent updated_at, then created_at.
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY client_id, row_id, set_index
      ORDER BY
        (completed_at IS NOT NULL) DESC,
        updated_at DESC NULLS LAST,
        created_at DESC NULLS LAST
    ) AS rn
  FROM public.pl_row_results
)
DELETE FROM public.pl_row_results
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

ALTER TABLE public.pl_row_results
  ADD CONSTRAINT pl_row_results_client_row_set_unique
  UNIQUE (client_id, row_id, set_index);

-- 2) Logging-quality enum, shared across both backends.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'workout_logging_quality') THEN
    CREATE TYPE public.workout_logging_quality AS ENUM (
      'complete',
      'mostly_logged',
      'partially_logged',
      'minimal_logging',
      'no_logs'
    );
  END IF;
END$$;

-- 3) Extend pl_day_completions (client backend).
ALTER TABLE public.pl_day_completions
  ADD COLUMN IF NOT EXISTS last_activity_at         timestamptz,
  ADD COLUMN IF NOT EXISTS elapsed_duration_seconds integer,
  ADD COLUMN IF NOT EXISTS active_duration_seconds  integer,
  ADD COLUMN IF NOT EXISTS required_sets_count      integer,
  ADD COLUMN IF NOT EXISTS logged_sets_count        integer,
  ADD COLUMN IF NOT EXISTS skipped_exercises_count  integer,
  ADD COLUMN IF NOT EXISTS logging_percentage       numeric(5,2),
  ADD COLUMN IF NOT EXISTS logging_quality          public.workout_logging_quality,
  ADD COLUMN IF NOT EXISTS completed_with_missing_logs boolean,
  ADD COLUMN IF NOT EXISTS completion_source        text;

-- 4) Extend pl_workout_feedback with review-edit metadata.
ALTER TABLE public.pl_workout_feedback
  ADD COLUMN IF NOT EXISTS review_submitted_at  timestamptz,
  ADD COLUMN IF NOT EXISTS review_last_edited_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_edit_count    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS review_updated_by    uuid REFERENCES auth.users(id);

-- Backfill review_submitted_at for existing 5 records from created_at so the
-- shared editor can rely on the field being present.
UPDATE public.pl_workout_feedback
SET review_submitted_at = COALESCE(review_submitted_at, created_at)
WHERE review_submitted_at IS NULL;

-- 5) Extend member_workout_completions to match pl_day_completions surface.
ALTER TABLE public.member_workout_completions
  ADD COLUMN IF NOT EXISTS started_at               timestamptz,
  ADD COLUMN IF NOT EXISTS in_progress_at           timestamptz,
  ADD COLUMN IF NOT EXISTS last_activity_at         timestamptz,
  ADD COLUMN IF NOT EXISTS actual_duration_min      integer,
  ADD COLUMN IF NOT EXISTS elapsed_duration_seconds integer,
  ADD COLUMN IF NOT EXISTS active_duration_seconds  integer,
  ADD COLUMN IF NOT EXISTS required_sets_count      integer,
  ADD COLUMN IF NOT EXISTS logged_sets_count        integer,
  ADD COLUMN IF NOT EXISTS skipped_exercises_count  integer,
  ADD COLUMN IF NOT EXISTS logging_percentage       numeric(5,2),
  ADD COLUMN IF NOT EXISTS logging_quality          public.workout_logging_quality,
  ADD COLUMN IF NOT EXISTS completed_with_missing_logs boolean,
  ADD COLUMN IF NOT EXISTS completion_source        text,
  ADD COLUMN IF NOT EXISTS completion_method        text,
  ADD COLUMN IF NOT EXISTS session_rating           smallint,
  ADD COLUMN IF NOT EXISTS client_notes             text,
  ADD COLUMN IF NOT EXISTS updated_at               timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.member_workout_completions
  DROP CONSTRAINT IF EXISTS member_workout_completions_completion_method_check;
ALTER TABLE public.member_workout_completions
  ADD CONSTRAINT member_workout_completions_completion_method_check
  CHECK (completion_method IS NULL OR completion_method IN ('manual','automatic'));

ALTER TABLE public.member_workout_completions
  DROP CONSTRAINT IF EXISTS member_workout_completions_session_rating_range;
ALTER TABLE public.member_workout_completions
  ADD CONSTRAINT member_workout_completions_session_rating_range
  CHECK (session_rating IS NULL OR (session_rating >= 1 AND session_rating <= 5));

-- Allow completed_at to be NULL so we can persist "started but not completed"
-- the same way pl_day_completions does.
ALTER TABLE public.member_workout_completions
  ALTER COLUMN completed_at DROP NOT NULL;

DROP TRIGGER IF EXISTS trg_member_workout_completions_updated ON public.member_workout_completions;
CREATE TRIGGER trg_member_workout_completions_updated
  BEFORE UPDATE ON public.member_workout_completions
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 6) New member_workout_reviews table mirrors pl_workout_feedback.
CREATE TABLE IF NOT EXISTS public.member_workout_reviews (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id          uuid NOT NULL REFERENCES public.member_plan_enrollments(id) ON DELETE CASCADE,
  completion_id          uuid REFERENCES public.member_workout_completions(id) ON DELETE CASCADE,
  week_index             integer NOT NULL,
  day_index              integer NOT NULL,
  overall_rating         integer NOT NULL CHECK (overall_rating BETWEEN 1 AND 5),
  session_rpe            integer NOT NULL CHECK (session_rpe BETWEEN 1 AND 10),
  pain                   boolean NOT NULL DEFAULT false,
  pain_level             integer CHECK (pain_level IS NULL OR pain_level BETWEEN 1 AND 10),
  pain_area              text,
  pain_note              text,
  client_note            text,
  reviewed_by            uuid REFERENCES auth.users(id),
  reviewed_at            timestamptz,
  review_submitted_at    timestamptz NOT NULL DEFAULT now(),
  review_last_edited_at  timestamptz,
  review_edit_count      integer NOT NULL DEFAULT 0,
  review_updated_by      uuid REFERENCES auth.users(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT member_workout_reviews_pain_consistency CHECK (
    (pain = false AND pain_level IS NULL AND pain_area IS NULL) OR
    (pain = true  AND pain_level IS NOT NULL AND pain_area IS NOT NULL AND length(btrim(pain_area)) > 0)
  ),
  CONSTRAINT member_workout_reviews_enrollment_week_day_unique
    UNIQUE (enrollment_id, week_index, day_index)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_workout_reviews TO authenticated;
GRANT ALL ON public.member_workout_reviews TO service_role;

ALTER TABLE public.member_workout_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin manage member_workout_reviews"
  ON public.member_workout_reviews
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Member read own member_workout_reviews"
  ON public.member_workout_reviews FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.member_plan_enrollments e
    WHERE e.id = member_workout_reviews.enrollment_id
      AND e.member_id = public.current_member_id()
  ));

CREATE POLICY "Member insert own member_workout_reviews"
  ON public.member_workout_reviews FOR INSERT
  TO authenticated
  WITH CHECK (
    reviewed_by IS NULL
    AND reviewed_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.member_plan_enrollments e
      WHERE e.id = member_workout_reviews.enrollment_id
        AND e.member_id = public.current_member_id()
    )
  );

CREATE POLICY "Member update own member_workout_reviews"
  ON public.member_workout_reviews FOR UPDATE
  TO authenticated
  USING (
    reviewed_by IS NULL
    AND reviewed_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.member_plan_enrollments e
      WHERE e.id = member_workout_reviews.enrollment_id
        AND e.member_id = public.current_member_id()
    )
  )
  WITH CHECK (
    reviewed_by IS NULL
    AND reviewed_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.member_plan_enrollments e
      WHERE e.id = member_workout_reviews.enrollment_id
        AND e.member_id = public.current_member_id()
    )
  );

DROP TRIGGER IF EXISTS trg_member_workout_reviews_updated ON public.member_workout_reviews;
CREATE TRIGGER trg_member_workout_reviews_updated
  BEFORE UPDATE ON public.member_workout_reviews
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_member_workout_reviews_enrollment
  ON public.member_workout_reviews (enrollment_id, created_at DESC);
