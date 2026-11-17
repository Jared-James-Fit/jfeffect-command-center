-- Security hardening from the Nov 17 2026 audit (docs/SECURITY_AUDIT_2026-11.md).
-- Every change narrows who can do something; nothing here changes what the app
-- itself does (each caller was traced in the live database first).
--
-- 1. Worker and job functions anyone signed in could call.
--    JF Effect is free to join, so "signed in" is anyone with an email. These
--    SECURITY DEFINER functions had no check of their own:
--    * claim_scheduled_messages() handed back every due scheduled coach
--      message (its words, its client) and leased it away from the worker, so
--      a caller polling it could read coach messages as they came due and
--      stall their delivery. claim_message_for_retry / finalize_message_send /
--      mark_message_sending / release_message_claim / cancel_scheduled_message
--      (and the scheduled-send pair) changed any message's delivery state.
--    * consume_session_for_pt() used a PT session's credit; grant_sessions_*,
--      expire_overdue_sessions, mark_stale_lift_uploads ran jobs early;
--      maybe_refresh_water_target, apply_default_member_access,
--      sync_athlete_achievements wrote someone else's rows;
--      crm_last_contacted_map read CRM data for any client; xp_client_for_user
--      mapped any login to its client record (anonymously, too).
--    Every caller is the service role (the hooks and server functions use
--    supabaseAdmin), pg_cron (runs as postgres) or another SECURITY DEFINER
--    function or trigger (runs as its owner), so none of them needs a
--    signed-in user's EXECUTE. retryFailedMessage (scheduled-messages.functions.ts)
--    checks the caller itself and now calls its two functions as the server.
--    Left as they are: recompute_purchase_totals (an invoker trigger on
--    payment_ledger calls it, and it only recomputes from the ledger) and
--    fn_apply_nutrition_cadence / fn_recompute_nutrition_status (server
--    functions call them as the signed-in coach; they only recompute).
--
-- 2. pl_clone_blocks_for_rows() copied exercise blocks from any program row
--    into any other. Its server functions check the caller, but a direct call
--    didn't. It now holds itself to the same rule as pl_exercise_blocks' own
--    policies: the server, an admin, or a coach for every program on both
--    sides (a program with no client: only the login that made it).
--
-- 3. powerlifting_athletes / powerlifting_coaching_periods were readable by
--    every signed-in account, coach-only tracking notes and coaching dates
--    included. Now staff, plus the athlete reading their own row (the analytics
--    card reads id and sex). The careers, Hall of Strength and strength board
--    read them through SECURITY DEFINER functions and are unchanged.
--
-- 4. The avatars bucket was readable (and listable) by every signed-in account.
--    It holds clients' account photos (the photo taken at setup, for the coach)
--    as well as Crew photos. Now: your own files, staff, and the photos other
--    athletes are meant to see (a Crew profile photo, a coach's team photo:
--    exactly what community_avatar() hands out).
--
-- 5. Legal acceptance records are evidence. A user could insert their own row
--    with any accepted_at, snapshot or acknowledgement text, and nothing
--    stopped an edit or delete. Now only the server writes them (the app
--    already writes every one from a server function), each is stamped with
--    the time and the accepted version's own text by the database, and a row
--    never changes or goes away except with its login (the existing cascade)
--    or the admin-only history escape hatch.
--
-- 6. A legal version that was ever published can't have its words changed,
--    even after it's archived (archive, edit, re-publish used to rewrite what
--    people had accepted).

-- 7. auth_user_id_for_email(): the login with exactly this email, for the
--    server's password recovery (account-recovery-lookup.server.ts), which used
--    to take a phone from any client record that merely shared the email.
--    Service role only.
--
-- 8. The retired paid checkout is switched off (public_checkout_enabled):
--    JF Effect is free to join, and its server functions now refuse anyway.
--
-- 9. Only a coaching client writes into the coach chat (messages). The
--    client's own insert policy checked the record was theirs, not that they
--    were coached, so any free account could post into the coach's inbox (and
--    push him). A member's help goes through Support (member_support_*).
--    Every client-sent message on file is from a coaching client.

-- ── 1. Worker and job functions: the server only ─────────────────────────────
DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.claim_scheduled_messages(text, integer, integer)',
    'public.claim_message_for_retry(uuid)',
    'public.finalize_message_send(uuid, text, text)',
    'public.mark_message_sending(uuid)',
    'public.release_message_claim(uuid)',
    'public.cancel_scheduled_message(uuid)',
    'public.cancel_scheduled_response_safe(uuid)',
    'public.finalize_schedule_send(uuid, text, text)',
    'public.mark_schedule_sending(uuid)',
    'public.consume_session_for_pt(uuid)',
    'public.grant_sessions_due_today()',
    'public.grant_sessions_if_paid_in_full(uuid)',
    'public.expire_overdue_sessions()',
    'public.mark_stale_lift_uploads()',
    'public.maybe_refresh_water_target(uuid, numeric)',
    'public.apply_default_member_access(uuid)',
    'public.sync_athlete_achievements(uuid)',
    'public.crm_last_contacted_map(uuid[])',
    'public.xp_client_for_user(uuid)'
  ] LOOP
    IF to_regprocedure(fn) IS NULL THEN
      RAISE NOTICE 'security hardening: % not found, skipped', fn;
      CONTINUE;
    END IF;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END $$;

