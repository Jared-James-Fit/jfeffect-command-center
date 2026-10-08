-- Member athletes, step 2: a member's athlete profile on the pl_* engine.
--
-- ensure_member_athlete() returns the caller's clients row, creating a
-- member-kind one the first time a member builds a workout. The row has no
-- coach, status 'Member' (so no coaching automation that looks for 'Active'
-- picks it up) and no account_created_at (so client legal docs don't apply).
-- Requires an active membership. If the login already has a clients row
-- (a coaching client), that row is returned and nothing is created.
CREATE OR REPLACE FUNCTION public.ensure_member_athlete()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  cid uuid;
  mem record;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;

  -- One row per login, even if the app calls this twice at once.
  PERFORM pg_advisory_xact_lock(hashtext('ensure_member_athlete:' || uid::text));

  SELECT id INTO cid FROM public.clients
   WHERE user_id = uid
   ORDER BY (athlete_kind = 'coaching') DESC, created_at
   LIMIT 1;
  IF cid IS NOT NULL THEN
    RETURN cid;
  END IF;

  SELECT m.id, m.email, m.full_name INTO mem
    FROM public.app_members m
   WHERE m.user_id = uid AND NOT coalesce(m.is_admin_sandbox, false);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only members can build their own workouts' USING ERRCODE = '42501';
  END IF;
  IF NOT public.member_has_access(mem.id, 'app_membership') THEN
    RAISE EXCEPTION 'Your membership isn''t active' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.clients (user_id, email, full_name, athlete_kind, status)
  VALUES (uid, mem.email, coalesce(nullif(trim(mem.full_name), ''), mem.email, 'Member'), 'member', 'Member')
  RETURNING id INTO cid;
  RETURN cid;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_member_athlete() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_member_athlete() TO authenticated;
