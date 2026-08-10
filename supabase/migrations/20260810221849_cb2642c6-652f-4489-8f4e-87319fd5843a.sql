-- 1. Link task definitions to their actual forms so Action Centre rows deep-link directly.
UPDATE public.coach_task_definitions
SET form_id = '750bcec9-2c2b-4f02-ab80-6c7123aa672a'
WHERE task_type = 'weekly_checkin' AND form_id IS NULL;

UPDATE public.coach_task_definitions
SET form_id = '0cbd5e2c-ed47-48ea-93fd-20c341013444'
WHERE task_type = 'nutrition_review' AND form_id IS NULL;

-- 2. Backfill active occurrences with the form link and a friendly cadence subtitle.
UPDATE public.client_task_occurrences o
SET
  metadata = COALESCE(o.metadata, '{}'::jsonb) || jsonb_build_object('form_id', d.form_id),
  subtitle = COALESCE(o.subtitle,
    CASE d.frequency
      WHEN 'weekly' THEN 'Weekly'
      WHEN 'biweekly' THEN 'Every 2 weeks'
      WHEN 'monthly' THEN 'Monthly'
      WHEN 'daily' THEN 'Daily'
      WHEN 'custom_days' THEN 'Every ' || COALESCE(d.interval_days::text, 'few') || ' days'
      ELSE NULL
    END ||
    CASE WHEN d.due_day_of_week IS NOT NULL
      THEN ' · due ' || trim(to_char(date '2026-08-09' + d.due_day_of_week, 'Day'))
      ELSE ''
    END)
FROM public.coach_task_definitions d
WHERE o.task_type = d.task_type
  AND d.form_id IS NOT NULL
  AND o.status NOT IN ('completed', 'skipped');

-- 3. One consistent name per form, everywhere (titles, buttons, headers).
UPDATE public.nf_forms
SET title = 'Nutrition Review', button_label = 'Submit Nutrition Review'
WHERE id = '0cbd5e2c-ed47-48ea-93fd-20c341013444';

UPDATE public.nf_forms
SET title = 'Weekly Check-In', button_label = 'Submit Weekly Check-In'
WHERE id = '750bcec9-2c2b-4f02-ab80-6c7123aa672a';