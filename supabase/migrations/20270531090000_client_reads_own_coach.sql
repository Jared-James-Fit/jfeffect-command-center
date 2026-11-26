-- A client reads their own coach: name, photo, and the phone only when the
-- coach lets them call or text.
--
-- Clients have no read on `coaches` (its policies are the admin's and the
-- coach's own row), so the client's Messages asked for its coach and got
-- nothing back: the pinned row read the placeholder "Coach Jared" with
-- initials instead of the coach's photo, and Call / Text never showed for any
-- client, though all of them had it switched on (the phone came back empty).
-- It only ever looked right to staff in View as client, who can read the table.
--
-- The photo is the coach's Crew photo, else their team photo
-- (community_avatar), which every signed-in person may already open
-- (avatar_is_shared). Nobody else's coach is ever returned: the caller must be
-- that client's own login, the login linked to it, an admin, or its coach.

CREATE OR REPLACE FUNCTION public.my_coach(_client_id uuid)
RETURNS TABLE (id uuid, user_id uuid, full_name text, photo text, phone text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT co.id,
         co.user_id,
         co.full_name,
         COALESCE(public.community_avatar(co.user_id), co.profile_picture_url) AS photo,
         CASE WHEN c.coach_call_access_enabled OR c.coach_sms_access_enabled THEN co.phone END AS phone
  FROM public.clients c
  JOIN public.coaches co ON co.id = c.assigned_coach_id
  WHERE c.id = _client_id
    AND (SELECT auth.uid()) IS NOT NULL
    AND (
      c.user_id = (SELECT auth.uid())
      OR c.id = (SELECT public.linked_client_id())
      OR (SELECT public.has_role((SELECT auth.uid()), 'admin'))
      OR c.id IN (SELECT public.coached_client_ids())
    )
$$;

REVOKE ALL ON FUNCTION public.my_coach(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_coach(uuid) TO authenticated;
COMMENT ON FUNCTION public.my_coach(uuid) IS 'A client''s own coach (name, photo, phone when call/text is on): 20270531090000_client_reads_own_coach.sql';
