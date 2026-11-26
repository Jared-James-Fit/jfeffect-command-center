-- Specialists: people on the team who study an athlete without coaching them
-- (a game day coach, a performance specialist). docs/COACHING_PLATFORM.md §7.
--
-- A specialist is a staff-only login with the app role 'specialist' and a
-- membership in an organization (JF Effect today). It never holds 'coach' or
-- 'admin', so none of the policies and functions that trust those roles let
-- one in. What a specialist sees is decided here and nowhere else:
--
--   specialist_can_view(client, category) is true only when, all at once,
--   - the login holds 'specialist' (and has its two-step sign-in when it has one),
--   - its specialist record is active and its organization membership active,
--   - an access row names that athlete, is active and has that category on
--     (footage, training, performance),
--   - the athlete agreed to share (or is the person who granted it: the
--     owner's own athlete account),
--   - the athlete's account is open (not archived, deactivated or deleted).
--
-- Every read a specialist makes goes through a server function that asks
-- this with the caller's own login before reading anything, and returns only
-- the fields that category allows (never a coach's notes or a program's
-- private notes). Nothing here widens any existing policy.
--
-- Notes a specialist leaves are private to their author unless they share one
-- with the athlete. No admin, coach or Cleo policy reads them.

SET lock_timeout = '5s';

-- ── Membership: specialists belong to the organization ─────────────────────
ALTER TABLE public.organization_members DROP CONSTRAINT IF EXISTS organization_members_role_check;
ALTER TABLE public.organization_members ADD CONSTRAINT organization_members_role_check
  CHECK (role IN ('owner', 'admin', 'coach', 'finance', 'specialist'));

CREATE OR REPLACE FUNCTION public._jf_member_sync(_uid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  want text;
  cur public.organization_members;
  had boolean;
  who text;
BEGIN
  IF _uid IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = _uid) THEN
    RETURN;
  END IF;

  SELECT CASE
           WHEN EXISTS (SELECT 1 FROM public.business_owners WHERE user_id = _uid)
                AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role = 'admin') THEN 'owner'
           WHEN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role = 'admin') THEN 'admin'
           WHEN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role = 'coach') THEN 'coach'
           WHEN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role = 'finance') THEN 'finance'
           WHEN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role::text = 'specialist') THEN 'specialist'
         END
    INTO want;

  SELECT * INTO cur FROM public.organization_members WHERE org_id = public.jf_org_id() AND user_id = _uid;
  had := FOUND;
  SELECT coalesce(nullif(btrim(p.full_name), ''), u.email, 'A teammate')
    INTO who
    FROM auth.users u LEFT JOIN public.profiles p ON p.id = u.id
   WHERE u.id = _uid;

  IF want IS NULL THEN
    IF had AND cur.status = 'active' THEN
      UPDATE public.organization_members
         SET status = 'revoked', revoked_at = now(), updated_at = now()
       WHERE org_id = public.jf_org_id() AND user_id = _uid;
      PERFORM public._org_audit(public.jf_org_id(), 'member.revoked', 'member', _uid,
        who || ' no longer has team access', jsonb_build_object('role', cur.role));
    END IF;
    RETURN;
  END IF;

  IF NOT had THEN
    INSERT INTO public.organization_members (org_id, user_id, role) VALUES (public.jf_org_id(), _uid, want);
    PERFORM public._org_audit(public.jf_org_id(), 'member.added', 'member', _uid,
      who || ' joined the team as ' || want, jsonb_build_object('role', want));
  ELSIF cur.status <> 'active' THEN
    UPDATE public.organization_members
       SET status = 'active', role = want, revoked_at = NULL, updated_at = now()
     WHERE org_id = public.jf_org_id() AND user_id = _uid;
    PERFORM public._org_audit(public.jf_org_id(), 'member.restored', 'member', _uid,
      who || '''s team access is back (' || want || ')', jsonb_build_object('role', want));
  ELSIF cur.role <> want THEN
    UPDATE public.organization_members SET role = want, updated_at = now()
     WHERE org_id = public.jf_org_id() AND user_id = _uid;
    PERFORM public._org_audit(public.jf_org_id(), 'member.role_changed', 'member', _uid,
      who || ' is now ' || want || ' (was ' || cur.role || ')', jsonb_build_object('from', cur.role, 'to', want));
  END IF;
END $$;

REVOKE ALL ON FUNCTION public._jf_member_sync(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._jf_member_sync(uuid) TO service_role;

-- ── Staff invites: hashed tokens, a verified email, specialist access ──────
-- No pending invite holds a token today (checked Nov 26 2026), so moving to
-- hashed tokens strands nobody. The plain setup_token column stays for
-- history and is never written again.
ALTER TABLE public.staff_invites ALTER COLUMN email DROP NOT NULL;
ALTER TABLE public.staff_invites
  ADD COLUMN IF NOT EXISTS setup_token_hash text,
  ADD COLUMN IF NOT EXISTS preset text,
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS access jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS code_hash text,
  ADD COLUMN IF NOT EXISTS code_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS code_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS code_sent_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS staff_invites_token_hash ON public.staff_invites (setup_token_hash) WHERE setup_token_hash IS NOT NULL;

ALTER TABLE public.staff_invites DROP CONSTRAINT IF EXISTS staff_invites_status_check;
ALTER TABLE public.staff_invites ADD CONSTRAINT staff_invites_status_check
  CHECK (status IN ('draft', 'pending', 'redeemed', 'revoked'));
ALTER TABLE public.staff_invites DROP CONSTRAINT IF EXISTS staff_invites_email_unless_draft;
ALTER TABLE public.staff_invites ADD CONSTRAINT staff_invites_email_unless_draft
  CHECK (status = 'draft' OR email IS NOT NULL);
ALTER TABLE public.staff_invites DROP CONSTRAINT IF EXISTS staff_invites_specialist_shape;
ALTER TABLE public.staff_invites ADD CONSTRAINT staff_invites_specialist_shape
  CHECK (role::text <> 'specialist'
         OR (preset IN ('game_day_coach', 'performance_specialist')
             AND title IS NOT NULL AND length(btrim(title)) BETWEEN 1 AND 60
             AND jsonb_typeof(access) = 'array'));

-- ── team_specialists ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.team_specialists (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id uuid NOT NULL DEFAULT public.jf_org_id() REFERENCES public.organizations(id) ON DELETE CASCADE,
  preset text NOT NULL CHECK (preset IN ('game_day_coach', 'performance_specialist')),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 60),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  display_name text CHECK (display_name IS NULL OR length(btrim(display_name)) BETWEEN 1 AND 60),
  phone text CHECK (phone IS NULL OR length(phone) BETWEEN 7 AND 30),
  time_zone text CHECK (time_zone IS NULL OR length(time_zone) BETWEEN 3 AND 64),
  headshot_path text CHECK (headshot_path IS NULL OR length(headshot_path) BETWEEN 3 AND 300),
  confidentiality_text text,
  confidentiality_at timestamptz,
  profile_completed_at timestamptz,
  invite_id uuid REFERENCES public.staff_invites(id) ON DELETE SET NULL,
  invited_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS team_specialists_org ON public.team_specialists (org_id);

DROP TRIGGER IF EXISTS team_specialists_updated_at ON public.team_specialists;
CREATE TRIGGER team_specialists_updated_at BEFORE UPDATE ON public.team_specialists
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ── specialist_access ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.specialist_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT public.jf_org_id() REFERENCES public.organizations(id) ON DELETE CASCADE,
  specialist_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  footage boolean NOT NULL DEFAULT true,
  training boolean NOT NULL DEFAULT true,
  performance boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  -- The athlete's yes (or the grant being the athlete's own: the owner sharing their own training).
  athlete_ok_at timestamptz,
  athlete_ok_by text CHECK (athlete_ok_by IS NULL OR athlete_ok_by IN ('athlete', 'self')),
  athlete_withdrew_at timestamptz,
  granted_by uuid,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (specialist_user_id, client_id)
);
CREATE INDEX IF NOT EXISTS specialist_access_client ON public.specialist_access (client_id) WHERE status = 'active';

/** (internal) Are these two logins the same person (one is the other's linked athlete or staff login)? */
CREATE OR REPLACE FUNCTION public._team_same_person(_a uuid, _b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT _a IS NOT NULL AND _b IS NOT NULL AND (
    _a = _b
    OR EXISTS (SELECT 1 FROM public.community_profiles cp
                WHERE (cp.user_id = _a AND cp.same_person_as = _b)
                   OR (cp.user_id = _b AND cp.same_person_as = _a))
  )
$$;

REVOKE ALL ON FUNCTION public._team_same_person(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._team_same_person(uuid, uuid) TO service_role;

/**
 * Access rows keep themselves straight, whoever writes them: a grant by the
 * athlete themselves (the owner sharing their own training) is agreed at
 * once; any other grant waits for the athlete; a revoked row keeps its time.
 */
CREATE OR REPLACE FUNCTION public.tg_specialist_access_shape()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  athlete uuid;
BEGIN
  NEW.updated_at := now();
  IF NEW.status = 'revoked' AND NEW.revoked_at IS NULL THEN
    NEW.revoked_at := now();
  END IF;
  IF NEW.status = 'active' THEN
    NEW.revoked_at := NULL;
    IF TG_OP = 'UPDATE' AND (
         OLD.status = 'revoked'
         -- a category the athlete never agreed to: their earlier yes doesn't cover it
         OR (NEW.footage AND NOT OLD.footage)
         OR (NEW.training AND NOT OLD.training)
         OR (NEW.performance AND NOT OLD.performance)
       ) THEN
      -- access given again or widened: the athlete's earlier answer doesn't carry over
      NEW.athlete_ok_at := NULL;
      NEW.athlete_ok_by := NULL;
      NEW.athlete_withdrew_at := NULL;
    END IF;
    IF NEW.athlete_ok_at IS NULL THEN
      SELECT user_id INTO athlete FROM public.clients WHERE id = NEW.client_id;
      IF public._team_same_person(NEW.granted_by, athlete) THEN
        NEW.athlete_ok_at := now();
        NEW.athlete_ok_by := 'self';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.tg_specialist_access_shape() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS specialist_access_shape ON public.specialist_access;
CREATE TRIGGER specialist_access_shape BEFORE INSERT OR UPDATE ON public.specialist_access
  FOR EACH ROW EXECUTE FUNCTION public.tg_specialist_access_shape();

/** Every change to who a specialist can see goes in the organization's access record. */
CREATE OR REPLACE FUNCTION public.tg_specialist_access_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  who text;
  athlete text;
  what text;
  action text;
BEGIN
  SELECT coalesce(nullif(btrim(s.display_name), ''), nullif(btrim(p.full_name), ''), 'A specialist')
    INTO who
    FROM auth.users u
    LEFT JOIN public.team_specialists s ON s.user_id = u.id
    LEFT JOIN public.profiles p ON p.id = u.id
   WHERE u.id = NEW.specialist_user_id;
  SELECT coalesce(nullif(btrim(full_name), ''), 'an athlete') INTO athlete FROM public.clients WHERE id = NEW.client_id;
  what := concat_ws(', ',
    CASE WHEN NEW.footage THEN 'footage' END,
    CASE WHEN NEW.training THEN 'training' END,
    CASE WHEN NEW.performance THEN 'performance' END);
  IF TG_OP = 'INSERT' THEN
    action := 'specialist.access_granted';
  ELSIF NEW.status <> OLD.status THEN
    action := CASE WHEN NEW.status = 'revoked' THEN 'specialist.access_revoked' ELSE 'specialist.access_granted' END;
  ELSIF NEW.athlete_ok_at IS DISTINCT FROM OLD.athlete_ok_at AND NEW.athlete_ok_at IS NOT NULL THEN
    action := 'specialist.athlete_agreed';
  ELSIF (NEW.footage, NEW.training, NEW.performance) IS DISTINCT FROM (OLD.footage, OLD.training, OLD.performance) THEN
    action := 'specialist.access_changed';
  ELSE
    RETURN NULL;
  END IF;
  PERFORM public._org_audit(NEW.org_id, action, 'member', NEW.specialist_user_id,
    CASE action
      WHEN 'specialist.access_revoked' THEN who || ' can no longer see ' || athlete
      WHEN 'specialist.athlete_agreed' THEN athlete || ' agreed to share with ' || who
      ELSE who || ' can see ' || athlete || '''s ' || coalesce(nullif(what, ''), 'nothing')
    END,
    jsonb_build_object('client_id', NEW.client_id, 'footage', NEW.footage, 'training', NEW.training,
                       'performance', NEW.performance, 'status', NEW.status));
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.tg_specialist_access_audit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS specialist_access_audit ON public.specialist_access;
CREATE TRIGGER specialist_access_audit AFTER INSERT OR UPDATE ON public.specialist_access
  FOR EACH ROW EXECUTE FUNCTION public.tg_specialist_access_audit();

