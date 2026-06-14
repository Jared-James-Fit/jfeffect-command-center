-- ============================================================================
-- B6: Restrict client-action-files storage policies to authenticated role
-- ============================================================================
ALTER POLICY "Admins manage client-action-files" ON storage.objects TO authenticated;
ALTER POLICY "Clients read own client-action-files" ON storage.objects TO authenticated;
ALTER POLICY "Coaches manage client-action-files for assigned clients" ON storage.objects TO authenticated;

-- ============================================================================
-- B7: Cross-coach support-message isolation
-- ============================================================================
-- Helper: a coach is "assigned" to a member iff there exists a clients row
-- linked to the same auth user as the member, and the caller is the assigned
-- coach of that client (reusing the existing is_assigned_coach helper).
CREATE OR REPLACE FUNCTION public.is_assigned_coach_for_member(_member_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.app_members m
    JOIN public.clients c ON c.user_id = m.user_id
    WHERE m.id = _member_id
      AND public.is_assigned_coach(c.id)
  )
$$;

REVOKE ALL ON FUNCTION public.is_assigned_coach_for_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_assigned_coach_for_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_assigned_coach_for_member(uuid) TO service_role;

-- Tighten message SELECT (was: bare is_coach_or_admin -> any coach saw all threads)
ALTER POLICY "msm_coach_select" ON public.member_support_messages
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR public.is_assigned_coach_for_member(member_id)
  );

-- Tighten message INSERT so coach can only post into assigned-member threads
ALTER POLICY "msm_coach_insert" ON public.member_support_messages
  WITH CHECK (
    sender_role = 'team'
    AND sender_user_id = auth.uid()
    AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR public.is_assigned_coach_for_member(member_id)
    )
  );

-- Tighten thread SELECT/UPDATE to match (otherwise coaches still list every thread)
ALTER POLICY "mst_coach_select" ON public.member_support_threads
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR public.is_assigned_coach_for_member(member_id)
  );

ALTER POLICY "mst_coach_update" ON public.member_support_threads
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR public.is_assigned_coach_for_member(member_id)
  )
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
    OR public.is_assigned_coach_for_member(member_id)
  );

-- ============================================================================
-- Pending signups: explicit admin-only policies + service_role grant
-- ============================================================================
-- RLS already enabled with zero policies, so anon/authenticated are denied by
-- default. We make that explicit (defense-in-depth + auditable intent) and
-- ensure trusted server paths (service_role) keep working.
ALTER TABLE public.jf_pending_signups ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.jf_pending_signups TO service_role;
-- Do NOT grant anon/authenticated. All non-admin access must go through the
-- approved server-side checkout / webhook / cleanup functions (service_role).

DROP POLICY IF EXISTS "Admins manage jf_pending_signups" ON public.jf_pending_signups;
CREATE POLICY "Admins manage jf_pending_signups"
  ON public.jf_pending_signups
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

COMMENT ON TABLE public.jf_pending_signups IS
  'Holds in-flight Stripe Checkout signups (email + password_hash + plan). '
  'Direct access is admin-only via RLS. All non-admin reads/writes MUST go '
  'through the approved server paths: createCheckoutSession / Stripe webhook '
  'handler / cleanup-pending-signups cron (all using service_role, which '
  'bypasses RLS). Never expose this table to anon or ordinary authenticated '
  'users — it contains pre-finalized account credentials.';
