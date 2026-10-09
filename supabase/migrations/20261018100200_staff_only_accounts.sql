-- Staff-only accounts (e.g. the finance bookkeeper login).
--
-- handle_new_user gives every new auth user the 'client' role and links any
-- clients row with the same email. A staff-only account must get neither:
-- it holds only its staff role and never sees the client portal.
--
-- The flag is app_metadata.account_kind = 'staff', set by the server when it
-- creates the user from a staff invite (redeemStaffInvite). app_metadata,
-- unlike user_metadata, can't be set by someone signing themselves up, so a
-- public signup can't opt out of the client path.
--
-- Body otherwise identical to the live definition (checked 2026-10-09 with
--   pg_get_functiondef). Redeem also strips any client role as a second check.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));

  IF coalesce(NEW.raw_app_meta_data->>'account_kind', '') = 'staff' THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'client')
  ON CONFLICT DO NOTHING;

  -- Auto-link to existing client profile by email
  UPDATE public.clients
     SET user_id = NEW.id,
         account_status = 'Account Created',
         account_created_at = now()
   WHERE lower(email) = lower(NEW.email)
     AND user_id IS NULL;

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
