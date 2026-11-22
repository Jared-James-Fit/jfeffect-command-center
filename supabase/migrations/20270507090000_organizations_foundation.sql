-- Organizations: the businesses that run inside JF Effect, who works in each,
-- and an append-only record of every change to who has access
-- (docs/COACHING_PLATFORM.md).
--
-- Today there is one organization, JF Effect. Its members are read from what
-- already decides staff access, never typed twice: a login's staff roles in
-- user_roles (admin, coach, finance) and the business owner
-- (business_owners). Triggers keep the membership in step with them, so a
-- role added, removed or a coach suspended anywhere shows here at once.
--
-- Nothing here grants access. has_role / has_permission / coached_client_ids
-- and every policy are unchanged. This is the table later phases hang
-- org-scoped access on (independent coaches, support access, Cleo per
-- organization), and the audit trail the owner reads on the Team page now.
--
-- Independent organizations (kind 'independent') can't be created yet: no
-- function or policy writes one, and they stay off until every client-data
-- policy is org-scoped (the release gate in docs/COACHING_PLATFORM.md).

SET lock_timeout = '5s';

-- ── organizations ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('jf_effect', 'independent')),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  slug text UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
  owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- There is only ever one JF Effect.
CREATE UNIQUE INDEX IF NOT EXISTS organizations_one_jf_effect ON public.organizations ((kind)) WHERE kind = 'jf_effect';

/** JF Effect's own organization (a fixed id, so code and policies can name it). */
CREATE OR REPLACE FUNCTION public.jf_org_id()
RETURNS uuid
LANGUAGE sql
IMMUTABLE
AS $$ SELECT 'f0f0f0f0-0000-4000-8000-000000000001'::uuid $$;

GRANT EXECUTE ON FUNCTION public.jf_org_id() TO authenticated, service_role;

INSERT INTO public.organizations (id, kind, name, slug, owner_user_id)
SELECT public.jf_org_id(), 'jf_effect', 'JF Effect', 'jf-effect',
       (SELECT user_id FROM public.business_owners ORDER BY created_at NULLS LAST LIMIT 1)
ON CONFLICT (id) DO NOTHING;

-- ── organization_members ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.organization_members (
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'coach', 'finance')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);
CREATE INDEX IF NOT EXISTS organization_members_user_idx ON public.organization_members (user_id) WHERE status = 'active';

-- ── organization_audit_log ─────────────────────────────────────────────────
-- Written only by the definer functions and triggers below, never by a client:
-- the record of who gained, changed or lost access, and when.
CREATE TABLE IF NOT EXISTS public.organization_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_user_id uuid,
  action text NOT NULL CHECK (length(action) BETWEEN 3 AND 60),
  target_type text NOT NULL CHECK (target_type IN ('member', 'coach', 'client', 'organization')),
  target_id uuid,
  summary text NOT NULL CHECK (length(summary) BETWEEN 1 AND 300),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS organization_audit_log_org_time ON public.organization_audit_log (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS organization_audit_log_target ON public.organization_audit_log (target_id, created_at DESC);

/** The record is append-only: no edit, and no delete while its organization exists. */
CREATE OR REPLACE FUNCTION public.tg_organization_audit_keep()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'The access record is never changed' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.organizations WHERE id = OLD.org_id) THEN
    RAISE EXCEPTION 'The access record is never deleted' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS organization_audit_keep ON public.organization_audit_log;
CREATE TRIGGER organization_audit_keep
  BEFORE UPDATE OR DELETE ON public.organization_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.tg_organization_audit_keep();

