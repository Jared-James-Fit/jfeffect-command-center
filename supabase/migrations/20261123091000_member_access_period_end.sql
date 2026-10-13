-- Members who cancel keep access until the month they paid for ends, and
-- comped members get in.
--
-- Billing writes subscription_status as "Active (Cancels at period end)" and
-- "Complimentary", but the access checks only accepted active / trialing, so
-- a member who cancelled mid-month was locked out of the month they'd paid for
-- and a comped member was locked out unless an admin set an override. Same
-- rules as isMemberAccessActive (memberAccess.ts). "Hold Plan" and "Paused"
-- stay locked on purpose: their data is kept, the features are off.

CREATE OR REPLACE FUNCTION public.member_can_consume(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.app_members m
    WHERE m.user_id = _user_id
      AND COALESCE(m.manual_access_disabled, false) = false
      AND (
        COALESCE(m.manual_access_override, false) = true
        OR COALESCE(m.in_grace, false) = true
        OR (
          (m.access_end_date IS NULL OR m.access_end_date > now())
          AND lower(COALESCE(m.status, '')) NOT IN ('expired', 'cancelled', 'canceled')
          AND (
            lower(btrim(COALESCE(m.subscription_status, ''))) IN ('active', 'trialing', 'admin_granted', 'complimentary')
            OR (lower(btrim(COALESCE(m.subscription_status, ''))) = 'active (cancels at period end)'
                AND COALESCE(m.cancel_at, m.current_period_end, 'infinity'::timestamptz) > now())
          )
        )
      )
  )
$function$;

CREATE OR REPLACE FUNCTION public.jf_member_has_full_access(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.app_members
     WHERE user_id = _user_id
       AND account_type = 'jf_member'
       AND status = 'Active'
       AND (
         subscription_status IN ('Trialing', 'Active', 'Complimentary')
         OR (subscription_status = 'Active (Cancels at period end)'
             AND COALESCE(cancel_at, current_period_end, 'infinity'::timestamptz) > now())
       )
  )
$function$;
