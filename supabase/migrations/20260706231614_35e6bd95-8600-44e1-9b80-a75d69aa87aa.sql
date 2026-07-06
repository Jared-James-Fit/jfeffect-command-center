
-- 1) Column-level guard for member_plan_enrollments self-updates
CREATE OR REPLACE FUNCTION public.guard_member_plan_enrollments_self_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN NEW;
  END IF;
  IF NEW.member_id IS DISTINCT FROM OLD.member_id
     OR NEW.plan_id IS DISTINCT FROM OLD.plan_id
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.started_at IS DISTINCT FROM OLD.started_at
     OR NEW.completed_at IS DISTINCT FROM OLD.completed_at
     OR NEW.current_week IS DISTINCT FROM OLD.current_week
     OR NEW.workouts_completed IS DISTINCT FROM OLD.workouts_completed
     OR NEW.workouts_total IS DISTINCT FROM OLD.workouts_total
     OR NEW.source_version IS DISTINCT FROM OLD.source_version
     OR NEW.start_date IS DISTINCT FROM OLD.start_date
     OR NEW.training_days IS DISTINCT FROM OLD.training_days
     OR NEW.import_mode IS DISTINCT FROM OLD.import_mode
     OR NEW.selection_json IS DISTINCT FROM OLD.selection_json
  THEN
    RAISE EXCEPTION 'Not allowed: members cannot modify enrollment progress or scheduling fields';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS guard_member_plan_enrollments_self_update ON public.member_plan_enrollments;
CREATE TRIGGER guard_member_plan_enrollments_self_update
  BEFORE UPDATE ON public.member_plan_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.guard_member_plan_enrollments_self_update();

REVOKE EXECUTE ON FUNCTION public.guard_member_plan_enrollments_self_update() FROM PUBLIC, anon;

-- 2) Revoke public/anon EXECUTE on existing security-definer guard/protect functions.
--    Trigger execution is unaffected because triggers run as the function definer.
REVOKE EXECUTE ON FUNCTION public.guard_coaches_self_update() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.guard_app_members_self_update() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.guard_purchase_records_client_update() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.guard_clients_self_update() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.protect_clients_self_update() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.protect_purchase_records_self_update() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.protect_app_members_self_update() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.protect_fillout_submissions_self_update() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.protect_messages_client_update() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.prevent_app_member_sensitive_self_update() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.prevent_client_sensitive_self_update() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.restrict_client_purchase_record_updates() FROM PUBLIC, anon;
