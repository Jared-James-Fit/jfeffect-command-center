-- AI reliability (Nov 23 2026): one record of every model call, each provider's health, and a
-- safe way to redo what failed while a provider was down.
--
-- Why: OpenAI's credits ran out three times in two weeks (around Nov 9, from Nov 21 00:09 UTC to
-- Nov 23 ~03:20 UTC). Nothing said so: three Athlete Insights never posted, 55 Crew post decks and
-- two coaching replies failed after three quick tries, two check-in recaps were saved as a
-- template, and only two features kept any record of their calls or what they cost.
--
--   ai_call_log           one row per model call (task, feature, model, ok / why not, tokens,
--                         seconds, estimated US$), written only by the server (ai-health.server.ts)
--   ai_provider_health    one row per provider: ok, or down (credits / auth / outage), when it
--                         went down, when to probe it next, when it came back and was recovered
--   ai_error_is_provider  the SQL twin of ai-errors.ts isProviderFailureText
--   ai_recovery_requeue   puts back what failed for the provider's fault (never anything a coach
--                         asked for himself, never a member's own paid import), service role only
--   community_post_decks_kick   never wakes the writer while OpenAI is down, and makes at most
--                         four background (library) decks a day so a backlog can't drain credits
--   ai-health-tick        pg_cron every 5 minutes: probe, alerts, stuck jobs, recovery
-- Rollback: docs/rollback/2026-11-23-ai-reliability-rollback.sql

SET lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- The call log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_call_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  at timestamptz NOT NULL DEFAULT now(),
  provider text NOT NULL CHECK (provider IN ('openai', 'gateway')),
  model text NOT NULL,
  task text NOT NULL,
  feature text,
  ok boolean NOT NULL,
  failure text CHECK (failure IS NULL OR failure IN ('credits', 'auth', 'rate', 'outage', 'timeout', 'paused', 'answer', 'other')),
  error text,
  input_tokens integer,
  cached_tokens integer,
  output_tokens integer,
  reasoning_tokens integer,
  ms integer,
  cost_usd numeric(12, 6)
);
CREATE INDEX IF NOT EXISTS ai_call_log_at_idx ON public.ai_call_log (at DESC);
CREATE INDEX IF NOT EXISTS ai_call_log_task_at_idx ON public.ai_call_log (task, at DESC);
CREATE INDEX IF NOT EXISTS ai_call_log_failed_idx ON public.ai_call_log (at DESC) WHERE NOT ok;
ALTER TABLE public.ai_call_log ENABLE ROW LEVEL SECURITY;
-- no policies: only the server writes it, and the admin panel reads it through the server
REVOKE ALL ON public.ai_call_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ai_call_log TO service_role;

-- ---------------------------------------------------------------------------
-- Provider health
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_provider_health (
  provider text PRIMARY KEY CHECK (provider IN ('openai', 'gateway')),
  status text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'credits', 'auth', 'outage')),
  since timestamptz,
  last_ok_at timestamptz,
  last_failure_at timestamptz,
  last_failure text,
  failures_in_row integer NOT NULL DEFAULT 0,
  next_probe_at timestamptz,
  recovered_at timestamptz,
  recovery_started_at timestamptz,
  recovery_done_at timestamptz,
  recovery_report jsonb,
  alerted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_provider_health ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_provider_health FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ai_provider_health TO service_role;

-- OpenAI answers again (a Nutrition Update revision went through on Nov 23 03:37 UTC), and what
-- failed from Nov 21 is still waiting: one recovery runs on the tick's first pass.
INSERT INTO public.ai_provider_health (provider, status, since, last_ok_at, recovered_at)
VALUES ('openai', 'ok', '2026-11-21 00:00:00+00', '2026-11-23 03:37:24+00', now()),
       ('gateway', 'ok', NULL, NULL, NULL)
ON CONFLICT (provider) DO NOTHING;

-- ---------------------------------------------------------------------------
-- The provider's fault, read from a stored error (keep in step with ai-errors.ts)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ai_error_is_provider(_t text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT _t IS NOT NULL AND (
    _t ~* '(insufficient_quota|no credits remaining|no credits left|credits are used up|out of credit|exceeded your current quota|billing_hard_limit|billing hard limit|add credits to continue|credit balance is too low|payment required|AI is paused|Waiting for AI|invalid_api_key|incorrect api key|is not configured|server_error|overloaded|service unavailable|bad gateway|fetch failed|econnreset|econnrefused|enotfound|socket hang up|other side closed)'
    OR _t ~* 'api key.*(revoked|invalid|deactivated)'
    OR _t ~ '(^|[:(]\s*)(401|402|500|502|503|504|520|521|522|523|524|529)(\s|\{|$)'
  );
