-- How a staff invite was delivered, so "Resend" uses the same channel and the
-- Team page can say where the link went. Existing invites stay as they were
-- (SMS or copied link).
ALTER TABLE public.staff_invites
  ADD COLUMN IF NOT EXISTS delivery_method text
    CHECK (delivery_method IS NULL OR delivery_method IN ('messenger', 'sms', 'link')),
  ADD COLUMN IF NOT EXISTS delivery_client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz;
