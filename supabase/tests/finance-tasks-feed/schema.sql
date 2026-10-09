-- Minimal stand-ins for the tables and helpers 20261028090000_finance_tasks_and_feed.sql
-- touches. auth.uid() reads the test.uid setting and auth.jwt() the test.aal
-- setting (aal2 = MFA-verified). Roles are rows in user_roles; community staff
-- are admins and coaches, as in the app.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT jsonb_build_object('aal', coalesce(nullif(current_setting('test.aal', true), ''), 'aal1')) $$;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT USAGE ON SCHEMA public TO authenticated;

CREATE TABLE public.user_roles (user_id uuid NOT NULL, role text NOT NULL, PRIMARY KEY (user_id, role));
CREATE TABLE public.role_permissions (role text NOT NULL, permission text NOT NULL, PRIMARY KEY (role, permission));
INSERT INTO public.role_permissions VALUES ('finance', 'admin.view'), ('finance', 'finance.read'), ('finance', 'discounts.manage');
CREATE TABLE public.coaches (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, archived boolean DEFAULT false, status text DEFAULT 'Active');

-- the real ones (20261018100100_role_permissions, 20261020093700_finance_admin_view)
CREATE FUNCTION public.session_mfa_verified() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce(auth.jwt() ->> 'aal', '') = 'aal2' $$;
CREATE FUNCTION public.is_business_owner(_uid uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.has_permission(_uid uuid, _perm text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _uid IS NOT NULL
    AND (_uid IS DISTINCT FROM auth.uid() OR public.session_mfa_verified())
    AND (
      (_perm LIKE 'finance.%' AND public.is_business_owner(_uid))
      OR (_perm NOT LIKE 'finance.%' AND EXISTS (
            SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _uid AND ur.role = 'admin'))
      OR EXISTS (SELECT 1 FROM public.user_roles ur
                   JOIN public.role_permissions rp ON rp.role = ur.role
                  WHERE ur.user_id = _uid AND rp.permission = _perm)) $$;
CREATE FUNCTION public.is_admin_viewer() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL
    AND public.session_mfa_verified()
    AND EXISTS (SELECT 1 FROM public.user_roles ur
                  JOIN public.role_permissions rp ON rp.role = ur.role
                 WHERE ur.user_id = auth.uid() AND rp.permission = 'admin.view')
    AND NOT EXISTS (SELECT 1 FROM public.user_roles ur
                     WHERE ur.user_id = auth.uid() AND ur.role = 'admin') $$;
-- has_role without the admin view (no read-only transaction, no header: what storage and writes see)
CREATE FUNCTION public.has_role(_uid uuid, _role text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role = _role) $$;
CREATE FUNCTION public.is_coach_or_admin(_uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_uid, 'admin') OR EXISTS (SELECT 1 FROM public.coaches WHERE user_id = _uid AND archived = false AND status = 'Active') $$;
CREATE FUNCTION public.is_media_manager(_uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_uid, 'media_manager') $$;

-- the task board and its existing rules
CREATE TABLE public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text NOT NULL, quadrant text DEFAULT 'do', status text DEFAULT 'open',
  created_by uuid REFERENCES public.coaches(id) ON DELETE SET NULL, assigned_to uuid, completed_at timestamptz,
  scope text NOT NULL DEFAULT 'admin' CHECK (scope IN ('admin', 'media')), created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks TO authenticated;
CREATE POLICY coaches_admins_select_tasks ON public.tasks FOR SELECT TO authenticated USING (public.is_coach_or_admin(auth.uid()));
CREATE POLICY coaches_admins_insert_tasks ON public.tasks FOR INSERT TO authenticated WITH CHECK (public.is_coach_or_admin(auth.uid()));
CREATE POLICY coaches_admins_update_tasks ON public.tasks FOR UPDATE TO authenticated USING (public.is_coach_or_admin(auth.uid())) WITH CHECK (public.is_coach_or_admin(auth.uid()));
CREATE POLICY coaches_admins_delete_tasks ON public.tasks FOR DELETE TO authenticated USING (public.is_coach_or_admin(auth.uid()));
CREATE POLICY "tasks media_manager read assigned" ON public.tasks FOR SELECT TO authenticated USING (public.is_media_manager(auth.uid()) AND assigned_to = auth.uid());

-- the community pieces the read checks look at
CREATE TABLE public.clients (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid);
CREATE TABLE public.community_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), author_user_id uuid NOT NULL, client_id uuid, visibility text NOT NULL DEFAULT 'community',
  media_path text, media_thumb_path text, extra_media jsonb NOT NULL DEFAULT '[]'::jsonb);
CREATE TABLE public.community_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), post_id uuid NOT NULL, author_user_id uuid NOT NULL, media_path text, media_thumb_path text, hidden_at timestamptz);
CREATE TABLE public.community_birthday_posts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text NOT NULL, media jsonb NOT NULL DEFAULT '[]'::jsonb);
CREATE TABLE public.community_series_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), media jsonb NOT NULL DEFAULT '[]'::jsonb);
CREATE FUNCTION public.is_community_staff() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT auth.uid() IS NOT NULL AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'coach')) $$;
CREATE FUNCTION public.can_view_community() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT auth.uid() IS NOT NULL AND (public.is_community_staff() OR EXISTS (SELECT 1 FROM public.clients c WHERE c.user_id = auth.uid())) $$;
CREATE FUNCTION public.community_post_visible(_visibility text, _author uuid, _client uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT auth.uid() IS NOT NULL AND (_author = auth.uid()
    OR (_visibility = 'community' AND public.can_view_community())
    OR (_visibility = 'coach' AND public.has_role(auth.uid(), 'admin'))) $$;
CREATE FUNCTION public.community_comment_readable(_post_id uuid, _author uuid, _hidden_at timestamptz) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT public.can_view_community() AND EXISTS (SELECT 1 FROM public.community_posts p WHERE p.id = _post_id
    AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id)
    AND (_hidden_at IS NULL OR _author = auth.uid() OR public.is_community_staff())) $$;
-- what the migration rebuilds
CREATE FUNCTION public.community_post_media_readable(_name text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.community_comment_media_readable(_name text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
