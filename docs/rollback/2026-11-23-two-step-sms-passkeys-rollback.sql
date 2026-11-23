-- Rollback for 20270512090000_two_step_sms_passkeys.sql (two-step sign-in by
-- text, passkey and trusted device). Puts the database's checks back to
-- "aal2 from an authenticator app only" and removes the new tables.
--
-- Before running it: anyone who confirms only by text or passkey has no
-- authenticator app, so after this their login is no longer enforced (the
-- admin and finance logins are asked to set up an authenticator app on next
-- open, as before Nov 23 2026). Authenticator apps, their aal2 sessions,
-- recovery codes and the record are kept. The record's wider list of kinds
-- is left as it is (rows of the new kinds stay readable).

SET lock_timeout = '5s';
BEGIN;

CREATE OR REPLACE FUNCTION public.caller_mfa_ok(_uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT _uid IS DISTINCT FROM auth.uid()
      OR coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
      OR NOT EXISTS (
           SELECT 1 FROM auth.mfa_factors f
            WHERE f.user_id = _uid AND f.status = 'verified'
         );
$function$;

CREATE OR REPLACE FUNCTION public.mfa_enforced_logins()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT DISTINCT f.user_id
    FROM auth.mfa_factors f
   WHERE f.status = 'verified';
$function$;

CREATE OR REPLACE FUNCTION public.staff_mfa_reset_record(_uid uuid, _actor uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  DELETE FROM public.staff_mfa_recovery_codes WHERE user_id = _uid AND used_at IS NULL;
  INSERT INTO public.staff_mfa_events (user_id, kind, actor_id) VALUES (_uid, 'reset_by_owner', _actor);
$function$;

DROP FUNCTION IF EXISTS public.two_step_trust_forget(uuid, uuid);
DROP FUNCTION IF EXISTS public.two_step_trust_use(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.two_step_trust_add(uuid, text, text, integer);
DROP FUNCTION IF EXISTS public.two_step_code_check(uuid, uuid, text, text);
DROP FUNCTION IF EXISTS public.two_step_code_unsent(uuid);
DROP FUNCTION IF EXISTS public.two_step_code_issue(uuid, uuid, text, text, uuid, text, integer);
DROP FUNCTION IF EXISTS public.two_step_code_issue(uuid, uuid, text, text, uuid, text, integer, text);
DROP FUNCTION IF EXISTS public.two_step_email_backup_set(uuid, boolean, boolean);
DROP FUNCTION IF EXISTS public.two_step_email_backup_state(uuid);
DROP FUNCTION IF EXISTS public.two_step_session_mark(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.two_step_session_live(uuid, uuid);
DROP FUNCTION IF EXISTS public.two_step_login_has(uuid);
DROP FUNCTION IF EXISTS public.jwt_session_id();

DROP TABLE IF EXISTS public.two_step_challenges;
DROP TABLE IF EXISTS public.two_step_trusted_devices;
DROP TABLE IF EXISTS public.two_step_codes;
DROP TABLE IF EXISTS public.two_step_sessions;
DROP TABLE IF EXISTS public.two_step_settings;
DROP TABLE IF EXISTS public.two_step_methods;

COMMIT;
RESET lock_timeout;
