
CREATE OR REPLACE FUNCTION public.prevent_app_member_self_escalation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.has_role(auth.uid(), 'admin') THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
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
  THEN RAISE EXCEPTION 'Not allowed to modify privileged membership fields'; END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_prevent_app_member_self_escalation ON public.app_members;
CREATE TRIGGER trg_prevent_app_member_self_escalation BEFORE UPDATE ON public.app_members
FOR EACH ROW EXECUTE FUNCTION public.prevent_app_member_self_escalation();

CREATE OR REPLACE FUNCTION public.prevent_coach_self_escalation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.has_role(auth.uid(), 'admin') THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF NEW.archived IS DISTINCT FROM OLD.archived
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.email IS DISTINCT FROM OLD.email
     OR NEW.archived_at IS DISTINCT FROM OLD.archived_at
     OR NEW.archived_by IS DISTINCT FROM OLD.archived_by
     OR NEW.start_date IS DISTINCT FROM OLD.start_date
  THEN RAISE EXCEPTION 'Not allowed to modify privileged coach fields'; END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_prevent_coach_self_escalation ON public.coaches;
CREATE TRIGGER trg_prevent_coach_self_escalation BEFORE UPDATE ON public.coaches
FOR EACH ROW EXECUTE FUNCTION public.prevent_coach_self_escalation();

DROP POLICY IF EXISTS "Referring users view their attribution" ON public.referral_attribution;

CREATE OR REPLACE FUNCTION public.get_my_referral_attribution()
RETURNS TABLE (
  id uuid,
  attributed_at timestamptz,
  original_cents integer,
  referral_discount_cents integer,
  recurring_discounted_cents integer,
  subscription_status text,
  cancellation_status text,
  refund_status text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ra.id, ra.attributed_at, ra.original_cents, ra.referral_discount_cents,
         ra.recurring_discounted_cents, ra.subscription_status, ra.cancellation_status, ra.refund_status
  FROM public.referral_attribution ra
  WHERE ra.referring_user_id = auth.uid();
$$;
GRANT EXECUTE ON FUNCTION public.get_my_referral_attribution() TO authenticated;
