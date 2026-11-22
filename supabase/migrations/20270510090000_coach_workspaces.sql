-- Coach workspaces: independent coaching businesses inside JF Effect, kept
-- apart from JF Effect and from each other (docs/COACHING_PLATFORM.md,
-- Phase 3). NOT applied to production: the owner applies it once the release
-- gate in that document passes. Nothing here can be reached until he creates a
-- pilot workspace by hand, and the pilot can't be switched on while any
-- client-keyed table is unfenced.
--
-- What it adds:
--   * clients.organization_id: the business a client record lives in (JF
--     Effect for every record today). An independent business's clients are
--     their own records, service_tier 'org_coaching', made only by accepting
--     that business's invitation. JF Effect's jobs read service_tier
--     'coaching' / 'self_serve', so they never pick those clients up.
--   * organization_clients: the coaching relationship (active, paused, ended),
--     who it's assigned to, and the client's consent, word for word.
--   * organization_invitations: client and coach invitations (only a SHA-256
--     of the token is stored; the token is made by the server and shown once).
--   * organization_member_permissions: an owner's per-person changes to a
--     role's defaults (has_org_permission).
--   * support_access_grants: the platform owner's time-limited, owner-approved
--     look into a business.
--   * organization_billing, coach_billing_events, org_ai_usage: seat billing
--     state (written by the server from Stripe, test mode only for now), the
--     webhook's dedupe, and every AI call's cost per business.
--   * The tenant fence: one RESTRICTIVE policy, "tenant_fence", on every table
--     that holds a client's records (every uuid client_id column, the clients
--     table, the program tree, nutrition days, form answers and the user-keyed
--     coaching tables), ANDed with whatever permissive policies already exist.
--     While no independent business exists it's a no-op (mode 'open'). Then a
--     JF Effect login is fenced out of every other business's clients (mode
--     'hide': a small set), and a login that only belongs to independent
--     businesses is fenced into theirs (mode 'allow'). Platform records the
--     owner must keep (money, legal acceptance, account lifecycle) are named
--     in tenant_fence_platform_tables and left alone.
--   * Independent members' access is granted only here, table by table
--     (org_client_ids()): they never get the global coach role, a coaches row,
--     or coached_client_ids(), so every existing JF Effect policy stays shut
--     to them.
--
-- Rollback: docs/rollback/2026-11-22-coach-workspaces-rollback.sql.
-- Tests: supabase/tests/coach-workspaces (two businesses, every principal).

SET lock_timeout = '5s';

-- ── clients: which business a record lives in ────────────────────────────
ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_service_tier_check;
ALTER TABLE public.clients ADD CONSTRAINT clients_service_tier_check
  CHECK (service_tier IN ('coaching', 'self_serve', 'org_coaching'));

ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS organization_id uuid NOT NULL DEFAULT 'f0f0f0f0-0000-4000-8000-000000000001'::uuid;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clients_organization_fk') THEN
    ALTER TABLE public.clients ADD CONSTRAINT clients_organization_fk
      FOREIGN KEY (organization_id) REFERENCES public.organizations(id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clients_org_tier_check') THEN
    -- an independent business's record is always 'org_coaching', and only theirs is
    ALTER TABLE public.clients ADD CONSTRAINT clients_org_tier_check
      CHECK ((organization_id = 'f0f0f0f0-0000-4000-8000-000000000001'::uuid) = (service_tier <> 'org_coaching')) NOT VALID;
  END IF;
END $$;
ALTER TABLE public.clients VALIDATE CONSTRAINT clients_organization_fk;
ALTER TABLE public.clients VALIDATE CONSTRAINT clients_org_tier_check;
CREATE INDEX IF NOT EXISTS clients_independent_org_idx ON public.clients (organization_id)
  WHERE organization_id <> 'f0f0f0f0-0000-4000-8000-000000000001'::uuid;

/**
 * Only the workspace functions below put a record in another business or make
 * it 'org_coaching' (they set jf.org_client_write for their own transaction).
 * Anyone else, the admin and the server included, gets an error.
 */
CREATE OR REPLACE FUNCTION public.tg_clients_org_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  allowed boolean := coalesce(current_setting('jf.org_client_write', true), '') = 'on';
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF (NEW.organization_id <> public.jf_org_id() OR NEW.service_tier = 'org_coaching') AND NOT allowed THEN
      RAISE EXCEPTION 'A client of another business is made only by accepting its invitation' USING ERRCODE = '42501';
    END IF;
  ELSIF (NEW.organization_id IS DISTINCT FROM OLD.organization_id
         OR (NEW.service_tier = 'org_coaching') IS DISTINCT FROM (OLD.service_tier = 'org_coaching'))
        AND NOT allowed THEN
    RAISE EXCEPTION 'A client record never moves between businesses' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.tg_clients_org_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS clients_org_guard ON public.clients;
CREATE TRIGGER clients_org_guard
  BEFORE INSERT OR UPDATE OF organization_id, service_tier ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.tg_clients_org_guard();

-- ── organizations: what an independent business adds ────────────────────
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS country text CHECK (country IN ('CA', 'US', 'OTHER'));
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS region text CHECK (length(region) <= 80);
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS time_zone text NOT NULL DEFAULT 'America/Winnipeg' CHECK (length(time_zone) BETWEEN 3 AND 60);
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS pilot boolean NOT NULL DEFAULT false;

-- ── organization_clients: the coaching relationship ──────────────────────
CREATE TABLE IF NOT EXISTS public.organization_clients (
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'ended')),
  assigned_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  paused_at timestamptz,
  ended_at timestamptz,
  ended_by uuid,
  end_reason text CHECK (end_reason IN ('coach_ended', 'client_left', 'org_closed', 'account_deleted')),
  invitation_id uuid,
  consent_version text NOT NULL CHECK (length(consent_version) BETWEEN 3 AND 80),
  consent_text text NOT NULL CHECK (length(consent_text) BETWEEN 20 AND 2000),
  consented_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, client_id),
  CHECK ((status = 'ended') = (ended_at IS NOT NULL))
);
-- a client record lives in one business, so it has one relationship
CREATE UNIQUE INDEX IF NOT EXISTS organization_clients_one_per_client ON public.organization_clients (client_id);
CREATE INDEX IF NOT EXISTS organization_clients_assigned ON public.organization_clients (assigned_user_id) WHERE status = 'active';

-- ── organization_invitations ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.organization_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('client', 'member')),
  email text NOT NULL CHECK (email = lower(btrim(email)) AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND length(email) <= 254),
  role text CHECK (role IN ('admin', 'coach')),
  assign_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  invited_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_by uuid,
  revoked_at timestamptz,
  revoked_by uuid,
  failed_tries int NOT NULL DEFAULT 0,
  CHECK ((kind = 'member') = (role IS NOT NULL)),
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '15 days')
);
-- a brand-new client makes their login from the invitation: a 6-digit code to the invited email
ALTER TABLE public.organization_invitations ADD COLUMN IF NOT EXISTS signup_code_hash text;
ALTER TABLE public.organization_invitations ADD COLUMN IF NOT EXISTS signup_code_expires_at timestamptz;
ALTER TABLE public.organization_invitations ADD COLUMN IF NOT EXISTS signup_code_tries int NOT NULL DEFAULT 0;
ALTER TABLE public.organization_invitations ADD COLUMN IF NOT EXISTS signup_code_sent_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS organization_invitations_one_open
  ON public.organization_invitations (org_id, kind, email) WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS organization_invitations_org_time ON public.organization_invitations (org_id, created_at DESC);

-- ── per-person permission changes ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.organization_member_permissions (
  org_id uuid NOT NULL,
  user_id uuid NOT NULL,
  key text NOT NULL CHECK (key IN (
    'clients.view_all', 'clients.manage', 'clients.invite', 'programs.edit', 'nutrition.edit',
    'messages.send', 'checkins.review', 'templates.edit', 'billing.view', 'settings.manage', 'cleo.use')),
  granted boolean NOT NULL,
  set_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id, key),
  FOREIGN KEY (org_id, user_id) REFERENCES public.organization_members(org_id, user_id) ON DELETE CASCADE
);

-- ── support access ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.support_access_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  granted_to uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 10 AND 500),
  hours int NOT NULL CHECK (hours BETWEEN 1 AND 72),
  requested_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid,
  approved_at timestamptz,
  expires_at timestamptz,
  revoked_by uuid,
  revoked_at timestamptz,
  CHECK ((approved_at IS NULL) = (expires_at IS NULL))
);
CREATE INDEX IF NOT EXISTS support_access_grants_live ON public.support_access_grants (granted_to, org_id) WHERE revoked_at IS NULL;

