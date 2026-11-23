-- Two-step sign-in by text message, passkey (Face ID / Touch ID) or a trusted
-- device, beside the authenticator app (20270424091500_staff_mfa.sql;
-- src/lib/two-step.ts, src/lib/two-step.functions.ts).
--
-- Supabase's own phone and WebAuthn factors are switched off in this project
-- and can't be configured from the app, and only an authenticator app reaches
-- Supabase's "aal2". So a session confirmed any other way is recorded here,
-- by its id (the access token's session_id claim), and every check that read
-- aal2 now reads "aal2, or a confirmed session that is still live":
--   caller_mfa_ok          the database's staff-rights check (has_role,
--                          has_permission, is_admin_viewer, is_business_owner)
--   mfa_enforced_logins    the server guard's list (mfa-guard.server.ts)
--   two_step_session_live  the server guard and the app's gate
-- A confirmed session ends with the session itself: signing out deletes its
-- auth.sessions row, and the join below stops counting it at once.
--
-- Nothing is taken away from anyone: a login with an authenticator app keeps
-- it and its aal2 sessions, a login with nothing set up is exactly as before.
-- A login is "enforced" once it has any verified way to confirm (an
-- authenticator app, a phone number confirmed by a code, a passkey).
--
-- Every table is the server's only (no policies, nothing granted to signed-in
-- or anonymous users): codes are kept as SHA-256 hashes, trusted-device tokens
-- as hashes, passkeys as public keys. Rate limits live in the functions, under
-- a per-login lock:
--   a code every 30 s, 5 an hour and 10 a day per login (and the SMS
--   sender's own 5 security texts a day per phone, public.sms_claim);
--   5 wrong tries kill a code, 10 wrong in an hour and the next try waits;
--   a code lives 10 minutes and belongs to the session it was sent for.

SET lock_timeout = '5s';

-- ── Ways to confirm, other than an authenticator app ────────────────────────
CREATE TABLE IF NOT EXISTS public.two_step_methods (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('sms', 'passkey')),
  label         text NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
  phone         text CHECK (phone IS NULL OR phone ~ '^\+[0-9]{8,15}$'),
  credential_id text CHECK (credential_id IS NULL OR (credential_id ~ '^[A-Za-z0-9_-]+$' AND length(credential_id) BETWEEN 16 AND 1400)),
  public_key    jsonb,
  alg           integer,
  rp_id         text,
  sign_count    bigint NOT NULL DEFAULT 0,
  transports    text[] NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz,
  removed_at    timestamptz,
  CONSTRAINT two_step_methods_shape CHECK (
    (kind = 'sms' AND phone IS NOT NULL AND credential_id IS NULL AND public_key IS NULL)
    OR (kind = 'passkey' AND phone IS NULL AND credential_id IS NOT NULL AND public_key IS NOT NULL
        AND alg IS NOT NULL AND rp_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS two_step_methods_credential ON public.two_step_methods (credential_id)
  WHERE credential_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS two_step_methods_phone ON public.two_step_methods (user_id, phone)
  WHERE kind = 'sms' AND removed_at IS NULL;
CREATE INDEX IF NOT EXISTS two_step_methods_user ON public.two_step_methods (user_id) WHERE removed_at IS NULL;

-- Which way the person wants asked first.
CREATE TABLE IF NOT EXISTS public.two_step_settings (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  preferred  text CHECK (preferred IN ('sms', 'passkey', 'totp')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Sessions confirmed by something Supabase doesn't mark aal2.
CREATE TABLE IF NOT EXISTS public.two_step_sessions (
  session_id  uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  method      text NOT NULL CHECK (method IN ('sms', 'passkey', 'totp', 'trusted_device', 'recovery_code')),
  verified_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS two_step_sessions_user ON public.two_step_sessions (user_id);

-- Texted codes (hashes only), each for one session.
CREATE TABLE IF NOT EXISTS public.two_step_codes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  purpose    text NOT NULL CHECK (purpose IN ('sign_in', 'add_phone')),
  phone      text NOT NULL CHECK (phone ~ '^\+[0-9]{8,15}$'),
  method_id  uuid REFERENCES public.two_step_methods(id) ON DELETE CASCADE,
  code_hash  text NOT NULL CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  attempts   integer NOT NULL DEFAULT 0,
  used_at    timestamptz,
  dead_at    timestamptz
);
CREATE INDEX IF NOT EXISTS two_step_codes_user_time ON public.two_step_codes (user_id, created_at DESC);

-- Devices that skip the second step for a while (token hashes only).
CREATE TABLE IF NOT EXISTS public.two_step_trusted_devices (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  label        text NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz
);
CREATE INDEX IF NOT EXISTS two_step_trusted_devices_user ON public.two_step_trusted_devices (user_id);

-- One-time passkey challenges, each for one session.
CREATE TABLE IF NOT EXISTS public.two_step_challenges (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  purpose    text NOT NULL CHECK (purpose IN ('register', 'verify')),
  challenge  text NOT NULL UNIQUE CHECK (challenge ~ '^[A-Za-z0-9_-]{32,128}$'),
  rp_id      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz
);
CREATE INDEX IF NOT EXISTS two_step_challenges_user ON public.two_step_challenges (user_id, created_at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['two_step_methods', 'two_step_settings', 'two_step_sessions', 'two_step_codes',
                           'two_step_trusted_devices', 'two_step_challenges'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;

-- The record (never a code, a token or a number): more kinds.
ALTER TABLE public.staff_mfa_events DROP CONSTRAINT IF EXISTS staff_mfa_events_kind_check;
ALTER TABLE public.staff_mfa_events ADD CONSTRAINT staff_mfa_events_kind_check CHECK (kind IN (
  'codes_made', 'code_used', 'code_wrong', 'reset_by_owner',
  'sms_sent', 'sms_ok', 'sms_wrong', 'passkey_ok', 'passkey_wrong',
  'method_added', 'method_removed', 'device_trusted', 'device_used', 'device_forgotten', 'recovered'
));

-- ── Small readers ───────────────────────────────────────────────────────────
-- The access token's session id, or null (never an error on a token without one).
CREATE OR REPLACE FUNCTION public.jwt_session_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE
           WHEN coalesce(auth.jwt() ->> 'session_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             THEN (auth.jwt() ->> 'session_id')::uuid
         END;
$function$;
REVOKE ALL ON FUNCTION public.jwt_session_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.jwt_session_id() TO authenticated, service_role;

-- Whether a login has any verified way to confirm (it's "enforced").
CREATE OR REPLACE FUNCTION public.two_step_login_has(_uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT _uid IS NOT NULL AND (
           EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = _uid AND f.status = 'verified')
        OR EXISTS (SELECT 1 FROM public.two_step_methods m WHERE m.user_id = _uid AND m.removed_at IS NULL)
         );
$function$;
REVOKE ALL ON FUNCTION public.two_step_login_has(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.two_step_login_has(uuid) TO service_role;

-- Whether this session was confirmed here and is still signed in.
CREATE OR REPLACE FUNCTION public.two_step_session_live(_uid uuid, _session uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT _uid IS NOT NULL AND _session IS NOT NULL AND EXISTS (
    SELECT 1
      FROM public.two_step_sessions s
      JOIN auth.sessions a ON a.id = s.session_id AND a.user_id = s.user_id
     WHERE s.session_id = _session
       AND s.user_id = _uid
       AND (a.not_after IS NULL OR a.not_after > now())
  );
$function$;
REVOKE ALL ON FUNCTION public.two_step_session_live(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.two_step_session_live(uuid, uuid) TO service_role;

-- ── The session may use this login's staff rights ───────────────────────────
-- As before, plus a session confirmed by text, passkey, trusted device or
-- recovery code. Checked only for the caller's own login, and only after the
-- role itself is found (has_role's CASE), so a client's query never gets here.
CREATE OR REPLACE FUNCTION public.caller_mfa_ok(_uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT _uid IS DISTINCT FROM auth.uid()
      OR coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
      OR NOT public.two_step_login_has(_uid)
      OR public.two_step_session_live(_uid, public.jwt_session_id());
$function$;
REVOKE ALL ON FUNCTION public.caller_mfa_ok(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.caller_mfa_ok(uuid) TO authenticated, service_role;

-- ── The logins whose sessions need confirming (server only) ─────────────────
CREATE OR REPLACE FUNCTION public.mfa_enforced_logins()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT f.user_id FROM auth.mfa_factors f WHERE f.status = 'verified'
  UNION
  SELECT m.user_id FROM public.two_step_methods m WHERE m.removed_at IS NULL;
$function$;
REVOKE ALL ON FUNCTION public.mfa_enforced_logins() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mfa_enforced_logins() TO service_role;

-- ── Mark a session confirmed (server only) ──────────────────────────────────
-- Only a session that exists and belongs to the login.
CREATE OR REPLACE FUNCTION public.two_step_session_mark(_uid uuid, _session uuid, _method text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF _uid IS NULL OR _session IS NULL
     OR NOT EXISTS (SELECT 1 FROM auth.sessions a WHERE a.id = _session AND a.user_id = _uid) THEN
    RETURN false;
  END IF;
  INSERT INTO public.two_step_sessions (session_id, user_id, method)
  VALUES (_session, _uid, _method)
  ON CONFLICT (session_id) DO UPDATE
     SET method = excluded.method, verified_at = now()
   WHERE public.two_step_sessions.user_id = excluded.user_id;
  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public.two_step_session_mark(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.two_step_session_mark(uuid, uuid, text) TO service_role;

-- ── Texted codes ────────────────────────────────────────────────────────────
-- Make one (the server hashes it and texts it): {ok, id, expires_at} or
-- {ok:false, reason: cooldown | hourly | daily | locked, wait_s}.
CREATE OR REPLACE FUNCTION public.two_step_code_issue(
  _uid uuid, _session uuid, _purpose text, _phone text, _method uuid, _hash text, _ttl_s integer DEFAULT 600)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  last_at timestamptz;
  n integer;
  oldest timestamptz;
  new_id uuid;
  exp timestamptz := now() + make_interval(secs => least(greatest(coalesce(_ttl_s, 600), 60), 900));
BEGIN
  IF _uid IS NULL OR _session IS NULL OR _purpose NOT IN ('sign_in', 'add_phone') THEN
    RAISE EXCEPTION 'A code needs a login, a session and a purpose.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('two_step_code:' || _uid::text));

  SELECT count(*), min(created_at) INTO n, oldest FROM public.staff_mfa_events
   WHERE user_id = _uid AND kind = 'sms_wrong' AND created_at > now() - interval '1 hour';
  IF n >= 10 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'locked',
      'wait_s', greatest(1, ceil(extract(epoch FROM oldest + interval '1 hour' - now()))::int));
  END IF;

  SELECT max(created_at) INTO last_at FROM public.two_step_codes WHERE user_id = _uid;
  IF last_at IS NOT NULL AND last_at > now() - interval '30 seconds' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'cooldown',
      'wait_s', greatest(1, ceil(extract(epoch FROM last_at + interval '30 seconds' - now()))::int));
  END IF;

  SELECT count(*), min(created_at) INTO n, oldest FROM public.two_step_codes
   WHERE user_id = _uid AND created_at > now() - interval '1 hour';
  IF n >= 5 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'hourly',
      'wait_s', greatest(1, ceil(extract(epoch FROM oldest + interval '1 hour' - now()))::int));
  END IF;

  SELECT count(*), min(created_at) INTO n, oldest FROM public.two_step_codes
   WHERE user_id = _uid AND created_at > now() - interval '24 hours';
  IF n >= 10 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'daily',
      'wait_s', greatest(1, ceil(extract(epoch FROM oldest + interval '24 hours' - now()))::int));
  END IF;

  -- Codes older than a week are no use to any limit.
  DELETE FROM public.two_step_codes WHERE user_id = _uid AND created_at < now() - interval '7 days';

  -- A new code replaces this session's earlier one.
  UPDATE public.two_step_codes SET dead_at = now()
   WHERE user_id = _uid AND session_id = _session AND purpose = _purpose
     AND used_at IS NULL AND dead_at IS NULL;

  INSERT INTO public.two_step_codes (user_id, session_id, purpose, phone, method_id, code_hash, expires_at)
  VALUES (_uid, _session, _purpose, _phone, _method, _hash, exp)
  RETURNING id INTO new_id;
  INSERT INTO public.staff_mfa_events (user_id, kind, actor_id) VALUES (_uid, 'sms_sent', _uid);
  RETURN jsonb_build_object('ok', true, 'id', new_id, 'expires_at', exp);
END;
$function$;
REVOKE ALL ON FUNCTION public.two_step_code_issue(uuid, uuid, text, text, uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.two_step_code_issue(uuid, uuid, text, text, uuid, text, integer) TO service_role;

-- The text didn't go: the code is dead (it still counts toward the limits,
-- so a number that can't be texted is never retried in a loop).
CREATE OR REPLACE FUNCTION public.two_step_code_unsent(_id uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  UPDATE public.two_step_codes SET dead_at = now() WHERE id = _id AND used_at IS NULL AND dead_at IS NULL;
$function$;
REVOKE ALL ON FUNCTION public.two_step_code_unsent(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.two_step_code_unsent(uuid) TO service_role;

-- Check one: {ok, phone, method_id} or {ok:false, reason: none | expired |
-- wrong (left) | used_up | locked (wait_s)}. A right code is spent at once.
CREATE OR REPLACE FUNCTION public.two_step_code_check(_uid uuid, _session uuid, _purpose text, _hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c public.two_step_codes%ROWTYPE;
  n integer;
  oldest timestamptz;
BEGIN
  IF _uid IS NULL OR _session IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'none');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('two_step_code:' || _uid::text));

  SELECT count(*), min(created_at) INTO n, oldest FROM public.staff_mfa_events
   WHERE user_id = _uid AND kind = 'sms_wrong' AND created_at > now() - interval '1 hour';
  IF n >= 10 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'locked',
      'wait_s', greatest(1, ceil(extract(epoch FROM oldest + interval '1 hour' - now()))::int));
  END IF;

  SELECT * INTO c FROM public.two_step_codes
   WHERE user_id = _uid AND session_id = _session AND purpose = _purpose
     AND used_at IS NULL AND dead_at IS NULL
   ORDER BY created_at DESC
   LIMIT 1
   FOR UPDATE;
  IF c.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'none');
  END IF;
  IF c.expires_at <= now() THEN
    UPDATE public.two_step_codes SET dead_at = now() WHERE id = c.id;
    RETURN jsonb_build_object('ok', false, 'reason', 'expired');
  END IF;
  IF c.code_hash = _hash THEN
    UPDATE public.two_step_codes SET used_at = now() WHERE id = c.id;
    INSERT INTO public.staff_mfa_events (user_id, kind, actor_id) VALUES (_uid, 'sms_ok', _uid);
    RETURN jsonb_build_object('ok', true, 'phone', c.phone, 'method_id', c.method_id);
  END IF;

  INSERT INTO public.staff_mfa_events (user_id, kind, actor_id) VALUES (_uid, 'sms_wrong', _uid);
  UPDATE public.two_step_codes
     SET attempts = attempts + 1,
         dead_at = CASE WHEN attempts + 1 >= 5 THEN now() END
   WHERE id = c.id;
  IF c.attempts + 1 >= 5 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'used_up');
  END IF;
  RETURN jsonb_build_object('ok', false, 'reason', 'wrong', 'left', 5 - (c.attempts + 1));
END;
$function$;
REVOKE ALL ON FUNCTION public.two_step_code_check(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.two_step_code_check(uuid, uuid, text, text) TO service_role;

-- ── Trusted devices ─────────────────────────────────────────────────────────
-- Trust one: at most 10 live per login (the oldest go), each for _days.
CREATE OR REPLACE FUNCTION public.two_step_trust_add(_uid uuid, _hash text, _label text, _days integer DEFAULT 30)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  new_id uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'A trusted device needs a login.' USING ERRCODE = '22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('two_step_trust:' || _uid::text));
  UPDATE public.two_step_trusted_devices SET revoked_at = now()
   WHERE id IN (
     SELECT id FROM public.two_step_trusted_devices
      WHERE user_id = _uid AND revoked_at IS NULL AND expires_at > now()
      ORDER BY created_at DESC
      OFFSET 9
   );
  INSERT INTO public.two_step_trusted_devices (user_id, token_hash, label, expires_at)
  VALUES (_uid, _hash, left(coalesce(nullif(btrim(_label), ''), 'This device'), 80),
          now() + make_interval(days => least(greatest(coalesce(_days, 30), 1), 30)))
  RETURNING id INTO new_id;
  INSERT INTO public.staff_mfa_events (user_id, kind, actor_id) VALUES (_uid, 'device_trusted', _uid);
  RETURN new_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.two_step_trust_add(uuid, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.two_step_trust_add(uuid, text, text, integer) TO service_role;

-- Use one: confirms the session when the token is this login's, live and
-- unexpired. Never extends it: a device is trusted for a fixed 30 days.
CREATE OR REPLACE FUNCTION public.two_step_trust_use(_uid uuid, _session uuid, _hash text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  hit uuid;
BEGIN
  IF _uid IS NULL OR _session IS NULL OR _hash IS NULL THEN RETURN false; END IF;
  SELECT id INTO hit FROM public.two_step_trusted_devices
   WHERE user_id = _uid AND token_hash = _hash AND revoked_at IS NULL AND expires_at > now();
  IF hit IS NULL THEN RETURN false; END IF;
  IF NOT public.two_step_session_mark(_uid, _session, 'trusted_device') THEN RETURN false; END IF;
  UPDATE public.two_step_trusted_devices SET last_used_at = now() WHERE id = hit;
  INSERT INTO public.staff_mfa_events (user_id, kind, actor_id) VALUES (_uid, 'device_used', _uid);
  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public.two_step_trust_use(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.two_step_trust_use(uuid, uuid, text) TO service_role;

-- Forget one (by id) or all of a login's trusted devices.
CREATE OR REPLACE FUNCTION public.two_step_trust_forget(_uid uuid, _id uuid DEFAULT NULL)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  n integer;
BEGIN
  UPDATE public.two_step_trusted_devices SET revoked_at = now()
   WHERE user_id = _uid AND revoked_at IS NULL AND (_id IS NULL OR id = _id);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN
    INSERT INTO public.staff_mfa_events (user_id, kind, actor_id) VALUES (_uid, 'device_forgotten', _uid);
  END IF;
  RETURN n;
END;
$function$;
REVOKE ALL ON FUNCTION public.two_step_trust_forget(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.two_step_trust_forget(uuid, uuid) TO service_role;

-- ── The owner reset a teammate ──────────────────────────────────────────────
-- Everything goes: unused recovery codes (as before), phone numbers and
-- passkeys, trusted devices and confirmed sessions, so they set up again the
-- next time they open the app. Their authenticator apps are removed by the
-- server through Supabase (mfa-recovery.functions.ts).
CREATE OR REPLACE FUNCTION public.staff_mfa_reset_record(_uid uuid, _actor uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  DELETE FROM public.staff_mfa_recovery_codes WHERE user_id = _uid AND used_at IS NULL;
  UPDATE public.two_step_methods SET removed_at = now() WHERE user_id = _uid AND removed_at IS NULL;
  UPDATE public.two_step_trusted_devices SET revoked_at = now() WHERE user_id = _uid AND revoked_at IS NULL;
  DELETE FROM public.two_step_sessions WHERE user_id = _uid;
  UPDATE public.two_step_codes SET dead_at = now() WHERE user_id = _uid AND used_at IS NULL AND dead_at IS NULL;
  DELETE FROM public.two_step_settings WHERE user_id = _uid;
  INSERT INTO public.staff_mfa_events (user_id, kind, actor_id) VALUES (_uid, 'reset_by_owner', _actor);
$function$;
REVOKE ALL ON FUNCTION public.staff_mfa_reset_record(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_mfa_reset_record(uuid, uuid) TO service_role;

RESET lock_timeout;
