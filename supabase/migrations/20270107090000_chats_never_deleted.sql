-- Chats are never deleted with an account.
--
-- Deleting a client cascaded to their whole coach chat (messages.client_id ON
-- DELETE CASCADE), deleting a member to their support chat (member_support_*
-- -> app_members), deleting a login to their reactions and group memberships
-- (and blanked who sent their messages), and deleting a coach-run group to its
-- messages. The coach wants every chat kept as a record, whatever happens to
-- the account, so the database now refuses each of those deletes while there
-- is chat history; the app deactivates (or archives) instead.
--
-- Deliberate purges keep the same admin-only escape as logged training
-- (20261123090000_pl_history_guard.sql): SET LOCAL jf.allow_history_delete = 'on'.
-- Member-made crews are untouched: when the last member leaves one it goes
-- (chat_crew_drop_member); those chats are private to the members who left.

CREATE OR REPLACE FUNCTION public.chat_history_purge_allowed()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$ SELECT coalesce(current_setting('jf.allow_history_delete', true), '') = 'on' $$;

-- A client with coach-chat messages: deactivate them instead.
CREATE OR REPLACE FUNCTION public.guard_client_chat_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.chat_history_purge_allowed() THEN RETURN OLD; END IF;
  IF EXISTS (SELECT 1 FROM public.messages WHERE client_id = OLD.id) THEN
    RAISE EXCEPTION 'This client has chat history, so they can''t be deleted. Deactivate them instead: the chat is kept.'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS clients_guard_chat_delete ON public.clients;
CREATE TRIGGER clients_guard_chat_delete
  BEFORE DELETE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.guard_client_chat_delete();

-- A member with support messages: deactivate them instead.
CREATE OR REPLACE FUNCTION public.guard_member_chat_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.chat_history_purge_allowed() THEN RETURN OLD; END IF;
  IF EXISTS (SELECT 1 FROM public.member_support_messages WHERE member_id = OLD.id) THEN
    RAISE EXCEPTION 'This member has support chat history, so they can''t be deleted. Deactivate them instead: the chat is kept.'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS app_members_guard_chat_delete ON public.app_members;
CREATE TRIGGER app_members_guard_chat_delete
  BEFORE DELETE ON public.app_members
  FOR EACH ROW EXECUTE FUNCTION public.guard_member_chat_delete();

-- A coach-run group (or 1:1) with messages: archive it instead.
CREATE OR REPLACE FUNCTION public.guard_group_chat_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.chat_history_purge_allowed() OR OLD.kind = 'crew' THEN RETURN OLD; END IF;
  IF EXISTS (SELECT 1 FROM public.group_messages WHERE group_id = OLD.id) THEN
    RAISE EXCEPTION 'This chat has messages, so it can''t be deleted. Archive it instead: the messages are kept.'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS chat_groups_guard_chat_delete ON public.chat_groups;
CREATE TRIGGER chat_groups_guard_chat_delete
  BEFORE DELETE ON public.chat_groups
  FOR EACH ROW EXECUTE FUNCTION public.guard_group_chat_delete();

-- A login that has sent or reacted to messages: deleting it would blank who
-- sent them and drop its reactions and group memberships. Turn its access off
-- instead (deactivate the client / member). Covers the Supabase dashboard and
-- every server path, not just the app's buttons.
CREATE OR REPLACE FUNCTION public.guard_login_chat_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.chat_history_purge_allowed() THEN RETURN OLD; END IF;
  IF EXISTS (SELECT 1 FROM public.messages WHERE sender_id = OLD.id)
     OR EXISTS (SELECT 1 FROM public.group_messages WHERE sender_id = OLD.id)
     OR EXISTS (SELECT 1 FROM public.member_support_messages WHERE sender_user_id = OLD.id)
     OR EXISTS (SELECT 1 FROM public.message_reactions WHERE user_id = OLD.id)
     OR EXISTS (SELECT 1 FROM public.group_message_reactions WHERE user_id = OLD.id) THEN
    RAISE EXCEPTION 'This login has chat history, so it can''t be deleted. Deactivate the account instead: the chats are kept.'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS users_guard_chat_delete ON auth.users;
CREATE TRIGGER users_guard_chat_delete
  BEFORE DELETE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.guard_login_chat_delete();

REVOKE EXECUTE ON FUNCTION public.guard_client_chat_delete() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_member_chat_delete() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_group_chat_delete() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_login_chat_delete() FROM PUBLIC, anon, authenticated;
