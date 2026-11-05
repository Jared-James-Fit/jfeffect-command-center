-- JF Effect as a free platform, release 1.
--
-- 1. Free accounts: a JF member with subscription_status 'Free' has access,
--    in all three checks (member_can_consume, jf_member_has_full_access and
--    isMemberAccessActive in memberAccess.ts). Nobody was paying for the
--    membership (one member ever, cancelled in June), so no billing changes.
-- 2. A self-signed-up login is never linked to a coach's client record by
--    email before that email is confirmed (handle_new_user), and confirming it
--    never links one either: a coaching client's record is linked only by the
--    coach's invite (invited_at) or a staff-created login (confirmed at
--    creation). Otherwise anyone could register a client's email with their
--    own password and get in the moment the real client tapped "Confirm".
-- 3. member_free_join: the confirmed login becomes a free JF member (an
--    app_members row, default access, a self-serve clients row). Run by the
--    confirmation trigger and, as a self-heal, by the app.
-- 4. Crew reports (community_reports): anyone can report a post, comment,
--    program or profile; staff review them (remove / dismiss).
-- 5. Athlete programs (athlete_programs): programs people build themselves,
--    kept apart from the coach's pl_templates (admins read every template, so
--    member-made ones would flood the coach's library, pickers and Cleo).
--    Publishing shares the program with the crew; anyone who can see it can
--    save their own copy (the original never changes) and a self-serve member
--    starts their own copy as a pl_block they own, on the same engine as
--    every other program.

-- ---------------------------------------------------------------------------
-- 1. Free counts as access
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.member_can_consume(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
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
          AND (
            lower(btrim(COALESCE(m.subscription_status, ''))) IN ('active', 'trialing', 'admin_granted', 'complimentary', 'free')
            OR (lower(btrim(COALESCE(m.subscription_status, ''))) = 'active (cancels at period end)'
                AND COALESCE(m.cancel_at, m.current_period_end, 'infinity'::timestamptz) > now())
          )
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.jf_member_has_full_access(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_members
     WHERE user_id = _user_id
       AND account_type = 'jf_member'
       AND status = 'Active'
       AND (
         subscription_status IN ('Trialing', 'Active', 'Complimentary', 'Free')
         OR (subscription_status = 'Active (Cancels at period end)'
             AND COALESCE(cancel_at, current_period_end, 'infinity'::timestamptz) > now())
       )
  )
$$;

-- ---------------------------------------------------------------------------
-- 2. Link a coach's client record only for invited / staff-created logins
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));

  IF coalesce(NEW.raw_app_meta_data->>'account_kind', '') = 'staff' THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'client')
  ON CONFLICT DO NOTHING;

  -- Link to the coach's client record by email only when the coach invited
  -- this login or staff created it (both own the email). A public sign-up is
  -- unconfirmed here: linking it would hand the client's record to whoever
  -- typed their email.
  IF NEW.invited_at IS NOT NULL OR NEW.email_confirmed_at IS NOT NULL THEN
    UPDATE public.clients
       SET user_id = NEW.id,
           account_status = 'Account Created',
           account_created_at = now()
     WHERE lower(email) = lower(NEW.email)
       AND user_id IS NULL;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. A confirmed login becomes a free JF member
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._member_free_join(_uid uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  u record;
  v_member uuid;
  v_type text;
  v_client uuid;
  v_name text;
BEGIN
  SELECT id, email, email_confirmed_at, raw_user_meta_data INTO u FROM auth.users WHERE id = _uid;
  IF NOT FOUND OR u.email IS NULL THEN
    RETURN jsonb_build_object('status', 'no_user');
  END IF;
  IF u.email_confirmed_at IS NULL THEN
    RETURN jsonb_build_object('status', 'unconfirmed');
  END IF;
  -- staff logins never become members
  IF EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _uid AND r.role IN ('admin', 'coach', 'finance')) THEN
    RETURN jsonb_build_object('status', 'staff');
  END IF;
  -- already an athlete (a coaching client or a member)
  SELECT c.id INTO v_client FROM public.clients c WHERE c.user_id = _uid;
  IF v_client IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'athlete', 'client_id', v_client);
  END IF;
  -- a coach already set this person up: their invite links it, never a second record
  IF EXISTS (SELECT 1 FROM public.clients c
              WHERE c.user_id IS NULL AND lower(c.email) = lower(u.email)
                AND coalesce(c.archived, false) = false) THEN
    RETURN jsonb_build_object('status', 'coach_account');
  END IF;

  v_name := left(coalesce(nullif(btrim(u.raw_user_meta_data->>'full_name'), ''), split_part(u.email, '@', 1)), 120);

  SELECT m.id, m.account_type INTO v_member, v_type FROM public.app_members m WHERE m.user_id = _uid;
  IF v_member IS NULL THEN
    INSERT INTO public.app_members (user_id, email, full_name, account_type, status, subscription_status)
    VALUES (_uid, lower(u.email), v_name, 'jf_member', 'Active', 'Free')
    RETURNING id INTO v_member;
  ELSIF v_type <> 'jf_member' THEN
    RETURN jsonb_build_object('status', 'other_account');
  ELSE
    -- a member row with no billing state (never checked out) is a free member
    UPDATE public.app_members SET subscription_status = 'Free'
     WHERE id = v_member AND nullif(btrim(coalesce(subscription_status, '')), '') IS NULL;
  END IF;

  PERFORM public.apply_default_member_access(v_member);
  v_client := public.ensure_member_client(v_member);
  RETURN jsonb_build_object('status', 'member', 'member_id', v_member, 'client_id', v_client);
