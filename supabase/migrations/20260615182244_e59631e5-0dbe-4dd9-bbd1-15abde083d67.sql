-- Phase 1: Training Schedule Manager — audit log + helper RPC

CREATE TABLE public.pl_schedule_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL,
  day_id uuid NOT NULL REFERENCES public.pl_days(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  previous_date date,
  new_date date,
  previous_source text,
  new_source text,
  scope text NOT NULL CHECK (scope IN ('single','swap','week','pattern','block','program','custom','completed-override','undo','shift-following')),
  changed_by uuid NOT NULL,
  changed_by_role text NOT NULL CHECK (changed_by_role IN ('client','member','coach','admin','system')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.pl_schedule_audit TO authenticated;
GRANT ALL ON public.pl_schedule_audit TO service_role;

ALTER TABLE public.pl_schedule_audit ENABLE ROW LEVEL SECURITY;

CREATE INDEX pl_schedule_audit_client_idx ON public.pl_schedule_audit (client_id, created_at DESC);
CREATE INDEX pl_schedule_audit_batch_idx ON public.pl_schedule_audit (batch_id);
CREATE INDEX pl_schedule_audit_day_idx ON public.pl_schedule_audit (day_id, created_at DESC);

-- Clients can read their own history.
CREATE POLICY "clients read own schedule audit"
  ON public.pl_schedule_audit FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = pl_schedule_audit.client_id
        AND c.user_id = auth.uid()
    )
  );

-- Admins and coaches (any staff with admin role) can read all audit rows.
CREATE POLICY "admins read schedule audit"
  ON public.pl_schedule_audit FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Inserts only via server fns (using service_role) or by the acting user themselves.
CREATE POLICY "users insert own schedule audit"
  ON public.pl_schedule_audit FOR INSERT
  TO authenticated
  WITH CHECK (changed_by = auth.uid());

-- Optional per-client lock flag for coach override (used by phase 5).
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS schedule_locked boolean NOT NULL DEFAULT false;
