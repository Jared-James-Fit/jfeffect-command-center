-- Member support lives in the coach's Messages.
--
-- JF members (free accounts, no coach) can't open the coach chat; their way
-- to reach JF Effect is Support. Their conversations used to sit on their own
-- Communication tab with no push, so a member's question could wait for days.
-- Now each member's Support chat is a row in the coach's 1:1 Chats (with the
-- blue dot and the Messages badge like any new message), opening in place.
--
-- One read for the inbox: every support conversation that has a message,
-- with the member's name, photo, client record (for "Message" from their
-- profile) and the latest message. Admins see every one, a coach only the
-- members assigned to them: the same rule as the tables' RLS.

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
  SELECT t.id, t.member_id, c.id, m.user_id,
         coalesce(nullif(btrim(coalesce(c.full_name, '')), ''), nullif(btrim(coalesce(m.full_name, '')), ''), m.email, 'Member'),
         m.email,
         coalesce(nullif(c.profile_picture_url, ''), public.community_avatar(m.user_id), nullif(m.avatar_url, '')),
         c.service_tier,
         t.status, greatest(t.unread_for_team, 0), l.body, l.sender_role, l.created_at, t.ticket_number
    FROM public.member_support_threads t
    JOIN public.app_members m ON m.id = t.member_id
    JOIN LATERAL (
      SELECT x.body, x.sender_role, x.created_at
        FROM public.member_support_messages x
       WHERE x.thread_id = t.id
       ORDER BY x.created_at DESC
       LIMIT 1
    ) l ON true
    LEFT JOIN LATERAL (
      SELECT c2.id, c2.full_name, c2.profile_picture_url, c2.service_tier
        FROM public.clients c2
       WHERE m.user_id IS NOT NULL AND c2.user_id = m.user_id
       ORDER BY (c2.service_tier = 'self_serve') DESC, c2.created_at
       LIMIT 1
    ) c ON true
   WHERE is_admin OR public.is_assigned_coach_for_member(t.member_id);
END;
$$;
REVOKE ALL ON FUNCTION public.staff_support_threads() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_support_threads() TO authenticated;