$$;
REVOKE ALL ON FUNCTION public.ai_error_is_provider(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_error_is_provider(text) TO service_role;

-- ---------------------------------------------------------------------------
-- Redo what the provider's failure stopped
-- ---------------------------------------------------------------------------
-- Only work that failed because the provider didn't answer, only within `_days`, and only work
-- nobody asked for by hand: background jobs go back in their own queues and are written again
-- from the records as they are now (every safeguard of the worker runs again: stillGoes, the
-- coach's mode, approval, dedupe, the deliver marker). What a coach asked for himself (a program,
-- an edit, a form reply) and a member's own paid import are only counted, for him to run again.
CREATE OR REPLACE FUNCTION public.ai_recovery_requeue(_days integer DEFAULT 7)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(_days, 7), 14)));
  v_today date := public.instant_to_local(now(), 'America/Winnipeg')::date;
  v_items int := 0; v_woke int := 0; v_days int := 0; v_decks int := 0; v_leads int := 0; v_plans int := 0;
  v_left jsonb;
BEGIN
  -- coaching queue: failed for the provider's fault → written again, attempts back to zero
  WITH r AS (
    UPDATE public.coach_automation_items
       SET status = 'queued', attempts = 0, error = NULL, locked_at = NULL, due_at = now(), updated_at = now()
     WHERE status = 'failed' AND created_at > v_since AND public.ai_error_is_provider(error)
    RETURNING id, coach_user_id, client_id
  ), e AS (
    INSERT INTO public.coach_automation_events (item_id, coach_user_id, client_id, kind, detail)
    SELECT id, coach_user_id, client_id, 'queued', jsonb_build_object('after', 'ai_back') FROM r
    RETURNING 1
  )
  SELECT count(*) INTO v_items FROM e;
  -- and the ones parked while it waited: now, not at their next check
  UPDATE public.coach_automation_items SET due_at = now(), updated_at = now()
   WHERE status = 'queued' AND error LIKE 'Waiting for AI%' AND due_at > now();
  GET DIAGNOSTICS v_woke = ROW_COUNT;

  -- Athlete Insights still to come that gave up for the provider's fault: made again
  UPDATE public.community_daily_visuals
     SET regen = 'full', status = 'planned', attempts = 0, error = NULL, candidate = NULL, updated_at = now()
   WHERE status = 'failed' AND day > v_today AND public.ai_error_is_provider(error);
  GET DIAGNOSTICS v_days = ROW_COUNT;
  UPDATE public.community_daily_visuals SET attempts = 0, updated_at = now()
   WHERE regen IS NOT NULL AND status <> 'skipped' AND error LIKE 'Waiting for AI%';

  -- Crew post decks: back in the queue (the kick's daily background budget paces them)
  UPDATE public.community_post_decks
     SET status = 'pending', attempts = 0, error = NULL, run_after = now(), claimed_at = NULL, updated_at = now()
   WHERE status = 'failed' AND public.ai_error_is_provider(error);
  GET DIAGNOSTICS v_decks = ROW_COUNT;

  -- a lead's first text, while the lead is still fresh
  UPDATE public.coaching_lead_replies
     SET status = 'pending', attempts = 0, error = NULL, updated_at = now()
   WHERE status = 'error' AND created_at > now() - interval '3 days' AND public.ai_error_is_provider(error);
  GET DIAGNOSTICS v_leads = ROW_COUNT;

  -- a Nutrition Update's plan that never got written (never one that was ready: the coach's)
  UPDATE public.nutrition_ai_plans
     SET status = 'pending', error = NULL, progress = NULL, updated_at = now()
   WHERE status = 'error' AND updated_at > now() - interval '3 days' AND public.ai_error_is_provider(error);
  GET DIAGNOSTICS v_plans = ROW_COUNT;

  -- left for a person to run again (counted, never redone by itself)
  SELECT jsonb_build_object(
    'program_generations', (SELECT count(*) FROM public.program_intel_jobs WHERE status = 'error' AND updated_at > v_since AND public.ai_error_is_provider(error)),
    'program_edits', (SELECT count(*) FROM public.program_ai_edits WHERE status = 'error' AND updated_at > v_since AND public.ai_error_is_provider(error)),
    'plan_edits', (SELECT count(*) FROM public.nutrition_plan_edits WHERE status = 'error' AND updated_at > v_since AND public.ai_error_is_provider(error)),
    'plan_changes', (SELECT count(*) FROM public.nutrition_ai_plans WHERE status = 'ready' AND updated_at > v_since AND public.ai_error_is_provider(error)),
    'program_imports', (SELECT count(*) FROM public.program_imports WHERE status = 'failed' AND updated_at > v_since AND public.ai_error_is_provider(error)),
    'meal_imports', (SELECT count(*) FROM public.nutrition_imports WHERE status = 'failed' AND updated_at > v_since AND public.ai_error_is_provider(error)),
    'form_reply_drafts', (SELECT count(*) FROM public.submission_ai_generations WHERE status = 'failed' AND created_at > v_since AND public.ai_error_is_provider(error))
  ) INTO v_left;

  RETURN jsonb_build_object(
    'coaching_replies', v_items, 'coaching_replies_woken', v_woke, 'athlete_insights', v_days,
    'post_decks', v_decks, 'lead_texts', v_leads, 'nutrition_plans', v_plans, 'left_for_you', v_left
  );
