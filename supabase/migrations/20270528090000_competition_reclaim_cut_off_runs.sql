-- Competition Intelligence: a worker request the host cuts off costs minutes, not a try
-- (Nov 25 2026).
--
-- On Nov 25 2026 the internal validation's game plan was claimed by the 17:13
-- tick, whose request the host killed (Cloudflare 1102) a moment later. The
-- milestone sat in 'generating' for ten minutes before it could be claimed
-- again, and the reclaim would have used one of its three tries, though its
-- OpenAI call was safely parked in `progress.pending` and nothing was lost.
--
-- Now, like Program Intelligence's runs:
--   * a 'generating' lock older than 3 minutes is stale (a worker request is
--     answered or dropped within the cron's 2-minute timeout);
--   * reclaiming one that's only waiting on a call parked at OpenAI
--     (`progress.pending` holds it) uses no try: the worker resumes that very
--     response, so nothing is asked twice; a run cut off before it parked
--     anything still counts.
-- competition_intel_due() reads the same rule, so the cron calls the worker.

SET lock_timeout = '10s';

-- a run that's only waiting on a model call it already parked
CREATE OR REPLACE FUNCTION public.competition_milestone_parked(_progress jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT coalesce(jsonb_typeof(_progress -> 'pending') = 'object'
    AND (_progress -> 'pending') <> '{}'::jsonb, false)
$$;
REVOKE ALL ON FUNCTION public.competition_milestone_parked(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.competition_milestone_parked(jsonb) TO service_role, postgres;

CREATE OR REPLACE FUNCTION public.competition_milestone_claim(_id uuid DEFAULT NULL)
RETURNS SETOF public.competition_milestones
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  today date := public.instant_to_local(now(), 'America/Winnipeg')::date;
BEGIN
  UPDATE public.competition_milestones
     SET status = 'failed', last_error = coalesce(last_error, 'Stopped after three tries'), locked_at = NULL
   WHERE status = 'generating' AND locked_at < now() - interval '3 minutes' AND attempts >= 3
     AND NOT public.competition_milestone_parked(progress);
  RETURN QUERY
  UPDATE public.competition_milestones m
     SET status = 'generating', locked_at = clock_timestamp(),
         attempts = CASE
           WHEN m.status = 'waiting_ai' THEN m.attempts
           -- cut off while its call was parked at OpenAI: resuming it isn't a new try
           WHEN m.status = 'generating' AND public.competition_milestone_parked(m.progress) THEN m.attempts
           ELSE m.attempts + 1
         END
   WHERE m.id = (
     SELECT x.id FROM public.competition_milestones x
       JOIN public.competitions c ON c.id = x.competition_id
      WHERE (_id IS NULL OR x.id = _id)
        AND x.due_on <= today
        AND c.status IN ('upcoming', 'completed')
        AND (x.status = 'scheduled'
          OR (x.status = 'waiting_ai' AND x.updated_at < now() - interval '50 seconds')
          OR (x.status = 'generating' AND x.locked_at < now() - interval '3 minutes'
              AND (x.attempts < 3 OR public.competition_milestone_parked(x.progress)))
          OR (x.status = 'failed' AND x.attempts < 3 AND x.updated_at < now() - interval '10 minutes'))
      ORDER BY x.due_on, x.created_at
      LIMIT 1
      FOR UPDATE OF x SKIP LOCKED
   )
  RETURNING m.*;
END;
$$;
REVOKE ALL ON FUNCTION public.competition_milestone_claim(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.competition_milestone_claim(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.competition_intel_due()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.competitions WHERE schedule_dirty AND status <> 'archived'
  ) OR EXISTS (
    SELECT 1 FROM public.competition_milestones x
      JOIN public.competitions c ON c.id = x.competition_id
     WHERE x.due_on <= public.instant_to_local(now(), 'America/Winnipeg')::date
       AND c.status IN ('upcoming', 'completed')
       AND (x.status = 'scheduled'
         OR (x.status = 'waiting_ai' AND x.updated_at < now() - interval '50 seconds')
         OR (x.status = 'generating' AND x.locked_at < now() - interval '3 minutes'
             AND (x.attempts < 3 OR public.competition_milestone_parked(x.progress)))
         OR (x.status = 'failed' AND x.attempts < 3 AND x.updated_at < now() - interval '10 minutes'))
  )
$$;
REVOKE ALL ON FUNCTION public.competition_intel_due() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.competition_intel_due() TO service_role, postgres;