/** (internal) Add a line to an organization's access record, as whoever is signed in. */
CREATE OR REPLACE FUNCTION public._org_audit(
  _org uuid, _action text, _target_type text, _target_id uuid, _summary text, _detail jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  INSERT INTO public.organization_audit_log (org_id, actor_user_id, action, target_type, target_id, summary, detail)
  VALUES (_org, auth.uid(), _action, _target_type, _target_id, left(_summary, 300), coalesce(_detail, '{}'::jsonb))
$$;

REVOKE ALL ON FUNCTION public._org_audit(uuid, text, text, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._org_audit(uuid, text, text, uuid, text, jsonb) TO service_role;

-- ── Helpers (read once per query: wrap in (SELECT …) in policies) ──────────

/** The organizations the signed-in person is an active member of. */
CREATE OR REPLACE FUNCTION public.my_org_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT m.org_id FROM public.organization_members m
   WHERE m.user_id = auth.uid() AND m.status = 'active'
$$;

REVOKE ALL ON FUNCTION public.my_org_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_org_ids() TO authenticated, service_role;

/** Is the signed-in person an owner or admin of this organization (with their two-step sign-in when they have one)? */
CREATE OR REPLACE FUNCTION public.is_org_admin(_org uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members m
     WHERE m.org_id = _org AND m.user_id = auth.uid() AND m.status = 'active'
       AND m.role IN ('owner', 'admin')
  ) AND public.caller_mfa_ok(auth.uid())
$$;

REVOKE ALL ON FUNCTION public.is_org_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_org_admin(uuid) TO authenticated, service_role;

/**
 * The organizations the signed-in person runs (owner or admin, with their
 * two-step sign-in when they have one). Policies read it as a set; a policy on
 * organization_members can't query that table itself without recursing.
 */
CREATE OR REPLACE FUNCTION public.my_admin_org_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT m.org_id FROM public.organization_members m
   WHERE m.user_id = auth.uid() AND m.status = 'active' AND m.role IN ('owner', 'admin')
     AND public.caller_mfa_ok(auth.uid())
$$;

REVOKE ALL ON FUNCTION public.my_admin_org_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_admin_org_ids() TO authenticated, service_role;

-- ── JF Effect's members follow staff access ────────────────────────────────

/**
 * (internal) Bring one login's JF Effect membership in line with their staff
 * access: the business owner is 'owner', then admin > coach > finance from
 * user_roles. No staff role left = revoked (the row and its history stay).
 * Every change is recorded.
 */
CREATE OR REPLACE FUNCTION public._jf_member_sync(_uid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  want text;
  cur public.organization_members;
  had boolean;
  who text;
BEGIN
  IF _uid IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = _uid) THEN
    RETURN;
  END IF;

  SELECT CASE
           WHEN EXISTS (SELECT 1 FROM public.business_owners WHERE user_id = _uid)
                AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role = 'admin') THEN 'owner'
           WHEN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role = 'admin') THEN 'admin'
           WHEN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role = 'coach') THEN 'coach'
           WHEN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role = 'finance') THEN 'finance'
         END
    INTO want;

  SELECT * INTO cur FROM public.organization_members WHERE org_id = public.jf_org_id() AND user_id = _uid;
  had := FOUND;  -- the name lookup below would overwrite FOUND
  SELECT coalesce(nullif(btrim(p.full_name), ''), u.email, 'A teammate')
    INTO who
    FROM auth.users u LEFT JOIN public.profiles p ON p.id = u.id
   WHERE u.id = _uid;

  IF want IS NULL THEN
    IF had AND cur.status = 'active' THEN
      UPDATE public.organization_members
         SET status = 'revoked', revoked_at = now(), updated_at = now()
       WHERE org_id = public.jf_org_id() AND user_id = _uid;
      PERFORM public._org_audit(public.jf_org_id(), 'member.revoked', 'member', _uid,
        who || ' no longer has team access', jsonb_build_object('role', cur.role));
    END IF;
    RETURN;
  END IF;

  IF NOT had THEN
    INSERT INTO public.organization_members (org_id, user_id, role) VALUES (public.jf_org_id(), _uid, want);
    PERFORM public._org_audit(public.jf_org_id(), 'member.added', 'member', _uid,
      who || ' joined the team as ' || want, jsonb_build_object('role', want));
  ELSIF cur.status <> 'active' THEN
    UPDATE public.organization_members
       SET status = 'active', role = want, revoked_at = NULL, updated_at = now()
     WHERE org_id = public.jf_org_id() AND user_id = _uid;
    PERFORM public._org_audit(public.jf_org_id(), 'member.restored', 'member', _uid,
      who || '''s team access is back (' || want || ')', jsonb_build_object('role', want));
  ELSIF cur.role <> want THEN
    UPDATE public.organization_members SET role = want, updated_at = now()
     WHERE org_id = public.jf_org_id() AND user_id = _uid;
    PERFORM public._org_audit(public.jf_org_id(), 'member.role_changed', 'member', _uid,
      who || ' is now ' || want || ' (was ' || cur.role || ')', jsonb_build_object('from', cur.role, 'to', want));
  END IF;
END $$;

REVOKE ALL ON FUNCTION public._jf_member_sync(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._jf_member_sync(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.tg_user_roles_jf_member()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM public._jf_member_sync(OLD.user_id);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND (TG_OP = 'INSERT' OR NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
    PERFORM public._jf_member_sync(NEW.user_id);
  END IF;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.tg_user_roles_jf_member() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS user_roles_jf_member ON public.user_roles;
CREATE TRIGGER user_roles_jf_member
  AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.tg_user_roles_jf_member();

CREATE OR REPLACE FUNCTION public.tg_business_owners_jf_member()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN PERFORM public._jf_member_sync(OLD.user_id); END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN PERFORM public._jf_member_sync(NEW.user_id); END IF;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.tg_business_owners_jf_member() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS business_owners_jf_member ON public.business_owners;
CREATE TRIGGER business_owners_jf_member
  AFTER INSERT OR UPDATE OR DELETE ON public.business_owners
  FOR EACH ROW EXECUTE FUNCTION public.tg_business_owners_jf_member();

-- A client given to (or taken from) a coach: one line in the record, whatever screen did it.
CREATE OR REPLACE FUNCTION public.tg_clients_coach_assignment_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  client_name text := coalesce(nullif(btrim(NEW.full_name), ''), 'A client');
  to_name text;
  from_name text;
BEGIN
  IF NEW.assigned_coach_id IS NOT DISTINCT FROM OLD.assigned_coach_id THEN
    RETURN NULL;
  END IF;
  SELECT coalesce(nullif(btrim(full_name), ''), email) INTO to_name FROM public.coaches WHERE id = NEW.assigned_coach_id;
  SELECT coalesce(nullif(btrim(full_name), ''), email) INTO from_name FROM public.coaches WHERE id = OLD.assigned_coach_id;
  PERFORM public._org_audit(
    public.jf_org_id(),
    CASE WHEN NEW.assigned_coach_id IS NULL THEN 'client.unassigned' ELSE 'client.assigned' END,
    'client', NEW.id,
    CASE WHEN NEW.assigned_coach_id IS NULL
         THEN client_name || ' no longer has a coach (was ' || coalesce(from_name, 'a coach') || ')'
         ELSE client_name || ' is now coached by ' || coalesce(to_name, 'a coach')
              || CASE WHEN OLD.assigned_coach_id IS NOT NULL THEN ' (was ' || coalesce(from_name, 'a coach') || ')' ELSE '' END
    END,
    jsonb_build_object('from_coach_id', OLD.assigned_coach_id, 'to_coach_id', NEW.assigned_coach_id)
  );
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.tg_clients_coach_assignment_audit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS clients_coach_assignment_audit ON public.clients;
CREATE TRIGGER clients_coach_assignment_audit
  AFTER UPDATE OF assigned_coach_id ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.tg_clients_coach_assignment_audit();

-- ── Row-level security ─────────────────────────────────────────────────────
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_audit_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.organizations, public.organization_members, public.organization_audit_log FROM anon, authenticated;
GRANT SELECT ON public.organizations, public.organization_members, public.organization_audit_log TO authenticated;
GRANT ALL ON public.organizations, public.organization_members, public.organization_audit_log TO service_role;

DROP POLICY IF EXISTS "Members read their organization" ON public.organizations;
CREATE POLICY "Members read their organization" ON public.organizations
  FOR SELECT TO authenticated
  USING (id IN (SELECT public.my_org_ids()));

DROP POLICY IF EXISTS "See your own memberships" ON public.organization_members;
CREATE POLICY "See your own memberships" ON public.organization_members
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Org admins see their team" ON public.organization_members;
CREATE POLICY "Org admins see their team" ON public.organization_members
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT public.my_admin_org_ids()));

DROP POLICY IF EXISTS "Org admins read the access record" ON public.organization_audit_log;
CREATE POLICY "Org admins read the access record" ON public.organization_audit_log
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT public.my_admin_org_ids()));

-- ── Backfill: everyone with staff access today ─────────────────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT ur.user_id FROM public.user_roles ur
     WHERE ur.role IN ('admin', 'coach', 'finance')
    UNION
    SELECT bo.user_id FROM public.business_owners bo
  LOOP
    PERFORM public._jf_member_sync(r.user_id);
  END LOOP;
END $$;

RESET lock_timeout;
