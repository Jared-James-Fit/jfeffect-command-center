-- "Not sure how bad" in a pain report (Nov 26 2026).
--
-- The voice-first pain report lets an athlete answer "how bad?" with Unsure
-- instead of a number. Nothing stands in for one: the place is stored with no
-- score and no severity (src/lib/pain/report.ts `UNSURE_WORDS`), and the
-- review's legacy pain_level is the worst rated place, or none when no place
-- was rated. Every reader already handles a missing severity (history.ts,
-- safety.ts, the coach's card); readers say "not sure how bad".
--
-- Additive: nothing is rewritten, every existing row already satisfies the
-- new checks (they only allow more), and pain_reports_save already writes the
-- severity it's sent (null when the score is null and severity is null).
-- Rollback: docs/rollback/2026-11-26-pain-unsure-severity-rollback.sql.

SET lock_timeout = '3s';

ALTER TABLE public.pain_reports ALTER COLUMN severity DROP NOT NULL;

ALTER TABLE public.pl_workout_feedback DROP CONSTRAINT IF EXISTS pl_workout_feedback_pain_consistency;
ALTER TABLE public.pl_workout_feedback ADD CONSTRAINT pl_workout_feedback_pain_consistency CHECK (
  (pain = false AND pain_level IS NULL AND pain_area IS NULL)
  OR (
    pain = true
    -- null: every place was answered "not sure how bad"
    AND (pain_level IS NULL OR pain_level BETWEEN 1 AND 10)
    AND pain_area IS NOT NULL AND length(btrim(pain_area)) > 0
  )
);

COMMENT ON COLUMN public.pain_reports.severity IS
  'mild / moderate / severe (from score when there is one); null with a null score = the athlete said they are not sure how bad.';
