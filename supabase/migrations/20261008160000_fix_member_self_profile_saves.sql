-- Members couldn't save their own profile.
--
-- Two app_members self-update guards referenced columns that don't exist
-- (access_starts_at, access_ends_at, trial_ends_at, current_period_start,
-- membership_tier, access_level, trial_end_date, subscription_tier). PL/pgSQL
-- resolves every field in the IF, so ANY self-update by a member raised
-- `record "new" has no field ...` — the setup wizard, the macro calculator's
-- profile save, all of it. Same protections, real column names. (Billing
-- and access fields are also refused by app_members_billing_guard and the
-- column allowlist below, so this is one layer of several.)

CREATE OR REPLACE FUNCTION public.prevent_app_member_sensitive_self_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Admins can change anything
  IF public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN NEW;
  END IF;

  -- For self-updates, disallow changes to sensitive/access-control fields
  IF NEW.user_id = auth.uid() THEN
    IF NEW.manual_access_override      IS DISTINCT FROM OLD.manual_access_override
    OR NEW.manual_access_disabled      IS DISTINCT FROM OLD.manual_access_disabled
    OR NEW.subscription_status         IS DISTINCT FROM OLD.subscription_status
    OR NEW.stripe_customer_id          IS DISTINCT FROM OLD.stripe_customer_id
    OR NEW.stripe_subscription_id      IS DISTINCT FROM OLD.stripe_subscription_id
    OR NEW.stripe_price_id             IS DISTINCT FROM OLD.stripe_price_id
    OR NEW.cross_account_locked        IS DISTINCT FROM OLD.cross_account_locked
    OR NEW.access_start_date           IS DISTINCT FROM OLD.access_start_date
    OR NEW.access_end_date             IS DISTINCT FROM OLD.access_end_date
    OR NEW.trial_end_at                IS DISTINCT FROM OLD.trial_end_at
    OR NEW.current_period_end          IS DISTINCT FROM OLD.current_period_end
    OR NEW.account_type                IS DISTINCT FROM OLD.account_type
    OR NEW.user_id                     IS DISTINCT FROM OLD.user_id
    THEN
      RAISE EXCEPTION 'Not allowed to modify access-control or billing fields';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.protect_app_members_self_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF public.is_privileged_writer() THEN
    RETURN NEW;
  END IF;

  -- Non-privileged (the member themselves) cannot touch these:
  IF NEW.subscription_status IS DISTINCT FROM OLD.subscription_status
     OR NEW.stripe_subscription_id IS DISTINCT FROM OLD.stripe_subscription_id
     OR NEW.stripe_customer_id IS DISTINCT FROM OLD.stripe_customer_id
     OR NEW.stripe_price_id IS DISTINCT FROM OLD.stripe_price_id
     OR NEW.manual_access_override IS DISTINCT FROM OLD.manual_access_override
     OR NEW.access_end_date IS DISTINCT FROM OLD.access_end_date
     OR NEW.access_start_date IS DISTINCT FROM OLD.access_start_date
     OR NEW.trial_end_at IS DISTINCT FROM OLD.trial_end_at
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
  THEN
    RAISE EXCEPTION 'Not permitted to update restricted app_members columns'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

-- The macro calculator saves these profile fields with the member's own
-- login; they were missing from the self-update column allowlist, so the
-- save silently did nothing. Row-level security still limits it to their row.
GRANT UPDATE (height_cm, biological_sex, activity_level, units_preference)
  ON public.app_members TO authenticated;
