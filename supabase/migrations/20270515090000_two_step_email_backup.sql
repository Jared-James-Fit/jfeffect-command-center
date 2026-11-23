-- Two-step sign-in: an emailed code as a backup way to confirm
-- (20270512090000_two_step_sms_passkeys.sql, src/lib/two-step.ts).
--
-- A team login with a way to confirm (a phone, a passkey, an authenticator
-- app) can also have a 6-digit code emailed to its own login email when it
-- doesn't have its phone. It's a backup, never a way on its own: a login with
-- only email isn't "enforced" (two_step_login_has is unchanged), since a code
-- sent to the same inbox that resets the password would add nothing.
--
-- It sends only to the address saved when it was turned on, and only while
-- that's still the login's email, nothing has been asked of that inbox lately
-- and the email isn't being changed:
--   changed       the login's email is no longer the one saved: off until
--                 they turn it on again from a confirmed session;
--   reset         a password reset or sign-in link went to the inbox in the
--                 last 3 days (auth.users.recovery_sent_at): someone holding
--                 the inbox could have set the password, so it waits;
--   email_change  a change of email was asked for in the last 3 days, or is
--                 waiting to be confirmed.
-- It's on by default (set when a login's first way is in place, from a
-- confirmed session) and stays as they choose (email_backup_at).
--
-- Codes share the texted codes' table, limits and lock (one budget, one count
-- of wrong tries): a code every 30 s, 5 an hour, 10 a day per login, 10 wrong
-- tries in an hour lock both.

SET lock_timeout = '5s';

-- ── The setting ─────────────────────────────────────────────────────────────
ALTER TABLE public.two_step_settings ADD COLUMN IF NOT EXISTS email_backup text;
ALTER TABLE public.two_step_settings ADD COLUMN IF NOT EXISTS email_backup_at timestamptz;
ALTER TABLE public.two_step_settings DROP CONSTRAINT IF EXISTS two_step_settings_email_backup_shape;
ALTER TABLE public.two_step_settings ADD CONSTRAINT two_step_settings_email_backup_shape CHECK (
  email_backup IS NULL OR (email_backup = lower(email_backup) AND length(email_backup) BETWEEN 3 AND 320
                           AND email_backup ~ '^[^@[:space:]]+@[^@[:space:]]+$')
);

-- ── Codes by email ──────────────────────────────────────────────────────────
ALTER TABLE public.two_step_codes ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'sms';
ALTER TABLE public.two_step_codes ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.two_step_codes ALTER COLUMN phone DROP NOT NULL;
ALTER TABLE public.two_step_codes DROP CONSTRAINT IF EXISTS two_step_codes_phone_check;
ALTER TABLE public.two_step_codes DROP CONSTRAINT IF EXISTS two_step_codes_channel_shape;
ALTER TABLE public.two_step_codes ADD CONSTRAINT two_step_codes_channel_shape CHECK (
  (channel = 'sms' AND phone ~ '^\+[0-9]{8,15}$' AND email IS NULL)
  OR (channel = 'email' AND phone IS NULL AND email IS NOT NULL AND purpose = 'sign_in')
);

ALTER TABLE public.two_step_sessions DROP CONSTRAINT IF EXISTS two_step_sessions_method_check;
ALTER TABLE public.two_step_sessions ADD CONSTRAINT two_step_sessions_method_check CHECK (
  method IN ('sms', 'email', 'passkey', 'totp', 'trusted_device', 'recovery_code')
);

ALTER TABLE public.staff_mfa_events DROP CONSTRAINT IF EXISTS staff_mfa_events_kind_check;
ALTER TABLE public.staff_mfa_events ADD CONSTRAINT staff_mfa_events_kind_check CHECK (kind IN (
  'codes_made', 'code_used', 'code_wrong', 'reset_by_owner',
  'sms_sent', 'sms_ok', 'sms_wrong', 'passkey_ok', 'passkey_wrong',
  'method_added', 'method_removed', 'device_trusted', 'device_used', 'device_forgotten', 'recovered',
  'email_sent', 'email_ok', 'email_wrong', 'email_backup_on', 'email_backup_off'
));

