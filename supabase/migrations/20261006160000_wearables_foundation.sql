-- Wearables foundation: provider-agnostic device connections + daily metrics.
--
-- Design rules
--  * One schema for every source (Oura, Whoop, Garmin, Apple Health, Health Connect...).
--    Providers differ only in the adapter that fills `wearable_daily_metrics`.
--  * OAuth tokens live in `wearable_connection_secrets`, which has NO grants for
--    anon/authenticated. Only the service role (server functions / cron) can read them.
--  * Metrics are written only by the service role. Clients cannot insert rows, so
--    device data cannot be forged from the browser.
--  * Wearable data never awards Level points: XP stays trigger-only from verified
--    workout/log records (see AGENTS.md), so device data cannot be farmed.
--  * Health data is sensitive: the athlete controls whether their coach can see it
--    (`shared_with_coach`), and can disconnect and delete everything.

CREATE TABLE IF NOT EXISTS public.wearable_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN (
    'oura', 'whoop', 'garmin', 'fitbit', 'withings', 'polar', 'strava',
    'apple_health', 'health_connect'
  )),
  status text NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected', 'reconnect_required', 'disconnected')),
  provider_user_id text,
  scopes text,
  shared_with_coach boolean NOT NULL DEFAULT true,
  last_synced_at timestamptz,
  last_error text,
  sync_started_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);

CREATE TABLE IF NOT EXISTS public.wearable_connection_secrets (
  connection_id uuid PRIMARY KEY REFERENCES public.wearable_connections(id) ON DELETE CASCADE,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.wearable_daily_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  metric_date date NOT NULL,
  sleep_minutes integer CHECK (sleep_minutes IS NULL OR sleep_minutes BETWEEN 0 AND 1440),
  sleep_efficiency integer CHECK (sleep_efficiency IS NULL OR sleep_efficiency BETWEEN 0 AND 100),
  sleep_score integer CHECK (sleep_score IS NULL OR sleep_score BETWEEN 0 AND 100),
  readiness_score integer CHECK (readiness_score IS NULL OR readiness_score BETWEEN 0 AND 100),
  hrv_ms numeric(6,1) CHECK (hrv_ms IS NULL OR hrv_ms > 0),
  resting_hr numeric(5,1) CHECK (resting_hr IS NULL OR resting_hr > 0),
  temp_deviation_c numeric(4,2),
  steps integer CHECK (steps IS NULL OR steps >= 0),
  active_kcal integer CHECK (active_kcal IS NULL OR active_kcal >= 0),
  activity_score integer CHECK (activity_score IS NULL OR activity_score BETWEEN 0 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider, metric_date)
);

CREATE INDEX IF NOT EXISTS idx_wearable_daily_metrics_user_date
  ON public.wearable_daily_metrics (user_id, metric_date DESC);

DROP TRIGGER IF EXISTS trg_wearable_connections_updated_at ON public.wearable_connections;
CREATE TRIGGER trg_wearable_connections_updated_at BEFORE UPDATE ON public.wearable_connections
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
DROP TRIGGER IF EXISTS trg_wearable_daily_metrics_updated_at ON public.wearable_daily_metrics;
CREATE TRIGGER trg_wearable_daily_metrics_updated_at BEFORE UPDATE ON public.wearable_daily_metrics
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.wearable_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wearable_connection_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wearable_daily_metrics ENABLE ROW LEVEL SECURITY;

-- Secrets: service role only (no policies, no grants for client roles).
REVOKE ALL ON public.wearable_connection_secrets FROM anon, authenticated;
GRANT ALL ON public.wearable_connection_secrets TO service_role;

-- Connections: owner reads and may flip the coach-sharing flag only.
-- Creating/removing a connection and token changes go through server functions.
REVOKE ALL ON public.wearable_connections FROM anon, authenticated;
GRANT SELECT ON public.wearable_connections TO authenticated;
GRANT UPDATE (shared_with_coach) ON public.wearable_connections TO authenticated;
GRANT ALL ON public.wearable_connections TO service_role;

CREATE POLICY "Owner reads wearable connections" ON public.wearable_connections
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Owner updates wearable sharing" ON public.wearable_connections
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Admin reads wearable connections" ON public.wearable_connections
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Coach reads shared wearable connections" ON public.wearable_connections
  FOR SELECT TO authenticated USING (
    shared_with_coach
    AND public.has_role(auth.uid(), 'coach')
    AND EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.user_id = wearable_connections.user_id AND public.is_assigned_coach(c.id)
    )
  );

-- Metrics: read-only for everyone except the service role.
REVOKE ALL ON public.wearable_daily_metrics FROM anon, authenticated;
GRANT SELECT ON public.wearable_daily_metrics TO authenticated;
GRANT ALL ON public.wearable_daily_metrics TO service_role;

CREATE POLICY "Owner reads wearable metrics" ON public.wearable_daily_metrics
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Admin reads wearable metrics" ON public.wearable_daily_metrics
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Coach reads shared wearable metrics" ON public.wearable_daily_metrics
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'coach')
    AND EXISTS (
      SELECT 1
      FROM public.wearable_connections wc
      JOIN public.clients c ON c.user_id = wc.user_id
      WHERE wc.user_id = wearable_daily_metrics.user_id
        AND wc.provider = wearable_daily_metrics.provider
        AND wc.shared_with_coach
        AND public.is_assigned_coach(c.id)
    )
  );
