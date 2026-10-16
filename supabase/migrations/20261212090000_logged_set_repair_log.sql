-- Repairs to logged sets made by hand (support fixes), one row per field
-- changed, with the value it had, so every repair can be undone exactly.
-- First use: RPE / reps typed on a set that filled down to the sets below
-- were saved on the sets below but not on the set itself (Oct 7 to Oct 16,
-- useAutosave dropped the pending save on re-render). The set is restored to
-- the value the fill-down copied from it.
-- Closed to every client (RLS on, no policies): admins read it in SQL.
CREATE TABLE IF NOT EXISTS public.pl_row_result_repairs (
  id bigserial PRIMARY KEY,
  result_id uuid NOT NULL,
  row_id uuid NOT NULL,
  client_id uuid NOT NULL,
  set_index integer NOT NULL,
  field text NOT NULL CHECK (field IN ('actual_rpe', 'actual_reps')),
  old_value text,
  new_value text,
  reason text NOT NULL,
  repaired_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.pl_row_result_repairs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pl_row_result_repairs FROM anon, authenticated;
CREATE INDEX IF NOT EXISTS pl_row_result_repairs_result_idx ON public.pl_row_result_repairs (result_id);
