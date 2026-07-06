CREATE OR REPLACE FUNCTION public.guard_clients_self_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- System / service-role contexts (e.g. Supabase Auth inserting a new
  -- auth.users row and firing handle_new_user, or admin server functions
  -- using the service role) have no auth.uid(). Allow those through so
  -- account_created linkage from handle_new_user doesn't fail.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN NEW;
  END IF;
  -- Coaches updating assigned clients also bypass this restriction
  IF OLD.assigned_coach_id IS NOT NULL AND OLD.assigned_coach_id = public.current_coach_id() THEN
    RETURN NEW;
  END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.assigned_coach_id IS DISTINCT FROM OLD.assigned_coach_id
     OR NEW.account_status IS DISTINCT FROM OLD.account_status
     OR NEW.billing_source IS DISTINCT FROM OLD.billing_source
     OR NEW.payment_status IS DISTINCT FROM OLD.payment_status
     OR NEW.agreement_signed IS DISTINCT FROM OLD.agreement_signed
     OR NEW.agreement_status IS DISTINCT FROM OLD.agreement_status
     OR NEW.agreement_signed_date IS DISTINCT FROM OLD.agreement_signed_date
     OR NEW.sessions_purchased IS DISTINCT FROM OLD.sessions_purchased
     OR NEW.sessions_used IS DISTINCT FROM OLD.sessions_used
     OR NEW.coach_call_access_enabled IS DISTINCT FROM OLD.coach_call_access_enabled
     OR NEW.portal_access_disabled IS DISTINCT FROM OLD.portal_access_disabled
  THEN
    RAISE EXCEPTION 'Not allowed: only admins can change billing/access/coach assignment fields on clients';
  END IF;
  RETURN NEW;
END;
$function$;