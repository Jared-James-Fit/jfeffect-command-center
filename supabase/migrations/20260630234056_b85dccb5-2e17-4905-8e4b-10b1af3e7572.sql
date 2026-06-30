
-- 1) Push subscriptions (one row per device)
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh_key TEXT NOT NULL,
  auth_key TEXT NOT NULL,
  device_name TEXT,
  platform TEXT,
  user_agent TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_used_at TIMESTAMPTZ,
  last_error TEXT,
  failure_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON public.push_subscriptions(user_id) WHERE enabled = true;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Users see/modify only their own rows. Note: this still returns the raw
-- keys to their own client (which is fine — the client created them) but
-- never to other users, coaches, or admins via the Data API.
CREATE POLICY "Users manage own push subs"
  ON public.push_subscriptions
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Admin maintenance read (for diagnostics) via security-definer functions only;
-- no broad admin policy here so raw keys stay confined.

-- 2) Per-user notification category preferences
CREATE TABLE IF NOT EXISTS public.push_notification_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  master_enabled BOOLEAN NOT NULL DEFAULT true,
  messages BOOLEAN NOT NULL DEFAULT true,
  check_ins BOOLEAN NOT NULL DEFAULT true,
  lift_reviews BOOLEAN NOT NULL DEFAULT true,
  workouts BOOLEAN NOT NULL DEFAULT true,
  billing BOOLEAN NOT NULL DEFAULT true,
  coaching_apps BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_notification_preferences TO authenticated;
GRANT ALL ON public.push_notification_preferences TO service_role;
ALTER TABLE public.push_notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own push prefs"
  ON public.push_notification_preferences
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 3) Per-(user,event) dedupe so the same event fires once per recipient
CREATE TABLE IF NOT EXISTS public.push_notification_dedupe (
  user_id UUID NOT NULL,
  event_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, event_key)
);

GRANT ALL ON public.push_notification_dedupe TO service_role;
ALTER TABLE public.push_notification_dedupe ENABLE ROW LEVEL SECURITY;
-- No policies = inaccessible to authenticated; only service_role writes.

-- 4) updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS touch_push_subscriptions ON public.push_subscriptions;
CREATE TRIGGER touch_push_subscriptions BEFORE UPDATE ON public.push_subscriptions
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS touch_push_prefs ON public.push_notification_preferences;
CREATE TRIGGER touch_push_prefs BEFORE UPDATE ON public.push_notification_preferences
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
