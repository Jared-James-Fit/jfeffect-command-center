-- Free platform, hardening after review (20270128090000_free_platform.sql):
--   1. Someone who applied for coaching and then makes a free account keeps one
--      record: their application's Lead row becomes their member record
--      (ensure_member_client turns it self-serve, as it already did for a
--      lead who checked out), instead of locking them out as if a coach had
--      set them up.
--   2. A program's days name the exercise that left the library.
--   3. Duplicating your own taken-down program keeps it taken down.
--   4. Reports: putting a program back up settles its open reports, a settled
--      report is never reopened by re-sending it, and the 3-report takedown
--      only counts accounts at least 7 days old.
--   5. Starting a program counts once per person, replaces the program you ran
--      before right in the database (a direct call can't stack live blocks),
--      and is capped at 10 a day.
--   6. Browsing checks who you are, your blocks and your follows once per
--      query (sets), never per program.
--   7. "Based on a program by @X" never shows across a block.
--   8. athlete_program_visible is internal (it told a caller who blocked them).
--   9. Merging a duplicate exercise moves programs people built onto the kept one.

-- ---------------------------------------------------------------------------
-- 1. A coaching applicant who joins free keeps their one record
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._member_free_join(_uid uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  u record;
  v_member uuid;
  v_type text;
  v_client uuid;
  v_lead uuid;
  v_name text;
  v_claims text;
  v_sub text;
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
  -- a coach already set this person up: their invite links it, never a second
  -- record. A coaching application nobody has taken on (a Lead with no coach)
  -- isn't that: it's only what they typed in, and it becomes their member record.
  IF EXISTS (SELECT 1 FROM public.clients c
              WHERE c.user_id IS NULL AND lower(c.email) = lower(u.email)
                AND coalesce(c.archived, false) = false
                AND NOT (c.status = 'Lead' AND c.assigned_coach_id IS NULL)) THEN
    RETURN jsonb_build_object('status', 'coach_account');
  END IF;
  SELECT c.id INTO v_lead FROM public.clients c
   WHERE c.user_id IS NULL AND lower(c.email) = lower(u.email)
     AND coalesce(c.archived, false) = false
     AND c.status = 'Lead' AND c.assigned_coach_id IS NULL
   ORDER BY c.created_at DESC
   LIMIT 1;

  v_name := left(coalesce(nullif(btrim(u.raw_user_meta_data->>'full_name'), ''), split_part(u.email, '@', 1)), 120);

  SELECT m.id, m.account_type INTO v_member, v_type FROM public.app_members m WHERE m.user_id = _uid;
  IF v_member IS NOT NULL AND v_type <> 'jf_member' THEN
    RETURN jsonb_build_object('status', 'other_account');
  END IF;

  -- Joining is the server's step, so it runs as the server even when the
  -- person's own /welcome call got here: the clients guards
  -- (guard_clients_service_tier, clients_block_self_privileged_updates) let
  -- trusted server work through and still refuse the person changing those
  -- fields themselves. The application is linked before the member row,
  -- whose insert makes their client record (app_members_ensure_client):
  -- ensure_member_client then finds the Lead and turns it self-serve.
  v_claims := current_setting('request.jwt.claims', true);
  v_sub := current_setting('request.jwt.claim.sub', true);
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF v_lead IS NOT NULL THEN
    UPDATE public.clients
       SET user_id = _uid, account_status = 'Account Created', account_created_at = now()
     WHERE id = v_lead AND user_id IS NULL;
  END IF;
  IF v_member IS NULL THEN
    INSERT INTO public.app_members (user_id, email, full_name, account_type, status, subscription_status)
    VALUES (_uid, lower(u.email), v_name, 'jf_member', 'Active', 'Free')
    RETURNING id INTO v_member;
  ELSE
    -- a member row with no billing state (never checked out) is a free member
    UPDATE public.app_members SET subscription_status = 'Free'
     WHERE id = v_member AND nullif(btrim(coalesce(subscription_status, '')), '') IS NULL;
  END IF;
  PERFORM public.apply_default_member_access(v_member);
  v_client := public.ensure_member_client(v_member);
  PERFORM set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  PERFORM set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  RETURN jsonb_build_object('status', 'member', 'member_id', v_member, 'client_id', v_client);
END;
$$;
REVOKE ALL ON FUNCTION public._member_free_join(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Say which exercise is no longer in the library
-- ---------------------------------------------------------------------------
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
  v_ex record;
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
      v_ex := NULL;
      IF v_id IS NOT NULL THEN
        SELECT x.name, coalesce(x.archived, false) AS archived INTO v_ex FROM public.exercises x WHERE x.id = v_id;
      END IF;
      IF v_id IS NULL OR v_ex.name IS NULL THEN
        RAISE EXCEPTION 'Pick each exercise from the library' USING ERRCODE = '22023';
      END IF;
      IF v_ex.archived THEN
        RAISE EXCEPTION '% is no longer in the library. Swap it for another exercise on %.',
          v_ex.name, coalesce(v_title, 'Day ' || i) USING ERRCODE = '22023';
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

-- ---------------------------------------------------------------------------
-- 3. A copy of your own taken-down program stays taken down
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.athlete_program_copy(_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  p public.athlete_programs%ROWTYPE;
  v_id uuid;
  v_first boolean;
  v_own boolean;
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
  v_own := p.owner_id = v_uid;
  v_first := NOT v_own AND NOT EXISTS (
    SELECT 1 FROM public.athlete_programs m WHERE m.owner_id = v_uid AND m.forked_from = p.id);
  INSERT INTO public.athlete_programs (owner_id, title, description, goal, level, weeks, days, days_per_week, exercise_count,
                                       forked_from, forked_from_owner, hidden_at, hidden_by, hidden_reason)
  VALUES (v_uid,
          CASE WHEN v_own THEN left(p.title || ' (copy)', 80) ELSE p.title END,
          p.description, p.goal, p.level, p.weeks, p.days, p.days_per_week, p.exercise_count,
          CASE WHEN v_own THEN p.forked_from ELSE p.id END,
          CASE WHEN v_own THEN p.forked_from_owner ELSE p.owner_id END,
          -- what the team took down can't come back up through Duplicate
          CASE WHEN v_own THEN p.hidden_at END,
          CASE WHEN v_own THEN p.hidden_by END,
          CASE WHEN v_own THEN p.hidden_reason END)
  RETURNING id INTO v_id;
  IF v_first THEN
    UPDATE public.athlete_programs SET save_count = save_count + 1 WHERE id = p.id;
  END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.athlete_program_copy(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.athlete_program_copy(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Reports can't be used to keep a program down
-- ---------------------------------------------------------------------------
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
  -- Put back up: the reports that were open are looked at and settled, so the
  -- next report can't take it straight back down.
  UPDATE public.community_reports
     SET status = CASE WHEN coalesce(_hide, true) THEN 'removed' ELSE 'dismissed' END,
         reviewed_by = auth.uid(), reviewed_at = now()
   WHERE target_kind = 'program' AND target_id = _id AND status = 'open';
END;
$$;
REVOKE ALL ON FUNCTION public.athlete_program_moderate(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.athlete_program_moderate(uuid, boolean, text) TO authenticated;

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

  -- Re-sending updates an open report; one the team already settled stays settled.
  INSERT INTO public.community_reports (reporter_id, target_kind, target_id, target_owner, reason, details, snapshot)
  VALUES (v_uid, _kind, _target, v_owner, _reason, left(nullif(btrim(coalesce(_details, '')), ''), 500), v_snap)
  ON CONFLICT (reporter_id, target_kind, target_id) DO UPDATE
     SET reason = EXCLUDED.reason, details = EXCLUDED.details, snapshot = EXCLUDED.snapshot
   WHERE community_reports.status = 'open';

  -- Three people (not staff, accounts at least a week old, so one person
  -- can't do it with fresh sign-ups) take a program down until staff look.
  IF _kind = 'program' AND v_prog.hidden_at IS NULL
     AND (SELECT count(DISTINCT r.reporter_id)
            FROM public.community_reports r JOIN auth.users au ON au.id = r.reporter_id
           WHERE r.target_kind = 'program' AND r.target_id = _target AND r.status = 'open'
             AND au.created_at < now() - interval '7 days'
             AND NOT public.community_is_staff(r.reporter_id)) >= 3 THEN
    UPDATE public.athlete_programs SET hidden_at = now(), hidden_reason = 'Reported by several people'
     WHERE id = _target AND hidden_at IS NULL;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.community_report(text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_report(text, uuid, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Starting a program: once per person in the counts, one live program,
--    at most 10 starts a day
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.athlete_program_starts (
  program_id uuid NOT NULL REFERENCES public.athlete_programs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  first_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (program_id, user_id)
);
ALTER TABLE public.athlete_program_starts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.athlete_program_starts FROM anon, authenticated;
GRANT ALL ON public.athlete_program_starts TO service_role;
-- written only by athlete_program_start; nobody reads it from the app

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
  v_old uuid[];
  v_new int;
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
  IF (SELECT count(*) FROM public.pl_blocks b
       WHERE b.client_id = v_client AND b.created_by = v_uid AND b.created_at > now() - interval '1 day') >= 10 THEN
    RAISE EXCEPTION 'You''ve started 10 programs today. Try again tomorrow.' USING ERRCODE = '54000';
  END IF;

  -- the program they ran before makes way: archived, never deleted (its logs stay)
  SELECT array_agg(b.id) INTO v_old FROM public.pl_blocks b
   WHERE b.client_id = v_client AND b.created_by = v_uid AND b.archived = false
     AND coalesce(b.source_template_block_key, '') NOT LIKE 'at_home_backup%';
  IF v_old IS NOT NULL THEN
    UPDATE public.pl_blocks SET status = 'Archived', archived = true, archived_at = now(), archived_by = v_uid
     WHERE id = ANY (v_old);
    UPDATE public.pl_preps SET status = 'Archived', archived = true, archived_at = now(), archived_by = v_uid
     WHERE created_by = v_uid AND archived = false
       AND id IN (SELECT b.prep_id FROM public.pl_blocks b WHERE b.id = ANY (v_old) AND b.prep_id IS NOT NULL);
  END IF;

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

  -- "started by N people": each person once, on the program and the original it was copied from
  INSERT INTO public.athlete_program_starts (program_id, user_id) VALUES (p.id, v_uid) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_new = ROW_COUNT;
  IF v_new > 0 THEN
    UPDATE public.athlete_programs SET start_count = start_count + 1 WHERE id = p.id;
  END IF;
  IF p.forked_from IS NOT NULL AND p.forked_from_owner IS DISTINCT FROM v_uid THEN
    INSERT INTO public.athlete_program_starts (program_id, user_id)
    SELECT p.forked_from, v_uid WHERE EXISTS (SELECT 1 FROM public.athlete_programs o WHERE o.id = p.forked_from)
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_new = ROW_COUNT;
    IF v_new > 0 THEN
      UPDATE public.athlete_programs SET start_count = start_count + 1 WHERE id = p.forked_from;
    END IF;
  END IF;
  RETURN jsonb_build_object('block_id', v_block, 'client_id', v_client, 'replaced', coalesce(array_length(v_old, 1), 0));
END;
$$;
REVOKE ALL ON FUNCTION public.athlete_program_start(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.athlete_program_start(uuid, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6 + 7. Browse with the viewer worked out once; attribution respects blocks
-- ---------------------------------------------------------------------------
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
    -- "Based on a program by @X", unless X and the viewer blocked each other
    'forked_from', CASE WHEN p.forked_from_owner IS NOT NULL
                         AND public.community_main_account(p.forked_from_owner) NOT IN (
                               SELECT b FROM public.community_blocked_authors() b WHERE b IS NOT NULL)
                    THEN jsonb_build_object('id', p.forked_from, 'author', public.community_author(p.forked_from_owner)) END)
$$;
REVOKE ALL ON FUNCTION public.athlete_program_card(public.athlete_programs) FROM PUBLIC, anon, authenticated;

/**
 * Programs to browse. _scope: 'community' (shared by the crew, you can see
 * them), 'mine' (yours, shared or not) or 'author' (one person's, for a
 * profile: _author). _sort: 'popular' (saves + starts) or 'new'. Who you are,
 * whether you're staff, your blocks and your follows are read once (sets),
 * the same rules as athlete_program_visible.
 */
CREATE OR REPLACE FUNCTION public.athlete_programs_browse(
  _scope text DEFAULT 'community', _q text DEFAULT NULL, _goal text DEFAULT NULL, _level text DEFAULT NULL,
  _days integer DEFAULT NULL, _sort text DEFAULT 'popular', _author uuid DEFAULT NULL,
  _limit integer DEFAULT 30, _offset integer DEFAULT 0)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH ctx AS MATERIALIZED (
    SELECT auth.uid() AS me,
           public.community_main_account(auth.uid()) AS my_main,
           public.is_community_staff() AS staff,
           public.can_view_community() AS can_view,
           coalesce(_scope, 'community') AS scope,
           coalesce(_sort, 'popular') AS sort,
           nullif(btrim(coalesce(_q, '')), '') AS q),
  blocked AS MATERIALIZED (SELECT b AS id FROM public.community_blocked_authors() b WHERE b IS NOT NULL),
  followed AS MATERIALIZED (SELECT f AS id FROM public.community_followed_authors() f WHERE f IS NOT NULL),
  hits AS (
    SELECT p.id,
           CASE WHEN ctx.scope = 'mine' THEN p.updated_at END AS k_updated,
           CASE WHEN ctx.sort = 'popular' THEN p.save_count + p.start_count END AS k_popular,
           p.published_at AS k_published,
           p.created_at AS k_created
      FROM ctx
      JOIN public.athlete_programs p ON p.archived_at IS NULL
      LEFT JOIN public.community_profiles cp ON cp.user_id = p.owner_id
      LEFT JOIN public.community_profiles op ON op.user_id = coalesce(cp.same_person_as, p.owner_id)
     WHERE ctx.me IS NOT NULL
       AND CASE ctx.scope
             WHEN 'mine' THEN p.owner_id = ctx.me
             WHEN 'author' THEN p.owner_id = _author
             ELSE p.visibility = 'community' AND (p.hidden_at IS NULL OR ctx.staff)
           END
       AND (ctx.scope = 'mine'
            OR coalesce(cp.same_person_as, p.owner_id) = ctx.my_main
            OR (p.visibility = 'community' AND (
                  ctx.staff
                  OR (p.hidden_at IS NULL
                      AND ctx.can_view
                      AND coalesce(cp.same_person_as, p.owner_id) NOT IN (SELECT id FROM blocked)
                      AND (NOT coalesce(op.is_private, false)
                           OR coalesce(cp.same_person_as, p.owner_id) IN (SELECT id FROM followed))))))
       AND (ctx.q IS NULL OR p.title ILIKE '%' || ctx.q || '%' OR coalesce(p.description, '') ILIKE '%' || ctx.q || '%')
       AND (_goal IS NULL OR p.goal = _goal)
       AND (_level IS NULL OR p.level = _level)
       AND (_days IS NULL OR p.days_per_week = _days)
     ORDER BY k_updated DESC NULLS LAST, k_popular DESC NULLS LAST, k_published DESC NULLS LAST, k_created DESC
     LIMIT least(greatest(coalesce(_limit, 30), 1), 60)
    OFFSET greatest(coalesce(_offset, 0), 0))
  SELECT coalesce(jsonb_agg(public.athlete_program_card(p)
           ORDER BY h.k_updated DESC NULLS LAST, h.k_popular DESC NULLS LAST, h.k_published DESC NULLS LAST, h.k_created DESC),
         '[]'::jsonb)
    FROM hits h JOIN public.athlete_programs p ON p.id = h.id
$$;
REVOKE ALL ON FUNCTION public.athlete_programs_browse(text, text, text, text, integer, text, uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.athlete_programs_browse(text, text, text, text, integer, text, uuid, integer, integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- 8. Internal only: it answered "has X blocked me?" to anyone who asked
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.athlete_program_visible(uuid, text, timestamptz, timestamptz) FROM authenticated;

-- ---------------------------------------------------------------------------
-- 9. A merged duplicate exercise moves out of programs people built too
--    (merge_duplicate_exercise logs every merge in exercise_dedupe_audit)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_exercise_merge_athlete_programs()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.duplicate_id IS NULL OR NEW.canonical_id IS NULL OR NEW.duplicate_id = NEW.canonical_id THEN
    RETURN NEW;
  END IF;
  UPDATE public.athlete_programs
     SET days = replace(days::text, NEW.duplicate_id::text, NEW.canonical_id::text)::jsonb
   WHERE days @> jsonb_build_array(jsonb_build_object('exercises',
           jsonb_build_array(jsonb_build_object('exercise_id', NEW.duplicate_id::text))));
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_exercise_merge_athlete_programs() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS exercise_merge_athlete_programs ON public.exercise_dedupe_audit;
CREATE TRIGGER exercise_merge_athlete_programs
  AFTER INSERT ON public.exercise_dedupe_audit
  FOR EACH ROW EXECUTE FUNCTION public.tg_exercise_merge_athlete_programs();