CREATE OR REPLACE FUNCTION public.tg_team_specialists_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  who text := coalesce(nullif(btrim(NEW.display_name), ''), 'A specialist');
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public._org_audit(NEW.org_id, 'specialist.added', 'member', NEW.user_id,
      who || ' joined as ' || NEW.title, jsonb_build_object('preset', NEW.preset));
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public._org_audit(NEW.org_id,
      CASE WHEN NEW.status = 'suspended' THEN 'specialist.suspended' ELSE 'specialist.reactivated' END,
      'member', NEW.user_id,
      who || CASE WHEN NEW.status = 'suspended' THEN ' was suspended' ELSE ' is active again' END,
      jsonb_build_object('preset', NEW.preset));
  ELSIF NEW.title IS DISTINCT FROM OLD.title OR NEW.preset IS DISTINCT FROM OLD.preset THEN
    PERFORM public._org_audit(NEW.org_id, 'specialist.role_changed', 'member', NEW.user_id,
      who || ' is now ' || NEW.title, jsonb_build_object('preset', NEW.preset, 'was', OLD.title));
  END IF;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.tg_team_specialists_audit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS team_specialists_audit ON public.team_specialists;
CREATE TRIGGER team_specialists_audit AFTER INSERT OR UPDATE ON public.team_specialists
  FOR EACH ROW EXECUTE FUNCTION public.tg_team_specialists_audit();

