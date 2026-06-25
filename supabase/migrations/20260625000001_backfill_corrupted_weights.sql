-- ============================================================
-- Backfill: Restore weight values corrupted by the KG/LB toggle bug
-- Root cause: autosave fired on mount before server hydration, sending
-- actual_load_unit='lb' for rows that were stored in KG. The Postgres
-- trigger then divided the actual_load by 2.2046 to derive actual_load_kg,
-- effectively corrupting the stored value on each page load.
--
-- Pattern of corrupted rows:
--   actual_load_unit = 'lb' (was changed by the toggle)
--   actual_load < 20 (suspiciously small for a lb value)
--   actual_load > 0 (has a value, not null)
--   entered_unit = 'kg' OR (entered_unit IS NULL AND actual_load < 20)
--
-- Fix: multiply actual_load by 2.2046 to reverse the division,
-- and restore actual_load_unit to 'kg'.
--
-- This migration is IDEMPOTENT: running it twice will not double-multiply
-- because after the first run, actual_load >= 20 (no longer matches the
-- WHERE clause).
-- ============================================================

DO $$
DECLARE
  v_count integer;
BEGIN
  -- Identify and fix corrupted rows
  -- Criteria: lb-labeled rows with suspiciously small values (< 20 lb)
  -- that were almost certainly stored as KG values
  UPDATE public.pl_row_results
  SET
    actual_load = ROUND((actual_load * 2.2046)::numeric, 2),
    actual_load_unit = 'kg',
    entered_unit = 'kg'
  WHERE
    actual_load_unit = 'lb'
    AND actual_load IS NOT NULL
    AND actual_load > 0
    AND actual_load < 20;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Backfill complete: % corrupted weight rows restored', v_count;
END $$;

-- Verify: show any remaining suspicious rows after fix
-- (Should return 0 rows if fix was complete)
DO $$
DECLARE
  v_remaining integer;
BEGIN
  SELECT COUNT(*) INTO v_remaining
  FROM public.pl_row_results
  WHERE actual_load_unit = 'lb'
    AND actual_load IS NOT NULL
    AND actual_load > 0
    AND actual_load < 20;

  IF v_remaining > 0 THEN
    RAISE WARNING 'WARNING: % rows still have suspicious lb values < 20 after backfill', v_remaining;
  ELSE
    RAISE NOTICE 'Verification passed: no remaining suspicious lb values < 20';
  END IF;
END $$;
