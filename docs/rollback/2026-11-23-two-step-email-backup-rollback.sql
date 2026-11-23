-- Rollback for 20270515090000_two_step_email_backup.sql (emailed codes as a
-- backup way to confirm). Puts the codes back to texts only, exactly as
-- 20270512090000_two_step_sms_passkeys.sql left them.
--
-- Before running it: anyone who can only confirm by email on a device (the
-- iPhone app with only Face ID set up) confirms another way. Sessions already
-- confirmed by an emailed code stay confirmed until they sign out. Emailed
-- codes are deleted; the record (staff_mfa_events) is kept, its wider list of
-- kinds with it.

SET lock_timeout = '5s';
BEGIN;

DROP FUNCTION IF EXISTS public.two_step_email_backup_set(uuid, boolean, boolean);
DROP FUNCTION IF EXISTS public.two_step_email_backup_state(uuid);
DROP FUNCTION IF EXISTS public.two_step_code_issue(uuid, uuid, text, text, uuid, text, integer, text);

DELETE FROM public.two_step_codes WHERE channel = 'email';
ALTER TABLE public.two_step_codes DROP CONSTRAINT IF EXISTS two_step_codes_channel_shape;
ALTER TABLE public.two_step_codes DROP COLUMN IF EXISTS email;
ALTER TABLE public.two_step_codes DROP COLUMN IF EXISTS channel;
ALTER TABLE public.two_step_codes ALTER COLUMN phone SET NOT NULL;
ALTER TABLE public.two_step_codes ADD CONSTRAINT two_step_codes_phone_check CHECK (phone ~ '^\+[0-9]{8,15}$');

UPDATE public.two_step_sessions SET method = 'sms' WHERE method = 'email';
ALTER TABLE public.two_step_sessions DROP CONSTRAINT IF EXISTS two_step_sessions_method_check;
ALTER TABLE public.two_step_sessions ADD CONSTRAINT two_step_sessions_method_check CHECK (
  method IN ('sms', 'passkey', 'totp', 'trusted_device', 'recovery_code')
);

ALTER TABLE public.two_step_settings DROP CONSTRAINT IF EXISTS two_step_settings_email_backup_shape;
ALTER TABLE public.two_step_settings DROP COLUMN IF EXISTS email_backup_at;
ALTER TABLE public.two_step_settings DROP COLUMN IF EXISTS email_backup;

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

COMMIT;
RESET lock_timeout;