-- ── 2. pl_clone_blocks_for_rows: the caller must be allowed on both sides ────
CREATE OR REPLACE FUNCTION public.pl_clone_blocks_for_rows(p_mappings jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  m record;
  block_row record;
  id_map jsonb := '{}'::jsonb;
  new_block_id uuid;
  total int := 0;
  v_uid uuid := (SELECT auth.uid());
BEGIN
  IF p_mappings IS NULL OR jsonb_array_length(p_mappings) = 0 THEN
    RETURN 0;
  END IF;

  -- A signed-in caller who isn't an admin must coach every program on both
  -- sides of every mapping (pl_exercise_blocks' own rule); a program with no
  -- client only by the login that made it. The server (service role) has no
  -- auth.uid() and has already checked the caller.
  IF v_uid IS NOT NULL AND NOT coalesce(public.has_role(v_uid, 'admin'), false) THEN
    IF EXISTS (
      SELECT 1
        FROM jsonb_array_elements(p_mappings) AS elem
        CROSS JOIN LATERAL (VALUES ((elem->>'source_row_id')::uuid), ((elem->>'dest_row_id')::uuid)) AS side(row_id)
        LEFT JOIN public.pl_exercise_rows r ON r.id = side.row_id
        LEFT JOIN public.pl_days d ON d.id = r.day_id
        LEFT JOIN public.pl_weeks w ON w.id = d.week_id
        LEFT JOIN public.pl_blocks b ON b.id = w.block_id
       WHERE b.id IS NULL
          OR NOT (
            (b.client_id IS NOT NULL AND b.client_id IN (SELECT public.coached_client_ids()))
            OR (b.client_id IS NULL AND b.created_by = v_uid)
          )
    ) THEN
      RAISE EXCEPTION 'You can only copy exercises between programs you coach.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Pass 1: clone blocks + children.
  FOR m IN
    SELECT (elem->>'source_row_id')::uuid AS src_row,
           (elem->>'dest_row_id')::uuid   AS dst_row
      FROM jsonb_array_elements(p_mappings) AS elem
  LOOP
    FOR block_row IN
      SELECT * FROM public.pl_exercise_blocks
       WHERE row_id = m.src_row
       ORDER BY sort_order
    LOOP
      INSERT INTO public.pl_exercise_blocks (
        row_id, sort_order, block_type, label, sets, reps_text, rpe, rir,
        load_type, load_value, load_unit, reference_block_id,
        rest_seconds_override, tempo, amrap, notes, config
      ) VALUES (
        m.dst_row, block_row.sort_order, block_row.block_type, block_row.label,
        block_row.sets, block_row.reps_text, block_row.rpe, block_row.rir,
        block_row.load_type, block_row.load_value, block_row.load_unit,
        NULL,
        block_row.rest_seconds_override, block_row.tempo, block_row.amrap,
        block_row.notes, block_row.config
      ) RETURNING id INTO new_block_id;

      id_map := id_map || jsonb_build_object(block_row.id::text, new_block_id::text);

      INSERT INTO public.pl_block_set_rows
        (block_id, sort_order, reps_text, load_value, load_unit, rpe, rir, amrap)
      SELECT new_block_id, sort_order, reps_text, load_value, load_unit, rpe, rir, amrap
        FROM public.pl_block_set_rows
       WHERE block_id = block_row.id
       ORDER BY sort_order;

      INSERT INTO public.pl_block_drop_stages
        (block_id, sort_order, reduction_type, reduction_value, reps_text, rpe, rir, amrap, rest_seconds)
      SELECT new_block_id, sort_order, reduction_type, reduction_value, reps_text, rpe, rir, amrap, rest_seconds
        FROM public.pl_block_drop_stages
       WHERE block_id = block_row.id
       ORDER BY sort_order;

      total := total + 1;
    END LOOP;
  END LOOP;

  -- Pass 2: remap reference_block_id within the same clone batch.
  FOR m IN
    SELECT (elem->>'source_row_id')::uuid AS src_row
      FROM jsonb_array_elements(p_mappings) AS elem
  LOOP
    FOR block_row IN
      SELECT id, reference_block_id
        FROM public.pl_exercise_blocks
       WHERE row_id = m.src_row AND reference_block_id IS NOT NULL
    LOOP
      IF NOT (id_map ? block_row.reference_block_id::text) THEN
        RAISE EXCEPTION 'Cannot copy block %: it references a block outside the copied selection. Copy the referenced block together with this exercise.', block_row.id
          USING ERRCODE = 'check_violation';
      END IF;
      UPDATE public.pl_exercise_blocks
         SET reference_block_id = (id_map->>block_row.reference_block_id::text)::uuid
       WHERE id = (id_map->>block_row.id::text)::uuid;
    END LOOP;
  END LOOP;

  RETURN total;
END;
$function$;

REVOKE ALL ON FUNCTION public.pl_clone_blocks_for_rows(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pl_clone_blocks_for_rows(jsonb) TO authenticated, service_role;

-- ── 3. Powerlifting athlete records: staff and the athlete ───────────────────
DROP POLICY IF EXISTS "Authenticated read powerlifting athletes" ON public.powerlifting_athletes;
DROP POLICY IF EXISTS "Staff and the athlete read powerlifting athletes" ON public.powerlifting_athletes;
CREATE POLICY "Staff and the athlete read powerlifting athletes"
  ON public.powerlifting_athletes
  FOR SELECT TO authenticated
  USING (
    (SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
    OR (SELECT public.has_role((SELECT auth.uid()), 'coach'::public.app_role))
    OR (SELECT public.is_admin_viewer())
    OR client_id IN (SELECT c.id FROM public.clients c WHERE c.user_id = (SELECT auth.uid()))
    OR client_id = (SELECT public.linked_client_id())
  );

DROP POLICY IF EXISTS "Authenticated read coaching periods" ON public.powerlifting_coaching_periods;
DROP POLICY IF EXISTS "Staff read coaching periods" ON public.powerlifting_coaching_periods;
CREATE POLICY "Staff read coaching periods"
  ON public.powerlifting_coaching_periods
  FOR SELECT TO authenticated
  USING (
    (SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
    OR (SELECT public.has_role((SELECT auth.uid()), 'coach'::public.app_role))
    OR (SELECT public.is_admin_viewer())
  );

-- ── 4. avatars: your own, staff, and the photos the crew is meant to see ─────
-- One lookup the storage policy can use without depending on the caller's own
-- access to community_profiles / coaches.
CREATE OR REPLACE FUNCTION public.avatar_is_shown_to_crew(_path text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT _path IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.community_profiles cp WHERE cp.avatar_path = _path)
    OR EXISTS (SELECT 1 FROM public.coaches co WHERE co.profile_picture_url = _path)
  );
$function$;
REVOKE ALL ON FUNCTION public.avatar_is_shown_to_crew(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.avatar_is_shown_to_crew(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.avatar_is_my_photo(_path text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT _path IS NOT NULL AND auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.clients c WHERE c.user_id = auth.uid() AND c.profile_picture_url = _path)
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.avatar_url = _path)
  );
$function$;
REVOKE ALL ON FUNCTION public.avatar_is_my_photo(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.avatar_is_my_photo(text) TO authenticated, service_role;

DROP POLICY IF EXISTS "Auth view avatars" ON storage.objects;
DROP POLICY IF EXISTS "Avatars: own, staff and crew photos" ON storage.objects;
CREATE POLICY "Avatars: own, staff and crew photos"
  ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'avatars' AND (
      (storage.foldername(name))[1] = (SELECT auth.uid())::text
      OR (SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
      OR (SELECT public.has_role((SELECT auth.uid()), 'coach'::public.app_role))
      OR (SELECT public.is_admin_viewer())
      OR public.avatar_is_shown_to_crew(name)
      OR public.avatar_is_my_photo(name)
    )
  );

-- ── 5. Legal acceptances: written by the server, stamped, never changed ─────
DROP POLICY IF EXISTS "Users insert their own acceptances" ON public.legal_acceptances;

CREATE OR REPLACE FUNCTION public.tg_legal_acceptance_stamp()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v public.legal_document_versions%ROWTYPE;
BEGIN
  SELECT * INTO v FROM public.legal_document_versions WHERE id = NEW.version_id;
  IF NOT FOUND OR v.document_id IS DISTINCT FROM NEW.document_id THEN
    RAISE EXCEPTION 'That version isn''t part of this document.' USING ERRCODE = 'check_violation';
  END IF;
  IF v.status IS DISTINCT FROM 'published' THEN
    RAISE EXCEPTION 'Only a published version can be accepted.' USING ERRCODE = 'check_violation';
  END IF;
  -- The evidence is the text as published, whatever the caller sent.
  NEW.rendered_snapshot := v.body;
  -- The moment is the database's, unless the server is importing history.
  IF coalesce(auth.role(), '') <> 'service_role' OR NEW.accepted_at IS NULL THEN
    NEW.accepted_at := now();
  END IF;
  NEW.created_at := now();
  NEW.revoked_at := NULL;
  NEW.revoked_reason := NULL;
  NEW.superseded_by := NULL;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.tg_legal_acceptance_stamp() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_legal_acceptance_stamp ON public.legal_acceptances;
CREATE TRIGGER trg_legal_acceptance_stamp
  BEFORE INSERT ON public.legal_acceptances
  FOR EACH ROW EXECUTE FUNCTION public.tg_legal_acceptance_stamp();

CREATE OR REPLACE FUNCTION public.tg_legal_acceptance_keep()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF coalesce(current_setting('jf.allow_history_delete', true), '') = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'DELETE' THEN
    -- Going with its login (legal_acceptances_user_id_fkey cascades) is the
    -- one way a record leaves: by then the login itself is gone.
    IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = OLD.user_id) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Legal acceptance records are kept as evidence and can''t be deleted.'
      USING ERRCODE = 'check_violation';
  END IF;
  -- An update may only revoke or supersede; what was accepted never changes.
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.document_id IS DISTINCT FROM OLD.document_id
     OR NEW.version_id IS DISTINCT FROM OLD.version_id
     OR NEW.context IS DISTINCT FROM OLD.context
     OR NEW.context_ref IS DISTINCT FROM OLD.context_ref
     OR NEW.signature_method IS DISTINCT FROM OLD.signature_method
     OR NEW.checkbox_checked IS DISTINCT FROM OLD.checkbox_checked
     OR NEW.typed_name IS DISTINCT FROM OLD.typed_name
     OR NEW.acknowledgement_text IS DISTINCT FROM OLD.acknowledgement_text
     OR NEW.rendered_snapshot IS DISTINCT FROM OLD.rendered_snapshot
     OR NEW.ip_address IS DISTINCT FROM OLD.ip_address
     OR NEW.user_agent IS DISTINCT FROM OLD.user_agent
     OR NEW.accepted_at IS DISTINCT FROM OLD.accepted_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     -- client_id may only be cleared (legal_acceptances_client_id_fkey is ON DELETE SET NULL)
     OR (NEW.client_id IS DISTINCT FROM OLD.client_id AND NEW.client_id IS NOT NULL)
  THEN
    RAISE EXCEPTION 'Legal acceptance records are kept as evidence and can''t be changed.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.tg_legal_acceptance_keep() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_legal_acceptance_keep ON public.legal_acceptances;
CREATE TRIGGER trg_legal_acceptance_keep
  BEFORE UPDATE OR DELETE ON public.legal_acceptances
  FOR EACH ROW EXECUTE FUNCTION public.tg_legal_acceptance_keep();

-- ── 6. A version that was ever published keeps its words ─────────────────────
CREATE OR REPLACE FUNCTION public.tg_legal_version_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.status = 'published' OR OLD.published_at IS NOT NULL THEN
    IF NEW.body IS DISTINCT FROM OLD.body
       OR NEW.title IS DISTINCT FROM OLD.title
       OR NEW.signature_method IS DISTINCT FROM OLD.signature_method
       OR NEW.version_number IS DISTINCT FROM OLD.version_number
       OR NEW.document_id IS DISTINCT FROM OLD.document_id THEN
      RAISE EXCEPTION 'Published legal versions are immutable. Create a new version instead.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

-- ── 7. The login with exactly this email (server only) ──────────────────────
CREATE OR REPLACE FUNCTION public.auth_user_id_for_email(_email text)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  SELECT u.id
    FROM auth.users u
   WHERE _email IS NOT NULL
     AND btrim(_email) <> ''
     AND lower(u.email) = lower(btrim(_email))
     AND u.deleted_at IS NULL
   ORDER BY u.created_at
   LIMIT 1;
$function$;
REVOKE ALL ON FUNCTION public.auth_user_id_for_email(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auth_user_id_for_email(text) TO service_role;

-- ── 8. The retired paid checkout stays off ──────────────────────────────────
UPDATE public.jf_membership_settings
   SET public_checkout_enabled = false
 WHERE public_checkout_enabled IS DISTINCT FROM false;

-- ── 9. The coach chat is the coaching layer ─────────────────────────────────
DROP POLICY IF EXISTS "Client send own messages" ON public.messages;
CREATE POLICY "Client send own messages"
  ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_role = 'client'
    AND is_internal_note = false
    AND priority IS NULL
    AND sender_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.clients c
       WHERE c.id = messages.client_id
         AND c.user_id = (SELECT auth.uid())
         AND c.service_tier = 'coaching'
    )
  );
