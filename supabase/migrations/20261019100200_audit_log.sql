-- One audit trail for finance writes, role grants and client POV starts:
-- admin_audit_log (not a new table). It already has the right shape (actor,
-- action, target, before/after), app users can only INSERT/SELECT it, and only
-- admins can read it. This migration makes it fully append-only and fills it
-- from triggers so every path is covered, including direct API calls.

-- Both existing writers (jf-billing writeBillingAudit, scheduled messages)
-- insert a `details` column that never existed, so their rows were dropped.
ALTER TABLE public.admin_audit_log ADD COLUMN IF NOT EXISTS details jsonb;

-- Append-only, for everyone including the service role. The one allowed
-- change is the foreign key's own ON DELETE SET NULL on actor_user_id, so
-- deleting an account still works and the entry stays.
CREATE OR REPLACE FUNCTION public.tg_admin_audit_log_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.actor_user_id IS NULL AND OLD.actor_user_id IS NOT NULL
     AND (to_jsonb(NEW) - 'actor_user_id') = (to_jsonb(OLD) - 'actor_user_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'admin_audit_log is append-only';
END;
$$;

DROP TRIGGER IF EXISTS admin_audit_log_append_only ON public.admin_audit_log;
CREATE TRIGGER admin_audit_log_append_only
  BEFORE UPDATE OR DELETE ON public.admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.tg_admin_audit_log_append_only();

-- The actor's most senior role, for the log line.
CREATE OR REPLACE FUNCTION public.audit_actor_role(_uid uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN _uid IS NULL THEN 'system'
    WHEN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role = 'admin') THEN 'admin'
    WHEN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role = 'finance') THEN 'finance'
    WHEN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role = 'coach') THEN 'coach'
    WHEN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role = 'media_manager') THEN 'media_manager'
    ELSE 'user'
  END
$$;

-- Finance writes: every insert, update and delete on the books tables.
-- (Receipts are files in storage; uploading one is logged when it's attached
-- to an expense, through business_expenses.receipt_path.)
CREATE OR REPLACE FUNCTION public.tg_audit_finance_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row_id text;
BEGIN
  row_id := coalesce(to_jsonb(NEW) ->> 'id', to_jsonb(OLD) ->> 'id');
  INSERT INTO public.admin_audit_log (actor_user_id, actor_role, action, target_table, target_id, before, after)
  VALUES (
    auth.uid(), public.audit_actor_role(auth.uid()),
    'finance.' || lower(TG_OP), TG_TABLE_NAME, row_id,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END
  );
  RETURN NULL;
END;
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['business_expenses', 'business_tax_payments', 'business_tax_settings'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS audit_finance_write ON public.%I', t);
    EXECUTE format('CREATE TRIGGER audit_finance_write AFTER INSERT OR UPDATE OR DELETE ON public.%I
                    FOR EACH ROW EXECUTE FUNCTION public.tg_audit_finance_write()', t);
  END LOOP;
END $$;

-- Role grants and revokes, from any path (app, server, SQL).
CREATE OR REPLACE FUNCTION public.tg_audit_role_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.admin_audit_log (actor_user_id, actor_role, action, target_table, target_id, summary, before, after)
  VALUES (
    auth.uid(), public.audit_actor_role(auth.uid()),
    CASE TG_OP WHEN 'INSERT' THEN 'role.grant' WHEN 'DELETE' THEN 'role.revoke' ELSE 'role.change' END,
    'user_roles',
    coalesce(NEW.user_id, OLD.user_id)::text,
    CASE TG_OP WHEN 'INSERT' THEN 'granted ' || NEW.role WHEN 'DELETE' THEN 'revoked ' || OLD.role
               ELSE OLD.role || ' -> ' || NEW.role END,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END
  );
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS audit_role_change ON public.user_roles;
CREATE TRIGGER audit_role_change
  AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_role_change();

-- Client POV starts. POV runs in the browser on the staff member's own
-- session, so the app calls this when it starts; it refuses anyone who
-- couldn't open that client anyway.
CREATE OR REPLACE FUNCTION public.log_client_pov_start(_client_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  who text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.is_assigned_coach(_client_id)) THEN
    RAISE EXCEPTION 'Forbidden: not your client' USING ERRCODE = '42501';
  END IF;
  SELECT full_name INTO who FROM public.clients WHERE id = _client_id;
  INSERT INTO public.admin_audit_log (actor_user_id, actor_role, action, target_table, target_id, summary)
  VALUES (auth.uid(), public.audit_actor_role(auth.uid()), 'client_pov.start', 'clients', _client_id::text,
          'Viewing as ' || coalesce(who, 'client'));
END;
$$;

REVOKE ALL ON FUNCTION public.log_client_pov_start(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_client_pov_start(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.audit_actor_role(uuid) FROM PUBLIC, anon;
