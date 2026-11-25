-- A staff member's own athlete account passes the AI-permission check, like their staff login
-- (Nov 25 2026).
--
-- ai_consent_ok passed a staff login, and a login whose community profile points at its athlete
-- account (`same_person_as`), but not the athlete account it points at. A coach who trains as an
-- athlete on a linked account (Jared: staff login 0076110b → athlete account 3d502a48) was refused
-- on his own records: his Competition "Write a new version" failed with "Jared hasn't allowed their
-- data to be sent to AI services", and the consent prompt is never shown to staff or in their
-- client view, so there was nowhere to say yes. It's the same person's own data and their own work,
-- which is what the staff rule is for. Only an account that a staff login names as itself passes;
-- every client and member still needs their own permission.

CREATE OR REPLACE FUNCTION public.ai_consent_ok(_user uuid, _version integer)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT _user IS NOT NULL AND (
    public._account_is_staff(_user)
    -- the athlete account a staff login is linked to (same person)
    OR EXISTS (
      SELECT 1 FROM public.community_profiles cp
      JOIN public.user_roles ur ON ur.user_id = cp.user_id AND ur.role::text <> 'client'
      WHERE cp.same_person_as = _user)
    OR EXISTS (
      SELECT 1 FROM public.ai_data_consents c
      WHERE c.user_id = _user AND c.granted AND c.text_version >= _version));
$$;
REVOKE ALL ON FUNCTION public.ai_consent_ok(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_consent_ok(uuid, integer) TO service_role;
