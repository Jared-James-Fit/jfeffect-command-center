-- Recently deleted: no account is ever deleted on the spot.
--
-- Deleting an account (the person themselves from Account → Delete account,
-- or an admin from a client's or member's page) moves it to Recently deleted
-- for 30 days, like iMessage's. During those 30 days the account is held:
-- the client record is archived with status 'Deleted' and the portal off
-- (every coaching job and the Clients list leave it out), a JF member's access
-- is off (manual_access_disabled), and the person is hidden from everyone in
-- Crew (community_blocked_authors). Their login keeps working only so they can
-- sign back in and tap Restore (an account they deleted themselves; one an
-- admin deleted says to contact support); an admin can restore any of them
-- from Recently deleted. Restoring puts back exactly what was there (`prior`). After 30 days the
-- account-deletions-purge job deletes it for good the way an admin delete
-- always has (account-deletion.server.ts): chats are never deleted, so a
-- record with chat history stays deactivated and its login is closed instead.
-- Nobody, staff included, can skip the 30 days.
--
-- Staff logins (coach, admin, finance, media) and a coach's linked athlete
-- login aren't deleted this way: they're managed from Team.

CREATE TABLE IF NOT EXISTS public.account_deletions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  member_id uuid REFERENCES public.app_members(id) ON DELETE SET NULL,
  name text,
  email text,
  source text NOT NULL CHECK (source IN ('self', 'admin')),
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reason text CHECK (reason IS NULL OR char_length(reason) <= 500),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'restored', 'deleted')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  purge_after timestamptz NOT NULL DEFAULT now() + interval '30 days',
  -- what the hold changed, put back exactly on restore
  prior jsonb NOT NULL DEFAULT '{}'::jsonb,
  restored_at timestamptz,
  restored_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  deleted_at timestamptz,
  -- what the purge did: { client: deleted|kept, member: deleted|kept, login: deleted|closed }
  result jsonb,
  attempts integer NOT NULL DEFAULT 0,
  last_error text
);
CREATE UNIQUE INDEX IF NOT EXISTS account_deletions_one_pending_user
  ON public.account_deletions (user_id) WHERE status = 'pending' AND user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS account_deletions_one_pending_client
  ON public.account_deletions (client_id) WHERE status = 'pending' AND client_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS account_deletions_one_pending_member
  ON public.account_deletions (member_id) WHERE status = 'pending' AND member_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS account_deletions_due ON public.account_deletions (purge_after) WHERE status = 'pending';

