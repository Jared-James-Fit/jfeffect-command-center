
CREATE OR REPLACE FUNCTION public.app_members_block_self_privileged_updates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  -- Allow service_role / trusted server processes (no auth.uid) and admins.
  IF uid IS NULL OR public.has_role(uid, 'admin'::app_role) THEN
    RETURN NEW;
  END IF;

  -- Only enforce for self-updates. Admin manage policy already covers other paths.
  IF NEW.user_id IS DISTINCT FROM uid AND OLD.user_id IS DISTINCT FROM uid THEN
    RETURN NEW;
  END IF;

  -- Protected columns: identity, billing, subscription, access-control, admin/status.
  IF NEW.id                          IS DISTINCT FROM OLD.id
  OR NEW.user_id                     IS DISTINCT FROM OLD.user_id
  OR NEW.email                       IS DISTINCT FROM OLD.email
  OR NEW.account_type                IS DISTINCT FROM OLD.account_type
  OR NEW.status                      IS DISTINCT FROM OLD.status
  OR NEW.stripe_customer_id          IS DISTINCT FROM OLD.stripe_customer_id
  OR NEW.stripe_subscription_id      IS DISTINCT FROM OLD.stripe_subscription_id
  OR NEW.stripe_price_id             IS DISTINCT FROM OLD.stripe_price_id
  OR NEW.subscription_status         IS DISTINCT FROM OLD.subscription_status
  OR NEW.trial_end_at                IS DISTINCT FROM OLD.trial_end_at
  OR NEW.current_period_end          IS DISTINCT FROM OLD.current_period_end
  OR NEW.cancel_at                   IS DISTINCT FROM OLD.cancel_at
  OR NEW.cancelled_at                IS DISTINCT FROM OLD.cancelled_at
  OR NEW.paused_until                IS DISTINCT FROM OLD.paused_until
  OR NEW.hold_plan_started_at        IS DISTINCT FROM OLD.hold_plan_started_at
  OR NEW.last_invoice_status         IS DISTINCT FROM OLD.last_invoice_status
  OR NEW.last_billing_event_at       IS DISTINCT FROM OLD.last_billing_event_at
  OR NEW.payment_failed_at           IS DISTINCT FROM OLD.payment_failed_at
  OR NEW.grace_period_ends_at        IS DISTINCT FROM OLD.grace_period_ends_at
  OR NEW.last_grace_warning_at       IS DISTINCT FROM OLD.last_grace_warning_at
  OR NEW.payment_recovered_at        IS DISTINCT FROM OLD.payment_recovered_at
  OR NEW.access_restricted_at        IS DISTINCT FROM OLD.access_restricted_at
  OR NEW.subscription_ended_at       IS DISTINCT FROM OLD.subscription_ended_at
  OR NEW.last_restart_attempt_at     IS DISTINCT FROM OLD.last_restart_attempt_at
  OR NEW.sync_warning_at             IS DISTINCT FROM OLD.sync_warning_at
  OR NEW.sync_warning_reason         IS DISTINCT FROM OLD.sync_warning_reason
  OR NEW.cross_account_locked        IS DISTINCT FROM OLD.cross_account_locked
  OR NEW.manual_access_override      IS DISTINCT FROM OLD.manual_access_override
  OR NEW.manual_access_disabled      IS DISTINCT FROM OLD.manual_access_disabled
  OR NEW.access_end_date             IS DISTINCT FROM OLD.access_end_date
  OR NEW.in_grace                    IS DISTINCT FROM OLD.in_grace
  OR NEW.admin_access_note           IS DISTINCT FROM OLD.admin_access_note
  OR NEW.access_start_date           IS DISTINCT FROM OLD.access_start_date
  OR NEW.reactivated_at              IS DISTINCT FROM OLD.reactivated_at
  OR NEW.expired_at                  IS DISTINCT FROM OLD.expired_at
  OR NEW.is_admin_sandbox            IS DISTINCT FROM OLD.is_admin_sandbox
  OR NEW.admin_notes                 IS DISTINCT FROM OLD.admin_notes
  OR NEW.messaging_permission        IS DISTINCT FROM OLD.messaging_permission
  OR NEW.setup_token                 IS DISTINCT FROM OLD.setup_token
  OR NEW.setup_token_expires_at      IS DISTINCT FROM OLD.setup_token_expires_at
  OR NEW.signup_ip                   IS DISTINCT FROM OLD.signup_ip
  OR NEW.signup_user_agent           IS DISTINCT FROM OLD.signup_user_agent
  OR NEW.last_setup_error            IS DISTINCT FROM OLD.last_setup_error
  OR NEW.created_at                  IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'app_members: members may not modify billing, subscription, access, or admin fields on their own row'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS app_members_block_self_privileged_updates ON public.app_members;

CREATE TRIGGER app_members_block_self_privileged_updates
BEFORE UPDATE ON public.app_members
FOR EACH ROW
EXECUTE FUNCTION public.app_members_block_self_privileged_updates();
