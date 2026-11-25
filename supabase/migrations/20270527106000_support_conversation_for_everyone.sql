-- JF Effect Support is one conversation in Messages, for members and coaching
-- clients alike (Nov 25 2026).
--
-- Members had a Support tab of their own and coaching clients had no way to
-- ask JF Effect anything that wasn't for their coach. Now everyone's inbox
-- (/portal/messages) has a "JF Effect Support" chat. A member's thread stays
-- keyed by their app_members row (nothing existing moves); a coaching client
-- (who may have no app_members row) gets a thread keyed by their client row.
-- Every thread made from now on carries client_id; old member threads are
-- backfilled with their self-serve client row.
--
-- Writes go through the server (member-support.functions.ts, service role)
-- after it has checked who is asking; the person's own login only reads
-- (the inbox row, live updates), so the policies added here are SELECT only.

SET lock_timeout = '3s';

ALTER TABLE public.member_support_threads ALTER COLUMN member_id DROP NOT NULL;
ALTER TABLE public.member_support_threads
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE;
DO $$
BEGIN
  ALTER TABLE public.member_support_threads
    ADD CONSTRAINT member_support_threads_has_person CHECK (member_id IS NOT NULL OR client_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS member_support_threads_client_uidx
  ON public.member_support_threads (client_id) WHERE client_id IS NOT NULL;

ALTER TABLE public.member_support_messages ALTER COLUMN member_id DROP NOT NULL;

-- Old member threads: their self-serve client row (one thread per client).
WITH pick AS (
  SELECT DISTINCT ON (c.id) t.id AS thread_id, c.id AS client_id
    FROM public.member_support_threads t
    JOIN public.app_members m ON m.id = t.member_id
    CROSS JOIN LATERAL (
      SELECT c2.id FROM public.clients c2
       WHERE m.user_id IS NOT NULL AND c2.user_id = m.user_id
       ORDER BY (c2.service_tier = 'self_serve') DESC, c2.created_at
       LIMIT 1
    ) c
   WHERE t.client_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.member_support_threads x WHERE x.client_id = c.id)
   ORDER BY c.id, t.created_at
)
UPDATE public.member_support_threads t SET client_id = p.client_id FROM pick p WHERE t.id = p.thread_id;

-- The threads the signed-in person may read as their own: by their member row
-- or by any client row that is theirs.
CREATE OR REPLACE FUNCTION public.support_own_thread_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.id FROM public.member_support_threads t
   WHERE t.member_id = public.current_member_id()
      OR t.client_id IN (SELECT c.id FROM public.clients c WHERE c.user_id = auth.uid())
$$;
REVOKE ALL ON FUNCTION public.support_own_thread_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_own_thread_ids() TO authenticated;

-- The threads a coach may answer: members assigned to them and their own clients.
CREATE OR REPLACE FUNCTION public.support_coached_thread_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.id FROM public.member_support_threads t
   WHERE t.member_id IN (SELECT public.coached_member_ids())
      OR t.client_id IN (SELECT public.coached_client_ids())
$$;
REVOKE ALL ON FUNCTION public.support_coached_thread_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_coached_thread_ids() TO authenticated;

DROP POLICY IF EXISTS mst_client_self_select ON public.member_support_threads;
CREATE POLICY mst_client_self_select ON public.member_support_threads
  FOR SELECT TO authenticated
  USING (id IN (SELECT public.support_own_thread_ids()));

DROP POLICY IF EXISTS msm_client_self_select ON public.member_support_messages;
CREATE POLICY msm_client_self_select ON public.member_support_messages
  FOR SELECT TO authenticated
  USING (thread_id IN (SELECT public.support_own_thread_ids()));

ALTER POLICY mst_coach_select ON public.member_support_threads
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)) OR id IN (SELECT public.support_coached_thread_ids()));
ALTER POLICY mst_coach_update ON public.member_support_threads
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)) OR id IN (SELECT public.support_coached_thread_ids()))
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)) OR id IN (SELECT public.support_coached_thread_ids()));
ALTER POLICY msm_coach_select ON public.member_support_messages
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)) OR thread_id IN (SELECT public.support_coached_thread_ids()));
ALTER POLICY msm_coach_insert ON public.member_support_messages
  WITH CHECK (
    sender_role = 'team'
    AND sender_user_id = (SELECT auth.uid())
    AND ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)) OR thread_id IN (SELECT public.support_coached_thread_ids()))
  );

-- Chats are never deleted with an account: a client with Support messages too.
CREATE OR REPLACE FUNCTION public.guard_client_chat_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.chat_history_purge_allowed() THEN RETURN OLD; END IF;
  IF EXISTS (SELECT 1 FROM public.messages WHERE client_id = OLD.id)
     OR EXISTS (
       SELECT 1 FROM public.member_support_messages x
         JOIN public.member_support_threads t ON t.id = x.thread_id
        WHERE t.client_id = OLD.id
     ) THEN
    RAISE EXCEPTION 'This client has chat history, so they can''t be deleted. Deactivate them instead: the chat is kept.'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$$;

-- The coach's Messages: every Support chat with a message, a member's or a
-- coaching client's, with their name, photo and client record. Admins see
-- every one, a coach only the members and clients assigned to them.
CREATE OR REPLACE FUNCTION public.staff_support_threads()
RETURNS TABLE(thread_id uuid, member_id uuid, client_id uuid, user_id uuid, name text, email text, avatar text,
              service_tier text, status text, unread_count int, last_body text, last_sender_role text,
              last_at timestamptz, ticket_number bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := auth.uid(); is_admin boolean;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  is_admin := public.has_role(me, 'admin');
  IF NOT is_admin AND NOT public.has_role(me, 'coach') THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT t.id, t.member_id, c.id, coalesce(m.user_id, c.user_id),
         coalesce(nullif(btrim(coalesce(c.full_name, '')), ''), nullif(btrim(coalesce(m.full_name, '')), ''), m.email, c.email, 'Member'),
         coalesce(m.email, c.email),
         coalesce(nullif(c.profile_picture_url, ''), public.community_avatar(coalesce(m.user_id, c.user_id)), nullif(m.avatar_url, '')),
         c.service_tier,
         t.status, greatest(t.unread_for_team, 0), l.body, l.sender_role, l.created_at, t.ticket_number
    FROM public.member_support_threads t
    LEFT JOIN public.app_members m ON m.id = t.member_id
    JOIN LATERAL (
      SELECT x.body, x.sender_role, x.created_at
        FROM public.member_support_messages x
       WHERE x.thread_id = t.id
       ORDER BY x.created_at DESC
       LIMIT 1
    ) l ON true
    LEFT JOIN LATERAL (
      SELECT c2.id, c2.user_id, c2.email, c2.full_name, c2.profile_picture_url, c2.service_tier
        FROM public.clients c2
       WHERE c2.id = t.client_id
          OR (t.client_id IS NULL AND m.user_id IS NOT NULL AND c2.user_id = m.user_id)
       ORDER BY (c2.id = t.client_id) DESC NULLS LAST, (c2.service_tier = 'self_serve') DESC, c2.created_at
       LIMIT 1
    ) c ON true
   WHERE is_admin OR t.id IN (SELECT public.support_coached_thread_ids());
END;
$$;
REVOKE ALL ON FUNCTION public.staff_support_threads() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_support_threads() TO authenticated;
