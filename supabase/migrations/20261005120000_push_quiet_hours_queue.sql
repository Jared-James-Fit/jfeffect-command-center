-- Smarter push: new categories (wins, reminders), quiet hours, and a queue
-- for non-urgent pushes held during quiet hours (delivered by the hourly tick).

ALTER TABLE public.push_notification_preferences
  ADD COLUMN IF NOT EXISTS wins boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS reminders boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS quiet_hours_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS quiet_start smallint NOT NULL DEFAULT 22 CHECK (quiet_start BETWEEN 0 AND 23),
  ADD COLUMN IF NOT EXISTS quiet_end smallint NOT NULL DEFAULT 7 CHECK (quiet_end BETWEEN 0 AND 23),
  ADD COLUMN IF NOT EXISTS timezone text;

CREATE TABLE IF NOT EXISTS public.push_notification_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  payload jsonb NOT NULL,
  category text,
  event_key text,
  deliver_after timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS push_queue_due_idx ON public.push_notification_queue (deliver_after) WHERE sent_at IS NULL;
ALTER TABLE public.push_notification_queue ENABLE ROW LEVEL SECURITY;
-- Server-only (service role); no client policies.
GRANT ALL ON public.push_notification_queue TO service_role;
