-- Non-destructive archive support for client Sales.
-- Paid/financial history remains in purchase_records; UI hides archived rows by default.
ALTER TABLE public.purchase_records
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid;

CREATE INDEX IF NOT EXISTS idx_purchase_records_client_archive
  ON public.purchase_records (client_id, archived_at, purchased_at DESC);