-- ── Footage the owner keeps from specialists, and what a specialist watched ─
CREATE TABLE IF NOT EXISTS public.specialist_hidden_videos (
  set_video_id uuid PRIMARY KEY REFERENCES public.pl_set_videos(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  hidden_by uuid,
  hidden_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS specialist_hidden_videos_client ON public.specialist_hidden_videos (client_id);

CREATE TABLE IF NOT EXISTS public.specialist_video_views (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  set_video_id uuid NOT NULL REFERENCES public.pl_set_videos(id) ON DELETE CASCADE,
  watched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, set_video_id)
);

-- ── specialist_notes: private observations, optionally shared ──────────────
CREATE TABLE IF NOT EXISTS public.specialist_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  author_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_kind text NOT NULL CHECK (target_kind IN ('set_video', 'set', 'session')),
  target_id uuid NOT NULL,
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 2000),
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'shared')),
  shared_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS specialist_notes_author ON public.specialist_notes (author_user_id, client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS specialist_notes_shared ON public.specialist_notes (client_id, target_kind, target_id) WHERE visibility = 'shared';

CREATE OR REPLACE FUNCTION public.tg_specialist_notes_shape()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.visibility = 'shared' AND (TG_OP = 'INSERT' OR OLD.visibility <> 'shared') THEN
    NEW.shared_at := now();
  ELSIF NEW.visibility = 'private' THEN
    NEW.shared_at := NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.author_user_id <> OLD.author_user_id OR NEW.client_id <> OLD.client_id
                           OR NEW.target_kind <> OLD.target_kind OR NEW.target_id <> OLD.target_id) THEN
    RAISE EXCEPTION 'A note stays on what it was written about' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS specialist_notes_shape ON public.specialist_notes;
