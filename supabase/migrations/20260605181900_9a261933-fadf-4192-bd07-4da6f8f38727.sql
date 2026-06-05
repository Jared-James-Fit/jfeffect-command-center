
-- Phase 1: activity tracking + compliance settings foundation

-- 1. Activity / compliance columns on clients
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS last_signed_in_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_active_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_active_route text,
  ADD COLUMN IF NOT EXISTS compliance_status text NOT NULL DEFAULT 'On Track',
  ADD COLUMN IF NOT EXISTS compliance_status_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS compliance_status_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS compliance_tracking_enabled boolean NOT NULL DEFAULT true;

-- Constrain status to known values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'clients_compliance_status_check'
  ) THEN
    ALTER TABLE public.clients
      ADD CONSTRAINT clients_compliance_status_check
      CHECK (compliance_status IN ('On Track','Watch','Needs Follow-Up','Non-Compliant','Paused'));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS clients_last_active_at_idx ON public.clients (last_active_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS clients_compliance_status_idx ON public.clients (compliance_status);

-- 2. Per-client compliance settings (1:1)
CREATE TABLE IF NOT EXISTS public.client_compliance_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL UNIQUE,
  check_in_required boolean NOT NULL DEFAULT true,
  check_in_due_day text,
  bodyweight_expected boolean NOT NULL DEFAULT false,
  bodyweight_frequency_per_week integer,
  lift_videos_expected boolean NOT NULL DEFAULT false,
  lift_video_frequency_per_week integer,
  progress_photos_expected boolean NOT NULL DEFAULT false,
  message_response_expected_days integer,
  inactivity_threshold_days integer NOT NULL DEFAULT 7,
  followup_threshold_days integer NOT NULL DEFAULT 14,
  noncompliant_threshold_days integer NOT NULL DEFAULT 30,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_compliance_settings TO authenticated;
GRANT ALL ON public.client_compliance_settings TO service_role;

ALTER TABLE public.client_compliance_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin manage client_compliance_settings"
  ON public.client_compliance_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Coach manage assigned client_compliance_settings"
  ON public.client_compliance_settings FOR ALL TO authenticated
  USING (public.is_assigned_coach(client_id))
  WITH CHECK (public.is_assigned_coach(client_id));

CREATE POLICY "Client read own client_compliance_settings"
  ON public.client_compliance_settings FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = client_compliance_settings.client_id AND c.user_id = auth.uid()
  ));

CREATE TRIGGER trg_client_compliance_settings_updated_at
  BEFORE UPDATE ON public.client_compliance_settings
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE INDEX IF NOT EXISTS client_compliance_settings_client_id_idx ON public.client_compliance_settings (client_id);

-- 3. Allow clients to insert their own activity_log rows (heartbeat / page views)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='client_activity_log'
      AND policyname='Client insert own activity_log'
  ) THEN
    CREATE POLICY "Client insert own activity_log"
      ON public.client_activity_log FOR INSERT TO authenticated
      WITH CHECK (
        actor_user_id = auth.uid()
        AND EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_activity_log.client_id AND c.user_id = auth.uid())
      );
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS client_activity_log_client_id_created_idx
  ON public.client_activity_log (client_id, created_at DESC);

-- 4. Allow clients to update their own last_signed_in_at / last_active_at via RPC (via SECURITY DEFINER fn below).

-- 5. RPC: ping activity (throttled server-side to 60s)
CREATE OR REPLACE FUNCTION public.ping_client_activity(_route text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_id uuid;
  v_last timestamptz;
BEGIN
  SELECT id, last_active_at INTO v_client_id, v_last
    FROM public.clients WHERE user_id = auth.uid() LIMIT 1;
  IF v_client_id IS NULL THEN RETURN; END IF;

  -- Throttle: only update if >60s since last ping
  IF v_last IS NULL OR v_last < now() - interval '60 seconds' THEN
    UPDATE public.clients
       SET last_active_at = now(),
           last_active_route = COALESCE(_route, last_active_route)
     WHERE id = v_client_id;
  ELSIF _route IS NOT NULL AND _route <> COALESCE((SELECT last_active_route FROM public.clients WHERE id = v_client_id), '') THEN
    -- Always record route changes (without bumping timestamp aggressively)
    UPDATE public.clients SET last_active_route = _route WHERE id = v_client_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ping_client_activity(text) TO authenticated;

-- 6. RPC: mark sign-in (called once on session establish/restore)
CREATE OR REPLACE FUNCTION public.mark_client_signed_in()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_id uuid;
BEGIN
  SELECT id INTO v_client_id FROM public.clients WHERE user_id = auth.uid() LIMIT 1;
  IF v_client_id IS NULL THEN RETURN; END IF;

  UPDATE public.clients
     SET last_signed_in_at = now(),
         last_active_at = now()
   WHERE id = v_client_id;

  INSERT INTO public.client_activity_log (client_id, actor_user_id, actor_role, action, details)
  VALUES (v_client_id, auth.uid(), 'client', 'signed_in', '{}'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_client_signed_in() TO authenticated;
