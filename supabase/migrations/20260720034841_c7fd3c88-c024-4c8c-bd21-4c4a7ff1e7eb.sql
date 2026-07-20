-- Backfill schema_version=2 on legacy block templates whose payload uses
-- blocks_data. Without this flag, pl_assign_template_to_client falls to a
-- legacy branch that creates blocks with zero weeks/days, so the assigned
-- program never appears on the client's calendar.
UPDATE public.pl_templates
SET payload = jsonb_set(COALESCE(payload, '{}'::jsonb), '{schema_version}', '2'::jsonb, true)
WHERE template_type = 'block'
  AND (payload->>'schema_version') IS NULL
  AND jsonb_typeof(payload->'blocks_data') = 'array'
  AND jsonb_array_length(payload->'blocks_data') > 0;

-- Remove empty pl_blocks left behind by previous failed assigns
-- (no weeks means no schedule, logs, or completions can exist).
DELETE FROM public.pl_blocks b
WHERE NOT EXISTS (SELECT 1 FROM public.pl_weeks w WHERE w.block_id = b.id);