-- Fix: user_is_active() was rejecting clients whose status is anything other
-- than 'Active' (e.g. 'New Client'), preventing them from reading group
-- chats / messages even though they were added as members.
CREATE OR REPLACE FUNCTION public.user_is_active(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    public.is_coach_or_admin(_user_id)
    OR EXISTS (
      SELECT 1 FROM public.clients
      WHERE user_id = _user_id
        AND COALESCE(archived, false) = false
        AND COALESCE(status, '') NOT IN ('Deactivated', 'Inactive', 'Archived')
    )
    OR EXISTS (
      SELECT 1 FROM public.app_members
      WHERE user_id = _user_id AND status = 'Active'
    )
$function$;
