UPDATE public.coach_task_definitions
SET frequency = 'semi_monthly', due_day_of_week = NULL, updated_at = now()
WHERE task_type = 'nutrition_review';

UPDATE public.client_task_overrides
SET frequency = 'semi_monthly', due_day_of_week = NULL, updated_at = now()
WHERE task_type = 'nutrition_review' AND frequency IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fn_next_semi_monthly(_from date)
RETURNS date
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN EXTRACT(DAY FROM _from)::int <= 15
      THEN date_trunc('month', _from)::date + 14
    WHEN EXTRACT(DAY FROM _from)::int <= LEAST(30, EXTRACT(DAY FROM (date_trunc('month', _from) + interval '1 month - 1 day'))::int)
      THEN date_trunc('month', _from)::date + (LEAST(30, EXTRACT(DAY FROM (date_trunc('month', _from) + interval '1 month - 1 day'))::int) - 1)
    ELSE (date_trunc('month', _from) + interval '1 month')::date + 14
  END
$$;

UPDATE public.client_task_occurrences o
SET due_local_date = public.fn_next_semi_monthly(((now() AT TIME ZONE o.client_tz)::date)),
    due_at_utc = ((public.fn_next_semi_monthly(((now() AT TIME ZONE o.client_tz)::date))
                   + ((o.due_at_utc AT TIME ZONE o.client_tz)::time)) AT TIME ZONE o.client_tz),
    subtitle = '15th + 30th of each month',
    status = 'upcoming',
    updated_at = now()
WHERE o.task_type = 'nutrition_review'
  AND o.status NOT IN ('completed', 'skipped');