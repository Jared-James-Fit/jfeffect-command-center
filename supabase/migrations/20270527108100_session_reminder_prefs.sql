-- Call and session reminders (session-reminders.ts): each person chooses which
-- ones reach them. Keys: day (a day before, and a coach's "tomorrow" summary),
-- hour (an hour before), soon (10 or 15 minutes before). A missing key is on.
-- Sent once each through push_notification_dedupe (the push sender's own key).
ALTER TABLE public.push_notification_preferences
  ADD COLUMN IF NOT EXISTS session_reminders jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.push_notification_preferences.session_reminders IS
  'Call and session reminder choices: {"day": bool, "hour": bool, "soon": bool}; missing = on.';
