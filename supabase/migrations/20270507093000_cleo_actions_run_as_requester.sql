-- Cleo's cards run as the person who asked for them, never as whoever approved.
--
-- Before this, a coach's card (send a message, build a program, set nutrition
-- targets…) waited for the owner's approval and then ran with the OWNER's
-- session: the message was sent with the owner's sender_id, the block was
-- created_by the owner, and the owner's RLS decided what it could reach. The
-- approval lent the owner's identity and rights to the request.
--
-- Now (cleo-actions.server.ts, CLEO_ACTION_RULES in cleo-actions.ts):
--   * approval only authorizes. An approved card runs as the requester, written
--     with the service role, every row naming the requester (sender_id,
--     author_id, created_by, reviewed_by), after checking again, at run time,
--     that the requester still holds the coach role and that the client is
--     still assigned to them (cleo_action_target_allowed below);
--   * kinds a role can never do aren't offered or run, approval or not (money
--     for a coach); kinds that only work through request-bound server
--     functions stay the owner's to do himself;
--   * the card records who approved it and when (decided_by / decided_at,
--     written at the moment of approval) and who it ran as (executed_as),
--     which the database holds to the requester.

SET lock_timeout = '5s';

-- ── 1. Who it ran as ────────────────────────────────────────────────────────
ALTER TABLE public.cleo_actions
  ADD COLUMN IF NOT EXISTS executed_as uuid REFERENCES auth.users (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.cleo_actions.executed_as IS
  'The login the action ran as: always the requester (checked). Approval is decided_by / decided_at.';
COMMENT ON COLUMN public.cleo_actions.decided_by IS
  'Who approved or declined it (the business owner). Approval authorizes; it never changes who it runs as.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cleo_actions_runs_as_requester'
                   AND conrelid = 'public.cleo_actions'::regclass) THEN
    ALTER TABLE public.cleo_actions
      ADD CONSTRAINT cleo_actions_runs_as_requester
      CHECK (executed_as IS NULL OR executed_as = requested_by);
  END IF;
END $$;

-- Once per query (was a bare auth.uid() per row).
DROP POLICY IF EXISTS "cleo actions: requester and owner read" ON public.cleo_actions;
CREATE POLICY "cleo actions: requester and owner read" ON public.cleo_actions
  FOR SELECT TO authenticated
  USING (requested_by = (SELECT auth.uid()) OR (SELECT public.is_business_owner((SELECT auth.uid()))));

-- ── 2. May this requester act on this client? ──────────────────────────────
-- Read about the requester, never the caller's session (the server calls it
-- with the service role on the owner's approval): the admin, or the client's
-- own Active, unarchived coach who still holds the coach role (which follows
-- the coach record: 20270506091000_team_access_hardening.sql).
CREATE OR REPLACE FUNCTION public.cleo_action_target_allowed(_requester uuid, _client uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT _requester IS NOT NULL AND _client IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _requester AND ur.role = 'admin'::public.app_role)
    OR (
      EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _requester AND ur.role = 'coach'::public.app_role)
      AND EXISTS (
        SELECT 1
          FROM public.clients c
          JOIN public.coaches co ON co.id = c.assigned_coach_id
         WHERE c.id = _client
           AND co.user_id = _requester
           AND co.status = 'Active'
           AND NOT coalesce(co.archived, false)
      )
    )
  )
$$;

REVOKE ALL ON FUNCTION public.cleo_action_target_allowed(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleo_action_target_allowed(uuid, uuid) TO service_role;

-- ── 3. Mark a client's check-ins reviewed, as the coach who asked ──────────
-- mark_client_reviews_reviewed() reads auth.uid(), which the server doesn't
-- have on an approval. This is the same three updates, for the server only,
-- reviewed by the requester, after the same check.
CREATE OR REPLACE FUNCTION public.cleo_mark_client_reviews_reviewed_as(_actor uuid, _client uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  a int := 0; b int := 0; c int := 0;
BEGIN
  IF NOT public.cleo_action_target_allowed(_actor, _client) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  UPDATE public.messenger_checkins
     SET reviewed_at = now(), reviewed_by = _actor, reviewed_via = 'manual'
   WHERE client_id = _client AND status = 'completed' AND superseded_at IS NULL AND reviewed_at IS NULL;
  GET DIAGNOSTICS a = ROW_COUNT;

  UPDATE public.nf_submissions
     SET status = 'reviewed', reviewed_at = now(), reviewed_by = _actor
   WHERE client_id = _client AND submitted_at IS NOT NULL AND reviewed_at IS NULL
     AND status IN ('submitted', 'pending_review');
  GET DIAGNOSTICS b = ROW_COUNT;

  UPDATE public.submission_reviews
     SET review_status = 'no_response'
   WHERE client_id = _client AND source_type <> 'native'
     AND coalesce(review_status, '') IN ('pending', 'needs_review', 'submitted');
  GET DIAGNOSTICS c = ROW_COUNT;

  RETURN a + b + c;
END $$;

REVOKE ALL ON FUNCTION public.cleo_mark_client_reviews_reviewed_as(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleo_mark_client_reviews_reviewed_as(uuid, uuid) TO service_role;

SELECT public.rls_evaluate_once('cleo_actions');
