-- Session, flight and local wall-clock times already live on competitions.
-- Preserve existing rows; no backfill or duplicate schedule columns.
ALTER TABLE public.competitions
  ADD COLUMN IF NOT EXISTS equipment_event text
  CHECK (equipment_event IS NULL OR char_length(equipment_event) <= 100);
