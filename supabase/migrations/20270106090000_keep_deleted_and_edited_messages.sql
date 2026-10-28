-- The coach chat keeps what a deleted or edited message said, for admins only.
--
-- A client's (or coach's) "Delete for everyone" blanked the message in place
-- (deleted_at, body '', attachments []) and an edit overwrote the words, so
-- nobody could ever see what was said; the coach lost the text of a client's
-- message she deleted a minute after sending it. Now the database keeps the
-- version that was replaced, whoever changed it:
--   * delete for everyone -> message_deletions, kind 'unsent' (the placeholder
--     stays in the chat; an admin can tap it to see the words and files)
--   * edit -> message_edits, the words before each edit (an admin taps
--     "edited" to see them)
-- Only admins read either table (not coaches, never the client, never in
-- "View as client", which reads as the client), and only a SECURITY DEFINER
-- trigger writes them. Coach 1:1 chats (`messages`) only: member-made group
-- and 1:1 chats stay private to their members.
--
-- Nothing earlier can be recovered: what was overwritten before this was
-- never kept anywhere.

-- What kind of deletion a row is: 'removed' = an admin took the message out
-- (no placeholder, listed under "N deleted" above the composer); 'unsent' =
-- deleted for everyone (the placeholder stays in the chat).
ALTER TABLE public.message_deletions
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'removed';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'message_deletions_kind_check') THEN
    ALTER TABLE public.message_deletions
      ADD CONSTRAINT message_deletions_kind_check CHECK (kind IN ('removed', 'unsent'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS message_deletions_message_idx ON public.message_deletions (message_id);

-- Admins only, checked once per query. Read-only from the app: copies are
-- written by this trigger, admin_delete_messages and the server (service role).
REVOKE ALL ON public.message_deletions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.message_deletions TO authenticated;
GRANT ALL ON public.message_deletions TO service_role;
DROP POLICY IF EXISTS "Admins read message deletions" ON public.message_deletions;
CREATE POLICY "Admins read message deletions" ON public.message_deletions
  FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));

-- Every earlier version of an edited message: `body` is the words an edit replaced.
CREATE TABLE IF NOT EXISTS public.message_edits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL,
  client_id uuid,
  sender_id uuid,
  sender_role text,
  body text NOT NULL,
  edited_by uuid,
  edited_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS message_edits_client_idx ON public.message_edits (client_id, edited_at);
CREATE INDEX IF NOT EXISTS message_edits_message_idx ON public.message_edits (message_id, edited_at);

ALTER TABLE public.message_edits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.message_edits FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.message_edits TO authenticated;
GRANT ALL ON public.message_edits TO service_role;

DROP POLICY IF EXISTS "Admins read message edits" ON public.message_edits;
CREATE POLICY "Admins read message edits" ON public.message_edits
  FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));

-- Keeps the replaced version. Runs as the table owner so a client's own
-- delete or edit can write the copy they can never read.
CREATE OR REPLACE FUNCTION public.keep_message_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    IF coalesce(OLD.body, '') <> ''
       OR (jsonb_typeof(OLD.attachments) = 'array' AND jsonb_array_length(OLD.attachments) > 0) THEN
      INSERT INTO public.message_deletions
        (message_id, chat, kind, client_id, sender_id, sender_role, body, attachments, original_created_at, deleted_by, deleted_at)
      VALUES
        (OLD.id, 'dm', 'unsent', OLD.client_id, OLD.sender_id, OLD.sender_role, OLD.body, OLD.attachments, OLD.created_at,
         auth.uid(), coalesce(NEW.deleted_at, now()));
    END IF;
  ELSIF OLD.deleted_at IS NULL
        AND NEW.body IS DISTINCT FROM OLD.body
        AND coalesce(OLD.body, '') <> '' THEN
    INSERT INTO public.message_edits (message_id, client_id, sender_id, sender_role, body, edited_by, edited_at)
    VALUES (OLD.id, OLD.client_id, OLD.sender_id, OLD.sender_role, OLD.body, auth.uid(), coalesce(NEW.edited_at, now()));
  END IF;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.keep_message_history() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS messages_keep_history ON public.messages;
CREATE TRIGGER messages_keep_history
  AFTER UPDATE OF body, deleted_at ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.keep_message_history();

-- An admin's Remove on a "This message was deleted" placeholder: the words
-- are already kept (as 'unsent'), so that row becomes the removed one instead
-- of a second, empty copy, and it moves to "N deleted" with what it said.
CREATE OR REPLACE FUNCTION public.admin_delete_messages(_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  n integer;
  affected uuid[];
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only admins can delete messages this way' USING errcode = '42501';
  END IF;

  SELECT array_agg(DISTINCT client_id) INTO affected FROM public.messages WHERE id = ANY(_ids);

  UPDATE public.message_deletions d
     SET kind = 'removed'
   WHERE d.kind = 'unsent' AND d.message_id = ANY(_ids);

  INSERT INTO public.message_deletions
    (message_id, chat, kind, client_id, sender_id, sender_role, body, attachments, original_created_at, deleted_by)
  SELECT m.id, 'dm', 'removed', m.client_id, m.sender_id, m.sender_role, m.body, m.attachments, m.created_at, auth.uid()
    FROM public.messages m
   WHERE m.id = ANY(_ids)
     AND NOT EXISTS (SELECT 1 FROM public.message_deletions d WHERE d.message_id = m.id AND d.chat = 'dm');

  -- Replies quoting a removed message lose the quote (FK is ON DELETE SET
  -- NULL and normalize_message_reply clears reply_preview).
  DELETE FROM public.messages WHERE id = ANY(_ids);
  GET DIAGNOSTICS n = row_count;

  -- Inbox ordering follows what's actually left in the thread.
  UPDATE public.conversation_state cs
     SET last_message_at = coalesce(
           (SELECT max(m.created_at) FROM public.messages m
             WHERE m.client_id = cs.client_id AND NOT m.is_internal_note),
           cs.last_message_at),
         updated_at = now()
   WHERE cs.client_id = ANY(coalesce(affected, '{}'));

  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_messages(uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_messages(uuid[]) TO authenticated;

SELECT public.rls_evaluate_once('message_deletions');
SELECT public.rls_evaluate_once('message_edits');