END;
$$;
REVOKE ALL ON FUNCTION public._member_free_join(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.member_free_join()
RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE WHEN auth.uid() IS NULL THEN jsonb_build_object('status', 'signed_out')
              ELSE public._member_free_join(auth.uid()) END
$$;
REVOKE ALL ON FUNCTION public.member_free_join() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_free_join() TO authenticated;

-- The moment a free sign-up confirms their email (never fails the confirmation)
CREATE OR REPLACE FUNCTION public.tg_auth_user_free_join()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL
     AND coalesce(NEW.raw_user_meta_data->>'jf_signup', '') = 'free' THEN
    BEGIN
      PERFORM public._member_free_join(NEW.id);
    EXCEPTION WHEN others THEN
      RAISE WARNING 'member_free_join(%): %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_auth_user_free_join() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS auth_user_free_join ON auth.users;
CREATE TRIGGER auth_user_free_join AFTER UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.tg_auth_user_free_join();

-- ---------------------------------------------------------------------------
-- 5 (first, reports point at it). Athlete programs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.athlete_programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 80),
  description text CHECK (description IS NULL OR char_length(description) <= 1000),
  goal text CHECK (goal IS NULL OR goal IN ('strength', 'muscle', 'fat_loss', 'powerlifting', 'general', 'athletic')),
  level text CHECK (level IS NULL OR level IN ('beginner', 'intermediate', 'advanced')),
  weeks integer NOT NULL DEFAULT 4 CHECK (weeks BETWEEN 1 AND 16),
  -- [{ title, focus, exercises: [{ exercise_id, sets, reps, rpe, rest_seconds, notes }] }]
  days jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(days) = 'array'),
  days_per_week integer NOT NULL DEFAULT 0,
  exercise_count integer NOT NULL DEFAULT 0,
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'community')),
  published_at timestamptz,
  forked_from uuid REFERENCES public.athlete_programs(id) ON DELETE SET NULL,
  forked_from_owner uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  hidden_at timestamptz,
  hidden_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  hidden_reason text,
  archived_at timestamptz,
  save_count integer NOT NULL DEFAULT 0,
  start_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS athlete_programs_owner_idx ON public.athlete_programs (owner_id, updated_at DESC) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS athlete_programs_community_idx ON public.athlete_programs (published_at DESC)
  WHERE visibility = 'community' AND hidden_at IS NULL AND archived_at IS NULL;
CREATE INDEX IF NOT EXISTS athlete_programs_forked_idx ON public.athlete_programs (forked_from) WHERE forked_from IS NOT NULL;

ALTER TABLE public.athlete_programs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.athlete_programs FROM anon;
GRANT SELECT ON public.athlete_programs TO authenticated;
GRANT ALL ON public.athlete_programs TO service_role;
-- Reads of other people's programs go through the RPCs below (they apply
-- privacy and blocks); the table itself shows only your own, and staff all.
DROP POLICY IF EXISTS "Own athlete programs" ON public.athlete_programs;
CREATE POLICY "Own athlete programs" ON public.athlete_programs FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()) OR (SELECT public.is_community_staff()));

/** Who can see a program: its owner, else a crew-shared one that isn't taken
    down, whose owner hasn't blocked you (or you them) and is public or followed
    by you; staff see every shared one, taken down or not. */
CREATE OR REPLACE FUNCTION public.athlete_program_visible(_owner uuid, _visibility text, _hidden timestamptz, _archived timestamptz)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT auth.uid() IS NOT NULL AND (
    public.community_main_account(_owner) = public.community_main_account(auth.uid())
    OR (_archived IS NULL AND _visibility = 'community' AND (
          public.is_community_staff()
          OR (_hidden IS NULL
              AND public.can_view_community()
              AND public.community_main_account(_owner) NOT IN (SELECT public.community_blocked_authors())
              AND (NOT public.community_is_private(_owner) OR public.community_follows_user(auth.uid(), _owner))))))
