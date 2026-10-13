-- Membership + Coaching unification, Phase 1: one athlete record.
--
-- Every self-serve JF member gets a `clients` row (service_tier 'self_serve',
-- status 'Member', no coach), so the whole client engine works for them: the
-- portal, workouts, PRs, analytics, history, Crew. What separates coaching is
-- the human layer, decided by service_tier in the app (useEntitlement), never
-- by separate tables. Upgrading a member to coaching is flipping the tier and
-- assigning a coach; their history comes with them.
--
-- Members are kept out of coaching automations:
--  * status 'Member' (not 'Active' / 'New Client'): skips the coaching-form
--    auto-assign, "all active clients" mass messages, coaching broadcasts and
--    events;
--  * service_tier = 'coaching' is required by the weekly check-in seeding,
--    the admin client directory and the dashboard roster (patched below).
-- Only admins (or the server) can change service_tier.

ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS service_tier text NOT NULL DEFAULT 'coaching';
ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_service_tier_check;
ALTER TABLE public.clients ADD CONSTRAINT clients_service_tier_check CHECK (service_tier IN ('coaching', 'self_serve'));
CREATE INDEX IF NOT EXISTS clients_self_serve_idx ON public.clients (id) WHERE service_tier = 'self_serve';

-- Nobody promotes themselves: the tier changes only through an admin or the server.
CREATE OR REPLACE FUNCTION public.guard_clients_service_tier()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.service_tier IS DISTINCT FROM OLD.service_tier
     AND auth.uid() IS NOT NULL
     AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only an admin can change a client''s service tier' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_clients_service_tier() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS guard_clients_service_tier ON public.clients;
CREATE TRIGGER guard_clients_service_tier BEFORE UPDATE OF service_tier ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.guard_clients_service_tier();

-- A member's client row. Never touches a real coaching client (one login, one
-- row: an existing row stays what it is, except a bare CRM lead with no coach,
-- which becomes the member). Returns the clients id, or NULL when it isn't a
-- linked JF member (or is an admin's preview sandbox).
CREATE OR REPLACE FUNCTION public.ensure_member_client(_member_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  m public.app_members%ROWTYPE;
  v_id uuid;
  v_status text;
  v_coach uuid;
BEGIN
  SELECT * INTO m FROM public.app_members WHERE id = _member_id;
  IF NOT FOUND OR m.account_type IS DISTINCT FROM 'jf_member' OR m.user_id IS NULL OR coalesce(m.is_admin_sandbox, false) THEN
    RETURN NULL;
  END IF;
  SELECT c.id, c.status, c.assigned_coach_id INTO v_id, v_status, v_coach FROM public.clients c WHERE c.user_id = m.user_id;
  IF v_id IS NOT NULL THEN
    IF v_status = 'Lead' AND v_coach IS NULL THEN
      UPDATE public.clients SET service_tier = 'self_serve', status = 'Member', account_status = 'Account Created' WHERE id = v_id;
    END IF;
    RETURN v_id;
  END IF;
  INSERT INTO public.clients (user_id, full_name, email, phone, status, service_tier, account_status, sms_opt_out)
  VALUES (m.user_id, coalesce(nullif(btrim(m.full_name), ''), m.email, 'Member'), m.email, m.phone,
          'Member', 'self_serve', 'Account Created', coalesce(m.sms_opt_out, false))
  ON CONFLICT (user_id) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT c.id INTO v_id FROM public.clients c WHERE c.user_id = m.user_id;
  END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.ensure_member_client(uuid) FROM PUBLIC, anon, authenticated;

-- Signup, admin-created members and billing all write app_members: any of
-- them linking a JF member to a login creates the row. Never fails the write.
CREATE OR REPLACE FUNCTION public.tg_app_members_ensure_client()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.account_type = 'jf_member' AND NEW.user_id IS NOT NULL THEN
    BEGIN
      PERFORM public.ensure_member_client(NEW.id);
    EXCEPTION WHEN others THEN
      RAISE WARNING 'ensure_member_client(%): %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_app_members_ensure_client() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS app_members_ensure_client ON public.app_members;
CREATE TRIGGER app_members_ensure_client AFTER INSERT OR UPDATE OF account_type, user_id ON public.app_members
  FOR EACH ROW EXECUTE FUNCTION public.tg_app_members_ensure_client();

-- Self-heal from the app: the signed-in member's own row (no-op for anyone else).
CREATE OR REPLACE FUNCTION public.ensure_my_member_client()
RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.ensure_member_client(m.id) FROM public.app_members m
   WHERE m.user_id = (SELECT auth.uid()) AND m.account_type = 'jf_member'
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.ensure_my_member_client() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_my_member_client() TO authenticated;

-- Members already linked to a login (former members stay as they are).
SELECT public.ensure_member_client(m.id) FROM public.app_members m
 WHERE m.account_type = 'jf_member' AND m.user_id IS NOT NULL AND coalesce(m.status, '') <> 'Archived';

-- Coaching-only server work skips self-serve members: weekly check-ins, the
-- admin client directory (members have their own list) and the dashboard roster.
DO $$
DECLARE
  v_def text;
  v_fn regprocedure;
  v_from text;
  v_to text;
  v_patch record;
BEGIN
  FOR v_patch IN
    SELECT * FROM (VALUES
      ('public.seed_messenger_checkin_occurrences()',
       E'    where coalesce(c.archived,false) = false\n      and d.task_type in',
       E'    where coalesce(c.archived,false) = false\n      and c.service_tier = ''coaching''\n      and d.task_type in'),
      ('public.admin_clients_directory(text,text,text,uuid,text,integer,integer,text,text[])',
       E'    where (v_is_admin or public.is_assigned_coach(c.id))\n      and (',
       E'    where (v_is_admin or public.is_assigned_coach(c.id))\n      and c.service_tier = ''coaching''\n      and ('),
      ('public.admin_dashboard_overview()',
       E'    where c.archived = false\n      and coalesce(c.status, '''') not in (''Archived'', ''Deactivated'')',
       E'    where c.archived = false\n      and c.service_tier = ''coaching''\n      and coalesce(c.status, '''') not in (''Archived'', ''Deactivated'')')
    ) AS t(fn, anchor, replacement)
  LOOP
    v_fn := v_patch.fn::regprocedure;
    v_def := pg_get_functiondef(v_fn);
    IF position('c.service_tier = ''coaching''' in v_def) > 0 THEN
      CONTINUE; -- already patched
    END IF;
    IF (length(v_def) - length(replace(v_def, v_patch.anchor, ''))) / length(v_patch.anchor) <> 1 THEN
      RAISE EXCEPTION '%: anchor not found exactly once', v_patch.fn;
    END IF;
    EXECUTE replace(v_def, v_patch.anchor, v_patch.replacement);
  END LOOP;
END $$;
