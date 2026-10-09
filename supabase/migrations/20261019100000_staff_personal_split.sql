-- Staff accounts are separate from personal accounts.
--
--   * A personal client or member account never holds a staff role.
--   * A staff account never has a clients or app_members row.
--   * Staff roles: admin, coach, media_manager, finance.
--
-- These triggers enforce the split for NEW grants and links on every path
-- (server functions, browser-side inserts, webhooks, SQL). Accounts that
-- already mix both are left exactly as they are. See
-- docs/staff-personal-split-plan.md for the read-only listing and the dry-run
-- plan to split them.
--
-- Exempt: app_members rows with is_admin_sandbox = true (the admin's member
-- POV sandbox, created for the admin's own login on purpose).

CREATE OR REPLACE FUNCTION public.is_staff_role(_role public.app_role)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT _role IN ('admin', 'coach', 'media_manager', 'finance')
$$;

CREATE OR REPLACE FUNCTION public.user_has_staff_role(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _uid AND public.is_staff_role(r.role))
$$;

CREATE OR REPLACE FUNCTION public.user_has_personal_record(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.clients c WHERE c.user_id = _uid)
      OR EXISTS (SELECT 1 FROM public.app_members m
                  WHERE m.user_id = _uid AND NOT coalesce(m.is_admin_sandbox, false))
$$;

REVOKE ALL ON FUNCTION public.user_has_staff_role(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.user_has_personal_record(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_has_staff_role(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_has_personal_record(uuid) TO authenticated, service_role;

-- 1. No new staff role on a personal account.
CREATE OR REPLACE FUNCTION public.tg_user_roles_staff_split()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_staff_role(NEW.role)
     -- Re-asserting a role the user already holds (upsert) changes nothing.
     AND NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = NEW.user_id AND r.role = NEW.role)
     AND public.user_has_personal_record(NEW.user_id) THEN
    RAISE EXCEPTION 'staff_personal_split: this login has a client or member record, so it can''t hold the % role. Staff need a separate staff-only email.', NEW.role
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_roles_staff_split ON public.user_roles;
CREATE TRIGGER user_roles_staff_split
  BEFORE INSERT ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.tg_user_roles_staff_split();

-- 2. No client or member record linked to a staff account, and no new client
--    record on a staff login's email.
CREATE OR REPLACE FUNCTION public.tg_personal_record_staff_split()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  linked boolean;
BEGIN
  -- Nested IFs on purpose: PL/pgSQL doesn't promise AND short-circuits, and
  -- clients rows have no is_admin_sandbox field.
  IF TG_TABLE_NAME = 'app_members' THEN
    IF coalesce(NEW.is_admin_sandbox, false) THEN
      RETURN NEW;
    END IF;
  END IF;

  IF NEW.user_id IS NOT NULL THEN
    IF TG_OP = 'INSERT' THEN
      linked := true;
    ELSE
      linked := NEW.user_id IS DISTINCT FROM OLD.user_id;
    END IF;
    IF linked AND public.user_has_staff_role(NEW.user_id) THEN
      RAISE EXCEPTION 'staff_personal_split: this login is a staff account, so it can''t be linked to a % record. Use a separate personal email.', TG_TABLE_NAME
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'clients' AND TG_OP = 'INSERT' THEN
    IF NEW.email IS NOT NULL AND EXISTS (
         SELECT 1 FROM auth.users u
           JOIN public.user_roles r ON r.user_id = u.id
          WHERE lower(u.email) = lower(NEW.email) AND public.is_staff_role(r.role)) THEN
      RAISE EXCEPTION 'staff_personal_split: % belongs to a staff account. Use a different email for this client.', NEW.email
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clients_staff_split ON public.clients;
CREATE TRIGGER clients_staff_split
  BEFORE INSERT OR UPDATE OF user_id ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.tg_personal_record_staff_split();

DROP TRIGGER IF EXISTS app_members_staff_split ON public.app_members;
CREATE TRIGGER app_members_staff_split
  BEFORE INSERT OR UPDATE OF user_id ON public.app_members
  FOR EACH ROW EXECUTE FUNCTION public.tg_personal_record_staff_split();