$$;
REVOKE ALL ON FUNCTION public.athlete_program_visible(uuid, text, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.athlete_program_visible(uuid, text, timestamptz, timestamptz) TO authenticated, service_role;

/** Someone who can make programs: an athlete in the app (a client or member row) or staff. */
CREATE OR REPLACE FUNCTION public.athlete_program_can_author()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT auth.uid() IS NOT NULL AND (public.is_community_staff() OR public.can_view_community())
$$;
REVOKE ALL ON FUNCTION public.athlete_program_can_author() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.athlete_program_can_author() TO authenticated;

/** Checks and cleans a program's days. Library exercises only (no typed names). */
CREATE OR REPLACE FUNCTION public.athlete_program_clean_days(_days jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  d jsonb;
  e jsonb;
  out_days jsonb := '[]'::jsonb;
  out_ex jsonb;
  i int := 0;
  v_id uuid;
  v_sets int;
  v_reps text;
  v_rpe text;
  v_rest int;
  v_title text;
BEGIN
  IF _days IS NULL OR jsonb_typeof(_days) <> 'array' OR jsonb_array_length(_days) = 0 THEN
    RAISE EXCEPTION 'Add at least one training day' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(_days) > 7 THEN
    RAISE EXCEPTION 'A week has at most 7 training days' USING ERRCODE = '22023';
  END IF;
  FOR d IN SELECT x FROM jsonb_array_elements(_days) WITH ORDINALITY t(x, o) ORDER BY o LOOP
    i := i + 1;
    IF jsonb_typeof(d) <> 'object' THEN RAISE EXCEPTION 'Day % is not valid', i USING ERRCODE = '22023'; END IF;
    v_title := left(nullif(btrim(coalesce(d->>'title', '')), ''), 40);
    IF jsonb_typeof(d->'exercises') <> 'array' OR jsonb_array_length(d->'exercises') = 0 THEN
      RAISE EXCEPTION 'Add at least one exercise to %', coalesce(v_title, 'Day ' || i) USING ERRCODE = '22023';
    END IF;
    IF jsonb_array_length(d->'exercises') > 20 THEN
      RAISE EXCEPTION '% has more than 20 exercises', coalesce(v_title, 'Day ' || i) USING ERRCODE = '22023';
    END IF;
    out_ex := '[]'::jsonb;
    FOR e IN SELECT x FROM jsonb_array_elements(d->'exercises') WITH ORDINALITY t(x, o) ORDER BY o LOOP
      BEGIN
        v_id := nullif(e->>'exercise_id', '')::uuid;
      EXCEPTION WHEN others THEN
        v_id := NULL;
      END;
      IF v_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.exercises x WHERE x.id = v_id AND NOT coalesce(x.archived, false)) THEN
        RAISE EXCEPTION 'Pick each exercise from the library' USING ERRCODE = '22023';
      END IF;
      v_sets := CASE WHEN coalesce(e->>'sets', '') ~ '^\d{1,2}$' THEN (e->>'sets')::int END;
      IF v_sets IS NULL OR v_sets < 1 OR v_sets > 20 THEN
        RAISE EXCEPTION 'Sets must be 1 to 20' USING ERRCODE = '22023';
      END IF;
      v_reps := left(nullif(btrim(coalesce(e->>'reps', '')), ''), 20);
      IF v_reps IS NULL THEN
        RAISE EXCEPTION 'Every exercise needs reps (like 8 or 8-10)' USING ERRCODE = '22023';
      END IF;
      v_rpe := nullif(btrim(coalesce(e->>'rpe', '')), '');
      IF v_rpe IS NOT NULL AND v_rpe !~ '^(10|[1-9](\.5)?)(-(10|[1-9](\.5)?))?$' THEN
        RAISE EXCEPTION 'RPE is 1 to 10 (like 8 or 7-8)' USING ERRCODE = '22023';
      END IF;
      v_rest := CASE WHEN coalesce(e->>'rest_seconds', '') ~ '^\d{1,4}$' THEN (e->>'rest_seconds')::int END;
      IF v_rest IS NOT NULL AND v_rest > 900 THEN v_rest := 900; END IF;
      out_ex := out_ex || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'exercise_id', v_id,
        'sets', v_sets,
        'reps', v_reps,
        'rpe', v_rpe,
        'rest_seconds', v_rest,
        'notes', left(nullif(btrim(coalesce(e->>'notes', '')), ''), 200))));
    END LOOP;
    out_days := out_days || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'title', coalesce(v_title, 'Day ' || i),
      'focus', left(nullif(btrim(coalesce(d->>'focus', '')), ''), 60),
      'exercises', out_ex)));
  END LOOP;
  RETURN out_days;
