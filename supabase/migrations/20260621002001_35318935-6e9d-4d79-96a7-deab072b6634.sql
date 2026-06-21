
-- Appointment ↔ session credit linkage
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS session_credit_package_id uuid REFERENCES public.purchase_records(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS credits_used integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS credit_deducted boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS appointments_session_credit_package_idx
  ON public.appointments(session_credit_package_id);

-- Whether the package's monetary value can be shown to clients
ALTER TABLE public.purchase_records
  ADD COLUMN IF NOT EXISTS show_value_to_client boolean NOT NULL DEFAULT false;

-- Link ledger entries to appointments + allow appointment-driven sources
ALTER TABLE public.session_ledger_events
  ADD COLUMN IF NOT EXISTS appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS sle_appointment_idx
  ON public.session_ledger_events(appointment_id);

ALTER TABLE public.session_ledger_events DROP CONSTRAINT IF EXISTS session_ledger_events_source_check;
ALTER TABLE public.session_ledger_events
  ADD CONSTRAINT session_ledger_events_source_check
  CHECK (source IN (
    'manual','auto_grant_on_payment','auto_use_on_complete','auto_expire',
    'conversion','admin_adjust',
    'auto_use_on_appointment','auto_unuse_on_appointment_cancel'
  ));
