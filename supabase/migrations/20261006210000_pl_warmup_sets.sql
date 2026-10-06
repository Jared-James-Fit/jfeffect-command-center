-- Logged warm-up sets (optional, any external-load exercise).
-- Deliberately NOT stored in pl_row_results: that table feeds records, tonnage,
-- league points, completion and coach review, none of which may ever see a warm-up.
CREATE TABLE IF NOT EXISTS public.pl_warmup_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  row_id uuid NOT NULL REFERENCES public.pl_exercise_rows(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  load numeric NOT NULL CHECK (load > 0),
  unit text NOT NULL CHECK (unit IN ('kg','lb')),
  reps integer NOT NULL CHECK (reps BETWEEN 1 AND 8),
  rpe numeric CHECK (rpe IS NULL OR (rpe >= 1 AND rpe <= 10)),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pl_warmup_sets_row_client_idx ON public.pl_warmup_sets (row_id, client_id, created_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pl_warmup_sets TO authenticated;
GRANT ALL ON public.pl_warmup_sets TO service_role;
ALTER TABLE public.pl_warmup_sets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin manage pl_warmup_sets" ON public.pl_warmup_sets FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "Coach manage pl_warmup_sets" ON public.pl_warmup_sets FOR ALL TO authenticated
  USING (is_assigned_coach(client_id)) WITH CHECK (is_assigned_coach(client_id));
CREATE POLICY "Client manage own pl_warmup_sets" ON public.pl_warmup_sets FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM clients c WHERE c.id = pl_warmup_sets.client_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM clients c WHERE c.id = pl_warmup_sets.client_id AND c.user_id = auth.uid()));