-- ── Where the backup stands (server only) ───────────────────────────────────
-- {on, chosen, email, ready, why, held_until}: `email` is where a code would
-- go (only while it's on), `ready` whether one may go now.
CREATE OR REPLACE FUNCTION public.two_step_email_backup_state(_uid uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH s AS (
    SELECT email_backup, email_backup_at FROM public.two_step_settings WHERE user_id = _uid
  ), u AS (
    SELECT lower(email) AS email, recovery_sent_at, email_change_sent_at,
           nullif(btrim(coalesce(email_change, '')), '') AS email_change
      FROM auth.users WHERE id = _uid
  ), w AS (
    SELECT s.email_backup, s.email_backup_at, u.email AS login_email,
           CASE WHEN u.recovery_sent_at > now() - interval '3 days'
                THEN u.recovery_sent_at + interval '3 days' END AS reset_until,
           CASE WHEN u.email_change IS NOT NULL THEN 'infinity'::timestamptz
                WHEN u.email_change_sent_at > now() - interval '3 days'
                THEN u.email_change_sent_at + interval '3 days' END AS change_until
      FROM u LEFT JOIN s ON true
  )
  SELECT jsonb_build_object(
           'on', w.email_backup IS NOT NULL,
           'chosen', w.email_backup_at IS NOT NULL,
           'email', w.email_backup,
           'why', CASE
                    WHEN w.email_backup IS NULL THEN NULL
                    WHEN NOT public.two_step_login_has(_uid) THEN 'no_way'
                    WHEN w.login_email IS DISTINCT FROM w.email_backup THEN 'changed'
                    WHEN w.change_until IS NOT NULL THEN 'email_change'
                    WHEN w.reset_until IS NOT NULL THEN 'reset'
                  END,
           'held_until', CASE
                           WHEN w.change_until IS NOT NULL AND w.change_until <> 'infinity' THEN w.change_until
                           WHEN w.change_until IS NULL THEN w.reset_until
                         END,
           'ready', w.email_backup IS NOT NULL
                    AND public.two_step_login_has(_uid)
                    AND w.login_email IS NOT DISTINCT FROM w.email_backup
                    AND w.change_until IS NULL
                    AND w.reset_until IS NULL
         )
    FROM w
  UNION ALL
  SELECT jsonb_build_object('on', false, 'chosen', false, 'email', NULL, 'why', NULL,
                            'held_until', NULL, 'ready', false)
   WHERE NOT EXISTS (SELECT 1 FROM auth.users WHERE id = _uid)
  LIMIT 1;
$function$;
REVOKE ALL ON FUNCTION public.two_step_email_backup_state(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.two_step_email_backup_state(uuid) TO service_role;

-- Turn it on (to the login's email as it is now) or off. With _only_if_unset
-- it's the default: on, only for a login that never chose either way. The
-- server calls it only from a confirmed session.
CREATE OR REPLACE FUNCTION public.two_step_email_backup_set(_uid uuid, _on boolean, _only_if_unset boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  addr text;
  was text;
  chosen boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'A login is needed.' USING ERRCODE = '22023'; END IF;
  SELECT email_backup, email_backup_at IS NOT NULL INTO was, chosen
    FROM public.two_step_settings WHERE user_id = _uid;
  IF _only_if_unset AND coalesce(chosen, false) THEN
    RETURN public.two_step_email_backup_state(_uid);
  END IF;
  IF _on THEN
    SELECT lower(btrim(email)) INTO addr FROM auth.users WHERE id = _uid;
    IF addr IS NULL OR addr !~ '^[^@[:space:]]+@[^@[:space:]]+$' THEN
      IF _only_if_unset THEN RETURN public.two_step_email_backup_state(_uid); END IF;
      RAISE EXCEPTION 'Your login has no email to send codes to.' USING ERRCODE = '22023';
    END IF;
  END IF;
  INSERT INTO public.two_step_settings (user_id, email_backup, email_backup_at, updated_at)
  VALUES (_uid, CASE WHEN _on THEN addr END, now(), now())
  ON CONFLICT (user_id) DO UPDATE
     SET email_backup = excluded.email_backup, email_backup_at = now(), updated_at = now();
  IF was IS DISTINCT FROM (CASE WHEN _on THEN addr END) THEN
    INSERT INTO public.staff_mfa_events (user_id, kind, actor_id)
    VALUES (_uid, CASE WHEN _on THEN 'email_backup_on' ELSE 'email_backup_off' END, _uid);
  END IF;
  RETURN public.two_step_email_backup_state(_uid);
END;
$function$;
REVOKE ALL ON FUNCTION public.two_step_email_backup_set(uuid, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.two_step_email_backup_set(uuid, boolean, boolean) TO service_role;

-- ── Issuing a code: by text or by email ─────────────────────────────────────
-- As before, plus _channel. An email code goes only where the backup says and
-- only while it's ready; the address comes back in the answer ({ok, id,
-- expires_at, email}), so the server never picks it. Wrong tries count across
-- both channels.
DROP FUNCTION IF EXISTS public.two_step_code_issue(uuid, uuid, text, text, uuid, text, integer);
CREATE OR REPLACE FUNCTION public.two_step_code_issue(
  _uid uuid, _session uuid, _purpose text, _phone text, _method uuid, _hash text,
  _ttl_s integer DEFAULT 600, _channel text DEFAULT 'sms')
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
  backup jsonb;
  addr text;
  exp timestamptz := now() + make_interval(secs => least(greatest(coalesce(_ttl_s, 600), 60), 900));
BEGIN
  IF _uid IS NULL OR _session IS NULL OR _purpose NOT IN ('sign_in', 'add_phone')
     OR coalesce(_channel, 'sms') NOT IN ('sms', 'email') THEN
    RAISE EXCEPTION 'A code needs a login, a session and a purpose.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('two_step_code:' || _uid::text));

  IF _channel = 'email' THEN
    IF _purpose <> 'sign_in' THEN
      RAISE EXCEPTION 'An emailed code is only for signing in.' USING ERRCODE = '22023';
    END IF;
    backup := public.two_step_email_backup_state(_uid);
    IF NOT coalesce((backup ->> 'ready')::boolean, false) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'email_' || coalesce(backup ->> 'why', 'off'),
                                'held_until', backup ->> 'held_until');
    END IF;
    addr := backup ->> 'email';
  END IF;

  SELECT count(*), min(created_at) INTO n, oldest FROM public.staff_mfa_events
   WHERE user_id = _uid AND kind IN ('sms_wrong', 'email_wrong') AND created_at > now() - interval '1 hour';
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

  DELETE FROM public.two_step_codes WHERE user_id = _uid AND created_at < now() - interval '7 days';

  -- A new code replaces this session's earlier one, by either channel.
  UPDATE public.two_step_codes SET dead_at = now()
   WHERE user_id = _uid AND session_id = _session AND purpose = _purpose
     AND used_at IS NULL AND dead_at IS NULL;

  INSERT INTO public.two_step_codes (user_id, session_id, purpose, channel, phone, email, method_id, code_hash, expires_at)
  VALUES (_uid, _session, _purpose, _channel,
          CASE WHEN _channel = 'sms' THEN _phone END, addr,
          CASE WHEN _channel = 'sms' THEN _method END, _hash, exp)
  RETURNING id INTO new_id;
  INSERT INTO public.staff_mfa_events (user_id, kind, actor_id)
  VALUES (_uid, CASE WHEN _channel = 'email' THEN 'email_sent' ELSE 'sms_sent' END, _uid);
  RETURN jsonb_build_object('ok', true, 'id', new_id, 'expires_at', exp, 'email', addr);
END;
$function$;
REVOKE ALL ON FUNCTION public.two_step_code_issue(uuid, uuid, text, text, uuid, text, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.two_step_code_issue(uuid, uuid, text, text, uuid, text, integer, text) TO service_role;

-- Check one: as before, and says which channel it came by ({ok, channel,
-- phone, email, method_id}).
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
   WHERE user_id = _uid AND kind IN ('sms_wrong', 'email_wrong') AND created_at > now() - interval '1 hour';
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
    INSERT INTO public.staff_mfa_events (user_id, kind, actor_id)
    VALUES (_uid, CASE WHEN c.channel = 'email' THEN 'email_ok' ELSE 'sms_ok' END, _uid);
    RETURN jsonb_build_object('ok', true, 'channel', c.channel, 'phone', c.phone, 'email', c.email,
                              'method_id', c.method_id);
  END IF;

  INSERT INTO public.staff_mfa_events (user_id, kind, actor_id)
  VALUES (_uid, CASE WHEN c.channel = 'email' THEN 'email_wrong' ELSE 'sms_wrong' END, _uid);
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

-- ── On for the logins that already have a way ───────────────────────────────
INSERT INTO public.two_step_settings (user_id, email_backup, email_backup_at, updated_at)
SELECT u.id, lower(btrim(u.email)), now(), now()
  FROM auth.users u
 WHERE u.id IN (SELECT public.mfa_enforced_logins())
   AND lower(btrim(coalesce(u.email, ''))) ~ '^[^@[:space:]]+@[^@[:space:]]+$'
ON CONFLICT (user_id) DO UPDATE
   SET email_backup = excluded.email_backup, email_backup_at = excluded.email_backup_at, updated_at = now()
 WHERE public.two_step_settings.email_backup_at IS NULL;

RESET lock_timeout;
