CREATE OR REPLACE FUNCTION public.guard_coaches_self_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Trusted server-side processes (service_role) bypass the guard.
  IF current_setting('role', true) = 'service_role'
     OR current_user = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN NEW;
  END IF;

  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.archived IS DISTINCT FROM OLD.archived
     OR NEW.archived_at IS DISTINCT FROM OLD.archived_at
     OR NEW.archived_by IS DISTINCT FROM OLD.archived_by
     OR NEW.email IS DISTINCT FROM OLD.email
     OR NEW.start_date IS DISTINCT FROM OLD.start_date
  THEN
    RAISE EXCEPTION 'Not allowed: only admins can change privileged coach fields';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.prevent_coach_self_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF current_setting('role', true) = 'service_role'
     OR current_user = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF public.has_role(auth.uid(), 'admin'::app_role) THEN RETURN NEW; END IF;
  IF NEW.archived IS DISTINCT FROM OLD.archived
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.email IS DISTINCT FROM OLD.email
     OR NEW.archived_at IS DISTINCT FROM OLD.archived_at
     OR NEW.archived_by IS DISTINCT FROM OLD.archived_by
     OR NEW.start_date IS DISTINCT FROM OLD.start_date
  THEN RAISE EXCEPTION 'Not allowed to modify privileged coach fields'; END IF;
  RETURN NEW;
END;
$function$;

DROP POLICY IF EXISTS "Coach update own coach row" ON public.coaches;
CREATE POLICY "Coach update own coach row"
ON public.coaches
FOR UPDATE
TO authenticated
USING (user_id = auth.uid() AND archived = false AND status = 'Active')
WITH CHECK (user_id = auth.uid() AND archived = false AND status = 'Active');