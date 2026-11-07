-- Hand repairs to logged sets can also be a weight (and the set's done stamp),
-- not only reps / RPE. On Nov 7 2026 Jared McIntyre's 495 lb deadlift set never
-- saved: 495 typed on a kg card was over the 450 kg cap, and the weight cell
-- dropped it when the box closed. It was entered by hand as 495 lb, and that
-- repair is logged here like any other.
ALTER TABLE public.pl_row_result_repairs DROP CONSTRAINT IF EXISTS pl_row_result_repairs_field_check;
ALTER TABLE public.pl_row_result_repairs ADD CONSTRAINT pl_row_result_repairs_field_check
  CHECK (field = ANY (ARRAY['actual_rpe', 'actual_reps', 'entered_value', 'entered_unit', 'completed_at']));