END;
$$;
REVOKE ALL ON FUNCTION public.athlete_program_clean_days(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.athlete_program_clean_days(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.athlete_program_count_exercises(_days jsonb)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(sum(jsonb_array_length(coalesce(d->'exercises', '[]'::jsonb))), 0)::int
    FROM jsonb_array_elements(coalesce(_days, '[]'::jsonb)) d
$$;

/** Create (no id) or update your own program. Returns its id. */
CREATE OR REPLACE FUNCTION public.athlete_program_save(
  _id uuid, _title text, _description text, _goal text, _level text, _weeks integer, _days jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_days jsonb;
  v_id uuid;
BEGIN
  IF v_uid IS NULL OR NOT public.athlete_program_can_author() THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  v_days := public.athlete_program_clean_days(_days);
  IF _id IS NULL THEN
    IF (SELECT count(*) FROM public.athlete_programs WHERE owner_id = v_uid AND archived_at IS NULL) >= 50 THEN
      RAISE EXCEPTION 'You have 50 programs. Delete one to make another.' USING ERRCODE = '54000';
    END IF;
    INSERT INTO public.athlete_programs (owner_id, title, description, goal, level, weeks, days, days_per_week, exercise_count)
    VALUES (v_uid, btrim(_title), nullif(btrim(coalesce(_description, '')), ''), nullif(_goal, ''), nullif(_level, ''),
            coalesce(_weeks, 4), v_days, jsonb_array_length(v_days), public.athlete_program_count_exercises(v_days))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.athlete_programs
       SET title = btrim(_title),
           description = nullif(btrim(coalesce(_description, '')), ''),
           goal = nullif(_goal, ''),
           level = nullif(_level, ''),
           weeks = coalesce(_weeks, weeks),
           days = v_days,
           days_per_week = jsonb_array_length(v_days),
           exercise_count = public.athlete_program_count_exercises(v_days),
           updated_at = now()
     WHERE id = _id AND owner_id = v_uid AND archived_at IS NULL
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Program not found' USING ERRCODE = 'P0002'; END IF;
  END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.athlete_program_save(uuid, text, text, text, text, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.athlete_program_save(uuid, text, text, text, text, integer, jsonb) TO authenticated;

/** Share your program with the crew, or take it back to private. */
CREATE OR REPLACE FUNCTION public.athlete_program_set_shared(_id uuid, _shared boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  p public.athlete_programs%ROWTYPE;
BEGIN
  SELECT * INTO p FROM public.athlete_programs WHERE id = _id AND owner_id = auth.uid() AND archived_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Program not found' USING ERRCODE = 'P0002'; END IF;
  IF coalesce(_shared, false) THEN
    IF p.hidden_at IS NOT NULL THEN
      RAISE EXCEPTION 'This program was taken down by the JF Effect team, so it can''t be shared.' USING ERRCODE = '42501';
    END IF;
    IF p.exercise_count = 0 THEN
      RAISE EXCEPTION 'Add exercises before sharing' USING ERRCODE = '22023';
    END IF;
    UPDATE public.athlete_programs
       SET visibility = 'community',
           published_at = CASE WHEN p.visibility = 'community' THEN p.published_at ELSE now() END,
           updated_at = now()
     WHERE id = _id;
  ELSE
    UPDATE public.athlete_programs SET visibility = 'private', updated_at = now() WHERE id = _id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.athlete_program_set_shared(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.athlete_program_set_shared(uuid, boolean) TO authenticated;

/** Your own copy of a program you can see (yours or a shared one). The original never changes. */
CREATE OR REPLACE FUNCTION public.athlete_program_copy(_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  p public.athlete_programs%ROWTYPE;
  v_id uuid;
  v_first boolean;
BEGIN
  IF v_uid IS NULL OR NOT public.athlete_program_can_author() THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO p FROM public.athlete_programs WHERE id = _id;
  IF NOT FOUND OR NOT public.athlete_program_visible(p.owner_id, p.visibility, p.hidden_at, p.archived_at) THEN
    RAISE EXCEPTION 'Program not found' USING ERRCODE = 'P0002';
  END IF;
  IF (SELECT count(*) FROM public.athlete_programs WHERE owner_id = v_uid AND archived_at IS NULL) >= 50 THEN
    RAISE EXCEPTION 'You have 50 programs. Delete one to make another.' USING ERRCODE = '54000';
  END IF;
  v_first := p.owner_id <> v_uid AND NOT EXISTS (
    SELECT 1 FROM public.athlete_programs m WHERE m.owner_id = v_uid AND m.forked_from = p.id);
  INSERT INTO public.athlete_programs (owner_id, title, description, goal, level, weeks, days, days_per_week, exercise_count,
                                       forked_from, forked_from_owner)
  VALUES (v_uid,
          CASE WHEN p.owner_id = v_uid THEN left(p.title || ' (copy)', 80) ELSE p.title END,
          p.description, p.goal, p.level, p.weeks, p.days, p.days_per_week, p.exercise_count,
          CASE WHEN p.owner_id = v_uid THEN p.forked_from ELSE p.id END,
          CASE WHEN p.owner_id = v_uid THEN p.forked_from_owner ELSE p.owner_id END)
  RETURNING id INTO v_id;
  IF v_first THEN
    UPDATE public.athlete_programs SET save_count = save_count + 1 WHERE id = p.id;
  END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.athlete_program_copy(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.athlete_program_copy(uuid) TO authenticated;

/** Delete your program (kept as history: copies others saved stay theirs). */
CREATE OR REPLACE FUNCTION public.athlete_program_delete(_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  UPDATE public.athlete_programs
     SET archived_at = now(), visibility = 'private', updated_at = now()
   WHERE id = _id AND owner_id = auth.uid() AND archived_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Program not found' USING ERRCODE = 'P0002'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.athlete_program_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.athlete_program_delete(uuid) TO authenticated;

/** Staff: take a shared program down (or put it back). */
CREATE OR REPLACE FUNCTION public.athlete_program_moderate(_id uuid, _hide boolean, _reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  UPDATE public.athlete_programs
     SET hidden_at = CASE WHEN coalesce(_hide, true) THEN now() END,
         hidden_by = CASE WHEN coalesce(_hide, true) THEN auth.uid() END,
         hidden_reason = CASE WHEN coalesce(_hide, true) THEN left(nullif(btrim(coalesce(_reason, '')), ''), 200) END
   WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Program not found' USING ERRCODE = 'P0002'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.athlete_program_moderate(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.athlete_program_moderate(uuid, boolean, text) TO authenticated;

/** One program as a card (no days): what lists show. */
CREATE OR REPLACE FUNCTION public.athlete_program_card(p public.athlete_programs)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object(
    'id', p.id,
    'title', p.title,
    'description', p.description,
    'goal', p.goal,
    'level', p.level,
    'weeks', p.weeks,
    'days_per_week', p.days_per_week,
    'exercise_count', p.exercise_count,
    'visibility', p.visibility,
    'published_at', p.published_at,
    'updated_at', p.updated_at,
    'save_count', p.save_count,
    'start_count', p.start_count,
    'hidden', p.hidden_at IS NOT NULL,
    'is_mine', public.community_main_account(p.owner_id) = public.community_main_account(auth.uid()),
    'author', public.community_author(p.owner_id),
    'day_titles', (SELECT coalesce(jsonb_agg(d->>'title' ORDER BY o), '[]'::jsonb)
                     FROM jsonb_array_elements(p.days) WITH ORDINALITY t(d, o)),
    'forked_from', CASE WHEN p.forked_from_owner IS NOT NULL THEN
      jsonb_build_object('id', p.forked_from, 'author', public.community_author(p.forked_from_owner)) END)
$$;
REVOKE ALL ON FUNCTION public.athlete_program_card(public.athlete_programs) FROM PUBLIC, anon, authenticated;

/**
 * Programs to browse. _scope: 'community' (shared by the crew, you can see
 * them), 'mine' (yours, shared or not) or 'author' (one person's shared ones,
 * for a profile: _author). _sort: 'popular' (saves + starts) or 'new'.
 */
CREATE OR REPLACE FUNCTION public.athlete_programs_browse(
  _scope text DEFAULT 'community', _q text DEFAULT NULL, _goal text DEFAULT NULL, _level text DEFAULT NULL,
  _days integer DEFAULT NULL, _sort text DEFAULT 'popular', _author uuid DEFAULT NULL,
  _limit integer DEFAULT 30, _offset integer DEFAULT 0)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH me AS (SELECT auth.uid() AS id),
  q AS (SELECT nullif(btrim(coalesce(_q, '')), '') AS text),
  hits AS (
    SELECT p.id, row_number() OVER (ORDER BY
             CASE WHEN coalesce(_scope, 'community') = 'mine' THEN extract(epoch FROM p.updated_at) END DESC NULLS LAST,
             CASE WHEN coalesce(_sort, 'popular') = 'popular' THEN p.save_count + p.start_count END DESC NULLS LAST,
             p.published_at DESC NULLS LAST, p.created_at DESC) AS rn
      FROM public.athlete_programs p, me, q
     WHERE me.id IS NOT NULL
       AND p.archived_at IS NULL
       AND CASE coalesce(_scope, 'community')
             WHEN 'mine' THEN p.owner_id = me.id
             WHEN 'author' THEN p.owner_id = _author AND public.athlete_program_visible(p.owner_id, p.visibility, p.hidden_at, p.archived_at)
             ELSE p.visibility = 'community'
                  AND (p.hidden_at IS NULL OR public.is_community_staff())
                  AND public.athlete_program_visible(p.owner_id, p.visibility, p.hidden_at, p.archived_at)
           END
       AND (q.text IS NULL OR p.title ILIKE '%' || q.text || '%' OR coalesce(p.description, '') ILIKE '%' || q.text || '%')
       AND (_goal IS NULL OR p.goal = _goal)
       AND (_level IS NULL OR p.level = _level)
       AND (_days IS NULL OR p.days_per_week = _days)),
  page AS (
    SELECT r.id, r.rn FROM hits r
     WHERE r.rn > greatest(coalesce(_offset, 0), 0)
       AND r.rn <= greatest(coalesce(_offset, 0), 0) + least(greatest(coalesce(_limit, 30), 1), 60))
  SELECT coalesce(jsonb_agg(public.athlete_program_card(p) ORDER BY pg.rn), '[]'::jsonb)
    FROM page pg JOIN public.athlete_programs p ON p.id = pg.id
$$;
REVOKE ALL ON FUNCTION public.athlete_programs_browse(text, text, text, text, integer, text, uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.athlete_programs_browse(text, text, text, text, integer, text, uuid, integer, integer) TO authenticated;

/** One program in full: its card plus every day with its exercises' names. */
CREATE OR REPLACE FUNCTION public.athlete_program_detail(_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE WHEN p.id IS NULL OR NOT public.athlete_program_visible(p.owner_id, p.visibility, p.hidden_at, p.archived_at)
              THEN NULL
         ELSE public.athlete_program_card(p) || jsonb_build_object(
           'hidden_reason', CASE WHEN public.is_community_staff() OR p.owner_id = auth.uid() THEN p.hidden_reason END,
           'can_moderate', public.is_community_staff(),
           'copied', EXISTS (SELECT 1 FROM public.athlete_programs m
                              WHERE m.owner_id = auth.uid() AND m.forked_from = p.id AND m.archived_at IS NULL),
           'days', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                       'title', d->>'title',
                       'focus', d->>'focus',
                       'exercises', (SELECT coalesce(jsonb_agg(e || jsonb_build_object(
                                        'name', x.name, 'muscle_group', x.muscle_group, 'equipment', x.equipment) ORDER BY eo), '[]'::jsonb)
                                       FROM jsonb_array_elements(coalesce(d->'exercises', '[]'::jsonb)) WITH ORDINALITY te(e, eo)
                                       LEFT JOIN public.exercises x ON x.id = nullif(e->>'exercise_id', '')::uuid)
                     ) ORDER BY o), '[]'::jsonb)
                      FROM jsonb_array_elements(p.days) WITH ORDINALITY t(d, o)))
         END
    FROM (SELECT 1) one
    LEFT JOIN public.athlete_programs p ON p.id = _id
$$;
REVOKE ALL ON FUNCTION public.athlete_program_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.athlete_program_detail(uuid) TO authenticated;

/**
 * Put your own program on your calendar: a pl_block you own (created_by),
 * its week repeated for every week, starting _start. Only a self-serve
 * member with access: a coaching client's program is their coach's to write.
 * The server fn then archives the program you started before and places the
 * workouts on your training days (the same steps as starting a library plan).
 */
CREATE OR REPLACE FUNCTION public.athlete_program_start(_id uuid, _start date)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  p public.athlete_programs%ROWTYPE;
  v_client uuid;
  v_block uuid;
  v_week uuid;
  v_day uuid;
  v_start date := coalesce(_start, (now() AT TIME ZONE 'America/Winnipeg')::date);
  w int;
  d jsonb;
  e jsonb;
  i int;
  n int;
  s int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO p FROM public.athlete_programs WHERE id = _id AND owner_id = v_uid AND archived_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Program not found' USING ERRCODE = 'P0002'; END IF;
  SELECT c.id INTO v_client FROM public.clients c
   WHERE c.user_id = v_uid AND c.service_tier = 'self_serve' AND coalesce(c.archived, false) = false;
  IF v_client IS NULL THEN
    RAISE EXCEPTION 'Your coach writes your program, so it can''t be started here.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.member_can_consume(v_uid) THEN
    RAISE EXCEPTION 'Your account doesn''t have access right now.' USING ERRCODE = '42501';
  END IF;
  IF v_start < (now() AT TIME ZONE 'America/Winnipeg')::date - 1 THEN
    RAISE EXCEPTION 'Pick a start date from today on' USING ERRCODE = '22023';
  END IF;
  n := jsonb_array_length(p.days);
  IF n = 0 THEN RAISE EXCEPTION 'Add a training day first' USING ERRCODE = '22023'; END IF;

  INSERT INTO public.pl_blocks (client_id, name, weeks, goal, status, client_visible, start_date, end_date, sort_order, created_by)
  VALUES (v_client, p.title, p.weeks, p.goal, 'Active', true, v_start, v_start + (p.weeks * 7 - 1), 0, v_uid)
  RETURNING id INTO v_block;

  FOR w IN 1..p.weeks LOOP
    INSERT INTO public.pl_weeks (block_id, week_index, start_date, end_date)
    VALUES (v_block, w, v_start + (w - 1) * 7, v_start + (w * 7 - 1))
    RETURNING id INTO v_week;
    i := 0;
    FOR d IN SELECT x FROM jsonb_array_elements(p.days) WITH ORDINALITY t(x, o) ORDER BY o LOOP
      i := i + 1;
      INSERT INTO public.pl_days (week_id, day_index, title, focus, scheduled_date, schedule_source)
      VALUES (v_week, i, coalesce(nullif(d->>'title', ''), 'Day ' || i), nullif(d->>'focus', ''),
              v_start + (w - 1) * 7 + public.pl_week_day_offset(i, n), 'builder_assignment')
      RETURNING id INTO v_day;
      s := 0;
      FOR e IN SELECT x FROM jsonb_array_elements(coalesce(d->'exercises', '[]'::jsonb)) WITH ORDINALITY t(x, o) ORDER BY o LOOP
        INSERT INTO public.pl_exercise_rows (day_id, sort_order, exercise_id, sets, reps_text, rpe, rest_seconds, notes,
                                             time_profile, measurement_type, tracking_type)
        VALUES (v_day, s, (e->>'exercise_id')::uuid, (e->>'sets')::int, e->>'reps', nullif(e->>'rpe', ''),
                nullif(e->>'rest_seconds', '')::int, nullif(e->>'notes', ''),
                'accessory_compound', 'reps', 'reps_weight');
        s := s + 1;
      END LOOP;
    END LOOP;
  END LOOP;

  UPDATE public.athlete_programs SET start_count = start_count + 1 WHERE id = p.id;
  IF p.forked_from IS NOT NULL AND p.forked_from_owner IS DISTINCT FROM v_uid THEN
    UPDATE public.athlete_programs SET start_count = start_count + 1 WHERE id = p.forked_from;
  END IF;
  RETURN jsonb_build_object('block_id', v_block, 'client_id', v_client);
END;
$$;
REVOKE ALL ON FUNCTION public.athlete_program_start(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.athlete_program_start(uuid, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Crew reports
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.community_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_kind text NOT NULL CHECK (target_kind IN ('post', 'comment', 'program', 'profile')),
  target_id uuid NOT NULL,
  target_owner uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reason text NOT NULL CHECK (reason IN ('spam', 'harassment', 'hate', 'nudity', 'violence', 'self_harm', 'misinformation', 'other')),
  details text CHECK (details IS NULL OR char_length(details) <= 500),
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'removed', 'dismissed')),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reporter_id, target_kind, target_id)
);
CREATE INDEX IF NOT EXISTS community_reports_open_idx ON public.community_reports (created_at DESC) WHERE status = 'open';
ALTER TABLE public.community_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_reports FROM anon;
GRANT SELECT ON public.community_reports TO authenticated;
GRANT ALL ON public.community_reports TO service_role;
-- Staff read; nobody else (who reported what stays private). Writes: the RPCs.
DROP POLICY IF EXISTS "Staff read community reports" ON public.community_reports;
CREATE POLICY "Staff read community reports" ON public.community_reports FOR SELECT TO authenticated
  USING ((SELECT public.is_community_staff()));

/** Report something you can see in Crew. Three people reporting a program take it down until staff look. */
CREATE OR REPLACE FUNCTION public.community_report(_kind text, _target uuid, _reason text, _details text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_snap jsonb;
  v_post record;
  v_comment record;
  v_prog public.athlete_programs%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR NOT public.can_view_community() THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF _reason IS NULL OR _reason NOT IN ('spam', 'harassment', 'hate', 'nudity', 'violence', 'self_harm', 'misinformation', 'other') THEN
    RAISE EXCEPTION 'Pick a reason' USING ERRCODE = '22023';
  END IF;

  IF _kind = 'post' THEN
    SELECT id, author_user_id, client_id, visibility, caption, media_path, media_type, kind, story_only, created_at
      INTO v_post FROM public.community_posts WHERE id = _target;
    IF NOT FOUND OR NOT public.community_post_visible(v_post.visibility, v_post.author_user_id, v_post.client_id) THEN
      RAISE EXCEPTION 'Post not found' USING ERRCODE = 'P0002';
    END IF;
    v_owner := v_post.author_user_id;
    v_snap := jsonb_build_object('caption', left(v_post.caption, 500), 'media_path', v_post.media_path,
                                 'media_type', v_post.media_type, 'kind', v_post.kind, 'story', v_post.story_only,
                                 'posted_at', v_post.created_at);
  ELSIF _kind = 'comment' THEN
    SELECT c.id, c.author_user_id, c.body, c.post_id, p.visibility, p.author_user_id AS post_author, p.client_id
      INTO v_comment
      FROM public.community_comments c JOIN public.community_posts p ON p.id = c.post_id
     WHERE c.id = _target;
    IF NOT FOUND OR NOT public.community_post_visible(v_comment.visibility, v_comment.post_author, v_comment.client_id) THEN
      RAISE EXCEPTION 'Comment not found' USING ERRCODE = 'P0002';
    END IF;
    v_owner := v_comment.author_user_id;
    v_snap := jsonb_build_object('body', left(v_comment.body, 500), 'post_id', v_comment.post_id);
  ELSIF _kind = 'program' THEN
    SELECT * INTO v_prog FROM public.athlete_programs WHERE id = _target;
    IF NOT FOUND OR NOT public.athlete_program_visible(v_prog.owner_id, v_prog.visibility, v_prog.hidden_at, v_prog.archived_at) THEN
      RAISE EXCEPTION 'Program not found' USING ERRCODE = 'P0002';
    END IF;
    v_owner := v_prog.owner_id;
    v_snap := jsonb_build_object('title', v_prog.title, 'description', left(v_prog.description, 500));
  ELSIF _kind = 'profile' THEN
    IF NOT EXISTS (SELECT 1 FROM public.community_profiles cp WHERE cp.user_id = _target) THEN
      RAISE EXCEPTION 'Profile not found' USING ERRCODE = 'P0002';
    END IF;
    v_owner := _target;
    v_snap := public.community_author(_target);
  ELSE
    RAISE EXCEPTION 'Unknown report' USING ERRCODE = '22023';
  END IF;

  IF public.community_main_account(v_owner) = public.community_main_account(v_uid) THEN
    RAISE EXCEPTION 'That''s yours' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.community_reports (reporter_id, target_kind, target_id, target_owner, reason, details, snapshot)
  VALUES (v_uid, _kind, _target, v_owner, _reason, left(nullif(btrim(coalesce(_details, '')), ''), 500), v_snap)
  ON CONFLICT (reporter_id, target_kind, target_id) DO UPDATE
     SET reason = EXCLUDED.reason, details = EXCLUDED.details, snapshot = EXCLUDED.snapshot,
         status = CASE WHEN community_reports.status = 'dismissed' THEN 'dismissed' ELSE 'open' END;

  IF _kind = 'program' AND v_prog.hidden_at IS NULL
     AND (SELECT count(DISTINCT r.reporter_id) FROM public.community_reports r
           WHERE r.target_kind = 'program' AND r.target_id = _target AND r.status = 'open'
             AND NOT public.community_is_staff(r.reporter_id)) >= 3 THEN
    UPDATE public.athlete_programs SET hidden_at = now(), hidden_reason = 'Reported by several people'
     WHERE id = _target AND hidden_at IS NULL;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.community_report(text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_report(text, uuid, text, text) TO authenticated;

/** Staff: open reports, one row per reported thing, newest first. */
CREATE OR REPLACE FUNCTION public.community_reports_open()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE WHEN NOT public.is_community_staff() THEN '[]'::jsonb ELSE coalesce((
    SELECT jsonb_agg(g ORDER BY g->>'last_at' DESC)
      FROM (
        SELECT jsonb_build_object(
                 'target_kind', r.target_kind,
                 'target_id', r.target_id,
                 'owner', public.community_author(max(r.target_owner::text)::uuid),
                 'reports', count(*),
                 'reasons', jsonb_agg(DISTINCT r.reason),
                 'details', (SELECT jsonb_agg(x.details) FROM public.community_reports x
                              WHERE x.target_kind = r.target_kind AND x.target_id = r.target_id
                                AND x.status = 'open' AND x.details IS NOT NULL),
                 'snapshot', (array_agg(r.snapshot ORDER BY r.created_at DESC))[1],
                 'last_at', max(r.created_at)) AS g
          FROM public.community_reports r
         WHERE r.status = 'open'
         GROUP BY r.target_kind, r.target_id) s), '[]'::jsonb) END
$$;
REVOKE ALL ON FUNCTION public.community_reports_open() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_reports_open() TO authenticated;

/**
 * Staff: settle the reports on one thing. 'remove' takes it out of Crew (a
 * post goes to its author's archive, a comment is hidden, a program taken
 * down); 'dismiss' leaves it (and puts back a program the reports took down).
 */
CREATE OR REPLACE FUNCTION public.community_report_resolve(_kind text, _target uuid, _action text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF _action NOT IN ('remove', 'dismiss') THEN RAISE EXCEPTION 'Unknown action' USING ERRCODE = '22023'; END IF;
  IF _action = 'remove' THEN
    IF _kind = 'post' THEN
      UPDATE public.community_posts
         SET archived_from = visibility, visibility = 'private', archived_at = now(), updated_at = now()
       WHERE id = _target AND archived_at IS NULL;
    ELSIF _kind = 'comment' THEN
      UPDATE public.community_comments SET hidden_at = now(), hidden_by = auth.uid()
       WHERE id = _target AND hidden_at IS NULL;
    ELSIF _kind = 'program' THEN
      UPDATE public.athlete_programs SET hidden_at = coalesce(hidden_at, now()), hidden_by = auth.uid(),
             hidden_reason = 'Taken down by the JF Effect team'
       WHERE id = _target;
    END IF;
  ELSIF _kind = 'program' THEN
    UPDATE public.athlete_programs SET hidden_at = NULL, hidden_by = NULL, hidden_reason = NULL
     WHERE id = _target AND hidden_reason = 'Reported by several people';
  END IF;
  UPDATE public.community_reports
     SET status = CASE WHEN _action = 'remove' THEN 'removed' ELSE 'dismissed' END,
         reviewed_by = auth.uid(), reviewed_at = now()
   WHERE target_kind = _kind AND target_id = _target AND status = 'open';
END;
$$;
REVOKE ALL ON FUNCTION public.community_report_resolve(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_report_resolve(text, uuid, text) TO authenticated;
