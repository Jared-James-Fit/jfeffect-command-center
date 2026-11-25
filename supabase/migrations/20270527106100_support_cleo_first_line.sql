-- Cleo answers JF Effect Support first, and the team works Support as a queue
-- in Messages (Nov 25 2026; src/lib/support-cleo/).
--
-- A thread is handled by Cleo or by a person (`handler`). While Cleo has it,
-- a message from the person doesn't count as new for the team (no badge, no
-- push): Cleo answers from the support knowledge base or hands off. A hand-off
-- (Cleo unsure, the person asked for a human, billing, account, coaching,
-- complaint, a repeated issue) sets handler = 'human' with the escalation card
-- (`escalation`), and from then on Cleo never writes until a person returns
-- the chat to Cleo or it's resolved. A resolved chat that gets a new message
-- goes back to Cleo first.
--
-- Chats that existed before stay with a person (they were answered by hand).

SET lock_timeout = '3s';

ALTER TABLE public.member_support_threads
  ADD COLUMN IF NOT EXISTS handler text NOT NULL DEFAULT 'human',
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS escalation jsonb,
  ADD COLUMN IF NOT EXISTS escalated_at timestamptz,
  ADD COLUMN IF NOT EXISTS cleo_turns int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS resolved_by text,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz;
-- new threads start with Cleo (existing ones keep 'human' from the default above)
ALTER TABLE public.member_support_threads ALTER COLUMN handler SET DEFAULT 'cleo';
DO $$
BEGIN
  ALTER TABLE public.member_support_threads
    ADD CONSTRAINT member_support_threads_handler_check CHECK (handler IN ('cleo', 'human'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER TABLE public.member_support_threads
    ADD CONSTRAINT member_support_threads_resolved_by_check CHECK (resolved_by IS NULL OR resolved_by IN ('cleo', 'team'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Cleo writes as itself, never as the team.
ALTER TABLE public.member_support_messages DROP CONSTRAINT IF EXISTS member_support_messages_sender_role_check;
ALTER TABLE public.member_support_messages
  ADD CONSTRAINT member_support_messages_sender_role_check CHECK (sender_role IN ('member', 'team', 'cleo'));
ALTER TABLE public.member_support_messages DROP CONSTRAINT IF EXISTS member_support_messages_category_check;
ALTER TABLE public.member_support_messages
  ADD CONSTRAINT member_support_messages_category_check CHECK (category IN ('question', 'bug', 'suggestion', 'reply', 'handoff'));

CREATE OR REPLACE FUNCTION public.tg_msm_bump_thread()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.sender_role = 'member' THEN
    UPDATE public.member_support_threads
       SET last_member_message_at = NEW.created_at,
           -- new for the team only while a person handles it (Cleo's chats never badge or push)
           unread_for_team = CASE WHEN status <> 'closed' AND handler = 'human' THEN unread_for_team + 1 ELSE unread_for_team END,
           -- a resolved chat that gets a new message goes back to Cleo first
           handler = CASE WHEN status = 'closed' THEN 'cleo' ELSE handler END,
           escalation = CASE WHEN status = 'closed' THEN NULL ELSE escalation END,
           escalated_at = CASE WHEN status = 'closed' THEN NULL ELSE escalated_at END,
           owner_user_id = CASE WHEN status = 'closed' THEN NULL ELSE owner_user_id END,
           cleo_turns = CASE WHEN status = 'closed' THEN 0 ELSE cleo_turns END,
           resolved_by = CASE WHEN status = 'closed' THEN NULL ELSE resolved_by END,
           resolved_at = CASE WHEN status = 'closed' THEN NULL ELSE resolved_at END,
           status = CASE WHEN status = 'closed' THEN 'open' ELSE status END,
           updated_at = now()
     WHERE id = NEW.thread_id;
  ELSE
    UPDATE public.member_support_threads
       SET last_team_message_at = CASE WHEN NEW.sender_role = 'team' THEN NEW.created_at ELSE last_team_message_at END,
           unread_for_member = unread_for_member + 1,
           status = CASE WHEN NEW.sender_role = 'team' THEN 'answered' ELSE status END,
           updated_at = now()
     WHERE id = NEW.thread_id;
  END IF;
  RETURN NEW;
END;
$$;

-- The coach's Messages: every Support chat with a message, with who handles it.
DROP FUNCTION IF EXISTS public.staff_support_threads();
CREATE FUNCTION public.staff_support_threads()
RETURNS TABLE(thread_id uuid, member_id uuid, client_id uuid, user_id uuid, name text, email text, avatar text,
              service_tier text, status text, unread_count int, last_body text, last_sender_role text,
              last_at timestamptz, ticket_number bigint, handler text, escalation jsonb, escalated_at timestamptz,
              owner_user_id uuid, resolved_by text)
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
         t.status, greatest(t.unread_for_team, 0), l.body, l.sender_role, l.created_at, t.ticket_number,
         t.handler, t.escalation, t.escalated_at, t.owner_user_id, t.resolved_by
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
