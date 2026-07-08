
CREATE OR REPLACE FUNCTION public.clients_block_self_privileged_updates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  -- Trusted server processes (no auth.uid) and admins bypass.
  IF uid IS NULL OR public.has_role(uid, 'admin'::app_role) THEN
    RETURN NEW;
  END IF;

  -- Assigned coach edits are allowed (RLS already scopes them).
  IF NEW.assigned_coach_id IS NOT NULL
     AND NEW.assigned_coach_id = public.current_coach_id() THEN
    RETURN NEW;
  END IF;

  -- Only enforce when the client is editing their own row.
  IF NEW.user_id IS DISTINCT FROM uid AND OLD.user_id IS DISTINCT FROM uid THEN
    RETURN NEW;
  END IF;

  IF NEW.id                     IS DISTINCT FROM OLD.id
  OR NEW.user_id                IS DISTINCT FROM OLD.user_id
  OR NEW.email                  IS DISTINCT FROM OLD.email
  OR NEW.payment_status         IS DISTINCT FROM OLD.payment_status
  OR NEW.agreement_signed       IS DISTINCT FROM OLD.agreement_signed
  OR NEW.coaching_package       IS DISTINCT FROM OLD.coaching_package
  OR NEW.assigned_coach_id      IS DISTINCT FROM OLD.assigned_coach_id
  OR NEW.billing_source         IS DISTINCT FROM OLD.billing_source
  OR NEW.account_status         IS DISTINCT FROM OLD.account_status
  OR NEW.status                 IS DISTINCT FROM OLD.status
  OR NEW.stripe_customer_id     IS DISTINCT FROM OLD.stripe_customer_id
  OR NEW.archived               IS DISTINCT FROM OLD.archived
  OR NEW.coach_notes            IS DISTINCT FROM OLD.coach_notes
  OR NEW.created_at             IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'clients: clients may not modify payment, agreement, coaching, billing, status, or admin fields on their own row'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clients_block_self_privileged_updates ON public.clients;

CREATE TRIGGER clients_block_self_privileged_updates
BEFORE UPDATE ON public.clients
FOR EACH ROW
EXECUTE FUNCTION public.clients_block_self_privileged_updates();
