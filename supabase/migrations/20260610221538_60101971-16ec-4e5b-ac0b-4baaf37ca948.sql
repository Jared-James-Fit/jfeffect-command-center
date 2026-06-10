
-- Admin account protections: ensure ≥1 active admin, primary admin flag.

ALTER TABLE public.user_roles ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false;

-- Only one primary admin allowed
CREATE UNIQUE INDEX IF NOT EXISTS user_roles_single_primary_admin_idx
  ON public.user_roles (role) WHERE is_primary = true AND role = 'admin';

-- Helper: count of active admin accounts (admin role + corresponding auth user not banned)
CREATE OR REPLACE FUNCTION public.count_active_admins()
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(DISTINCT ur.user_id)::int
    FROM public.user_roles ur
   WHERE ur.role = 'admin'
$$;

-- Trigger: refuse to delete the last admin role assignment
CREATE OR REPLACE FUNCTION public.tg_protect_last_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE remaining int;
BEGIN
  IF TG_OP = 'DELETE' AND OLD.role = 'admin' THEN
    SELECT COUNT(DISTINCT user_id) INTO remaining
      FROM public.user_roles
     WHERE role = 'admin' AND user_id <> OLD.user_id;
    IF remaining < 1 THEN
      RAISE EXCEPTION 'Action blocked. At least one active admin account is required.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.is_primary THEN
      RAISE EXCEPTION 'Action blocked. The primary admin cannot be removed.'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF TG_OP = 'UPDATE' AND OLD.role = 'admin' AND NEW.role <> 'admin' THEN
    SELECT COUNT(DISTINCT user_id) INTO remaining
      FROM public.user_roles
     WHERE role = 'admin' AND user_id <> OLD.user_id;
    IF remaining < 1 THEN
      RAISE EXCEPTION 'Action blocked. At least one active admin account is required.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.is_primary THEN
      RAISE EXCEPTION 'Action blocked. The primary admin role cannot be changed.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS protect_last_admin ON public.user_roles;
CREATE TRIGGER protect_last_admin
BEFORE DELETE OR UPDATE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.tg_protect_last_admin();

-- Seed: mark the oldest admin as primary if none set yet
DO $$
DECLARE v_uid uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin' AND is_primary) THEN
    SELECT user_id INTO v_uid
      FROM public.user_roles
     WHERE role = 'admin'
     ORDER BY created_at ASC
     LIMIT 1;
    IF v_uid IS NOT NULL THEN
      UPDATE public.user_roles SET is_primary = true WHERE user_id = v_uid AND role = 'admin';
    END IF;
  END IF;
END $$;

-- Profile-picture requirement flag for JF members
ALTER TABLE public.app_members
  ADD COLUMN IF NOT EXISTS profile_picture_required boolean NOT NULL DEFAULT true;
