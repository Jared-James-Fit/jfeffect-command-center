CREATE OR REPLACE FUNCTION public.prevent_app_member_self_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;

  IF NEW.account_type IS DISTINCT FROM OLD.account_type
     OR NEW.subscription_status IS DISTINCT FROM OLD.subscription_status
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.trial_end_at IS DISTINCT FROM OLD.trial_end_at
     OR NEW.current_period_end IS DISTINCT FROM OLD.current_period_end
     OR NEW.paused_until IS DISTINCT FROM OLD.paused_until
     OR NEW.hold_plan_started_at IS DISTINCT FROM OLD.hold_plan_started_at
     OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
     OR NEW.cancel_at IS DISTINCT FROM OLD.cancel_at
     OR NEW.setup_token IS DISTINCT FROM OLD.setup_token
     OR NEW.profile_picture_required IS DISTINCT FROM OLD.profile_picture_required
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.manual_access_override IS DISTINCT FROM OLD.manual_access_override
     OR NEW.manual_access_disabled IS DISTINCT FROM OLD.manual_access_disabled
     OR NEW.access_end_date IS DISTINCT FROM OLD.access_end_date
     OR NEW.in_grace IS DISTINCT FROM OLD.in_grace
  THEN
    RAISE EXCEPTION 'Not authorized to modify protected membership fields';
  END IF;

  RETURN NEW;
END;
$$;