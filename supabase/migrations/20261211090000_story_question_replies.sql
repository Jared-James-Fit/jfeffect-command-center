-- Instagram's Questions: the poster taps a response, replies to it with a
-- story (the response card on it, their own words around it), and the
-- response shows as answered. The card carries the question and what was
-- sent, never who sent it (only the poster ever sees that).
--
-- A response is answered by a story the poster posted; deleting that story
-- makes it unanswered again (answered_post_id goes, answered_at stays as
-- history but isn't shown).
SET lock_timeout = '3s';

ALTER TABLE public.community_sticker_answers
  ADD COLUMN IF NOT EXISTS answered_post_id uuid REFERENCES public.community_posts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS answered_at timestamptz;

-- The poster's list of responses says which ones they've answered (and with which story).
DO $$
DECLARE
  v_def text := pg_get_functiondef('public.community_sticker_json(uuid,uuid)'::regprocedure);
  v_old text := '''body'', a.body, ''at'', a.updated_at';
  v_new text := '''body'', a.body, ''at'', a.updated_at'
             || ', ''answered_at'', CASE WHEN a.answered_post_id IS NOT NULL THEN a.answered_at END, ''answered_post_id'', a.answered_post_id';
BEGIN
  IF position('''answered_post_id'', a.answered_post_id' IN v_def) > 0 THEN RETURN; END IF; -- already patched
  IF position(v_old IN v_def) = 0 THEN RAISE EXCEPTION 'community_sticker_json: answers anchor not found'; END IF;
  EXECUTE replace(v_def, v_old, v_new);
END $$;

/**
 * Mark a response to your question answered by a story you just posted.
 * Only the person who asked, only with their own story. Returns the sticker
 * as the poster sees it.
 */
CREATE OR REPLACE FUNCTION public.community_sticker_mark_answered(_post_id uuid, _user_id uuid, _reply_post_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  uid uuid := (SELECT auth.uid());
  v_me uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  v_me := public.community_main_account(uid);
  IF NOT EXISTS (SELECT 1 FROM public.community_posts p
                  WHERE p.id = _post_id AND p.author_user_id = v_me AND p.sticker->>'type' = 'question') THEN
    RAISE EXCEPTION 'Only the person who asked can answer here' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.community_posts p
                  WHERE p.id = _reply_post_id AND p.author_user_id = v_me AND p.story_only AND p.archived_at IS NULL) THEN
    RAISE EXCEPTION 'Post the reply to your story first';
  END IF;
  UPDATE public.community_sticker_answers
     SET answered_post_id = _reply_post_id, answered_at = now()
   WHERE post_id = _post_id AND user_id = _user_id AND body IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'That response is gone'; END IF;
  RETURN public.community_sticker_json(_post_id, uid);
END;
$$;
REVOKE ALL ON FUNCTION public.community_sticker_mark_answered(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_sticker_mark_answered(uuid, uuid, uuid) TO authenticated;
