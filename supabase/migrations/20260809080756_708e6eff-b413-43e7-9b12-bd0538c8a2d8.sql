-- 1) is_assigned_coach_by_user_id: SECURITY DEFINER helper was executable by
--    anon/PUBLIC. No RLS policy and no app code reference it; for anon callers
--    it always returned false anyway. Restrict to authenticated + service_role.
REVOKE EXECUTE ON FUNCTION public.is_assigned_coach_by_user_id(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_assigned_coach_by_user_id(uuid) FROM PUBLIC;

-- 2) Complete the coach self-update guard. The existing trigger already blocks
--    non-admins from changing user_id/status/archived on coaches rows; extend
--    it to the archived_at/archived_by audit fields per scanner remediation.
CREATE OR REPLACE FUNCTION public.guard_coaches_self_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN NEW;
  END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.archived IS DISTINCT FROM OLD.archived
     OR NEW.archived_at IS DISTINCT FROM OLD.archived_at
     OR NEW.archived_by IS DISTINCT FROM OLD.archived_by
  THEN
    RAISE EXCEPTION 'Not allowed: only admins can change status/archived on coaches';
  END IF;
  RETURN NEW;
END;
$function$;