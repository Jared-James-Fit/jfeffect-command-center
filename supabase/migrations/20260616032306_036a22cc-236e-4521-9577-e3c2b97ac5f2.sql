
-- Password recovery tokens (SMS path). Only hashed token is stored.
CREATE TABLE public.password_recovery_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE,
  channel text NOT NULL CHECK (channel IN ('sms','email')),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  attempts_remaining int NOT NULL DEFAULT 5,
  created_ip inet,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_prt_user ON public.password_recovery_tokens(user_id, created_at DESC);
CREATE INDEX idx_prt_expires ON public.password_recovery_tokens(expires_at);

GRANT ALL ON public.password_recovery_tokens TO service_role;
ALTER TABLE public.password_recovery_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON public.password_recovery_tokens
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Rate limit counters keyed by identifier+kind+window
CREATE TABLE public.recovery_rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier text NOT NULL,
  kind text NOT NULL,
  window_start timestamptz NOT NULL,
  count int NOT NULL DEFAULT 1,
  UNIQUE (identifier, kind, window_start)
);
CREATE INDEX idx_rrl_lookup ON public.recovery_rate_limits(identifier, kind, window_start DESC);

GRANT ALL ON public.recovery_rate_limits TO service_role;
ALTER TABLE public.recovery_rate_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON public.recovery_rate_limits
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Audit/event log for recovery activity (admin readable)
CREATE TABLE public.password_reset_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_user_id uuid,
  target_email_masked text,
  target_phone_masked text,
  initiated_by uuid,           -- admin user id when admin-initiated
  actor_kind text NOT NULL,    -- 'self' | 'admin' | 'system'
  channel text NOT NULL,       -- 'email' | 'sms' | 'both'
  destination_masked text,
  outcome text NOT NULL,       -- 'requested' | 'email_sent' | 'sms_sent' | 'partial' | 'failed' | 'rate_limited' | 'reset_success' | 'token_invalid'
  error_code text,
  ip inet,
  user_agent text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pre_target ON public.password_reset_events(target_user_id, created_at DESC);
CREATE INDEX idx_pre_initiator ON public.password_reset_events(initiated_by, created_at DESC);

GRANT SELECT ON public.password_reset_events TO authenticated;
GRANT ALL ON public.password_reset_events TO service_role;
ALTER TABLE public.password_reset_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins can view all events" ON public.password_reset_events
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "service role manages events" ON public.password_reset_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);
