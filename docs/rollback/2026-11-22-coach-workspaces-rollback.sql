-- Rollback for 20270510090000_coach_workspaces.sql.
--
-- Refuses while any client record lives in an independent business: rolling
-- back would take the fence off records that belong to someone else's
-- business. Close those businesses first (end their relationships, export or
-- delete what the owners and clients agreed to), then run this. Everything JF
-- Effect had before the migration is left exactly as it was.
SET lock_timeout = '5s';

DO $$
BEGIN
  IF to_regclass('public.organizations') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'clients' AND column_name = 'organization_id')
     AND EXISTS (SELECT 1 FROM public.clients WHERE organization_id <> 'f0f0f0f0-0000-4000-8000-000000000001'::uuid) THEN
    RAISE EXCEPTION 'Client records still live in an independent business; close those businesses before rolling back';
  END IF;
END $$;

-- the fence, everywhere it went
DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT tablename FROM pg_policies WHERE schemaname = 'public' AND policyname = 'tenant_fence' LOOP
    EXECUTE format('DROP POLICY tenant_fence ON public.%I', p.tablename);
  END LOOP;
END $$;

-- the workspace team's allow-list
DO $$
DECLARE t text; pol text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pl_row_results', 'pl_day_completions', 'pl_warmup_sets', 'pl_exercise_notes', 'pl_client_maxes'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS "Workspace team reads logs" ON public.%I', t);
    END IF;
  END LOOP;
  IF to_regclass('public.progress_bodyweight') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Workspace team reads weigh-ins" ON public.progress_bodyweight;
  END IF;
END $$;
DROP POLICY IF EXISTS "Workspace team reads its clients" ON public.clients;
DROP POLICY IF EXISTS "Workspace team reads programs" ON public.pl_blocks;
DROP POLICY IF EXISTS "Workspace team writes programs" ON public.pl_blocks;
DROP POLICY IF EXISTS "Workspace team edits programs" ON public.pl_blocks;
DROP POLICY IF EXISTS "Workspace team reads weeks" ON public.pl_weeks;
DROP POLICY IF EXISTS "Workspace team writes weeks" ON public.pl_weeks;
DROP POLICY IF EXISTS "Workspace team reads days" ON public.pl_days;
DROP POLICY IF EXISTS "Workspace team writes days" ON public.pl_days;
DROP POLICY IF EXISTS "Workspace team reads exercises" ON public.pl_exercise_rows;
DROP POLICY IF EXISTS "Workspace team writes exercises" ON public.pl_exercise_rows;
DROP POLICY IF EXISTS "Clients read their coach's business" ON public.organizations;
DROP POLICY IF EXISTS "Team sees its teammates" ON public.organization_members;

-- triggers
DROP TRIGGER IF EXISTS clients_org_guard ON public.clients;
DROP TRIGGER IF EXISTS clients_org_seats ON public.clients;
DROP TRIGGER IF EXISTS org_members_seats ON public.organization_members;

-- tables (their policies use the functions below)
DROP TABLE IF EXISTS public.org_ai_credit_grants;
DROP TABLE IF EXISTS public.org_ai_usage;
DROP TABLE IF EXISTS public.coach_billing_events;
DROP TABLE IF EXISTS public.organization_billing;
DROP TABLE IF EXISTS public.support_access_grants;
DROP TABLE IF EXISTS public.organization_member_permissions;
DROP TABLE IF EXISTS public.organization_invitations;
DROP TABLE IF EXISTS public.organization_clients;
DROP TABLE IF EXISTS public.tenant_fence_registry;
DROP TABLE IF EXISTS public.tenant_fence_platform_tables;

-- functions
DROP FUNCTION IF EXISTS public.coach_workspace_create(uuid, text, text, text, text, text);
DROP FUNCTION IF EXISTS public.coach_workspaces_set_pilot(boolean);
DROP FUNCTION IF EXISTS public.org_invite(uuid, text, text, text, text, uuid);
DROP FUNCTION IF EXISTS public.org_invitation_revoke(uuid);
DROP FUNCTION IF EXISTS public.org_invitation_peek(text);
DROP FUNCTION IF EXISTS public.org_invitation_accept(text, text, text);
DROP FUNCTION IF EXISTS public.org_client_set_status(uuid, uuid, text, text);
DROP FUNCTION IF EXISTS public.org_client_assign(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.org_member_set(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.org_member_permission_set(uuid, uuid, text, boolean);
DROP FUNCTION IF EXISTS public.support_access_request(uuid, text, int);
DROP FUNCTION IF EXISTS public.support_access_decide(uuid, boolean);
DROP FUNCTION IF EXISTS public.org_ai_spend(uuid, timestamptz);
DROP FUNCTION IF EXISTS public.org_ai_settle(uuid, boolean, text, int, int, int, bigint);
DROP FUNCTION IF EXISTS public.org_ai_reserve(uuid, text, int, bigint, int, bigint, bigint, uuid, uuid);
DROP FUNCTION IF EXISTS public.org_ai_state(uuid);
DROP FUNCTION IF EXISTS public.tenant_fence_apply();
DROP FUNCTION IF EXISTS public.tenant_fence_report();
DROP FUNCTION IF EXISTS public.tenant_fence_targets();
DROP FUNCTION IF EXISTS public.tenant_fence_expr(text, text);
DROP FUNCTION IF EXISTS public.tenant_fence_ids(text, boolean);
DROP FUNCTION IF EXISTS public.tenant_fence_mode();
DROP FUNCTION IF EXISTS public.tenant_visible_org_ids();
DROP FUNCTION IF EXISTS public.my_client_org_ids();
DROP FUNCTION IF EXISTS public.org_program_ids(text, boolean);
DROP FUNCTION IF EXISTS public.org_client_user_ids();
DROP FUNCTION IF EXISTS public.org_client_ids(boolean);
DROP FUNCTION IF EXISTS public.org_can_write(uuid);
DROP FUNCTION IF EXISTS public.has_org_permission(uuid, text);
DROP FUNCTION IF EXISTS public.org_role_allows(text, text);
DROP FUNCTION IF EXISTS public.coach_workspaces_pilot_on();
DROP FUNCTION IF EXISTS public.tg_org_client_record_seats();
DROP FUNCTION IF EXISTS public.tg_org_members_seats();
DROP FUNCTION IF EXISTS public.tg_org_clients_seats();
DROP FUNCTION IF EXISTS public._org_seats_refresh(uuid);
DROP FUNCTION IF EXISTS public.tg_clients_org_guard();

-- clients and organizations as they were
ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_org_tier_check;
ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_organization_fk;
DROP INDEX IF EXISTS public.clients_independent_org_idx;
ALTER TABLE public.clients DROP COLUMN IF EXISTS organization_id;
ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_service_tier_check;
ALTER TABLE public.clients ADD CONSTRAINT clients_service_tier_check CHECK (service_tier IN ('coaching', 'self_serve'));
ALTER TABLE public.organizations DROP COLUMN IF EXISTS pilot;
ALTER TABLE public.organizations DROP COLUMN IF EXISTS created_by;
ALTER TABLE public.organizations DROP COLUMN IF EXISTS time_zone;
ALTER TABLE public.organizations DROP COLUMN IF EXISTS region;
ALTER TABLE public.organizations DROP COLUMN IF EXISTS country;
DELETE FROM public.app_settings WHERE key = 'coach_workspaces';

RESET lock_timeout;
