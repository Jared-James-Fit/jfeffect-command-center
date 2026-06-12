-- Add explicit entered_value/entered_unit/normalized_kg/normalized_lb to workout logging tables.
-- Coexists with existing actual_load/actual_load_kg/actual_load_lb columns (kept for back-compat).

ALTER TABLE public.pl_row_results
  ADD COLUMN IF NOT EXISTS entered_value numeric,
  ADD COLUMN IF NOT EXISTS entered_unit text,
  ADD COLUMN IF NOT EXISTS normalized_kg numeric,
  ADD COLUMN IF NOT EXISTS normalized_lb numeric;

ALTER TABLE public.member_set_logs
  ADD COLUMN IF NOT EXISTS entered_value numeric,
  ADD COLUMN IF NOT EXISTS entered_unit text,
  ADD COLUMN IF NOT EXISTS normalized_kg numeric,
  ADD COLUMN IF NOT EXISTS normalized_lb numeric;

-- Replace pl_row_results sync trigger to also maintain the new normalized columns.
CREATE OR REPLACE FUNCTION public.tg_pl_row_results_sync_units()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_unit text;
  v_val  numeric;
BEGIN
  -- Prefer explicit entered_value/unit when provided; otherwise fall back to legacy actual_load.
  v_val  := COALESCE(NEW.entered_value, NEW.actual_load);
  v_unit := lower(COALESCE(NEW.entered_unit, NEW.actual_load_unit, 'lb'));

  -- Keep entered_* in sync with legacy fields so readers of either shape stay consistent.
  IF NEW.entered_value IS NULL AND NEW.actual_load IS NOT NULL THEN
    NEW.entered_value := NEW.actual_load;
  END IF;
  IF NEW.entered_unit IS NULL AND NEW.actual_load_unit IS NOT NULL THEN
    NEW.entered_unit := NEW.actual_load_unit;
  END IF;
  IF NEW.actual_load IS NULL AND NEW.entered_value IS NOT NULL THEN
    NEW.actual_load := NEW.entered_value;
  END IF;
  IF NEW.actual_load_unit IS NULL AND NEW.entered_unit IS NOT NULL THEN
    NEW.actual_load_unit := NEW.entered_unit;
  END IF;

  IF v_val IS NULL THEN
    NEW.actual_load_kg := NULL;
    NEW.actual_load_lb := NULL;
    NEW.normalized_kg  := NULL;
    NEW.normalized_lb  := NULL;
  ELSE
    IF v_unit = 'kg' THEN
      NEW.normalized_kg := v_val;
      NEW.normalized_lb := round((v_val * 2.2046226218)::numeric, 4);
    ELSE
      NEW.normalized_lb := v_val;
      NEW.normalized_kg := round((v_val / 2.2046226218)::numeric, 4);
    END IF;
    NEW.actual_load_kg := NEW.normalized_kg;
    NEW.actual_load_lb := NEW.normalized_lb;
  END IF;

  IF NEW.actual_rpe IS NOT NULL AND NEW.actual_rpe ~ '^[0-9]+(\.[0-9]+)?$' THEN
    NEW.actual_rpe_num := NEW.actual_rpe::numeric;
  ELSIF NEW.actual_rpe IS NULL THEN
    NEW.actual_rpe_num := NULL;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

-- Trigger for member_set_logs to keep normalized_kg/lb in sync.
CREATE OR REPLACE FUNCTION public.tg_member_set_logs_sync_units()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_unit text;
  v_val  numeric;
BEGIN
  -- Derive entered_* from load_kg/load_lb when not explicitly provided.
  IF NEW.entered_value IS NULL OR NEW.entered_unit IS NULL THEN
    IF NEW.load_kg IS NOT NULL THEN
      NEW.entered_value := COALESCE(NEW.entered_value, NEW.load_kg);
      NEW.entered_unit  := COALESCE(NEW.entered_unit, 'kg');
    ELSIF NEW.load_lb IS NOT NULL THEN
      NEW.entered_value := COALESCE(NEW.entered_value, NEW.load_lb);
      NEW.entered_unit  := COALESCE(NEW.entered_unit, 'lb');
    END IF;
  END IF;

  v_val  := NEW.entered_value;
  v_unit := lower(COALESCE(NEW.entered_unit, 'lb'));

  IF v_val IS NULL THEN
    NEW.normalized_kg := NULL;
    NEW.normalized_lb := NULL;
  ELSE
    IF v_unit = 'kg' THEN
      NEW.normalized_kg := v_val;
      NEW.normalized_lb := round((v_val * 2.2046226218)::numeric, 4);
    ELSE
      NEW.normalized_lb := v_val;
      NEW.normalized_kg := round((v_val / 2.2046226218)::numeric, 4);
    END IF;
    -- Keep legacy load_kg/load_lb consistent.
    NEW.load_kg := NEW.normalized_kg;
    NEW.load_lb := NEW.normalized_lb;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS tg_member_set_logs_sync_units ON public.member_set_logs;
CREATE TRIGGER tg_member_set_logs_sync_units
  BEFORE INSERT OR UPDATE ON public.member_set_logs
  FOR EACH ROW EXECUTE FUNCTION public.tg_member_set_logs_sync_units();

-- Backfill historical rows: derive entered_* and normalized_* from existing data.
UPDATE public.pl_row_results
   SET entered_value = actual_load,
       entered_unit  = COALESCE(actual_load_unit, 'lb'),
       normalized_kg = actual_load_kg,
       normalized_lb = actual_load_lb
 WHERE entered_value IS NULL
   AND actual_load IS NOT NULL;

UPDATE public.member_set_logs
   SET entered_value = COALESCE(load_kg, load_lb),
       entered_unit  = CASE WHEN load_kg IS NOT NULL THEN 'kg' ELSE 'lb' END,
       normalized_kg = COALESCE(load_kg, round((load_lb / 2.2046226218)::numeric, 4)),
       normalized_lb = COALESCE(load_lb, round((load_kg * 2.2046226218)::numeric, 4))
 WHERE entered_value IS NULL
   AND (load_kg IS NOT NULL OR load_lb IS NOT NULL);

-- Helpful indexes for future analytics queries (volume by client/exercise).
CREATE INDEX IF NOT EXISTS idx_pl_row_results_client_completed
  ON public.pl_row_results (client_id, completed_at)
  WHERE completed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pl_row_results_row_completed
  ON public.pl_row_results (row_id, completed_at);