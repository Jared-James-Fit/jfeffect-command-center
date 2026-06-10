ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS google_event_id text NULL,
  ADD COLUMN IF NOT EXISTS google_event_link text NULL,
  ADD COLUMN IF NOT EXISTS google_calendar_transparency text NOT NULL DEFAULT 'transparent',
  ADD COLUMN IF NOT EXISTS google_synced_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS google_sync_error text NULL;

ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_google_calendar_transparency_check;

ALTER TABLE public.events
  ADD CONSTRAINT events_google_calendar_transparency_check
  CHECK (google_calendar_transparency IN ('transparent','opaque'));

CREATE INDEX IF NOT EXISTS events_google_event_id_idx ON public.events (google_event_id);