ALTER TABLE public.account_deletions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_deletions FROM anon, authenticated;
GRANT SELECT ON public.account_deletions TO authenticated;
GRANT ALL ON public.account_deletions TO service_role;
-- written only by the functions below and the purge job; read by admins and by the person themselves
DROP POLICY IF EXISTS "Admins read account deletions" ON public.account_deletions;
CREATE POLICY "Admins read account deletions" ON public.account_deletions FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')));
DROP POLICY IF EXISTS "Own account deletion" ON public.account_deletions;
CREATE POLICY "Own account deletion" ON public.account_deletions FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- ---------------------------------------------------------------------------
-- The hold, and putting it back. Internal: they write the client row as the
-- server (the clients self-update guards refuse a client changing their own
-- status), the same way mark_client_signed_in does, then put the claims back.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._account_deletion_apply(_id uuid, _restore boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  r public.account_deletions%ROWTYPE;
  v_claims text := current_setting('request.jwt.claims', true);
  v_sub text := current_setting('request.jwt.claim.sub', true);
BEGIN
  SELECT * INTO r FROM public.account_deletions WHERE id = _id;
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  IF r.client_id IS NOT NULL THEN
    IF _restore THEN
      UPDATE public.clients
         SET archived = coalesce((r.prior #>> '{client,archived}')::boolean, false),
             status = r.prior #>> '{client,status}',
             portal_access_disabled = coalesce((r.prior #>> '{client,portal_access_disabled}')::boolean, false)
       WHERE id = r.client_id;
    ELSE
      UPDATE public.clients SET archived = true, status = 'Deleted', portal_access_disabled = true
       WHERE id = r.client_id;
    END IF;
  END IF;
  IF r.member_id IS NOT NULL THEN
    UPDATE public.app_members
       SET manual_access_disabled = CASE WHEN _restore
                                         THEN coalesce((r.prior #>> '{member,manual_access_disabled}')::boolean, false)
                                         ELSE true END
     WHERE id = r.member_id;
  END IF;

  PERFORM set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  PERFORM set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
END;
$$;
REVOKE ALL ON FUNCTION public._account_deletion_apply(uuid, boolean) FROM PUBLIC, anon, authenticated;

/** Staff logins and a coach's linked athlete login are managed from Team, never binned. */
CREATE OR REPLACE FUNCTION public._account_is_staff(_user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT _user IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _user AND ur.role::text <> 'client')
    OR EXISTS (SELECT 1 FROM public.community_profiles cp WHERE cp.user_id = _user AND cp.same_person_as IS NOT NULL));
$$;
REVOKE ALL ON FUNCTION public._account_is_staff(uuid) FROM PUBLIC, anon, authenticated;

/** One account into the bin (or the one already there). */
CREATE OR REPLACE FUNCTION public._account_deletion_open(
  _user uuid, _client uuid, _member uuid, _source text, _by uuid, _reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_existing public.account_deletions%ROWTYPE;
  v_id uuid;
  v_name text;
  v_email text;
  v_prior jsonb := '{}'::jsonb;
  c record;
  m record;
BEGIN
  SELECT * INTO v_existing FROM public.account_deletions d
   WHERE d.status = 'pending'
     AND ((_user IS NOT NULL AND d.user_id = _user)
       OR (_client IS NOT NULL AND d.client_id = _client)
       OR (_member IS NOT NULL AND d.member_id = _member))
   LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('id', v_existing.id, 'purge_after', v_existing.purge_after, 'already', true);
  END IF;

  IF _client IS NOT NULL THEN
    SELECT id, archived, status, portal_access_disabled, full_name, email INTO c FROM public.clients WHERE id = _client;
    v_prior := v_prior || jsonb_build_object('client', jsonb_build_object(
      'archived', c.archived, 'status', c.status, 'portal_access_disabled', c.portal_access_disabled));
    v_name := c.full_name;
    v_email := c.email;
  END IF;
  IF _member IS NOT NULL THEN
    SELECT id, manual_access_disabled, full_name, email INTO m FROM public.app_members WHERE id = _member;
    v_prior := v_prior || jsonb_build_object('member', jsonb_build_object('manual_access_disabled', m.manual_access_disabled));
    v_name := coalesce(v_name, m.full_name);
    v_email := coalesce(v_email, m.email);
  END IF;

  INSERT INTO public.account_deletions (user_id, client_id, member_id, name, email, source, requested_by, reason, prior)
  VALUES (_user, _client, _member, v_name, v_email, _source, _by, left(nullif(btrim(coalesce(_reason, '')), ''), 500), v_prior)
  RETURNING id INTO v_id;
  PERFORM public._account_deletion_apply(v_id, false);
  RETURN jsonb_build_object('id', v_id, 'purge_after', (SELECT purge_after FROM public.account_deletions WHERE id = v_id), 'already', false);
END;
$$;
REVOKE ALL ON FUNCTION public._account_deletion_open(uuid, uuid, uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The person deletes their own account: into the bin for 30 days.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.account_delete_request(_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_client uuid;
  v_member uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in first' USING ERRCODE = '42501'; END IF;
  IF public._account_is_staff(v_uid) THEN
    RAISE EXCEPTION 'Team accounts are closed by the owner from Team, not deleted here.' USING ERRCODE = '42501';
  END IF;
  SELECT id INTO v_client FROM public.clients WHERE user_id = v_uid ORDER BY created_at LIMIT 1;
  SELECT id INTO v_member FROM public.app_members WHERE user_id = v_uid ORDER BY created_at LIMIT 1;
  RETURN public._account_deletion_open(v_uid, v_client, v_member, 'self', v_uid, _reason);
END;
$$;
REVOKE ALL ON FUNCTION public.account_delete_request(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.account_delete_request(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- An admin deletes a client or a member: into the bin for 30 days too.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.account_delete_by_admin(
  _client_id uuid DEFAULT NULL, _member_id uuid DEFAULT NULL, _reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_user uuid;
  v_client uuid := _client_id;
  v_member uuid := _member_id;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'Only an admin can delete an account' USING ERRCODE = '42501';
  END IF;
  IF v_client IS NOT NULL THEN
    SELECT user_id INTO v_user FROM public.clients WHERE id = v_client;
    IF NOT FOUND THEN RAISE EXCEPTION 'Client not found' USING ERRCODE = 'P0002'; END IF;
  ELSIF v_member IS NOT NULL THEN
    SELECT user_id INTO v_user FROM public.app_members WHERE id = v_member;
    IF NOT FOUND THEN RAISE EXCEPTION 'Member not found' USING ERRCODE = 'P0002'; END IF;
  ELSE
    RAISE EXCEPTION 'Pick a client or a member' USING ERRCODE = '22023';
  END IF;
  IF v_user = v_uid THEN RAISE EXCEPTION 'You can''t delete your own account' USING ERRCODE = '42501'; END IF;
  IF public._account_is_staff(v_user) THEN
    RAISE EXCEPTION 'That''s a team login. Remove it from Team instead.' USING ERRCODE = '42501';
  END IF;
  -- the same person's other record goes with it (one athlete, one login)
  IF v_user IS NOT NULL THEN
    IF v_client IS NULL THEN SELECT id INTO v_client FROM public.clients WHERE user_id = v_user ORDER BY created_at LIMIT 1; END IF;
    IF v_member IS NULL THEN SELECT id INTO v_member FROM public.app_members WHERE user_id = v_user ORDER BY created_at LIMIT 1; END IF;
  END IF;
  RETURN public._account_deletion_open(v_user, v_client, v_member, 'admin', v_uid, _reason);
END;
$$;
REVOKE ALL ON FUNCTION public.account_delete_by_admin(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.account_delete_by_admin(uuid, uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Restore: the person from their gate (no id; only an account they deleted
-- themselves), or an admin (the row's id; any account).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.account_delete_restore(_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in first' USING ERRCODE = '42501'; END IF;
  IF _id IS NULL THEN
    -- only what they deleted themselves: an account an admin deleted is the admin's to restore
    SELECT id INTO v_id FROM public.account_deletions
     WHERE user_id = v_uid AND status = 'pending' AND source = 'self' LIMIT 1;
  ELSE
    IF NOT public.has_role(v_uid, 'admin') THEN
      RAISE EXCEPTION 'Only an admin can restore someone else''s account' USING ERRCODE = '42501';
    END IF;
    SELECT id INTO v_id FROM public.account_deletions WHERE id = _id AND status = 'pending';
  END IF;
  IF v_id IS NULL THEN RETURN false; END IF;
  PERFORM public._account_deletion_apply(v_id, true);
  UPDATE public.account_deletions SET status = 'restored', restored_at = now(), restored_by = v_uid WHERE id = v_id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.account_delete_restore(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.account_delete_restore(uuid) TO authenticated;

/** The signed-in person's account in the bin, if it is: what the restore screen shows. */
CREATE OR REPLACE FUNCTION public.account_deletion_status()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object('id', d.id, 'requested_at', d.requested_at, 'purge_after', d.purge_after, 'source', d.source)
    FROM public.account_deletions d
   WHERE d.user_id = auth.uid() AND d.status = 'pending'
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.account_deletion_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.account_deletion_status() TO authenticated;

-- ---------------------------------------------------------------------------
-- Crew: an account in the bin (or one closed after it, login kept for chat
-- history) is hidden from everyone, the same set blocks use. Staff still see
-- everything (callers skip the set for staff), and coaches are never hidden.
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
     WHERE d.status IN ('pending', 'deleted') AND d.user_id IS NOT NULL AND d.user_id NOT IN (SELECT id FROM mine))
  SELECT o.id FROM other o WHERE NOT public.community_is_coach(o.id)
  UNION
  SELECT cp.user_id FROM public.community_profiles cp JOIN other o ON cp.same_person_as = o.id WHERE NOT public.community_is_coach(o.id)
$$;
REVOKE ALL ON FUNCTION public.community_blocked_authors() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.community_blocked_authors() TO service_role;

-- ---------------------------------------------------------------------------
-- The Clients list leaves out accounts in the bin (they're under Recently
-- deleted, not Archived). Edited in place from the live definition; if it
-- isn't the shape this was written against, it's left as it is (they then
-- also show under Archived) rather than failing the deploy.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  f oid;
  v_def text;
  v_anchor text := E'      and c.service_tier = ''coaching''\n      and (';
  v_new text := E'      and c.service_tier = ''coaching''\n      and coalesce(c.status, '''') <> ''Deleted''\n      and (';
BEGIN
  SELECT p.oid INTO f FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'admin_clients_directory'
   ORDER BY p.pronargs DESC LIMIT 1;
  IF f IS NULL THEN RETURN; END IF;
  v_def := pg_get_functiondef(f);
  IF position('''Deleted''' in v_def) > 0 THEN RETURN; END IF;
  IF (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 THEN
    RAISE WARNING 'admin_clients_directory: anchor not found once, Recently deleted clients also show under Archived';
    RETURN;
  END IF;
  EXECUTE replace(v_def, v_anchor, v_new);
END $$;

-- ---------------------------------------------------------------------------
-- Day 30: the purge job (account-deletions-purge hook, daily while anything
-- is due), the same host and secret as the other jobs.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'account-deletions-purge';
  PERFORM cron.schedule(
    'account-deletions-purge',
    '17 9 * * *',
    $cmd$
    SELECT net.http_post(
      url := 'https://project--5f1f340c-5afa-4262-90c8-1f9406568c6c.lovable.app/api/public/hooks/account-deletions-purge',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-hook-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_hook_secret' LIMIT 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    ) AS request_id
    WHERE EXISTS (SELECT 1 FROM public.account_deletions WHERE status = 'pending' AND purge_after <= now());
    $cmd$
  );
EXCEPTION
  WHEN undefined_table OR undefined_function OR invalid_schema_name THEN
    NULL;
END $$;
