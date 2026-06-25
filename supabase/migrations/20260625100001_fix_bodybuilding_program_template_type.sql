-- ============================================================
-- Fix: Change template_type from 'full_prep' to 'block' for the
-- 12 bodybuilding programs inserted by migration 20260624200000.
--
-- Root cause: The programs were inserted with template_type='full_prep'
-- but their payload uses schema_version=2 with a 'blocks' array, which
-- is the 'block' template_type format. The builder reads full_prep
-- templates from payload.weeks_data (flat), not payload.blocks.
-- Changing to template_type='block' makes the builder render them correctly.
-- ============================================================

UPDATE public.pl_templates
SET template_type = 'block'
WHERE template_type = 'full_prep'
  AND (payload->>'schema_version') = '2'
  AND jsonb_typeof(payload->'blocks') = 'array'
  AND 'bodybuilding' = ANY(tags)
  AND 'full-body' = ANY(tags)
  AND '3-day' = ANY(tags);

-- Verify: report how many rows were updated
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM public.pl_templates
  WHERE template_type = 'block'
    AND (payload->>'schema_version') = '2'
    AND jsonb_typeof(payload->'blocks') = 'array'
    AND 'bodybuilding' = ANY(tags)
    AND 'full-body' = ANY(tags)
    AND '3-day' = ANY(tags);
  RAISE NOTICE 'Fixed: % bodybuilding programs now have template_type=block', v_count;
END $$;
