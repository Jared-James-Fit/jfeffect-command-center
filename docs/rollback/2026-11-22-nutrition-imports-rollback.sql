-- Rollback for 20270508091000_nutrition_imports.sql (meal plan imports and
-- Create with Cleo). Run only if that change has to come out; the app code
-- that calls startMealPlanImport / startMealPlanCreate and reads
-- nutrition_imports must be reverted first, or the Studio's Import a plan,
-- Create with Cleo and the coach's Import a file stop working.
--
-- What it leaves: plans already saved from an import (they're ordinary plans
-- in nutrition_targets) and originals already filed in documents (their own
-- rows in the documents library). Credits taken by a read still running are
-- given back first.
SET lock_timeout = '5s';

-- 1. give back credits held by reads still queued or running (only those: a finished
--    read's use is settled already and must never be refunded), then the queue goes
WITH cancelled AS (
  UPDATE public.nutrition_imports SET status = 'discarded'
   WHERE status IN ('pending', 'reading')
  RETURNING credit_use_id
)
SELECT public.ai_credits_settle(credit_use_id, false) FROM cancelled WHERE credit_use_id IS NOT NULL;

DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'nutrition-imports-tick';
EXCEPTION WHEN undefined_table OR undefined_function OR invalid_schema_name THEN NULL;
END $$;
DROP TRIGGER IF EXISTS nutrition_imports_queue_run ON public.nutrition_imports;
DROP FUNCTION IF EXISTS public.nutrition_imports_queue_run();

-- 2. the files (storage objects first: a bucket with objects can't be dropped), then the bucket
DELETE FROM storage.objects WHERE bucket_id = 'nutrition-imports';
DROP POLICY IF EXISTS "nutrition imports own insert" ON storage.objects;
DROP POLICY IF EXISTS "nutrition imports own read" ON storage.objects;
DROP POLICY IF EXISTS "nutrition imports own delete" ON storage.objects;
DELETE FROM storage.buckets WHERE id = 'nutrition-imports';

-- 3. the table
DROP TABLE IF EXISTS public.nutrition_imports;

-- 4. the AI credit costs as 20270427090000_program_imports.sql left them
CREATE OR REPLACE FUNCTION public.ai_credit_cost(_feature text)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE _feature
    WHEN 'meal_estimate' THEN 1
    WHEN 'program_import' THEN 10
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION public.ai_credit_state(_user uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  t text := public.ai_credit_tier(_user);
  allowance int := public.ai_credit_allowance(_user);
  p date := public.ai_credit_period_start();
  w public.ai_credit_wallets;
  used int := 0;
  extra int := 0;
  free_left int;
BEGIN
  SELECT * INTO w FROM public.ai_credit_wallets WHERE user_id = _user;
  IF FOUND THEN
    extra := w.extra;
    IF w.period_start = p THEN used := w.period_used; END IF;
  END IF;
  free_left := CASE WHEN allowance IS NULL THEN NULL ELSE greatest(allowance - used, 0) END;
  RETURN jsonb_build_object(
    'tier', t,
    'unlimited', allowance IS NULL,
    'allowance', allowance,
    'used', used,
    'allowance_left', free_left,
    'extra', extra,
    'left', CASE WHEN allowance IS NULL THEN NULL ELSE free_left + extra END,
    'period_start', p,
    'resets_on', (p + interval '1 month')::date,
    'costs', jsonb_build_object(
      'meal_estimate', public.ai_credit_cost('meal_estimate'),
      'program_import', public.ai_credit_cost('program_import'))
  );
END $$;
