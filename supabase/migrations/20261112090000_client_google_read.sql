-- Clients' own Google events in the JF Effect calendar (opt-in, read-only).
--
-- After connecting Google Calendar, a client can also allow read access to
-- their calendar list and events. The app reads them live when the client
-- looks at their calendar and never stores, writes or changes them. Only two
-- things are kept, on the existing connection row (service role only):
--   granted_scopes     what Google granted (read access is optional on
--                      Google's consent screen, and can be removed later)
--   show_calendar_ids  which of their calendars to show; null = their main one
alter table public.client_google_calendars
  add column if not exists granted_scopes text,
  add column if not exists show_calendar_ids text[];
