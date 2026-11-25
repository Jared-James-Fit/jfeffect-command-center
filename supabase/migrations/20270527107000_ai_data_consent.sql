-- Permission to send a person's data to outside AI services (OpenAI, Google Gemini).
-- App Store guideline 5.1.2(i): disclose sharing with third-party AI and get explicit
-- permission first. One answer per login, set only by the person (ai_consent_set),
-- read by the server before any model call that carries their data
-- (src/lib/ai-consent/consent.server.ts). Idempotent.

CREATE TABLE IF NOT EXISTS public.ai_data_consents (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  granted boolean NOT NULL,
  text_version integer NOT NULL CHECK (text_version BETWEEN 1 AND 1000),
  providers text NOT NULL DEFAULT 'OpenAI, Google (Gemini)',
  decided_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_data_consents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Own AI consent readable" ON public.ai_data_consents;
CREATE POLICY "Own AI consent readable" ON public.ai_data_consents
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
-- no insert / update / delete policies: only ai_consent_set writes

-- Every answer, kept as the record of what was agreed to and when (no FK: it outlives the row it describes).
CREATE TABLE IF NOT EXISTS public.ai_data_consent_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL,
  granted boolean NOT NULL,
  text_version integer NOT NULL,
  providers text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_data_consent_events_user_idx ON public.ai_data_consent_events (user_id, at DESC);
ALTER TABLE public.ai_data_consent_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Own AI consent history readable" ON public.ai_data_consent_events;
CREATE POLICY "Own AI consent history readable" ON public.ai_data_consent_events
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- The person answers (Allow / Don't allow / withdraw in Account → Privacy & data).
CREATE OR REPLACE FUNCTION public.ai_consent_set(_granted boolean, _version integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_user uuid := auth.uid();
  v_providers text := 'OpenAI, Google (Gemini)';
  v_at timestamptz := now();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Sign in first' USING ERRCODE = '42501';
  END IF;
  IF _granted IS NULL OR _version IS NULL OR _version NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'Invalid answer' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.ai_data_consents (user_id, granted, text_version, providers, decided_at)
  VALUES (v_user, _granted, _version, v_providers, v_at)
  ON CONFLICT (user_id) DO UPDATE
    SET granted = EXCLUDED.granted, text_version = EXCLUDED.text_version,
        providers = EXCLUDED.providers, decided_at = EXCLUDED.decided_at;
  INSERT INTO public.ai_data_consent_events (user_id, granted, text_version, providers, at)
  VALUES (v_user, _granted, _version, v_providers, v_at);
  RETURN jsonb_build_object('granted', _granted, 'text_version', _version, 'decided_at', v_at);
END;
$$;
REVOKE ALL ON FUNCTION public.ai_consent_set(boolean, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_consent_set(boolean, integer) TO authenticated;

-- May this login's data go to a model? Staff always (their own work); others only on an
-- explicit yes to the current wording. Server only.
CREATE OR REPLACE FUNCTION public.ai_consent_ok(_user uuid, _version integer)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT _user IS NOT NULL AND (
    public._account_is_staff(_user)
    OR EXISTS (
      SELECT 1 FROM public.ai_data_consents c
      WHERE c.user_id = _user AND c.granted AND c.text_version >= _version));
$$;
REVOKE ALL ON FUNCTION public.ai_consent_ok(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_consent_ok(uuid, integer) TO service_role;

-- The same for a client record (coach-side drafting). A record with no login is the
-- coach's own record keeping: nobody in the app to ask. A missing record is refused.
CREATE OR REPLACE FUNCTION public.ai_consent_ok_for_client(_client uuid, _version integer)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(
    (SELECT jsonb_build_object(
        'ok', c.user_id IS NULL OR public.ai_consent_ok(c.user_id, _version),
        'name', COALESCE(NULLIF(btrim(c.preferred_name), ''), NULLIF(btrim(c.first_name), ''), c.full_name))
     FROM public.clients c WHERE c.id = _client),
    jsonb_build_object('ok', false, 'name', NULL));
$$;
REVOKE ALL ON FUNCTION public.ai_consent_ok_for_client(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_consent_ok_for_client(uuid, integer) TO service_role;
