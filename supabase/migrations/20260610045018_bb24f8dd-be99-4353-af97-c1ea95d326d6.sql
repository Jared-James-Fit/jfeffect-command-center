
-- 1) Loosen user_is_active so non-Deactivated/Inactive/Archived clients
--    (e.g. status='New Client') can read group chats they're in.
CREATE OR REPLACE FUNCTION public.user_is_active(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_coach_or_admin(_user_id)
    OR EXISTS (
      SELECT 1 FROM public.clients
       WHERE user_id = _user_id
         AND COALESCE(archived, false) = false
         AND COALESCE(status, '') NOT IN ('Deactivated','Inactive','Archived')
    )
    OR EXISTS (
      SELECT 1 FROM public.app_members
       WHERE user_id = _user_id AND status = 'Active'
    )
$$;

-- 2) Display info for fellow group members (safe, gated by membership)
CREATE OR REPLACE FUNCTION public.get_group_member_profiles(_group_id uuid)
RETURNS TABLE(user_id uuid, full_name text, avatar_url text, role text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;

  IF NOT (
    public.is_coach_or_admin(auth.uid())
    OR public.is_group_member(_group_id, auth.uid())
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    gm.user_id,
    COALESCE(p.full_name, c.full_name, co.full_name, 'Member') AS full_name,
    COALESCE(p.avatar_url, c.profile_picture_url) AS avatar_url,
    gm.role::text
  FROM public.chat_group_members gm
  LEFT JOIN public.profiles p ON p.id = gm.user_id
  LEFT JOIN public.clients  c ON c.user_id = gm.user_id
  LEFT JOIN public.coaches  co ON co.user_id = gm.user_id
  WHERE gm.group_id = _group_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_group_member_profiles(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_group_member_profiles(uuid) TO authenticated;

-- 3) Presence authorization for group chats
CREATE OR REPLACE FUNCTION public.can_access_group_presence(_topic text)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix text;
  v_id_text text;
  v_group_id uuid;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR _topic IS NULL THEN RETURN false; END IF;
  v_prefix := split_part(_topic, ':', 1);
  IF v_prefix <> 'group-presence' THEN RETURN false; END IF;
  v_id_text := split_part(_topic, ':', 2);
  IF v_id_text = '' THEN RETURN false; END IF;
  BEGIN
    v_group_id := v_id_text::uuid;
  EXCEPTION WHEN others THEN
    RETURN false;
  END;

  IF public.has_role(v_uid, 'admin'::app_role) THEN RETURN true; END IF;
  IF public.is_group_member(v_group_id, v_uid) THEN RETURN true; END IF;
  -- Active coaches can observe any group's presence
  IF EXISTS (
    SELECT 1 FROM public.coaches
     WHERE user_id = v_uid AND archived = false AND status = 'Active'
  ) THEN RETURN true; END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.can_access_group_presence(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_group_presence(text) TO authenticated;

DROP POLICY IF EXISTS "group presence read"  ON realtime.messages;
DROP POLICY IF EXISTS "group presence write" ON realtime.messages;

CREATE POLICY "group presence read"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  (realtime.topic() LIKE 'group-presence:%')
  AND public.can_access_group_presence(realtime.topic())
);

CREATE POLICY "group presence write"
ON realtime.messages
FOR INSERT
TO authenticated
WITH CHECK (
  (realtime.topic() LIKE 'group-presence:%')
  AND public.can_access_group_presence(realtime.topic())
);
