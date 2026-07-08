WITH active_blocks AS (
  SELECT DISTINCT ON (client_id)
    client_id,
    start_date
  FROM public.pl_blocks
  WHERE status = 'Active'
    AND start_date IS NOT NULL
  ORDER BY client_id, start_date DESC
), eligible_targets AS (
  SELECT ct.id, ab.start_date
  FROM public.cardio_targets ct
  JOIN active_blocks ab ON ab.client_id = ct.client_id
  JOIN public.clients c ON c.id = ct.client_id
  WHERE c.archived = false
    AND c.status = 'Active'
    AND ct.status = 'Active'
    AND ct.enabled IS TRUE
    AND ct.visible_to_client IS TRUE
    AND ct.program_name IS NULL
    AND ct.day_type IN ('Training Day', 'High Day', 'Rest Day', 'Non-Training Day')
    AND ct.start_date IS NOT NULL
    AND ct.start_date > ab.start_date
)
UPDATE public.cardio_targets ct
SET start_date = et.start_date,
    last_updated_at = now(),
    updated_at = now()
FROM eligible_targets et
WHERE ct.id = et.id;