-- ── seat billing (server-written from Stripe) ───────────────────────────
CREATE TABLE IF NOT EXISTS public.organization_billing (
  org_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- the price this business agreed to, frozen when it was created: a later
  -- change to the platform's price never reaches it without its own decision
  pricing jsonb NOT NULL,
  state text NOT NULL DEFAULT 'free' CHECK (state IN ('free', 'needs_setup', 'active', 'past_due', 'paused', 'canceled')),
  livemode boolean NOT NULL DEFAULT false CHECK (livemode = false),
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_item_id text,
  seats int NOT NULL DEFAULT 0 CHECK (seats >= 0),
  paid_seats int NOT NULL DEFAULT 0 CHECK (paid_seats >= 0),
  seat_revision bigint NOT NULL DEFAULT 0,
  synced_revision bigint NOT NULL DEFAULT 0,
  synced_quantity int,
  needs_setup_since timestamptz,
  past_due_since timestamptz,
  grace_until timestamptz,
  current_period_end timestamptz,
  last_reconciled_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.coach_billing_events (
  event_id text PRIMARY KEY CHECK (event_id ~ '^evt_[A-Za-z0-9]+$'),
  type text NOT NULL,
  org_id uuid,
  livemode boolean NOT NULL DEFAULT false,
  received_at timestamptz NOT NULL DEFAULT now(),
  handled_at timestamptz,
  outcome text,
  error text
);

-- ── AI usage per business ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.org_ai_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid,
  client_id uuid,
  feature text NOT NULL CHECK (length(feature) BETWEEN 2 AND 60),
  model text NOT NULL CHECK (length(model) BETWEEN 2 AND 80),
  input_tokens int NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  cached_tokens int NOT NULL DEFAULT 0 CHECK (cached_tokens >= 0),
  output_tokens int NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  -- what the call cost, in millionths of a US dollar (the providers bill in USD)
  cost_micro_usd bigint NOT NULL CHECK (cost_micro_usd >= 0),
  refused boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS org_ai_usage_org_time ON public.org_ai_usage (org_id, created_at DESC);

ALTER TABLE public.org_ai_usage ADD COLUMN IF NOT EXISTS credits int NOT NULL DEFAULT 0 CHECK (credits >= 0);
ALTER TABLE public.org_ai_usage ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'included' CHECK (source IN ('allowance', 'purchased', 'included'));
ALTER TABLE public.org_ai_usage ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'settled' CHECK (status IN ('reserved', 'settled', 'refunded'));
ALTER TABLE public.org_ai_usage ADD COLUMN IF NOT EXISTS settled_at timestamptz;

-- credits a business bought (web only) or the owner gave; never expire
CREATE TABLE IF NOT EXISTS public.org_ai_credit_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  credits int NOT NULL CHECK (credits <> 0),
  source text NOT NULL CHECK (source IN ('pack', 'admin', 'refund')),
  stripe_ref text UNIQUE,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── settings ─────────────────────────────────────────────────────────────
INSERT INTO public.app_settings (key, value)
VALUES ('coach_workspaces', '{"pilot": false}')
ON CONFLICT (key) DO NOTHING;

/** Is the invite-only pilot on? (Off: no workspace can be made and no invitation accepted.) */
CREATE OR REPLACE FUNCTION public.coach_workspaces_pilot_on()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE raw text;
BEGIN
  SELECT value INTO raw FROM public.app_settings WHERE key = 'coach_workspaces';
  RETURN coalesce((raw::jsonb ->> 'pilot')::boolean, false);
EXCEPTION WHEN others THEN
  RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.coach_workspaces_pilot_on() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coach_workspaces_pilot_on() TO authenticated, service_role;

-- ── who may do what in a business ────────────────────────────────────────
/** A role's default keys. Owner: everything; members.manage, billing.manage and support.approve are an owner's only. */
CREATE OR REPLACE FUNCTION public.org_role_allows(_role text, _key text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN _role = 'owner' THEN true
    WHEN _key IN ('members.manage', 'billing.manage', 'support.approve') THEN false
    WHEN _role = 'admin' THEN _key IN ('clients.view_all', 'clients.manage', 'clients.invite', 'programs.edit',
      'nutrition.edit', 'messages.send', 'checkins.review', 'templates.edit', 'billing.view', 'settings.manage', 'cleo.use')
    WHEN _role = 'coach' THEN _key IN ('clients.invite', 'programs.edit', 'nutrition.edit', 'messages.send', 'checkins.review')
    WHEN _role = 'finance' THEN _key IN ('billing.view')
    ELSE false
  END
$$;

/**
 * May the signed-in person use this key in this independent business? An
 * active member of an active business (with their two-step sign-in when they
 * have one), the role's default unless the owner changed it for them. Never
 * true for JF Effect itself: its staff keep has_role / has_permission.
 */
CREATE OR REPLACE FUNCTION public.has_org_permission(_org uuid, _key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT coalesce((
    SELECT CASE
             WHEN _key IN ('members.manage', 'billing.manage', 'support.approve') THEN m.role = 'owner'
             ELSE coalesce(p.granted, public.org_role_allows(m.role, _key))
           END
      FROM public.organization_members m
      JOIN public.organizations o ON o.id = m.org_id
      LEFT JOIN public.organization_member_permissions p
        ON p.org_id = m.org_id AND p.user_id = m.user_id AND p.key = _key
     WHERE m.org_id = _org AND m.user_id = auth.uid() AND m.status = 'active'
       AND o.kind = 'independent' AND o.status = 'active'
  ), false) AND public.caller_mfa_ok(auth.uid())
$$;
REVOKE ALL ON FUNCTION public.has_org_permission(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_org_permission(uuid, text) TO authenticated, service_role;

/**
 * Can this business change its clients' records right now? Not while billing
 * has lapsed past its grace (a missing card 14 days after a paid client
 * joined, or a failed payment past its grace): reading stays open, nothing is
 * deleted, and clients keep their own records. The same rule as
 * writeAccess() in src/lib/coach-platform/coach-billing.ts.
 */
CREATE OR REPLACE FUNCTION public.org_can_write(_org uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = _org AND o.kind = 'independent' AND o.status = 'active')
     AND NOT EXISTS (
       SELECT 1 FROM public.organization_billing b
        WHERE b.org_id = _org
          AND (b.state IN ('paused', 'canceled') AND b.paid_seats > 0
               OR (b.state = 'needs_setup' AND b.needs_setup_since < now() - interval '14 days')
               OR (b.state = 'past_due' AND b.grace_until < now()))
     )
$$;
REVOKE ALL ON FUNCTION public.org_can_write(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_can_write(uuid) TO authenticated, service_role;

/**
 * The clients the signed-in person reaches through an independent business:
 * the whole roster for whoever holds clients.view_all, else the ones assigned
 * to them; only active relationships of active businesses. _write: only where
 * the business can write (org_can_write) and they hold programs.edit.
 */
CREATE OR REPLACE FUNCTION public.org_client_ids(_write boolean DEFAULT false)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT oc.client_id
    FROM public.organization_clients oc
    JOIN public.organization_members m ON m.org_id = oc.org_id AND m.user_id = auth.uid() AND m.status = 'active'
    JOIN public.organizations o ON o.id = oc.org_id AND o.kind = 'independent' AND o.status = 'active'
   WHERE oc.status = 'active'
     AND (oc.assigned_user_id = auth.uid() OR public.has_org_permission(oc.org_id, 'clients.view_all'))
     AND (NOT _write OR (public.org_can_write(oc.org_id) AND public.has_org_permission(oc.org_id, 'programs.edit')))
     AND public.caller_mfa_ok(auth.uid())
$$;
REVOKE ALL ON FUNCTION public.org_client_ids(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_client_ids(boolean) TO authenticated, service_role;

/** Their logins (for the user-keyed tables). */
CREATE OR REPLACE FUNCTION public.org_client_user_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT c.user_id FROM public.clients c
   WHERE c.id IN (SELECT public.org_client_ids(false)) AND c.user_id IS NOT NULL
$$;
REVOKE ALL ON FUNCTION public.org_client_user_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_client_user_ids() TO authenticated, service_role;

/** Their programs, weeks and days, read once per query. */
CREATE OR REPLACE FUNCTION public.org_program_ids(_kind text, _write boolean DEFAULT false)
RETURNS SETOF uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF _kind = 'block' THEN
    RETURN QUERY SELECT b.id FROM public.pl_blocks b WHERE b.client_id IN (SELECT public.org_client_ids(_write));
  ELSIF _kind = 'week' THEN
    RETURN QUERY SELECT w.id FROM public.pl_weeks w
      JOIN public.pl_blocks b ON b.id = w.block_id
     WHERE b.client_id IN (SELECT public.org_client_ids(_write));
  ELSIF _kind = 'day' THEN
    RETURN QUERY SELECT d.id FROM public.pl_days d
      JOIN public.pl_weeks w ON w.id = d.week_id
      JOIN public.pl_blocks b ON b.id = w.block_id
     WHERE b.client_id IN (SELECT public.org_client_ids(_write));
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.org_program_ids(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_program_ids(text, boolean) TO authenticated, service_role;

/** The independent businesses the signed-in person is a client of. */
CREATE OR REPLACE FUNCTION public.my_client_org_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT oc.org_id FROM public.organization_clients oc
    JOIN public.clients c ON c.id = oc.client_id
   WHERE c.user_id = auth.uid()
$$;
REVOKE ALL ON FUNCTION public.my_client_org_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_client_org_ids() TO authenticated, service_role;

-- ── the tenant fence ─────────────────────────────────────────────────────
/**
 * The businesses whose client records the signed-in person may ever be shown
 * (what permissive policies then allow is still theirs to decide): the ones
 * they work in, the one their own client record lives in (and a linked staff
 * login's), JF Effect for anyone with a staff role, and a business whose owner
 * approved a support grant that hasn't run out.
 */
CREATE OR REPLACE FUNCTION public.tenant_visible_org_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT m.org_id FROM public.organization_members m WHERE m.user_id = auth.uid() AND m.status = 'active'
  UNION
  SELECT c.organization_id FROM public.clients c WHERE c.user_id = auth.uid()
  UNION
  SELECT c.organization_id FROM public.clients c WHERE c.id = public.linked_client_id()
  UNION
  SELECT public.jf_org_id() WHERE EXISTS (
    SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role::text <> 'client')
  UNION
  SELECT g.org_id FROM public.support_access_grants g
   WHERE g.granted_to = auth.uid() AND g.approved_at IS NOT NULL AND g.revoked_at IS NULL AND g.expires_at > now()
$$;
REVOKE ALL ON FUNCTION public.tenant_visible_org_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tenant_visible_org_ids() TO authenticated, service_role;

/**
 * How the fence reads for the signed-in person, once per query:
 *   'open'  no independent business exists: the fence changes nothing
 *   'hide'  JF Effect is theirs: hide the (few) other businesses' records
 *   'allow' JF Effect isn't: show only their businesses' records
 */
CREATE OR REPLACE FUNCTION public.tenant_fence_mode()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM public.organizations WHERE kind = 'independent') THEN 'open'
    WHEN public.jf_org_id() IN (SELECT public.tenant_visible_org_ids()) THEN 'hide'
    ELSE 'allow'
  END
$$;
REVOKE ALL ON FUNCTION public.tenant_fence_mode() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tenant_fence_mode() TO authenticated, service_role;

/**
 * The ids behind the fence for one kind of key: hidden ones ('hide' mode) or
 * visible ones ('allow' mode). Own records always count as visible and never
 * as hidden. Kinds: client, user, block, week, day, nutrition_target,
 * nf_submission.
 */
CREATE OR REPLACE FUNCTION public.tenant_fence_ids(_kind text, _visible boolean)
RETURNS SETOF uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  me uuid := auth.uid();
  linked uuid := public.linked_client_id();
  ids uuid[];
BEGIN
  IF _visible THEN
    SELECT coalesce(array_agg(c.id), '{}') INTO ids FROM public.clients c
     WHERE c.organization_id IN (SELECT public.tenant_visible_org_ids())
        OR c.user_id = me OR c.id = linked;
  ELSE
    -- only asked in 'hide' mode, where JF Effect is visible: never one of its records
    SELECT coalesce(array_agg(c.id), '{}') INTO ids FROM public.clients c
     WHERE c.organization_id <> public.jf_org_id()
       AND c.organization_id NOT IN (SELECT public.tenant_visible_org_ids())
       AND c.user_id IS DISTINCT FROM me AND c.id IS DISTINCT FROM linked;
  END IF;

  IF _kind = 'client' THEN
    RETURN QUERY SELECT unnest(ids);
  ELSIF _kind = 'user' THEN
    RETURN QUERY SELECT c.user_id FROM public.clients c WHERE c.id = ANY (ids) AND c.user_id IS NOT NULL;
    IF _visible AND me IS NOT NULL THEN RETURN QUERY SELECT me; END IF;
  ELSIF _kind = 'block' THEN
    RETURN QUERY SELECT b.id FROM public.pl_blocks b WHERE b.client_id = ANY (ids);
  ELSIF _kind = 'week' THEN
    RETURN QUERY SELECT w.id FROM public.pl_weeks w JOIN public.pl_blocks b ON b.id = w.block_id WHERE b.client_id = ANY (ids);
  ELSIF _kind = 'day' THEN
    RETURN QUERY SELECT d.id FROM public.pl_days d JOIN public.pl_weeks w ON w.id = d.week_id
      JOIN public.pl_blocks b ON b.id = w.block_id WHERE b.client_id = ANY (ids);
  ELSIF _kind = 'nutrition_target' THEN
    RETURN QUERY SELECT t.id FROM public.nutrition_targets t WHERE t.client_id = ANY (ids);
  ELSIF _kind = 'nf_submission' THEN
    RETURN QUERY SELECT s.id FROM public.nf_submissions s WHERE s.client_id = ANY (ids);
  ELSE
    RAISE EXCEPTION 'Unknown fence kind %', _kind;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.tenant_fence_ids(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tenant_fence_ids(text, boolean) TO authenticated, service_role;

/** The fence's expression for one column and kind. */
CREATE OR REPLACE FUNCTION public.tenant_fence_expr(_col text, _kind text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT format(
    'CASE (SELECT public.tenant_fence_mode()) WHEN ''open'' THEN true '
    || 'WHEN ''hide'' THEN (%1$I IS NULL OR %1$I NOT IN (SELECT public.tenant_fence_ids(%2$L, false))) '
    || 'ELSE (%1$I IN (SELECT public.tenant_fence_ids(%2$L, true))) END',
    _col, _kind)
$$;

/**
 * Platform records the owner keeps whatever business a person coaches with:
 * money (JF Effect's own sales, ledger, AI credit packs, promo codes, books),
 * legal acceptance and consent evidence, and account lifecycle; plus the
 * businesses' own team tables, which their policies already scope. Never
 * opened to an independent business by any policy; left outside the fence so
 * JF Effect's books and legal records stay whole.
 */
CREATE TABLE IF NOT EXISTS public.tenant_fence_platform_tables (
  table_name text PRIMARY KEY,
  why text NOT NULL
);
INSERT INTO public.tenant_fence_platform_tables (table_name, why) VALUES
  ('purchase_records', 'JF Effect''s sales'),
  ('payment_ledger', 'JF Effect''s money in and out'),
  ('ai_credit_purchases', 'JF Effect''s AI credit pack sales'),
  ('auto_pay_changes', 'JF Effect''s Stripe auto-pay'),
  ('billing_audit_log', 'JF Effect''s billing record'),
  ('billing_migration_reviews', 'JF Effect''s billing record'),
  ('client_account_credits', 'JF Effect''s account credits'),
  ('financial_audit_events', 'JF Effect''s books'),
  ('legacy_billing_records', 'JF Effect''s books'),
  ('promo_code_redemptions', 'JF Effect''s discounts'),
  ('session_ledger_events', 'JF Effect''s session credits'),
  ('legal_acceptances', 'acceptance evidence for JF Effect''s own terms'),
  ('legal_consent_preferences', 'consent evidence for JF Effect''s own terms'),
  ('account_deletions', 'platform account lifecycle'),
  ('account_lifecycle_events', 'platform account lifecycle'),
  ('sms_log', 'JF Effect''s text messaging cost and delivery record'),
  ('jf_notification_attempts', 'JF Effect''s notification record'),
  ('organization_members', 'who works in each business: its own policies decide'),
  ('organization_member_permissions', 'a business''s permission changes: its own policies decide')
ON CONFLICT (table_name) DO UPDATE SET why = EXCLUDED.why;

/** Tables keyed by something other than a client_id: the column and its kind. */
CREATE TABLE IF NOT EXISTS public.tenant_fence_registry (
  table_name text PRIMARY KEY,
  column_name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('client', 'user', 'block', 'week', 'day', 'nutrition_target', 'nf_submission')),
  why text NOT NULL
);
INSERT INTO public.tenant_fence_registry (table_name, column_name, kind, why) VALUES
  ('clients', 'id', 'client', 'the client records themselves'),
  ('pl_weeks', 'block_id', 'block', 'program weeks'),
  ('pl_days', 'week_id', 'week', 'program days'),
  ('pl_exercise_rows', 'day_id', 'day', 'prescribed exercises'),
  ('nutrition_target_days', 'target_id', 'nutrition_target', 'a plan''s days and meals'),
  ('nf_answers', 'submission_id', 'nf_submission', 'form answers'),
  ('progress_bodyweight', 'user_id', 'user', 'weigh-ins'),
  ('progress_measurements', 'user_id', 'user', 'measurements'),
  ('progress_check_in_schedules', 'user_id', 'user', 'progress schedules'),
  ('progress_consents', 'user_id', 'user', 'progress photo consent'),
  ('progress_media', 'user_id', 'user', 'progress photos and videos'),
  ('progress_water_entries', 'user_id', 'user', 'water'),
  ('progress_water_targets', 'user_id', 'user', 'water targets'),
  ('member_bodyweight_logs', 'user_id', 'user', 'weigh-ins'),
  ('member_meal_logs', 'user_id', 'user', 'food log'),
  ('member_meal_presets', 'user_id', 'user', 'saved meals'),
  ('member_supplement_logs', 'user_id', 'user', 'supplements taken'),
  ('member_supplements', 'user_id', 'user', 'supplements'),
  ('member_exercise_notes', 'user_id', 'user', 'exercise notes'),
  ('member_exercise_unit_prefs', 'user_id', 'user', 'unit choices'),
  ('wearable_connections', 'user_id', 'user', 'wearables'),
  ('wearable_daily_metrics', 'user_id', 'user', 'wearable data'),
  ('workout_view_prefs', 'user_id', 'user', 'logger preferences'),
  ('bodyweight_unit_prefs', 'user_id', 'user', 'unit choices')
ON CONFLICT (table_name) DO UPDATE SET column_name = EXCLUDED.column_name, kind = EXCLUDED.kind, why = EXCLUDED.why;

/** Every table the fence is for: each uuid client_id column (but the platform's records) and the registry. */
CREATE OR REPLACE FUNCTION public.tenant_fence_targets()
RETURNS TABLE (table_name text, column_name text, kind text, rls_on boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT c.relname::text, a.attname::text, 'client'::text, c.relrowsecurity
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'client_id' AND NOT a.attisdropped
   WHERE c.relkind IN ('r', 'p')
     AND a.atttypid = 'uuid'::regtype
     AND c.relname NOT IN (SELECT p.table_name FROM public.tenant_fence_platform_tables p)
     AND c.relname NOT IN (SELECT r.table_name FROM public.tenant_fence_registry r)
  UNION ALL
  SELECT r.table_name, r.column_name, r.kind, c.relrowsecurity
    FROM public.tenant_fence_registry r
    JOIN pg_class c ON c.relname = r.table_name AND c.relkind IN ('r', 'p')
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
$$;
REVOKE ALL ON FUNCTION public.tenant_fence_targets() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_fence_targets() TO service_role;

/** Put the fence on every table it's for (and on any added since). Idempotent. */
CREATE OR REPLACE FUNCTION public.tenant_fence_apply()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  t record;
  e text;
  n int := 0;
BEGIN
  FOR t IN SELECT * FROM public.tenant_fence_targets() ORDER BY 1 LOOP
    e := public.tenant_fence_expr(t.column_name, t.kind);
    EXECUTE format('DROP POLICY IF EXISTS tenant_fence ON public.%I', t.table_name);
    EXECUTE format('CREATE POLICY tenant_fence ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (%s) WITH CHECK (%s)',
                   t.table_name, e, e);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.tenant_fence_apply() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_fence_apply() TO service_role;

/**
 * What the fence covers and what still needs a decision: every target with
 * its policy (and whether RLS is on, without which no policy applies), and
 * every RLS table keyed by a user_id that isn't fenced or named.
 */
CREATE OR REPLACE FUNCTION public.tenant_fence_report()
RETURNS TABLE (table_name text, column_name text, kind text, status text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT t.table_name, t.column_name, t.kind,
         CASE
           WHEN NOT t.rls_on THEN 'rls_off'
           WHEN EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = t.table_name
                         AND p.policyname = 'tenant_fence' AND p.permissive = 'RESTRICTIVE') THEN 'fenced'
           ELSE 'unfenced'
         END
    FROM public.tenant_fence_targets() t
  UNION ALL
  SELECT c.relname::text, 'user_id', 'user', 'undecided'
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'user_id' AND NOT a.attisdropped
   WHERE c.relkind IN ('r', 'p') AND c.relrowsecurity
     AND NOT EXISTS (SELECT 1 FROM pg_attribute a2 WHERE a2.attrelid = c.oid AND a2.attname = 'client_id' AND NOT a2.attisdropped)
     AND c.relname NOT IN (SELECT r.table_name FROM public.tenant_fence_registry r)
     AND c.relname NOT IN (SELECT p.table_name FROM public.tenant_fence_platform_tables p)
$$;
REVOKE ALL ON FUNCTION public.tenant_fence_report() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_fence_report() TO service_role;

-- ── seats ────────────────────────────────────────────────────────────────
/**
 * Count a business's billable clients and keep its billing row in step. A
 * seat is an active relationship with a client who signed in to accept it,
 * whose record isn't archived, deactivated or deleted, and who isn't on the
 * business's own team. One seat per person (a record is one person). Pending
 * invitations, paused and ended relationships are free. The same rule as
 * countSeats() in src/lib/coach-platform/seat-pricing.ts.
 */
CREATE OR REPLACE FUNCTION public._org_seats_refresh(_org uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  n int;
  free_n int;
  b public.organization_billing;
BEGIN
  SELECT * INTO b FROM public.organization_billing WHERE org_id = _org FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT count(DISTINCT c.id) INTO n
    FROM public.organization_clients oc
    JOIN public.clients c ON c.id = oc.client_id
   WHERE oc.org_id = _org AND oc.status = 'active'
     AND c.user_id IS NOT NULL
     AND coalesce(c.archived, false) = false
     AND c.status NOT IN ('Deactivated', 'Deleted')
     AND NOT EXISTS (SELECT 1 FROM public.organization_members m
                      WHERE m.org_id = _org AND m.user_id = c.user_id AND m.status = 'active');
  free_n := least(3, greatest(0, coalesce((b.pricing ->> 'free_clients')::int, 1)));
  IF n IS DISTINCT FROM b.seats THEN
    UPDATE public.organization_billing
       SET seats = n,
           paid_seats = greatest(0, n - free_n),
           seat_revision = seat_revision + 1,
           needs_setup_since = CASE
             WHEN greatest(0, n - free_n) > 0 AND stripe_subscription_id IS NULL THEN coalesce(needs_setup_since, now())
             WHEN greatest(0, n - free_n) = 0 THEN NULL
             ELSE needs_setup_since END,
           state = CASE
             WHEN state = 'free' AND greatest(0, n - free_n) > 0 AND stripe_subscription_id IS NULL THEN 'needs_setup'
             WHEN state = 'needs_setup' AND greatest(0, n - free_n) = 0 THEN 'free'
             ELSE state END,
           updated_at = now()
     WHERE org_id = _org;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public._org_seats_refresh(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._org_seats_refresh(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.tg_org_clients_seats()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN PERFORM public._org_seats_refresh(OLD.org_id); END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN PERFORM public._org_seats_refresh(NEW.org_id); END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.tg_org_clients_seats() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS org_clients_seats ON public.organization_clients;
CREATE TRIGGER org_clients_seats
  AFTER INSERT OR UPDATE OR DELETE ON public.organization_clients
  FOR EACH ROW EXECUTE FUNCTION public.tg_org_clients_seats();

-- a record archived, deactivated or put back changes the count too
CREATE OR REPLACE FUNCTION public.tg_org_client_record_seats()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.organization_id <> public.jf_org_id()
     AND (NEW.archived IS DISTINCT FROM OLD.archived OR NEW.status IS DISTINCT FROM OLD.status OR NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
    PERFORM public._org_seats_refresh(NEW.organization_id);
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.tg_org_client_record_seats() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS clients_org_seats ON public.clients;
CREATE TRIGGER clients_org_seats
  AFTER UPDATE OF archived, status, user_id ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.tg_org_client_record_seats();

-- someone joining or leaving the team changes who's a staff member, not a seat
CREATE OR REPLACE FUNCTION public.tg_org_members_seats()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public._org_seats_refresh(coalesce(NEW.org_id, OLD.org_id));
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.tg_org_members_seats() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS org_members_seats ON public.organization_members;
CREATE TRIGGER org_members_seats
  AFTER INSERT OR UPDATE OF status OR DELETE ON public.organization_members
  FOR EACH ROW EXECUTE FUNCTION public.tg_org_members_seats();

-- ── making a pilot workspace (the platform owner, by hand) ───────────────
/**
 * The platform owner makes an invite-only pilot workspace for a coach who
 * already has a login. Refused while the pilot is off, for anyone but an admin
 * (with their two-step sign-in), and for JF Effect itself. The business gets
 * the platform's price as it stands, frozen on its billing row.
 */
CREATE OR REPLACE FUNCTION public.coach_workspace_create(
  _owner uuid, _name text, _slug text, _country text, _region text, _time_zone text DEFAULT 'America/Winnipeg'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  org uuid;
  p jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only the platform owner makes a coach workspace' USING ERRCODE = '42501';
  END IF;
  IF NOT public.coach_workspaces_pilot_on() THEN
    RAISE EXCEPTION 'Coach workspaces are off' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = _owner) THEN
    RAISE EXCEPTION 'That login doesn''t exist' USING ERRCODE = 'P0002';
  END IF;
  p := public.coach_platform_settings();
  INSERT INTO public.organizations (kind, name, slug, status, owner_user_id, country, region, time_zone, created_by, pilot)
  VALUES ('independent', btrim(_name), lower(btrim(_slug)), 'active', _owner, _country, nullif(btrim(_region), ''),
          coalesce(nullif(btrim(_time_zone), ''), 'America/Winnipeg'), auth.uid(), true)
  RETURNING id INTO org;
  INSERT INTO public.organization_members (org_id, user_id, role) VALUES (org, _owner, 'owner');
  INSERT INTO public.organization_billing (org_id, pricing)
  VALUES (org, jsonb_build_object(
    'free_clients', p -> 'free_clients', 'per_client_cents', p -> 'per_client_cents',
    'volume_from', p -> 'volume_from', 'volume_cents', p -> 'volume_cents', 'currency', 'CAD',
    'frozen_at', now()));
  PERFORM public._org_audit(org, 'organization.created', 'organization', org,
    'Pilot workspace made for ' || btrim(_name), jsonb_build_object('owner', _owner));
  RETURN org;
END $$;
REVOKE ALL ON FUNCTION public.coach_workspace_create(uuid, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coach_workspace_create(uuid, text, text, text, text, text) TO authenticated;

/**
 * Turn the invite-only pilot on or off (the platform owner). It can't go on
 * while any table the fence is for is unfenced or has RLS off.
 */
CREATE OR REPLACE FUNCTION public.coach_workspaces_set_pilot(_on boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE gaps text[];
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only the platform owner' USING ERRCODE = '42501';
  END IF;
  IF _on THEN
    SELECT array_agg(table_name ORDER BY table_name) INTO gaps
      FROM public.tenant_fence_report() WHERE status IN ('unfenced', 'rls_off');
    IF gaps IS NOT NULL THEN
      RAISE EXCEPTION 'The fence isn''t on every client table yet: %', array_to_string(gaps, ', ') USING ERRCODE = '55000';
    END IF;
  END IF;
  INSERT INTO public.app_settings (key, value, updated_at)
  VALUES ('coach_workspaces', jsonb_build_object('pilot', _on, 'changed_by', auth.uid(), 'changed_at', now())::text, now())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  PERFORM public._org_audit(public.jf_org_id(), CASE WHEN _on THEN 'pilot.on' ELSE 'pilot.off' END, 'organization',
    public.jf_org_id(), CASE WHEN _on THEN 'Coach workspace pilot switched on' ELSE 'Coach workspace pilot switched off' END);
  RETURN jsonb_build_object('pilot', _on);
END $$;
REVOKE ALL ON FUNCTION public.coach_workspaces_set_pilot(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coach_workspaces_set_pilot(boolean) TO authenticated;

-- ── invitations ──────────────────────────────────────────────────────────
/**
 * Invite a client (clients.invite: a coach's are theirs, an admin or owner may
 * assign anyone on the team) or a teammate (members.manage, the owner). The
 * server makes the token and sends only its SHA-256; asking again for the same
 * email replaces the open invitation's token and expiry. 30 a day per business.
 */
CREATE OR REPLACE FUNCTION public.org_invite(
  _org uuid, _kind text, _email text, _token_hash text, _role text DEFAULT NULL, _assign_to uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  e text := lower(btrim(_email));
  assignee uuid := _assign_to;
  inv uuid;
BEGIN
  IF NOT public.coach_workspaces_pilot_on() THEN
    RAISE EXCEPTION 'Coach workspaces are off' USING ERRCODE = '55000';
  END IF;
  IF NOT public.org_can_write(_org) THEN
    RAISE EXCEPTION 'This workspace can''t invite anyone right now' USING ERRCODE = '42501';
  END IF;
  IF _kind = 'client' THEN
    IF NOT public.has_org_permission(_org, 'clients.invite') THEN
      RAISE EXCEPTION 'You can''t invite clients here' USING ERRCODE = '42501';
    END IF;
    IF NOT public.has_org_permission(_org, 'clients.manage') THEN
      assignee := auth.uid();  -- a coach's invitations are theirs
    END IF;
    IF assignee IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.organization_members
         WHERE org_id = _org AND user_id = assignee AND status = 'active' AND role IN ('owner', 'admin', 'coach')) THEN
      RAISE EXCEPTION 'They aren''t a coach here' USING ERRCODE = '22023';
    END IF;
    _role := NULL;
  ELSIF _kind = 'member' THEN
    IF NOT public.has_org_permission(_org, 'members.manage') THEN
      RAISE EXCEPTION 'Only the owner invites teammates' USING ERRCODE = '42501';
    END IF;
    IF _role NOT IN ('admin', 'coach') THEN
      RAISE EXCEPTION 'A teammate is an admin or a coach' USING ERRCODE = '22023';
    END IF;
    assignee := NULL;
  ELSE
    RAISE EXCEPTION 'Unknown invitation' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM public.organization_invitations
       WHERE org_id = _org AND created_at > now() - interval '1 day') >= 30 THEN
    RAISE EXCEPTION 'That''s the most invitations a workspace sends in a day' USING ERRCODE = '54000';
  END IF;

  UPDATE public.organization_invitations
     SET token_hash = _token_hash, invited_by = auth.uid(), role = _role, assign_to = assignee,
         created_at = now(), expires_at = now() + interval '14 days', failed_tries = 0
   WHERE org_id = _org AND kind = _kind AND email = e AND accepted_at IS NULL AND revoked_at IS NULL
  RETURNING id INTO inv;
  IF inv IS NULL THEN
    INSERT INTO public.organization_invitations (org_id, kind, email, role, assign_to, token_hash, invited_by, expires_at)
    VALUES (_org, _kind, e, _role, assignee, _token_hash, auth.uid(), now() + interval '14 days')
    RETURNING id INTO inv;
  END IF;
  PERFORM public._org_audit(_org, 'invitation.sent', CASE WHEN _kind = 'client' THEN 'client' ELSE 'member' END, inv,
    CASE WHEN _kind = 'client' THEN 'Client invitation sent to ' ELSE 'Teammate invitation sent to ' END || e,
    jsonb_build_object('role', _role, 'assign_to', assignee));
  RETURN inv;
END $$;
REVOKE ALL ON FUNCTION public.org_invite(uuid, text, text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_invite(uuid, text, text, text, text, uuid) TO authenticated;

/** Cancel an open invitation (clients.manage for a client's, the owner for a teammate's, or whoever sent it). */
CREATE OR REPLACE FUNCTION public.org_invitation_revoke(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE i public.organization_invitations;
BEGIN
  SELECT * INTO i FROM public.organization_invitations WHERE id = _id FOR UPDATE;
  IF NOT FOUND OR NOT (
       i.invited_by = auth.uid() AND i.org_id IN (SELECT public.my_org_ids())
       OR public.has_org_permission(i.org_id, CASE WHEN i.kind = 'client' THEN 'clients.manage' ELSE 'members.manage' END)) THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = 'P0002';
  END IF;
  IF i.accepted_at IS NOT NULL OR i.revoked_at IS NOT NULL THEN RETURN; END IF;
  UPDATE public.organization_invitations SET revoked_at = now(), revoked_by = auth.uid() WHERE id = _id;
  PERFORM public._org_audit(i.org_id, 'invitation.revoked', CASE WHEN i.kind = 'client' THEN 'client' ELSE 'member' END, i.id,
    'Invitation to ' || i.email || ' cancelled');
END $$;
REVOKE ALL ON FUNCTION public.org_invitation_revoke(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_invitation_revoke(uuid) TO authenticated;

/**
 * What an invitation link shows before it's accepted (no sign-in needed to
 * look, nothing about anyone else): the business's name, what it's for, and
 * whether it can still be accepted. A token that isn't one says 'invalid',
 * never which part was wrong.
 */
CREATE OR REPLACE FUNCTION public.org_invitation_peek(_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  i public.organization_invitations;
  o public.organizations;
BEGIN
  SELECT * INTO i FROM public.organization_invitations
   WHERE token_hash = encode(sha256(convert_to(coalesce(_token, ''), 'UTF8')), 'hex');
  IF NOT FOUND THEN RETURN jsonb_build_object('state', 'invalid'); END IF;
  SELECT * INTO o FROM public.organizations WHERE id = i.org_id;
  RETURN jsonb_build_object(
    'state', CASE
      WHEN i.accepted_at IS NOT NULL THEN 'accepted'
      WHEN i.revoked_at IS NOT NULL THEN 'cancelled'
      WHEN i.expires_at <= now() THEN 'expired'
      WHEN i.failed_tries >= 5 THEN 'locked'
      WHEN o.status <> 'active' OR NOT public.coach_workspaces_pilot_on() THEN 'unavailable'
      ELSE 'open' END,
    'kind', i.kind,
    'role', i.role,
    'business', o.name,
    'expires_at', i.expires_at);
END $$;
REVOKE ALL ON FUNCTION public.org_invitation_peek(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.org_invitation_peek(text) TO anon, authenticated;

/**
 * Accept an invitation as the signed-in person. The link is only half of it:
 * their login's confirmed email must be the one invited (5 wrong logins and
 * the link locks). A client invitation makes their record in that business
 * and starts the relationship with their consent, word for word; in the pilot
 * a login that already trains with JF Effect or another business is refused
 * (one record per login). A teammate invitation adds them to the team; it
 * never gives a JF Effect role.
 */
CREATE OR REPLACE FUNCTION public.org_invitation_accept(_token text, _consent_version text, _consent_text text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  me uuid := auth.uid();
  my_email text;
  confirmed boolean;
  i public.organization_invitations;
  o public.organizations;
  existing public.clients;
  had_record boolean;
  cid uuid;
  nm text;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Sign in first' USING ERRCODE = '42501'; END IF;
  SELECT * INTO i FROM public.organization_invitations
   WHERE token_hash = encode(sha256(convert_to(coalesce(_token, ''), 'UTF8')), 'hex')
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This invitation isn''t valid' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO o FROM public.organizations WHERE id = i.org_id;
  IF i.accepted_at IS NOT NULL OR i.revoked_at IS NOT NULL OR i.expires_at <= now() OR i.failed_tries >= 5
     OR o.status <> 'active' OR o.kind <> 'independent' OR NOT public.coach_workspaces_pilot_on() THEN
    RAISE EXCEPTION 'This invitation can''t be accepted any more' USING ERRCODE = '55000';
  END IF;

  SELECT lower(u.email), (u.email_confirmed_at IS NOT NULL) INTO my_email, confirmed FROM auth.users u WHERE u.id = me;
  IF my_email IS DISTINCT FROM i.email OR NOT coalesce(confirmed, false) THEN
    UPDATE public.organization_invitations SET failed_tries = failed_tries + 1 WHERE id = i.id;
    RETURN jsonb_build_object('ok', false, 'reason', 'wrong_login');
  END IF;

  IF i.kind = 'member' THEN
    INSERT INTO public.organization_members (org_id, user_id, role) VALUES (i.org_id, me, i.role)
    ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role, status = 'active', revoked_at = NULL, updated_at = now();
    UPDATE public.organization_invitations SET accepted_at = now(), accepted_by = me WHERE id = i.id;
    PERFORM public._org_audit(i.org_id, 'member.joined', 'member', me, i.email || ' joined as ' || i.role);
    RETURN jsonb_build_object('ok', true, 'kind', 'member', 'org_id', i.org_id, 'business', o.name);
  END IF;

  -- a client: one record per login
  IF _consent_version IS NULL OR length(btrim(coalesce(_consent_text, ''))) < 20 THEN
    RAISE EXCEPTION 'Agree to share your records with your coach first' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.organization_members WHERE org_id = i.org_id AND user_id = me AND status = 'active') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'on_team');
  END IF;
  SELECT * INTO existing FROM public.clients WHERE user_id = me ORDER BY created_at LIMIT 1;
  had_record := FOUND;
  IF had_record AND existing.organization_id <> i.org_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_athlete');
  END IF;

  PERFORM set_config('jf.org_client_write', 'on', true);
  IF had_record THEN
    cid := existing.id;  -- coming back to the same business
    UPDATE public.clients SET archived = false, status = 'Active' WHERE id = cid AND (archived OR status <> 'Active');
  ELSE
    SELECT coalesce(nullif(btrim(p.full_name), ''), split_part(i.email, '@', 1)) INTO nm
      FROM auth.users u LEFT JOIN public.profiles p ON p.id = u.id WHERE u.id = me;
    INSERT INTO public.clients (user_id, full_name, email, organization_id, service_tier, status)
    VALUES (me, nm, i.email, i.org_id, 'org_coaching', 'Active')
    RETURNING id INTO cid;
  END IF;
  PERFORM set_config('jf.org_client_write', 'off', true);

  INSERT INTO public.organization_clients (org_id, client_id, status, assigned_user_id, invitation_id, consent_version, consent_text, consented_at, started_at)
  VALUES (i.org_id, cid, 'active', i.assign_to, i.id, _consent_version, btrim(_consent_text), now(), now())
  ON CONFLICT (org_id, client_id) DO UPDATE
    SET status = 'active', assigned_user_id = coalesce(EXCLUDED.assigned_user_id, organization_clients.assigned_user_id),
        invitation_id = EXCLUDED.invitation_id, consent_version = EXCLUDED.consent_version, consent_text = EXCLUDED.consent_text,
        consented_at = now(), started_at = now(), paused_at = NULL, ended_at = NULL, ended_by = NULL, end_reason = NULL, updated_at = now();
  UPDATE public.organization_invitations SET accepted_at = now(), accepted_by = me WHERE id = i.id;
  PERFORM public._org_audit(i.org_id, 'client.joined', 'client', cid, i.email || ' accepted their invitation',
    jsonb_build_object('consent_version', _consent_version));
  RETURN jsonb_build_object('ok', true, 'kind', 'client', 'org_id', i.org_id, 'client_id', cid, 'business', o.name);
END $$;
REVOKE ALL ON FUNCTION public.org_invitation_accept(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_invitation_accept(text, text, text) TO authenticated;

-- ── the relationship ─────────────────────────────────────────────────────
/**
 * End, pause or resume a client's relationship. The business ends or pauses
 * it with clients.manage; the client ends it themselves (client_left). Ending
 * stops the business's access at once and deletes nothing; resuming an ended
 * relationship takes a new invitation (the client's consent again).
 */
CREATE OR REPLACE FUNCTION public.org_client_set_status(_org uuid, _client uuid, _status text, _reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r public.organization_clients;
  is_client boolean;
BEGIN
  SELECT * INTO r FROM public.organization_clients WHERE org_id = _org AND client_id = _client FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not found' USING ERRCODE = 'P0002'; END IF;
  is_client := EXISTS (SELECT 1 FROM public.clients WHERE id = _client AND user_id = auth.uid());
  IF is_client AND _status = 'ended' THEN
    _reason := 'client_left';
  ELSIF NOT public.has_org_permission(_org, 'clients.manage') THEN
    RAISE EXCEPTION 'Not found' USING ERRCODE = 'P0002';
  END IF;
  IF _status NOT IN ('active', 'paused', 'ended') THEN RAISE EXCEPTION 'Unknown status' USING ERRCODE = '22023'; END IF;
  IF r.status = _status THEN RETURN; END IF;
  IF r.status = 'ended' THEN
    RAISE EXCEPTION 'An ended relationship starts again only with a new invitation' USING ERRCODE = '55000';
  END IF;
  IF _status = 'ended' AND coalesce(_reason, 'coach_ended') NOT IN ('coach_ended', 'client_left', 'org_closed', 'account_deleted') THEN
    RAISE EXCEPTION 'Unknown reason' USING ERRCODE = '22023';
  END IF;
  UPDATE public.organization_clients
     SET status = _status,
         paused_at = CASE WHEN _status = 'paused' THEN now() ELSE NULL END,
         ended_at = CASE WHEN _status = 'ended' THEN now() ELSE NULL END,
         ended_by = CASE WHEN _status = 'ended' THEN auth.uid() ELSE NULL END,
         end_reason = CASE WHEN _status = 'ended' THEN coalesce(_reason, 'coach_ended') ELSE NULL END,
         updated_at = now()
   WHERE org_id = _org AND client_id = _client;
  PERFORM public._org_audit(_org, 'client.' || _status, 'client', _client,
    CASE _status WHEN 'ended' THEN 'Coaching ended (' || coalesce(_reason, 'coach_ended') || ')'
                 WHEN 'paused' THEN 'Coaching paused' ELSE 'Coaching resumed' END);
END $$;
REVOKE ALL ON FUNCTION public.org_client_set_status(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_client_set_status(uuid, uuid, text, text) TO authenticated;

/** Give a client to a coach on the team (clients.manage), or to nobody (the owner and admins still see them). */
CREATE OR REPLACE FUNCTION public.org_client_assign(_org uuid, _client uuid, _user uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_org_permission(_org, 'clients.manage') THEN RAISE EXCEPTION 'Not found' USING ERRCODE = 'P0002'; END IF;
  IF _user IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.organization_members
       WHERE org_id = _org AND user_id = _user AND status = 'active' AND role IN ('owner', 'admin', 'coach')) THEN
    RAISE EXCEPTION 'They aren''t a coach here' USING ERRCODE = '22023';
  END IF;
  UPDATE public.organization_clients SET assigned_user_id = _user, updated_at = now()
   WHERE org_id = _org AND client_id = _client AND status <> 'ended';
  IF NOT FOUND THEN RAISE EXCEPTION 'Not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public._org_audit(_org, 'client.assigned', 'client', _client, 'Client assigned', jsonb_build_object('to', _user));
END $$;
REVOKE ALL ON FUNCTION public.org_client_assign(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_client_assign(uuid, uuid, uuid) TO authenticated;

-- ── the team ─────────────────────────────────────────────────────────────
/**
 * The owner changes a teammate's role or takes them off the team. The last
 * owner can't leave or be demoted. A coach taken off the team leaves their
 * clients unassigned (the owner sees them), never deleted.
 */
CREATE OR REPLACE FUNCTION public.org_member_set(_org uuid, _user uuid, _role text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE cur public.organization_members;
BEGIN
  IF NOT public.has_org_permission(_org, 'members.manage') THEN RAISE EXCEPTION 'Only the owner' USING ERRCODE = '42501'; END IF;
  SELECT * INTO cur FROM public.organization_members WHERE org_id = _org AND user_id = _user FOR UPDATE;
  IF NOT FOUND OR cur.status <> 'active' THEN RAISE EXCEPTION 'Not on the team' USING ERRCODE = 'P0002'; END IF;
  IF cur.role = 'owner' AND coalesce(_role, 'removed') <> 'owner'
     AND (SELECT count(*) FROM public.organization_members WHERE org_id = _org AND role = 'owner' AND status = 'active') <= 1 THEN
    RAISE EXCEPTION 'A workspace always has an owner' USING ERRCODE = '55000';
  END IF;
  IF _role IS NULL THEN
    UPDATE public.organization_members SET status = 'revoked', revoked_at = now(), updated_at = now()
     WHERE org_id = _org AND user_id = _user;
    UPDATE public.organization_clients SET assigned_user_id = NULL, updated_at = now()
     WHERE org_id = _org AND assigned_user_id = _user;
    DELETE FROM public.organization_member_permissions WHERE org_id = _org AND user_id = _user;
    PERFORM public._org_audit(_org, 'member.revoked', 'member', _user, 'Taken off the team', jsonb_build_object('role', cur.role));
  ELSIF _role IN ('owner', 'admin', 'coach') THEN
    UPDATE public.organization_members SET role = _role, updated_at = now() WHERE org_id = _org AND user_id = _user;
    PERFORM public._org_audit(_org, 'member.role_changed', 'member', _user, 'Now ' || _role || ' (was ' || cur.role || ')');
  ELSE
    RAISE EXCEPTION 'Unknown role' USING ERRCODE = '22023';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.org_member_set(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_member_set(uuid, uuid, text) TO authenticated;

/** The owner adds or takes away one key from one teammate (never an owner-only key). */
CREATE OR REPLACE FUNCTION public.org_member_permission_set(_org uuid, _user uuid, _key text, _granted boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_org_permission(_org, 'members.manage') THEN RAISE EXCEPTION 'Only the owner' USING ERRCODE = '42501'; END IF;
  IF _granted IS NULL THEN
    DELETE FROM public.organization_member_permissions WHERE org_id = _org AND user_id = _user AND key = _key;
  ELSE
    INSERT INTO public.organization_member_permissions (org_id, user_id, key, granted, set_by)
    VALUES (_org, _user, _key, _granted, auth.uid())
    ON CONFLICT (org_id, user_id, key) DO UPDATE SET granted = EXCLUDED.granted, set_by = auth.uid(), updated_at = now();
  END IF;
  PERFORM public._org_audit(_org, 'member.permission', 'member', _user,
    _key || CASE WHEN _granted IS NULL THEN ' back to the role''s default' WHEN _granted THEN ' given' ELSE ' taken away' END);
END $$;
REVOKE ALL ON FUNCTION public.org_member_permission_set(uuid, uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_member_permission_set(uuid, uuid, text, boolean) TO authenticated;

-- ── support access ───────────────────────────────────────────────────────
/** The platform owner asks a business for a look (≤ 72 hours, a reason the business owner reads). */
CREATE OR REPLACE FUNCTION public.support_access_request(_org uuid, _reason text, _hours int)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE g uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN RAISE EXCEPTION 'Only the platform owner' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = _org AND kind = 'independent') THEN
    RAISE EXCEPTION 'Not found' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.support_access_grants (org_id, granted_to, reason, hours)
  VALUES (_org, auth.uid(), btrim(_reason), _hours) RETURNING id INTO g;
  PERFORM public._org_audit(_org, 'support.requested', 'organization', g, 'JF Effect support asked for ' || _hours || ' hours: ' || left(btrim(_reason), 200));
  RETURN g;
END $$;
REVOKE ALL ON FUNCTION public.support_access_request(uuid, text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_access_request(uuid, text, int) TO authenticated;

/** The business's owner approves (the clock starts then) or either side ends it. */
CREATE OR REPLACE FUNCTION public.support_access_decide(_grant uuid, _approve boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE g public.support_access_grants;
BEGIN
  SELECT * INTO g FROM public.support_access_grants WHERE id = _grant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not found' USING ERRCODE = 'P0002'; END IF;
  IF _approve THEN
    IF NOT public.has_org_permission(g.org_id, 'support.approve') THEN RAISE EXCEPTION 'Only the business''s owner' USING ERRCODE = '42501'; END IF;
    IF g.approved_at IS NOT NULL OR g.revoked_at IS NOT NULL THEN RETURN; END IF;
    UPDATE public.support_access_grants SET approved_by = auth.uid(), approved_at = now(), expires_at = now() + make_interval(hours => g.hours)
     WHERE id = _grant;
    PERFORM public._org_audit(g.org_id, 'support.approved', 'organization', g.id, 'Support access approved for ' || g.hours || ' hours');
  ELSE
    IF NOT (public.has_org_permission(g.org_id, 'support.approve') OR g.granted_to = auth.uid()) THEN
      RAISE EXCEPTION 'Not found' USING ERRCODE = 'P0002';
    END IF;
    IF g.revoked_at IS NOT NULL THEN RETURN; END IF;
    UPDATE public.support_access_grants SET revoked_by = auth.uid(), revoked_at = now() WHERE id = _grant;
    PERFORM public._org_audit(g.org_id, 'support.ended', 'organization', g.id, 'Support access ended');
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.support_access_decide(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_access_decide(uuid, boolean) TO authenticated;

-- ── reads for the workspace screens ──────────────────────────────────────
/** A business's AI spend since a moment (billing.view), for the allowance. */
CREATE OR REPLACE FUNCTION public.org_ai_spend(_org uuid, _since timestamptz)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE WHEN public.has_org_permission(_org, 'billing.view') OR public.has_role(auth.uid(), 'admin'::app_role)
    THEN (SELECT jsonb_build_object('cost_micro_usd', coalesce(sum(cost_micro_usd), 0), 'calls', count(*) FILTER (WHERE NOT refused),
                                    'refused', count(*) FILTER (WHERE refused))
            FROM public.org_ai_usage WHERE org_id = _org AND created_at >= _since)
    ELSE NULL END
$$;
REVOKE ALL ON FUNCTION public.org_ai_spend(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_ai_spend(uuid, timestamptz) TO authenticated, service_role;

-- ── AI metering (the server's only) ─────────────────────────────────────
/**
 * A business's AI this month, in its own time zone: allowance credits used,
 * bought credits left, and what calls really cost this month and today.
 */
CREATE OR REPLACE FUNCTION public.org_ai_state(_org uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH o AS (
    SELECT (date_trunc('month', now() AT TIME ZONE coalesce(time_zone, 'UTC')) AT TIME ZONE coalesce(time_zone, 'UTC')) AS month_start,
           (date_trunc('day', now() AT TIME ZONE coalesce(time_zone, 'UTC')) AT TIME ZONE coalesce(time_zone, 'UTC')) AS day_start
      FROM public.organizations WHERE id = _org
  )
  SELECT jsonb_build_object(
    'used', coalesce((SELECT sum(u.credits) FROM public.org_ai_usage u, o
                       WHERE u.org_id = _org AND u.source = 'allowance' AND u.status <> 'refunded' AND u.created_at >= o.month_start), 0),
    'purchased_left', coalesce((SELECT sum(g.credits) FROM public.org_ai_credit_grants g WHERE g.org_id = _org), 0)
                    - coalesce((SELECT sum(u.credits) FROM public.org_ai_usage u
                                 WHERE u.org_id = _org AND u.source = 'purchased' AND u.status <> 'refunded'), 0),
    'spent_micro_usd', coalesce((SELECT sum(u.cost_micro_usd) FROM public.org_ai_usage u, o
                                  WHERE u.org_id = _org AND u.created_at >= o.month_start), 0),
    'spent_today_micro_usd', coalesce((SELECT sum(u.cost_micro_usd) FROM public.org_ai_usage u, o
                                        WHERE u.org_id = _org AND u.created_at >= o.day_start), 0))
$$;
REVOKE ALL ON FUNCTION public.org_ai_state(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.org_ai_state(uuid) TO service_role;

/**
 * Take a call's credits before the model runs, under the business's lock, so
 * two calls at once can't both spend the last credits. The rules are
 * decide()'s (src/lib/coach-platform/ai-allowance.ts): the allowance first,
 * then bought credits; the month's cap on what this call would bring the
 * real spend to; the day's on what's already spent today. Returns the use's
 * id, or why it can't run. The server passes the allowance and caps it worked
 * out from the business's paid clients.
 */
CREATE OR REPLACE FUNCTION public.org_ai_reserve(
  _org uuid, _feature text, _credits int, _estimate_micro_usd bigint,
  _allowance int, _cap_micro_usd bigint, _daily_cap_micro_usd bigint,
  _user uuid DEFAULT NULL, _client uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  st jsonb;
  left_allow int;
  left_bought int;
  src text;
  uid uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('org_ai:' || _org::text, 0));
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = _org AND kind = 'independent' AND status = 'active') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'workspace_off');
  END IF;
  st := public.org_ai_state(_org);
  left_allow := greatest(0, _allowance - (st ->> 'used')::int);
  left_bought := greatest(0, (st ->> 'purchased_left')::int);
  IF _credits <= 0 THEN src := 'included';
  ELSIF left_allow >= _credits THEN src := 'allowance';
  ELSIF left_bought >= _credits THEN src := 'purchased';
  ELSE
    RETURN jsonb_build_object('ok', false, 'reason', 'out_of_credits', 'state', st);
  END IF;
  IF (st ->> 'spent_micro_usd')::bigint + _estimate_micro_usd > _cap_micro_usd THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'monthly_cap', 'state', st);
  END IF;
  IF (st ->> 'spent_today_micro_usd')::bigint >= _daily_cap_micro_usd THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'daily_cap', 'state', st);
  END IF;
  INSERT INTO public.org_ai_usage (org_id, user_id, client_id, feature, model, credits, source, status, cost_micro_usd)
  VALUES (_org, _user, _client, _feature, 'pending', greatest(_credits, 0), src, 'reserved', 0)
  RETURNING id INTO uid;
  RETURN jsonb_build_object('ok', true, 'use_id', uid, 'source', src, 'state', public.org_ai_state(_org));
END $$;
REVOKE ALL ON FUNCTION public.org_ai_reserve(uuid, text, int, bigint, int, bigint, bigint, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.org_ai_reserve(uuid, text, int, bigint, int, bigint, bigint, uuid, uuid) TO service_role;

/**
 * After the call: its real model, tokens and cost kept, credits kept when it
 * worked and given back when it didn't (a failed or unreadable answer). The
 * cost is always kept: it counts against the cap either way. Once only.
 */
CREATE OR REPLACE FUNCTION public.org_ai_settle(
  _use uuid, _ok boolean, _model text, _input int, _cached int, _output int, _cost_micro_usd bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.org_ai_usage
     SET status = CASE WHEN _ok THEN 'settled' ELSE 'refunded' END,
         refused = NOT _ok,
         model = coalesce(nullif(btrim(_model), ''), 'unknown'),
         input_tokens = greatest(coalesce(_input, 0), 0),
         cached_tokens = greatest(coalesce(_cached, 0), 0),
         output_tokens = greatest(coalesce(_output, 0), 0),
         cost_micro_usd = greatest(coalesce(_cost_micro_usd, 0), 0),
         settled_at = now()
   WHERE id = _use AND status = 'reserved';
END $$;
REVOKE ALL ON FUNCTION public.org_ai_settle(uuid, boolean, text, int, int, int, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.org_ai_settle(uuid, boolean, text, int, int, int, bigint) TO service_role;

-- ── row-level security on the new tables ─────────────────────────────────
ALTER TABLE public.organization_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_member_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_access_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_billing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_billing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_ai_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_ai_credit_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_fence_platform_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_fence_registry ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.organization_clients, public.organization_invitations, public.organization_member_permissions,
  public.support_access_grants, public.organization_billing, public.coach_billing_events, public.org_ai_usage,
  public.org_ai_credit_grants, public.tenant_fence_platform_tables, public.tenant_fence_registry
  FROM anon, authenticated;
GRANT SELECT ON public.organization_clients, public.organization_invitations, public.organization_member_permissions,
  public.support_access_grants, public.organization_billing, public.org_ai_usage, public.org_ai_credit_grants TO authenticated;
GRANT ALL ON public.organization_clients, public.organization_invitations, public.organization_member_permissions,
  public.support_access_grants, public.organization_billing, public.coach_billing_events, public.org_ai_usage,
  public.org_ai_credit_grants, public.tenant_fence_platform_tables, public.tenant_fence_registry TO service_role;

-- the business's team sees its relationships (a coach: theirs); the client sees their own
DROP POLICY IF EXISTS "Team reads its clients' relationships" ON public.organization_clients;
CREATE POLICY "Team reads its clients' relationships" ON public.organization_clients
  FOR SELECT TO authenticated
  USING (
    client_id IN (SELECT public.org_client_ids(false))
    OR (org_id IN (SELECT public.my_admin_org_ids()))
  );
DROP POLICY IF EXISTS "Client reads own relationship" ON public.organization_clients;
CREATE POLICY "Client reads own relationship" ON public.organization_clients
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT public.my_client_org_ids())
         AND client_id IN (SELECT c.id FROM public.clients c WHERE c.user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "Team reads its invitations" ON public.organization_invitations;
CREATE POLICY "Team reads its invitations" ON public.organization_invitations
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT public.my_admin_org_ids()) OR invited_by = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Owner reads permission changes" ON public.organization_member_permissions;
CREATE POLICY "Owner reads permission changes" ON public.organization_member_permissions
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT public.my_admin_org_ids()) OR user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Both sides read support access" ON public.support_access_grants;
CREATE POLICY "Both sides read support access" ON public.support_access_grants
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT public.my_admin_org_ids()) OR granted_to = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Billing viewers read billing" ON public.organization_billing;
CREATE POLICY "Billing viewers read billing" ON public.organization_billing
  FOR SELECT TO authenticated
  USING (public.has_org_permission(org_id, 'billing.view'));

DROP POLICY IF EXISTS "Billing viewers read AI credits" ON public.org_ai_credit_grants;
CREATE POLICY "Billing viewers read AI credits" ON public.org_ai_credit_grants
  FOR SELECT TO authenticated
  USING (public.has_org_permission(org_id, 'billing.view'));

DROP POLICY IF EXISTS "Billing viewers read AI usage" ON public.org_ai_usage;
CREATE POLICY "Billing viewers read AI usage" ON public.org_ai_usage
  FOR SELECT TO authenticated
  USING (public.has_org_permission(org_id, 'billing.view') OR user_id = (SELECT auth.uid()));

-- a client reads the business they're a client of (its name), a teammate theirs
DROP POLICY IF EXISTS "Clients read their coach's business" ON public.organizations;
CREATE POLICY "Clients read their coach's business" ON public.organizations
  FOR SELECT TO authenticated
  USING (id IN (SELECT public.my_client_org_ids()));

-- the business's team sees its teammates
DROP POLICY IF EXISTS "Team sees its teammates" ON public.organization_members;
CREATE POLICY "Team sees its teammates" ON public.organization_members
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT public.my_org_ids()));

-- ── what an independent business's team may reach (allow-list) ───────────
-- Each table here is opened to a business's team for its own clients only.
-- Everything else stays shut to them: no JF Effect policy names them.
DROP POLICY IF EXISTS "Workspace team reads its clients" ON public.clients;
CREATE POLICY "Workspace team reads its clients" ON public.clients
  FOR SELECT TO authenticated
  USING (id IN (SELECT public.org_client_ids(false)));

DROP POLICY IF EXISTS "Workspace team reads programs" ON public.pl_blocks;
CREATE POLICY "Workspace team reads programs" ON public.pl_blocks
  FOR SELECT TO authenticated USING (client_id IN (SELECT public.org_client_ids(false)));
DROP POLICY IF EXISTS "Workspace team writes programs" ON public.pl_blocks;
CREATE POLICY "Workspace team writes programs" ON public.pl_blocks
  FOR INSERT TO authenticated WITH CHECK (client_id IN (SELECT public.org_client_ids(true)));
DROP POLICY IF EXISTS "Workspace team edits programs" ON public.pl_blocks;
CREATE POLICY "Workspace team edits programs" ON public.pl_blocks
  FOR UPDATE TO authenticated
  USING (client_id IN (SELECT public.org_client_ids(true)))
  WITH CHECK (client_id IN (SELECT public.org_client_ids(true)));

DROP POLICY IF EXISTS "Workspace team reads weeks" ON public.pl_weeks;
CREATE POLICY "Workspace team reads weeks" ON public.pl_weeks
  FOR SELECT TO authenticated USING (block_id IN (SELECT public.org_program_ids('block', false)));
DROP POLICY IF EXISTS "Workspace team writes weeks" ON public.pl_weeks;
CREATE POLICY "Workspace team writes weeks" ON public.pl_weeks
  FOR ALL TO authenticated
  USING (block_id IN (SELECT public.org_program_ids('block', true)))
  WITH CHECK (block_id IN (SELECT public.org_program_ids('block', true)));

DROP POLICY IF EXISTS "Workspace team reads days" ON public.pl_days;
CREATE POLICY "Workspace team reads days" ON public.pl_days
  FOR SELECT TO authenticated USING (week_id IN (SELECT public.org_program_ids('week', false)));
DROP POLICY IF EXISTS "Workspace team writes days" ON public.pl_days;
CREATE POLICY "Workspace team writes days" ON public.pl_days
  FOR ALL TO authenticated
  USING (week_id IN (SELECT public.org_program_ids('week', true)))
  WITH CHECK (week_id IN (SELECT public.org_program_ids('week', true)));

DROP POLICY IF EXISTS "Workspace team reads exercises" ON public.pl_exercise_rows;
CREATE POLICY "Workspace team reads exercises" ON public.pl_exercise_rows
  FOR SELECT TO authenticated USING (day_id IN (SELECT public.org_program_ids('day', false)));
DROP POLICY IF EXISTS "Workspace team writes exercises" ON public.pl_exercise_rows;
CREATE POLICY "Workspace team writes exercises" ON public.pl_exercise_rows
  FOR ALL TO authenticated
  USING (day_id IN (SELECT public.org_program_ids('day', true)))
  WITH CHECK (day_id IN (SELECT public.org_program_ids('day', true)));

-- what the client logged: read only
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pl_row_results', 'pl_day_completions', 'pl_warmup_sets', 'pl_exercise_notes', 'pl_client_maxes'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS "Workspace team reads logs" ON public.%I', t);
      EXECUTE format('CREATE POLICY "Workspace team reads logs" ON public.%I FOR SELECT TO authenticated USING (client_id IN (SELECT public.org_client_ids(false)))', t);
    END IF;
  END LOOP;
  IF to_regclass('public.progress_bodyweight') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Workspace team reads weigh-ins" ON public.progress_bodyweight;
    CREATE POLICY "Workspace team reads weigh-ins" ON public.progress_bodyweight
      FOR SELECT TO authenticated USING (user_id IN (SELECT public.org_client_user_ids()));
  END IF;
END $$;

-- ── the fence goes on last, over everything above ────────────────────────
SELECT public.tenant_fence_apply();

RESET lock_timeout;
