-- Purchase term date tracking
-- Adds date history, term snapshot, and auto-calculation on assignment.
--
-- Existing columns already on purchase_records:
--   term_start_date  date | null
--   term_end_date    date | null
--   package_expiry_date date | null
--
-- New columns added here:
--   term_date_history  jsonb  -- array of {start, end, changed_at, changed_by, reason}
--   term_length_snapshot int  -- product term_length at time of purchase
--   term_unit_snapshot   text -- product term_unit at time of purchase ('days','weeks','months','years')
--   term_auto_calculated boolean -- true if dates were auto-calculated from product term

ALTER TABLE public.purchase_records
  ADD COLUMN IF NOT EXISTS term_date_history    jsonb    DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS term_length_snapshot int      DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS term_unit_snapshot   text     DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS term_auto_calculated boolean  DEFAULT false;

-- ── RPC: update_purchase_term_dates ─────────────────────────────────────────
-- Called by admin UI to update start/end dates while preserving history.
-- Appends the PREVIOUS values to term_date_history before overwriting.
CREATE OR REPLACE FUNCTION public.update_purchase_term_dates(
  _purchase_id  uuid,
  _start_date   date,
  _end_date     date,
  _reason       text DEFAULT NULL
)
RETURNS public.purchase_records
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_record public.purchase_records;
  v_history jsonb;
  v_entry   jsonb;
BEGIN
  -- Verify caller is admin or coach
  IF NOT (
    public.has_role(auth.uid(), 'admin') OR
    public.has_role(auth.uid(), 'coach')
  ) THEN
    RAISE EXCEPTION 'Only admins or coaches can update purchase term dates';
  END IF;

  SELECT * INTO v_record FROM public.purchase_records WHERE id = _purchase_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase record not found';
  END IF;

  -- Build history entry from CURRENT values (before overwriting)
  v_entry := jsonb_build_object(
    'start_date',  v_record.term_start_date,
    'end_date',    v_record.term_end_date,
    'changed_at',  now(),
    'changed_by',  auth.uid(),
    'reason',      COALESCE(_reason, 'Manual update')
  );

  -- Append to existing history (keep last 50 entries)
  v_history := COALESCE(v_record.term_date_history, '[]'::jsonb);
  v_history := (v_history || jsonb_build_array(v_entry));
  -- Trim to last 50
  IF jsonb_array_length(v_history) > 50 THEN
    v_history := (SELECT jsonb_agg(elem) FROM (
      SELECT elem FROM jsonb_array_elements(v_history) WITH ORDINALITY AS t(elem, ord)
      ORDER BY ord DESC LIMIT 50
    ) sub);
  END IF;

  UPDATE public.purchase_records
  SET
    term_start_date    = _start_date,
    term_end_date      = _end_date,
    package_expiry_date = _end_date,  -- keep in sync
    term_date_history  = v_history,
    term_auto_calculated = false,     -- manually set
    updated_at         = now()
  WHERE id = _purchase_id
  RETURNING * INTO v_record;

  RETURN v_record;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_purchase_term_dates(uuid, date, date, text) TO authenticated;

-- ── RPC: auto_calculate_purchase_term_dates ──────────────────────────────────
-- Called when creating a purchase record to auto-fill start/end from product term.
-- Safe to call multiple times — only sets dates if they are currently NULL.
CREATE OR REPLACE FUNCTION public.auto_calculate_purchase_term_dates(
  _purchase_id   uuid,
  _start_date    date DEFAULT CURRENT_DATE,
  _term_length   int  DEFAULT NULL,
  _term_unit     text DEFAULT NULL  -- 'days' | 'weeks' | 'months' | 'years'
)
RETURNS public.purchase_records
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_record   public.purchase_records;
  v_end_date date;
  v_interval interval;
BEGIN
  SELECT * INTO v_record FROM public.purchase_records WHERE id = _purchase_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Purchase record not found'; END IF;

  -- Only auto-calculate if no dates are set yet
  IF v_record.term_start_date IS NOT NULL THEN
    RETURN v_record;
  END IF;

  -- Calculate end date from term
  IF _term_length IS NOT NULL AND _term_unit IS NOT NULL THEN
    v_interval := CASE lower(_term_unit)
      WHEN 'days'   THEN (_term_length || ' days')::interval
      WHEN 'weeks'  THEN (_term_length || ' weeks')::interval
      WHEN 'months' THEN (_term_length || ' months')::interval
      WHEN 'years'  THEN (_term_length || ' years')::interval
      ELSE NULL
    END;
    IF v_interval IS NOT NULL THEN
      v_end_date := _start_date + v_interval;
    END IF;
  END IF;

  UPDATE public.purchase_records
  SET
    term_start_date      = _start_date,
    term_end_date        = COALESCE(v_end_date, v_record.term_end_date),
    package_expiry_date  = COALESCE(v_end_date, v_record.package_expiry_date),
    term_length_snapshot = _term_length,
    term_unit_snapshot   = _term_unit,
    term_auto_calculated = true,
    updated_at           = now()
  WHERE id = _purchase_id
  RETURNING * INTO v_record;

  RETURN v_record;
END;
$$;

GRANT EXECUTE ON FUNCTION public.auto_calculate_purchase_term_dates(uuid, date, int, text) TO authenticated;

-- ── Backfill: set term_start_date = assigned_at for existing records ─────────
-- Only for records that have a term_end_date or package_expiry_date but no start.
UPDATE public.purchase_records
SET
  term_start_date      = assigned_at::date,
  term_auto_calculated = true
WHERE term_start_date IS NULL
  AND assigned_at IS NOT NULL
  AND (term_end_date IS NOT NULL OR package_expiry_date IS NOT NULL);

COMMENT ON COLUMN public.purchase_records.term_date_history IS
  'JSONB array of previous term date values. Each entry: {start_date, end_date, changed_at, changed_by, reason}. Appended by update_purchase_term_dates() before each change. Max 50 entries.';
