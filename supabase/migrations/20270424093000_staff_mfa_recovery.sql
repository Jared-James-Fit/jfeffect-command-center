-- A way back in when the phone with the authenticator is gone
-- (two-step sign-in, 20270424091500_staff_mfa.sql; src/lib/mfa-recovery.ts).
--
-- Recovery codes: ten one-time codes made when someone turns two-step on (or
-- makes new ones later), shown once, kept only as SHA-256 hashes. Using one,
-- with their password, removes their authenticators (which signs that login
-- out everywhere, a thief's session included) so they set up the new phone.
-- Wrong codes are counted: 5 in an hour and the next try waits. The owner can
-- also reset a teammate's two-step from Team (mfa-recovery.functions.ts).
--
-- Both tables are the server's only: no policies, no grants to signed-in or
-- anonymous users. The one thing a person reads about themselves is how many
-- codes they have left (staff_mfa_recovery_left), never a code or a hash.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.staff_mfa_recovery_codes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_hash  text NOT NULL CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at    timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS staff_mfa_recovery_codes_user_hash ON public.staff_mfa_recovery_codes (user_id, code_hash);
ALTER TABLE public.staff_mfa_recovery_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_mfa_recovery_codes FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.staff_mfa_recovery_codes TO service_role;

-- What happened, for the rate limit and the record (never a code).
CREATE TABLE IF NOT EXISTS public.staff_mfa_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,
  kind       text NOT NULL CHECK (kind IN ('codes_made', 'code_used', 'code_wrong', 'reset_by_owner')),
  actor_id   uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS staff_mfa_events_user_time ON public.staff_mfa_events (user_id, created_at DESC);
ALTER TABLE public.staff_mfa_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_mfa_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.staff_mfa_events TO service_role;

-- New codes replace every unused one (the server hashes them first).
CREATE OR REPLACE FUNCTION public.staff_mfa_recovery_replace(_uid uuid, _hashes text[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  n integer;
BEGIN
  IF _uid IS NULL OR _hashes IS NULL OR cardinality(_hashes) < 1 OR cardinality(_hashes) > 20 THEN
    RAISE EXCEPTION 'Recovery codes need a login and 1 to 20 codes.' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.staff_mfa_recovery_codes WHERE user_id = _uid AND used_at IS NULL;
  INSERT INTO public.staff_mfa_recovery_codes (user_id, code_hash)
  SELECT _uid, h FROM unnest(_hashes) AS h
  ON CONFLICT (user_id, code_hash) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO public.staff_mfa_events (user_id, kind, actor_id) VALUES (_uid, 'codes_made', _uid);
  RETURN n;
END;
$function$;
REVOKE ALL ON FUNCTION public.staff_mfa_recovery_replace(uuid, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_mfa_recovery_replace(uuid, text[]) TO service_role;

-- Use one: 'ok' (now spent), 'wrong', or 'wait' after 5 wrong tries in an hour.
CREATE OR REPLACE FUNCTION public.staff_mfa_recovery_use(_uid uuid, _hash text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  hit uuid;
BEGIN
  IF _uid IS NULL THEN RETURN 'wrong'; END IF;
  -- One at a time per login, so parallel guesses can't slip past the count.
  PERFORM pg_advisory_xact_lock(hashtext('staff_mfa_recovery:' || _uid::text));
  IF (SELECT count(*) FROM public.staff_mfa_events
       WHERE user_id = _uid AND kind = 'code_wrong' AND created_at > now() - interval '1 hour') >= 5 THEN
    RETURN 'wait';
  END IF;
  UPDATE public.staff_mfa_recovery_codes
     SET used_at = now()
   WHERE id = (SELECT id FROM public.staff_mfa_recovery_codes
                WHERE user_id = _uid AND code_hash = _hash AND used_at IS NULL
                LIMIT 1)
  RETURNING id INTO hit;
  IF hit IS NULL THEN
    INSERT INTO public.staff_mfa_events (user_id, kind, actor_id) VALUES (_uid, 'code_wrong', _uid);
    RETURN 'wrong';
  END IF;
  INSERT INTO public.staff_mfa_events (user_id, kind, actor_id) VALUES (_uid, 'code_used', _uid);
  RETURN 'ok';
END;
$function$;
REVOKE ALL ON FUNCTION public.staff_mfa_recovery_use(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_mfa_recovery_use(uuid, text) TO service_role;

-- How many the signed-in person has left (their own only).
CREATE OR REPLACE FUNCTION public.staff_mfa_recovery_left()
 RETURNS integer
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT count(*)::integer FROM public.staff_mfa_recovery_codes
   WHERE user_id = auth.uid() AND used_at IS NULL;
$function$;
REVOKE ALL ON FUNCTION public.staff_mfa_recovery_left() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_mfa_recovery_left() TO authenticated, service_role;

-- The owner reset a teammate: their unused codes go with their authenticators.
CREATE OR REPLACE FUNCTION public.staff_mfa_reset_record(_uid uuid, _actor uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  DELETE FROM public.staff_mfa_recovery_codes WHERE user_id = _uid AND used_at IS NULL;
  INSERT INTO public.staff_mfa_events (user_id, kind, actor_id) VALUES (_uid, 'reset_by_owner', _actor);
$function$;
REVOKE ALL ON FUNCTION public.staff_mfa_reset_record(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_mfa_reset_record(uuid, uuid) TO service_role;

RESET lock_timeout;
