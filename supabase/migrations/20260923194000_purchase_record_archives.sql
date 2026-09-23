-- Ensure client-profile Sales can be archived/restored in production.
-- Idempotent because older environments may already have these columns.
ALTER TABLE public.purchase_records
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid;

CREATE INDEX IF NOT EXISTS idx_purchase_records_client_archive
  ON public.purchase_records (client_id, archived_at, purchased_at DESC);