END;
$$;
REVOKE ALL ON FUNCTION public.ai_recovery_requeue(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_recovery_requeue(integer) TO service_role;

-- ---------------------------------------------------------------------------
-- Crew post decks: never while OpenAI is down, and the library backlog paced
-- ---------------------------------------------------------------------------
-- On Nov 20 2026 the whole library (lessons months away, every Tuesday tip) was written at once:
-- 65 decks in 25 minutes, up to eight GPT-5.5 calls each, and the account ran dry at 00:09 UTC.
-- Decks for what's planned in the next four weeks (priority < 40) still go at once; the rest of
-- the library goes at most four a day.
CREATE OR REPLACE FUNCTION public.community_post_decks_kick()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_free int;
  v_background_left int;
  v_job uuid;
  v_sent boolean := false;
BEGIN
  IF EXISTS (SELECT 1 FROM public.ai_provider_health WHERE provider = 'openai' AND status <> 'ok' AND next_probe_at > now()) THEN
    RETURN false;
  END IF;
  v_free := 3 - (SELECT count(*) FROM public.community_post_decks WHERE status = 'running' AND claimed_at > now() - interval '12 minutes');
  IF v_free <= 0 THEN RETURN false; END IF;
  v_background_left := 4 - (SELECT count(*) FROM public.community_post_decks
                             WHERE priority >= 40 AND claimed_at > now() - interval '24 hours');
  FOR v_job IN
    SELECT id FROM public.community_post_decks
     WHERE status = 'pending' AND run_after <= now()
       AND (priority < 40 OR v_background_left > 0)
     ORDER BY priority, created_at
     LIMIT v_free
  LOOP
    -- held a minute so the next kick doesn't name it again before its run claims it
    UPDATE public.community_post_decks SET run_after = now() + interval '1 minute' WHERE id = v_job;
    PERFORM net.http_post(
      url := 'https://project--5f1f340c-5afa-4262-90c8-1f9406568c6c.lovable.app/api/public/hooks/post-decks-tick',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-hook-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_hook_secret' LIMIT 1)),
      body := jsonb_build_object('jobId', v_job),
      timeout_milliseconds := 600000);
    v_sent := true;
    v_background_left := v_background_left - 1;
  END LOOP;
  RETURN v_sent;
END;
$$;
REVOKE ALL ON FUNCTION public.community_post_decks_kick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.community_post_decks_kick() TO service_role;

-- ---------------------------------------------------------------------------
-- Usage, read by the admin panel through the server (service role only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ai_usage_by_task(_since timestamptz)
RETURNS TABLE (task text, calls bigint, failed bigint, paused bigint, priced bigint, cost numeric, ok_priced bigint, ok_cost numeric, avg_ms numeric, tokens bigint, models text[], openai_cost numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.task,
         count(*),
         count(*) FILTER (WHERE NOT l.ok AND coalesce(l.failure, '') <> 'paused'),
         count(*) FILTER (WHERE l.failure = 'paused'),
         count(l.cost_usd),
         coalesce(sum(l.cost_usd), 0),
         count(l.cost_usd) FILTER (WHERE l.ok),
         coalesce(sum(l.cost_usd) FILTER (WHERE l.ok), 0),
         round(avg(l.ms) FILTER (WHERE l.ok)),
         coalesce(sum(coalesce(l.input_tokens, 0) + coalesce(l.output_tokens, 0)), 0)::bigint,
         array_agg(DISTINCT l.model),
         coalesce(sum(l.cost_usd) FILTER (WHERE l.provider = 'openai'), 0)
    FROM public.ai_call_log l
   WHERE l.at >= _since AND l.task <> 'probe'
   GROUP BY l.task;
$$;

CREATE OR REPLACE FUNCTION public.ai_usage_by_month(_months integer DEFAULT 12)
RETURNS TABLE (month text, calls bigint, failed bigint, cost numeric, unpriced bigint, openai_cost numeric, gateway_cost numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT to_char(date_trunc('month', public.instant_to_local(l.at, 'America/Winnipeg')), 'YYYY-MM') AS month,
         count(*),
         count(*) FILTER (WHERE NOT l.ok AND coalesce(l.failure, '') <> 'paused'),
         coalesce(sum(l.cost_usd), 0),
         count(*) FILTER (WHERE l.cost_usd IS NULL AND l.ok),
         coalesce(sum(l.cost_usd) FILTER (WHERE l.provider = 'openai'), 0),
         coalesce(sum(l.cost_usd) FILTER (WHERE l.provider = 'gateway'), 0)
    FROM public.ai_call_log l
   WHERE l.at >= date_trunc('month', now()) - make_interval(months => greatest(1, least(coalesce(_months, 12), 24)) - 1) - interval '1 day'
     AND l.task <> 'probe'
   GROUP BY 1
   ORDER BY 1;
$$;
REVOKE ALL ON FUNCTION public.ai_usage_by_task(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_usage_by_month(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_usage_by_task(timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.ai_usage_by_month(integer) TO service_role;

-- ---------------------------------------------------------------------------
-- What's on record from before: Generate a program, Adjust program and the food log
-- ---------------------------------------------------------------------------
INSERT INTO public.ai_call_log (at, provider, model, task, feature, ok, error, input_tokens, output_tokens, ms, cost_usd)
SELECT c.created_at,
       CASE WHEN c.model LIKE 'openai:%' THEN 'openai' ELSE 'gateway' END,
       c.model,
       split_part(split_part(c.stage, ':', 1), ' ', 1),
       c.stage, c.ok, left(c.error, 400), c.input_tokens, c.output_tokens, c.duration_ms,
       CASE WHEN c.input_tokens IS NULL OR c.output_tokens IS NULL THEN NULL ELSE
         CASE regexp_replace(regexp_replace(c.model, '^(openai|gateway|lovable):', ''), '^(openai|anthropic|google)/', '')
           WHEN 'gpt-6-astra' THEN (c.input_tokens * 10.0 + c.output_tokens * 50.0) / 1e6
           WHEN 'gpt-5.5' THEN (c.input_tokens * 5.0 + c.output_tokens * 30.0) / 1e6
           WHEN 'gpt-5.1' THEN (c.input_tokens * 1.25 + c.output_tokens * 10.0) / 1e6
           WHEN 'gpt-5' THEN (c.input_tokens * 1.25 + c.output_tokens * 10.0) / 1e6
           WHEN 'gpt-5-mini' THEN (c.input_tokens * 0.25 + c.output_tokens * 2.0) / 1e6
           WHEN 'claude-opus-5-5' THEN (c.input_tokens * 4.0 + c.output_tokens * 20.0) / 1e6
           WHEN 'claude-sonnet-5' THEN (c.input_tokens * 2.0 + c.output_tokens * 10.0) / 1e6
         END
       END
  FROM (
    SELECT created_at, model, stage, ok, error, input_tokens, output_tokens, duration_ms FROM public.program_intel_job_calls
    UNION ALL
    SELECT created_at, model, 'edit:' || stage, ok, error, input_tokens, output_tokens, duration_ms FROM public.program_ai_edit_calls
  ) c
 WHERE NOT EXISTS (SELECT 1 FROM public.ai_call_log);

INSERT INTO public.ai_call_log (at, provider, model, task, ok, input_tokens, output_tokens, cost_usd)
SELECT e.created_at, CASE WHEN e.model LIKE 'gateway:%' THEN 'gateway' ELSE 'openai' END, e.model, coalesce(e.feature, 'meal_estimate'),
       e.status <> 'refunded', e.input_tokens, e.output_tokens, e.cost_usd
  FROM public.ai_credit_events e
 WHERE e.model IS NOT NULL AND e.kind = 'use'
   AND NOT EXISTS (SELECT 1 FROM public.ai_call_log l WHERE l.task = coalesce(e.feature, 'meal_estimate') AND l.at = e.created_at);

-- ---------------------------------------------------------------------------
-- The tick: probe, alerts, stuck jobs and recovery (src/lib/ai/ai-monitor.server.ts)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM cron.unschedule('ai-health-tick') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ai-health-tick');
  PERFORM cron.schedule('ai-health-tick', '*/5 * * * *', $cmd$
    SELECT net.http_post(
      url := 'https://project--5f1f340c-5afa-4262-90c8-1f9406568c6c.lovable.app/api/public/hooks/ai-health-tick',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-hook-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_hook_secret' LIMIT 1)),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000);
  $cmd$);
END $$;
