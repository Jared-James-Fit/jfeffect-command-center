-- Fix: last_login_at was never being set for clients.
-- The admin_clients_directory view reads last_login_at but mark_client_signed_in
-- only updated last_signed_in_at and last_active_at — leaving last_login_at NULL.
--
-- This migration:
-- 1. Backfills last_login_at from last_signed_in_at (preferred) or last_active_at
--    for all existing clients who have signed in but show last_login_at = NULL.
-- 2. Also backfills from auth.users.last_sign_in_at for any clients whose
--    last_signed_in_at is also null (older accounts).
-- 3. Updates mark_client_signed_in() to also set last_login_at going forward.

-- Step 1: Backfill from last_signed_in_at / last_active_at
UPDATE public.clients
SET last_login_at = COALESCE(last_signed_in_at, last_active_at)
WHERE last_login_at IS NULL
  AND (last_signed_in_at IS NOT NULL OR last_active_at IS NOT NULL);

-- Step 2: Backfill from auth.users.last_sign_in_at for remaining nulls
-- (requires service_role access — runs in migration context)
UPDATE public.clients c
SET last_login_at = au.last_sign_in_at
FROM auth.users au
WHERE c.user_id = au.id
  AND c.last_login_at IS NULL
  AND au.last_sign_in_at IS NOT NULL;

-- Step 3: Update mark_client_signed_in() to also set last_login_at
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
         last_active_at    = now(),
         last_login_at     = now()   -- ← was missing; now kept in sync
   WHERE id = v_client_id;
  INSERT INTO public.client_activity_log (client_id, actor_user_id, actor_role, action, details)
  VALUES (v_client_id, auth.uid(), 'client', 'signed_in', '{}'::jsonb)
  ON CONFLICT DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_client_signed_in() TO authenticated;

COMMENT ON FUNCTION public.mark_client_signed_in IS
  'Called on every client sign-in and session restore. Updates last_signed_in_at,
   last_active_at, and last_login_at (all three kept in sync). The admin_clients_
   directory view uses last_login_at for the "Last signed in" display.';
