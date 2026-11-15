-- Account lifecycle: deactivate (now or when what's paid for runs out),
-- reactivate, the deletion request's record, and day 30 that keeps the money
-- and drops the person.
--
-- Three states, no new statuses: an account is Active (whatever its status
-- was), Deactivated (clients.status = 'Deactivated') or Pending deletion
-- (Recently deleted, account_deletions, status 'Deleted').
--
-- Deactivating (the person from Account, their coach or an admin from their
-- page; lifecycle.functions.ts decides who and does Stripe first) is
-- _account_deactivation_apply: status 'Deactivated', archived (every job,
-- check-in, reminder and coaching list leaves archived clients out), the app
-- off, a JF member's access off, hidden from the Crew, and their booked
-- sessions from that moment on cancelled with each credit back on its
-- package (the pt_sessions triggers bank it and take it off Google). What it
-- changed is kept in deactivation_prior and reactivating puts exactly that
-- back. Nothing about money changes in the database: no sale, payment,
-- balance or session credit is touched (a cancelled session keeps its credit).
-- A deactivation for later (deactivate_at: the day a coaching subscription's
-- paid month runs out) is applied by the account-deactivations-due job.
--
-- Every step is written to account_lifecycle_events (server only, staff
-- read, kept when the account is deleted) — never client_activity_log, which
-- clients can write to.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS deactivation_source text,
  ADD COLUMN IF NOT EXISTS deactivate_at timestamptz,
  ADD COLUMN IF NOT EXISTS deactivation_prior jsonb;
DO $$ BEGIN
  ALTER TABLE public.clients ADD CONSTRAINT clients_deactivation_source_check
    CHECK (deactivation_source IS NULL OR deactivation_source IN ('self', 'staff'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS clients_deactivate_due ON public.clients (deactivate_at) WHERE deactivate_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- The record: what happened to an account, by whom, when.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.account_lifecycle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- no foreign keys: the record outlives the account
  client_id uuid,
  user_id uuid,
  event text NOT NULL CHECK (event IN (
    'deactivation_scheduled', 'deactivation_withdrawn', 'deactivated', 'reactivated',
    'subscription_cancelled', 'auto_pay_stopped', 'sessions_cancelled',
    'deletion_requested', 'deletion_withdrawn', 'deletion_completed')),
  actor_user_id uuid,
  actor_role text NOT NULL CHECK (actor_role IN ('self', 'coach', 'admin', 'system')),
  -- reason and verified figures only; never a private note
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS account_lifecycle_events_client ON public.account_lifecycle_events (client_id, created_at DESC);
ALTER TABLE public.account_lifecycle_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_lifecycle_events FROM anon, authenticated;
GRANT SELECT ON public.account_lifecycle_events TO authenticated;
GRANT ALL ON public.account_lifecycle_events TO service_role;
DROP POLICY IF EXISTS "Staff read lifecycle events" ON public.account_lifecycle_events;
CREATE POLICY "Staff read lifecycle events" ON public.account_lifecycle_events FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'))
         OR client_id IN (SELECT public.coached_client_ids()));

CREATE OR REPLACE FUNCTION public._account_lifecycle_log(
  _client uuid, _user uuid, _event text, _actor uuid, _role text, _details jsonb DEFAULT '{}'::jsonb)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  INSERT INTO public.account_lifecycle_events (client_id, user_id, event, actor_user_id, actor_role, details)
  VALUES (_client, _user, _event, _actor, coalesce(_role, 'system'), coalesce(_details, '{}'::jsonb));
$$;
REVOKE ALL ON FUNCTION public._account_lifecycle_log(uuid, uuid, text, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._account_lifecycle_log(uuid, uuid, text, uuid, text, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- Deactivate: applied now, or by the job on deactivate_at. Idempotent: an
-- account already deactivated (or in Recently deleted) is left as it is.
-- Writes the client row as the server (the self-update guards refuse a client
-- changing their own status), then puts the claims back.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._account_deactivation_apply(_client uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  c record;
  v_member boolean;
  v_prior jsonb;
  v_cancelled uuid[];
  v_claims text := current_setting('request.jwt.claims', true);
  v_sub text := current_setting('request.jwt.claim.sub', true);
BEGIN
  SELECT id, user_id, status, archived, portal_access_disabled, deactivation_source, deactivated_by,
         deactivation_reason, deactivate_at
    INTO c FROM public.clients WHERE id = _client FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF c.status IN ('Deactivated', 'Deleted') THEN
    RETURN jsonb_build_object('ok', true, 'already', true);
  END IF;

  SELECT m.manual_access_disabled INTO v_member FROM public.app_members m WHERE m.user_id = c.user_id AND c.user_id IS NOT NULL
   ORDER BY m.created_at LIMIT 1;
  v_prior := jsonb_build_object('status', c.status, 'archived', c.archived,
                                'portal_access_disabled', c.portal_access_disabled,
                                'member_access_disabled', v_member);

  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  UPDATE public.clients
     SET status = 'Deactivated', archived = true, portal_access_disabled = true,
         deactivated_at = now(), deactivate_at = NULL,
         deactivation_source = coalesce(c.deactivation_source, 'staff'),
         deactivation_prior = v_prior
   WHERE id = _client;
  IF c.user_id IS NOT NULL THEN
    UPDATE public.app_members SET manual_access_disabled = true WHERE user_id = c.user_id;
  END IF;

  -- Booked sessions from now on: cancelled, each credit back on its package
  -- (tg_pt_session_status_change banks it; the sync takes it off Google).
  WITH gone AS (
    UPDATE public.pt_sessions SET status = 'Cancelled'
     WHERE client_id = _client AND status = 'Scheduled' AND starts_at >= now()
    RETURNING id)
  SELECT array_agg(id) INTO v_cancelled FROM gone;
  IF v_cancelled IS NOT NULL THEN
    INSERT INTO public.pt_session_coach_notes (pt_session_id, client_id, note)
    SELECT s, _client, 'Cancelled when the account was deactivated. The credit went back on the package.'
      FROM unnest(v_cancelled) s
    ON CONFLICT (pt_session_id) DO NOTHING;
  END IF;

  PERFORM set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  PERFORM set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);

  PERFORM public._account_lifecycle_log(_client, c.user_id, 'deactivated', c.deactivated_by,
    CASE WHEN c.deactivation_source = 'self' THEN 'self'
         WHEN c.deactivate_at IS NOT NULL AND c.deactivate_at <= now() THEN 'system'
         WHEN public.has_role(c.deactivated_by, 'admin') THEN 'admin'
         WHEN c.deactivated_by IS NOT NULL THEN 'coach' ELSE 'system' END,
    jsonb_build_object('reason', c.deactivation_reason, 'scheduled', c.deactivate_at IS NOT NULL,
                       'sessions_cancelled', coalesce(array_length(v_cancelled, 1), 0)));
  RETURN jsonb_build_object('ok', true, 'already', false,
                            'sessions_cancelled', coalesce(array_length(v_cancelled, 1), 0));
END;
$$;
REVOKE ALL ON FUNCTION public._account_deactivation_apply(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._account_deactivation_apply(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Reactivate: puts back exactly what deactivating changed, and nothing about
-- money: no subscription restarts, nothing is charged or invoiced, no refund
-- moves, no session is rebooked, no package or expired credit comes back.
-- A deactivation that hasn't happened yet is simply withdrawn.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._account_reactivation_apply(_client uuid, _by uuid, _role text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  c record;
  v_status text;
  v_claims text := current_setting('request.jwt.claims', true);
  v_sub text := current_setting('request.jwt.claim.sub', true);
BEGIN
  SELECT id, user_id, status, service_tier, deactivate_at, deactivation_prior AS prior, deactivation_reason
    INTO c FROM public.clients WHERE id = _client FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF c.status = 'Deleted' THEN RETURN jsonb_build_object('ok', false, 'reason', 'deleted'); END IF;

  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  IF c.status <> 'Deactivated' THEN
    IF c.deactivate_at IS NULL THEN
      PERFORM set_config('request.jwt.claims', coalesce(v_claims, ''), true);
      PERFORM set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
      RETURN jsonb_build_object('ok', true, 'already', true);
    END IF;
    UPDATE public.clients
       SET deactivate_at = NULL, deactivation_source = NULL, deactivated_by = NULL,
           deactivation_reason = NULL, deactivation_note = NULL
     WHERE id = _client;
    PERFORM set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    PERFORM set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
    PERFORM public._account_lifecycle_log(_client, c.user_id, 'deactivation_withdrawn', _by, _role,
      jsonb_build_object('was_due', c.deactivate_at));
    RETURN jsonb_build_object('ok', true, 'withdrawn', true);
  END IF;

  v_status := nullif(c.prior ->> 'status', '');
  IF v_status IS NULL OR v_status IN ('Deactivated', 'Deleted') THEN
    v_status := CASE WHEN c.service_tier = 'self_serve' THEN 'Member' ELSE 'Active' END;
  END IF;
  UPDATE public.clients
     SET status = v_status,
         archived = coalesce((c.prior ->> 'archived')::boolean, false),
         portal_access_disabled = coalesce((c.prior ->> 'portal_access_disabled')::boolean, false),
         deactivated_at = NULL, deactivated_by = NULL, deactivation_reason = NULL, deactivation_note = NULL,
         deactivation_source = NULL, deactivate_at = NULL, deactivation_prior = NULL
   WHERE id = _client;
  IF c.user_id IS NOT NULL THEN
    UPDATE public.app_members
       SET manual_access_disabled = coalesce((c.prior ->> 'member_access_disabled')::boolean, false)
     WHERE user_id = c.user_id;
  END IF;

  PERFORM set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  PERFORM set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  PERFORM public._account_lifecycle_log(_client, c.user_id, 'reactivated', _by, _role,
    jsonb_build_object('status', v_status));
  RETURN jsonb_build_object('ok', true, 'already', false, 'status', v_status);
END;
$$;
REVOKE ALL ON FUNCTION public._account_reactivation_apply(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._account_reactivation_apply(uuid, uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- What the signed-in person's own account is waiting on: the gate over the
-- app reads this once per sign-in.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.account_lifecycle_status()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object(
    'deletion', (
      SELECT jsonb_build_object('id', d.id, 'requested_at', d.requested_at, 'purge_after', d.purge_after, 'source', d.source)
        FROM public.account_deletions d
       WHERE d.user_id = auth.uid() AND d.status = 'pending'
       LIMIT 1),
    'deactivation', (
      SELECT jsonb_build_object(
               'client_id', c.id,
               'state', CASE WHEN c.status = 'Deactivated' THEN 'deactivated' ELSE 'scheduled' END,
               'source', coalesce(c.deactivation_source, 'staff'),
               'since', c.deactivated_at,
               'at', c.deactivate_at,
               'tier', c.service_tier,
               'coach', (SELECT split_part(co.full_name, ' ', 1) FROM public.coaches co WHERE co.id = c.assigned_coach_id))
        FROM public.clients c
       WHERE c.user_id = auth.uid() AND (c.status = 'Deactivated' OR c.deactivate_at IS NOT NULL)
       ORDER BY c.created_at
       LIMIT 1));
$$;
REVOKE ALL ON FUNCTION public.account_lifecycle_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.account_lifecycle_status() TO authenticated;

-- ---------------------------------------------------------------------------
-- A deactivation for later happens on its day. SQL only, and the job does
-- nothing unless one is due.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.account_deactivations_due()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  r record;
  n integer := 0;
BEGIN
  FOR r IN SELECT id FROM public.clients
            WHERE deactivate_at IS NOT NULL AND deactivate_at <= now()
              AND coalesce(status, '') NOT IN ('Deactivated', 'Deleted')
            ORDER BY deactivate_at LIMIT 50
  LOOP
    BEGIN
      PERFORM public._account_deactivation_apply(r.id);
      n := n + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'account_deactivations_due: % failed: %', r.id, SQLERRM;
    END;
  END LOOP;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.account_deactivations_due() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_deactivations_due() TO service_role;

DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'account-deactivations-due';
  PERFORM cron.schedule('account-deactivations-due', '*/15 * * * *',
    $cmd$ SELECT public.account_deactivations_due()
           WHERE EXISTS (SELECT 1 FROM public.clients WHERE deactivate_at IS NOT NULL AND deactivate_at <= now()) $cmd$);
EXCEPTION
  WHEN undefined_table OR undefined_function OR invalid_schema_name THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Deletion requests: recorded on every path (the person, an admin, the gate's
-- Restore, day 30) by one trigger on the bin itself.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_account_deletions_lifecycle()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public._account_lifecycle_log(NEW.client_id, NEW.user_id, 'deletion_requested', NEW.requested_by,
      CASE WHEN NEW.source = 'self' THEN 'self' ELSE 'admin' END,
      jsonb_build_object('purge_after', NEW.purge_after));
  ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'restored' THEN
    PERFORM public._account_lifecycle_log(NEW.client_id, NEW.user_id, 'deletion_withdrawn', NEW.restored_by,
      CASE WHEN NEW.restored_by = NEW.user_id THEN 'self' ELSE 'admin' END, '{}'::jsonb);
  ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'deleted' THEN
    PERFORM public._account_lifecycle_log(OLD.client_id, OLD.user_id, 'deletion_completed', NULL, 'system',
      jsonb_build_object('result', NEW.result));
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS account_deletions_lifecycle ON public.account_deletions;
CREATE TRIGGER account_deletions_lifecycle AFTER INSERT OR UPDATE OF status ON public.account_deletions
  FOR EACH ROW EXECUTE FUNCTION public.tg_account_deletions_lifecycle();

-- ---------------------------------------------------------------------------
-- Restore from Recently deleted: an account the person deleted themselves is
-- theirs to take back (they sign in and tap Restore). Staff can't reverse
-- someone's own deletion request; an admin restores only what an admin
-- deleted.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.account_delete_restore(_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
  v_source text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in first' USING ERRCODE = '42501'; END IF;
  IF _id IS NULL THEN
    SELECT id INTO v_id FROM public.account_deletions
     WHERE user_id = v_uid AND status = 'pending' AND source = 'self' LIMIT 1;
  ELSE
    IF NOT public.has_role(v_uid, 'admin') THEN
      RAISE EXCEPTION 'Only an admin can restore someone else''s account' USING ERRCODE = '42501';
    END IF;
    SELECT id, source INTO v_id, v_source FROM public.account_deletions WHERE id = _id AND status = 'pending';
    IF v_source = 'self' THEN
      RAISE EXCEPTION 'They asked for this deletion themselves, so only they can take it back: they sign in and tap Restore.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  IF v_id IS NULL THEN RETURN false; END IF;
  PERFORM public._account_deletion_apply(v_id, true);
  UPDATE public.account_deletions SET status = 'restored', restored_at = now(), restored_by = v_uid WHERE id = v_id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.account_delete_restore(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.account_delete_restore(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Crew: a deactivated account is hidden from everyone, like one in Recently
-- deleted (the same set blocks use; staff still see everything).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.community_blocked_authors()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH me AS (SELECT public.community_main_account(auth.uid()) AS id),
  mine AS (SELECT me.id FROM me UNION SELECT cp.user_id FROM public.community_profiles cp, me WHERE cp.same_person_as = me.id),
  other AS (
    SELECT public.community_main_account(b.blocked_user_id) AS id FROM public.chat_user_blocks b WHERE b.user_id IN (SELECT id FROM mine)
    UNION
    SELECT public.community_main_account(b.user_id) FROM public.chat_user_blocks b WHERE b.blocked_user_id IN (SELECT id FROM mine)
    UNION
    SELECT d.user_id FROM public.account_deletions d
     WHERE d.status IN ('pending', 'deleted') AND d.user_id IS NOT NULL AND d.user_id NOT IN (SELECT id FROM mine)
    UNION
    SELECT c.user_id FROM public.clients c
     WHERE c.status = 'Deactivated' AND c.user_id IS NOT NULL AND c.user_id NOT IN (SELECT id FROM mine))
  SELECT o.id FROM other o WHERE NOT public.community_is_coach(o.id)
  UNION
  SELECT cp.user_id FROM public.community_profiles cp JOIN other o ON cp.same_person_as = o.id WHERE NOT public.community_is_coach(o.id)
$$;
REVOKE ALL ON FUNCTION public.community_blocked_authors() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.community_blocked_authors() TO service_role;

-- ---------------------------------------------------------------------------
-- Clients list: a deactivated client is under Deactivated only, never also
-- under Archived (deactivating archives the record so every job skips it).
-- Edited in place from the live definition; left alone when it isn't the
-- shape this was written against.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  f oid;
  v_def text;
  v_anchor text := $a$(v_lifecycle = 'archived'    and (c.archived = true or c.status = 'Archived'))$a$;
  v_new text := $a$(v_lifecycle = 'archived'    and (c.archived = true or c.status = 'Archived') and coalesce(c.status, '') <> 'Deactivated')$a$;
BEGIN
  FOR f IN SELECT p.oid FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'admin_clients_directory'
  LOOP
    v_def := pg_get_functiondef(f);
    CONTINUE WHEN position(v_new in v_def) > 0;
    IF (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 THEN
      RAISE WARNING 'admin_clients_directory (%): archived anchor not found once, deactivated clients also show under Archived', f;
      CONTINUE;
    END IF;
    EXECUTE replace(v_def, v_anchor, v_new);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Day 30 for an account that has to be kept (payments, session records or a
-- chat with the coach): the person's own data goes, the business record
-- stays. Everything that would have gone with the client record and the
-- login goes, except what is kept on purpose:
--   money and session records (payment_ledger, session_ledger_events,
--   purchase_records, credits: no cascade from either), the PT sessions they
--   prove, the chat with the coach and its check-in threads, signed
--   agreements and legal acceptances / consents.
-- Training, nutrition, health, progress, forms, Crew posts and every
-- preference go. The record keeps only the name the money is under.
-- Service role only (account-deletion.server.ts).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._account_purge_personal(_client uuid, _user uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  keep_client text[] := ARRAY['messages', 'pt_sessions', 'agreements', 'coaching_agreement_client_state',
    'coaching_agreement_events', 'weekly_checkin_threads', 'communication_log', 'conversation_state',
    'conversation_staff_reads', 'conversation_workflow_events'];
  keep_user text[] := ARRAY['legal_acceptances', 'legal_consent_preferences', 'user_roles', 'profiles',
    'business_owners', 'challenge_staff', 'live_support_agents', 'weekly_checkin_messages', 'message_reactions',
    'tasks', 'quick_notes', 'summer_chats', 'summer_messages', 'summer_attachments', 'summer_profiles', 'cleo_actions',
    'program_ai_edits', 'program_intel_jobs', 'client_google_calendars',
    -- moderation records: who reported stays private, the report stays
    'community_reports', 'chat_reports'];
  -- personal data that a client delete wouldn't cascade (set null / restrict)
  extra text[] := ARRAY['progress_submissions', 'fillout_submissions', 'submission_reviews', 'health_screenings',
    'athlete_powerlifting_results', 'powerlifting_athletes'];
  r record;
  v_done jsonb := '{}'::jsonb;
  v_err jsonb := '{}'::jsonb;
  v_n integer;
  v_pass integer;
  v_todo jsonb := '[]'::jsonb;
  v_left jsonb;
  t jsonb;
BEGIN
  PERFORM set_config('jf.allow_history_delete', 'on', true);
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  -- what to clear: every cascade from the client and the login, plus the extras
  FOR r IN
    SELECT DISTINCT c.conrelid::regclass::text AS tbl, a.attname AS col, 'client' AS who
      FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
     WHERE c.contype = 'f' AND c.confrelid = 'public.clients'::regclass AND c.confdeltype = 'c'
       AND c.conrelid::regclass::text <> ALL (keep_client)
    UNION
    SELECT DISTINCT c.conrelid::regclass::text, a.attname, 'user'
      FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
     WHERE c.contype = 'f' AND c.confrelid = 'auth.users'::regclass AND c.confdeltype = 'c'
       AND c.conrelid::regclass::text NOT LIKE 'auth.%'
       AND c.conrelid::regclass::text <> ALL (keep_user)
    UNION
    SELECT DISTINCT c.conrelid::regclass::text, a.attname, 'client'
      FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
     WHERE c.contype = 'f' AND c.confrelid = 'public.clients'::regclass
       AND c.conrelid::regclass::text = ANY (extra)
  LOOP
    CONTINUE WHEN r.who = 'user' AND _user IS NULL;
    v_todo := v_todo || jsonb_build_object('tbl', r.tbl, 'col', r.col, 'id', CASE WHEN r.who = 'client' THEN _client ELSE _user END);
  END LOOP;

  -- two passes: something a foreign key held back the first time goes the second
  FOR v_pass IN 1..2 LOOP
    v_left := '[]'::jsonb;
    FOR t IN SELECT * FROM jsonb_array_elements(v_todo) LOOP
      BEGIN
        EXECUTE format('DELETE FROM %s WHERE %I = $1', t ->> 'tbl', t ->> 'col') USING (t ->> 'id')::uuid;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        IF v_n > 0 THEN
          v_done := v_done || jsonb_build_object(t ->> 'tbl', coalesce((v_done ->> (t ->> 'tbl'))::int, 0) + v_n);
        END IF;
        v_err := v_err - (t ->> 'tbl');
      EXCEPTION WHEN OTHERS THEN
        v_err := v_err || jsonb_build_object(t ->> 'tbl', left(SQLERRM, 200));
        v_left := v_left || t;
      END;
    END LOOP;
    v_todo := v_left;
    EXIT WHEN jsonb_array_length(v_todo) = 0;
  END LOOP;

  -- the record itself: the name the money is under, nothing else
  UPDATE public.clients SET
    email = NULL, phone = NULL, instagram = NULL, tiktok = NULL, youtube = NULL, facebook = NULL, twitter_x = NULL,
    linkedin = NULL, website = NULL, other_social_label = NULL, other_social_handle = NULL, openpowerlifting_url = NULL,
    address = NULL, city = NULL, province = NULL, postal_code = NULL, country = NULL, date_of_birth = NULL,
    emergency_contact_name = NULL, emergency_contact_phone = NULL, preferred_name = NULL, voice_nickname = NULL,
    profile_picture_url = NULL, goals = NULL, injuries = NULL, nutrition_notes = NULL, training_notes = NULL,
    lifestyle_notes = NULL, coach_notes = NULL, schedule_notes = NULL, checkin_notes_client = NULL,
    checkin_notes_admin = NULL, intake_injuries = NULL, intake_training_experience = NULL, intake_followed_program = NULL,
    food_dislikes = NULL, cooking_skill = NULL, sex = NULL, calendar_feed_token = NULL, last_active_route = NULL,
    basic_info_update_reason = NULL, deactivation_note = NULL, program_sheet_link = NULL, drive_folder_link = NULL,
    checkin_form_link = NULL, calendar_link = NULL, tags = '{}'
   WHERE id = _client;
  IF _user IS NOT NULL THEN
    UPDATE public.app_members SET email = 'deleted-' || _user::text || '@deleted.invalid', phone = NULL, date_of_birth = NULL, address_line1 = NULL,
      address_city = NULL, address_state = NULL, address_zip = NULL, address_country = NULL,
      emergency_contact_name = NULL, emergency_contact_phone = NULL, goals = NULL, training_background = NULL,
      avatar_url = NULL, signup_ip = NULL, signup_user_agent = NULL, setup_token = NULL, admin_notes = NULL
     WHERE user_id = _user;
    UPDATE public.profiles SET avatar_url = NULL WHERE id = _user;
  END IF;

  RETURN jsonb_build_object('deleted', v_done, 'failed', v_err);
END;
$$;
REVOKE ALL ON FUNCTION public._account_purge_personal(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._account_purge_personal(uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- app_members: trusted server processes (service role, the lifecycle
-- functions above) have no auth.uid(), the same pass the other app_members
-- guards already give. Without it, turning a member's access off from the
-- server (deactivating, Recently deleted's hold) was refused for everyone.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_app_members_self_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN NEW;
  END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.account_type IS DISTINCT FROM OLD.account_type
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.subscription_status IS DISTINCT FROM OLD.subscription_status
     OR NEW.manual_access_override IS DISTINCT FROM OLD.manual_access_override
     OR NEW.manual_access_disabled IS DISTINCT FROM OLD.manual_access_disabled
     OR NEW.access_end_date IS DISTINCT FROM OLD.access_end_date
     OR NEW.in_grace IS DISTINCT FROM OLD.in_grace
     OR NEW.cross_account_locked IS DISTINCT FROM OLD.cross_account_locked
     OR NEW.stripe_customer_id IS DISTINCT FROM OLD.stripe_customer_id
     OR NEW.stripe_subscription_id IS DISTINCT FROM OLD.stripe_subscription_id
     OR NEW.stripe_price_id IS DISTINCT FROM OLD.stripe_price_id
  THEN
    RAISE EXCEPTION 'Not allowed: only admins can change subscription/access/billing fields on app_members';
  END IF;
  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- Accounts deactivated before this (two, by a coach, "Coaching ended") are
-- archived like every deactivation now, so no job reaches them, with what
-- reactivating puts back. Applied once by hand on Nov 15, 2026; a no-op after.
-- ---------------------------------------------------------------------------
UPDATE public.clients
   SET archived = true,
       deactivation_source = coalesce(deactivation_source, 'staff'),
       deactivation_prior = coalesce(deactivation_prior, jsonb_build_object('status', 'Active', 'archived', archived, 'portal_access_disabled', false))
 WHERE status = 'Deactivated' AND (archived = false OR deactivation_source IS NULL);
