CREATE OR REPLACE FUNCTION public.member_can_consume(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.app_members m
    WHERE m.user_id = _user_id
      AND COALESCE(m.manual_access_disabled, false) = false
      AND (
        COALESCE(m.manual_access_override, false) = true
        OR COALESCE(m.in_grace, false) = true
        OR (
          (m.access_end_date IS NULL OR m.access_end_date > now())
          AND lower(COALESCE(m.status, '')) NOT IN ('expired', 'cancelled', 'canceled')
          AND lower(COALESCE(m.subscription_status, '')) IN ('active', 'trialing', 'admin_granted')
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.member_has_access(_member_id uuid, _key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.member_access a
    WHERE a.member_id = _member_id
      AND a.access_level_key = _key
      AND a.active = true
      AND (a.expires_at IS NULL OR a.expires_at > now())
  )
  OR (
    _key IN ('app_membership', 'program_library', 'jf_membership')
    AND EXISTS (
      SELECT 1
      FROM public.app_members m
      WHERE m.id = _member_id
        AND public.member_can_consume(m.user_id)
        AND (
          COALESCE(m.manual_access_override, false) = true
          OR EXISTS (
            SELECT 1
            FROM public.member_access a
            WHERE a.member_id = _member_id
              AND a.access_level_key IN ('app_membership', 'program_library', 'jf_membership')
              AND a.active = true
              AND (a.expires_at IS NULL OR a.expires_at > now())
          )
        )
    )
  )
$$;

GRANT EXECUTE ON FUNCTION public.member_can_consume(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.member_has_access(uuid, text) TO authenticated, service_role;