CREATE TRIGGER specialist_notes_shape BEFORE INSERT OR UPDATE ON public.specialist_notes
  FOR EACH ROW EXECUTE FUNCTION public.tg_specialist_notes_shape();

-- ── The one access rule ────────────────────────────────────────────────────

/**
 * May the signed-in specialist see this athlete's footage / training /
 * performance right now? Every specialist server function asks this with the
 * caller's own login before it reads anything.
 */
CREATE OR REPLACE FUNCTION public.specialist_can_view(_client uuid, _category text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT auth.uid() IS NOT NULL
     AND _category IN ('footage', 'training', 'performance')
     AND public.has_role(auth.uid(), 'specialist')
     AND EXISTS (
       SELECT 1
         FROM public.team_specialists s
         JOIN public.organizations o ON o.id = s.org_id AND o.status = 'active'
         JOIN public.organization_members m
           ON m.user_id = s.user_id AND m.org_id = s.org_id AND m.status = 'active' AND m.role = 'specialist'
         JOIN public.specialist_access a
           ON a.specialist_user_id = s.user_id AND a.org_id = s.org_id
         JOIN public.clients c ON c.id = a.client_id
        WHERE s.user_id = auth.uid()
          AND s.status = 'active'
          AND a.client_id = _client
          AND a.status = 'active'
          AND a.athlete_ok_at IS NOT NULL
          AND coalesce(c.archived, false) = false
          AND coalesce(c.status, '') NOT IN ('Deactivated', 'Deleted')
          AND CASE _category WHEN 'footage' THEN a.footage WHEN 'training' THEN a.training ELSE a.performance END
     )
$$;

REVOKE ALL ON FUNCTION public.specialist_can_view(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.specialist_can_view(uuid, text) TO authenticated, service_role;

/** The signed-in specialist's athletes and what each one shares (empty for anyone else). */
CREATE OR REPLACE FUNCTION public.specialist_my_athletes()
RETURNS TABLE (client_id uuid, footage boolean, training boolean, performance boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT a.client_id,
         a.footage AND public.specialist_can_view(a.client_id, 'footage'),
         a.training AND public.specialist_can_view(a.client_id, 'training'),
         a.performance AND public.specialist_can_view(a.client_id, 'performance')
    FROM public.specialist_access a
   WHERE a.specialist_user_id = auth.uid() AND a.status = 'active' AND a.athlete_ok_at IS NOT NULL
     AND (public.specialist_can_view(a.client_id, 'footage')
          OR public.specialist_can_view(a.client_id, 'training')
          OR public.specialist_can_view(a.client_id, 'performance'))
$$;

REVOKE ALL ON FUNCTION public.specialist_my_athletes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.specialist_my_athletes() TO authenticated, service_role;

-- ── The athlete's side: who can see their training, and their yes or no ────

/** (internal) The athlete accounts the signed-in person answers for: their own, and their linked one. */
CREATE OR REPLACE FUNCTION public._my_athlete_client_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT c.id FROM public.clients c WHERE c.user_id = auth.uid() AND auth.uid() IS NOT NULL
  UNION
  SELECT public.linked_client_id() WHERE public.linked_client_id() IS NOT NULL
$$;

REVOKE ALL ON FUNCTION public._my_athlete_client_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._my_athlete_client_ids() TO authenticated, service_role;

/** Everyone on the team who has (or asked for) access to the signed-in athlete's training. */
CREATE OR REPLACE FUNCTION public.my_team_access()
RETURNS TABLE (
  access_id uuid, client_id uuid, name text, title text,
  footage boolean, training boolean, performance boolean,
  agreed boolean, agreed_at timestamptz, granted_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT a.id, a.client_id,
         coalesce(nullif(btrim(s.display_name), ''), nullif(btrim(p.full_name), ''), 'Your team'),
         s.title, a.footage, a.training, a.performance,
         a.athlete_ok_at IS NOT NULL, a.athlete_ok_at, a.granted_at
    FROM public.specialist_access a
    JOIN public.team_specialists s ON s.user_id = a.specialist_user_id
    LEFT JOIN public.profiles p ON p.id = a.specialist_user_id
   WHERE a.status = 'active'
     AND s.status = 'active'
     AND a.client_id IN (SELECT public._my_athlete_client_ids())
   ORDER BY a.granted_at
$$;

REVOKE ALL ON FUNCTION public.my_team_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_team_access() TO authenticated, service_role;

/** The athlete says yes (share) or no (stop sharing) to one specialist's access. */
CREATE OR REPLACE FUNCTION public.specialist_access_respond(_access_id uuid, _allow boolean)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  acc public.specialist_access;
BEGIN
  SELECT * INTO acc FROM public.specialist_access WHERE id = _access_id;
  IF NOT FOUND OR acc.client_id NOT IN (SELECT public._my_athlete_client_ids()) THEN
    RETURN 'not_found';
  END IF;
  IF acc.status <> 'active' THEN
    RETURN 'not_active';
  END IF;
  IF _allow THEN
    UPDATE public.specialist_access
       SET athlete_ok_at = coalesce(athlete_ok_at, now()), athlete_ok_by = coalesce(athlete_ok_by, 'athlete'),
           athlete_withdrew_at = NULL
     WHERE id = _access_id;
    RETURN 'allowed';
  END IF;
  UPDATE public.specialist_access
     SET status = 'revoked', athlete_ok_at = NULL, athlete_ok_by = NULL, athlete_withdrew_at = now()
   WHERE id = _access_id;
  RETURN 'stopped';
END $$;

REVOKE ALL ON FUNCTION public.specialist_access_respond(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.specialist_access_respond(uuid, boolean) TO authenticated;

/** Notes a specialist shared with the signed-in athlete (never a private one). */
CREATE OR REPLACE FUNCTION public.my_shared_team_notes(_target_kind text DEFAULT NULL, _target_id uuid DEFAULT NULL)
RETURNS TABLE (
  id uuid, client_id uuid, target_kind text, target_id uuid, body text,
  author_name text, author_title text, shared_at timestamptz, updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT n.id, n.client_id, n.target_kind, n.target_id, n.body,
         coalesce(nullif(btrim(s.display_name), ''), nullif(btrim(p.full_name), ''), 'Your team'),
         s.title, n.shared_at, n.updated_at
    FROM public.specialist_notes n
    LEFT JOIN public.team_specialists s ON s.user_id = n.author_user_id
    LEFT JOIN public.profiles p ON p.id = n.author_user_id
   WHERE n.visibility = 'shared'
     AND n.client_id IN (SELECT public._my_athlete_client_ids())
     AND (_target_kind IS NULL OR n.target_kind = _target_kind)
     AND (_target_id IS NULL OR n.target_id = _target_id)
   ORDER BY n.shared_at DESC NULLS LAST
   LIMIT 200
$$;

REVOKE ALL ON FUNCTION public.my_shared_team_notes(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_shared_team_notes(text, uuid) TO authenticated;

-- ── Row-level security ─────────────────────────────────────────────────────
-- Reads only; every write is the server's (service role) after its checks,
-- or the definer functions above.
ALTER TABLE public.team_specialists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.specialist_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.specialist_hidden_videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.specialist_video_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.specialist_notes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.team_specialists, public.specialist_access, public.specialist_hidden_videos,
              public.specialist_video_views, public.specialist_notes FROM anon, authenticated;
GRANT SELECT ON public.team_specialists, public.specialist_access, public.specialist_hidden_videos,
                public.specialist_video_views, public.specialist_notes TO authenticated;
GRANT ALL ON public.team_specialists, public.specialist_access, public.specialist_hidden_videos,
             public.specialist_video_views, public.specialist_notes TO service_role;

DROP POLICY IF EXISTS "Specialists read their own record" ON public.team_specialists;
CREATE POLICY "Specialists read their own record" ON public.team_specialists
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "Org admins read their specialists" ON public.team_specialists;
CREATE POLICY "Org admins read their specialists" ON public.team_specialists
  FOR SELECT TO authenticated USING (org_id IN (SELECT public.my_admin_org_ids()));

DROP POLICY IF EXISTS "Specialists read their own access" ON public.specialist_access;
CREATE POLICY "Specialists read their own access" ON public.specialist_access
  FOR SELECT TO authenticated USING (specialist_user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "Org admins read specialist access" ON public.specialist_access;
CREATE POLICY "Org admins read specialist access" ON public.specialist_access
  FOR SELECT TO authenticated USING (org_id IN (SELECT public.my_admin_org_ids()));

DROP POLICY IF EXISTS "Org admins read hidden footage" ON public.specialist_hidden_videos;
CREATE POLICY "Org admins read hidden footage" ON public.specialist_hidden_videos
  FOR SELECT TO authenticated USING ((SELECT public.is_org_admin(public.jf_org_id())));

DROP POLICY IF EXISTS "Read your own watched videos" ON public.specialist_video_views;
CREATE POLICY "Read your own watched videos" ON public.specialist_video_views
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

-- A note is its author's; the athlete reads only shared ones through
-- my_shared_team_notes(). Deliberately no admin, coach or staff policy.
DROP POLICY IF EXISTS "Authors read their own notes" ON public.specialist_notes;
CREATE POLICY "Authors read their own notes" ON public.specialist_notes
  FOR SELECT TO authenticated USING (author_user_id = (SELECT auth.uid()));

-- ── Jesse: a Game Day Coach invite, ready to send ──────────────────────────
-- Waits as a draft (no email, no link) until the owner adds Jesse's email on
-- the Team page. Access starts with the owner's own athlete account only.
DO $$
DECLARE
  owner_uid uuid;
  athlete uuid;
BEGIN
  SELECT user_id INTO owner_uid FROM public.business_owners ORDER BY created_at NULLS LAST LIMIT 1;
  IF EXISTS (SELECT 1 FROM public.staff_invites
              WHERE role::text = 'specialist' AND preset = 'game_day_coach'
                AND lower(coalesce(first_name, '')) = 'jesse') THEN
    RETURN;
  END IF;
  SELECT c.id INTO athlete
    FROM public.community_profiles cp
    JOIN public.clients c ON c.user_id = cp.same_person_as
   WHERE cp.user_id = owner_uid
   LIMIT 1;
  INSERT INTO public.staff_invites (first_name, role, status, preset, title, access, created_by)
  VALUES ('Jesse', 'specialist', 'draft', 'game_day_coach', 'Game Day Coach',
          CASE WHEN athlete IS NULL THEN '[]'::jsonb
               ELSE jsonb_build_array(jsonb_build_object('client_id', athlete, 'footage', true, 'training', true, 'performance', true))
          END,
          owner_uid);
END $$;

RESET lock_timeout;
