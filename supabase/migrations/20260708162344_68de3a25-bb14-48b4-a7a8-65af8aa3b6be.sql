
-- 1. New column on pl_day_completions
ALTER TABLE public.pl_day_completions
  ADD COLUMN IF NOT EXISTS scheduled_workout_id uuid
    REFERENCES public.pl_scheduled_workouts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pl_day_completions_scheduled_workout_id
  ON public.pl_day_completions(scheduled_workout_id)
  WHERE scheduled_workout_id IS NOT NULL;

-- 2. Audit table for ambiguous / unlinkable historical completions
CREATE TABLE IF NOT EXISTS public.pl_completion_link_review (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  completion_id uuid NOT NULL REFERENCES public.pl_day_completions(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  day_id uuid NOT NULL,
  candidate_count integer NOT NULL,
  reason text NOT NULL,             -- 'no_instance' | 'multiple_instances'
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.pl_completion_link_review TO authenticated;
GRANT ALL ON public.pl_completion_link_review TO service_role;
ALTER TABLE public.pl_completion_link_review ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and coaches can read completion link review"
  ON public.pl_completion_link_review FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'coach'::app_role)
  );

CREATE POLICY "Service role manages completion link review"
  ON public.pl_completion_link_review FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 3. Backfill: link each unambiguous completion to its scheduled instance.
--    A completion is unambiguous when the client has exactly ONE scheduled
--    instance whose source_day_id matches the completion's day_id.
WITH candidates AS (
  SELECT
    c.id            AS completion_id,
    c.client_id,
    c.day_id,
    (SELECT COUNT(*) FROM public.pl_scheduled_workouts s
       WHERE s.client_id = c.client_id AND s.source_day_id = c.day_id) AS n,
    (SELECT s.id FROM public.pl_scheduled_workouts s
       WHERE s.client_id = c.client_id AND s.source_day_id = c.day_id
       ORDER BY s.scheduled_date, s.order_index, s.created_at
       LIMIT 1) AS first_instance_id
  FROM public.pl_day_completions c
  WHERE c.scheduled_workout_id IS NULL
)
UPDATE public.pl_day_completions c
   SET scheduled_workout_id = cand.first_instance_id
  FROM candidates cand
 WHERE c.id = cand.completion_id
   AND cand.n = 1;

-- 4. Log unlinkable / ambiguous completions for review (idempotent)
INSERT INTO public.pl_completion_link_review
  (completion_id, client_id, day_id, candidate_count, reason)
SELECT c.id, c.client_id, c.day_id,
       (SELECT COUNT(*) FROM public.pl_scheduled_workouts s
          WHERE s.client_id = c.client_id AND s.source_day_id = c.day_id),
       CASE
         WHEN (SELECT COUNT(*) FROM public.pl_scheduled_workouts s
                 WHERE s.client_id = c.client_id AND s.source_day_id = c.day_id) = 0
           THEN 'no_instance'
         ELSE 'multiple_instances'
       END
  FROM public.pl_day_completions c
 WHERE c.scheduled_workout_id IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.pl_completion_link_review r
      WHERE r.completion_id = c.id
   );
