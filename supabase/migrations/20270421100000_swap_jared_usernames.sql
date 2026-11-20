-- Swap two Crew handles, nothing else (Nov 20 2026, the coach's ask):
--   the membership account @jared        (exercisetutorials, b3f6e5b9…) → @jaredmcintyre
--   the coach's athlete account @jaredmcintyre (3d502a48…, its admin login
--   jaredjamesfit links to it through same_person_as)     → @jared
--
-- Only community_profiles.username (and username_set_at, marking a chosen
-- handle) changes. Logins, roles, client records, memberships, posts,
-- follows, messages and history are all keyed by user id, so they stay with
-- their own account. Mentions are read from captions by user id at read time
-- (community_caption_mentions), and no caption, comment or repost note
-- typed either handle when this was written, so no tag moves to the other
-- account. Profile links are by user id; challenge handles are their own.
--
-- The unique index on username isn't deferrable, so the swap goes through a
-- placeholder inside one transaction. Each step only touches a row still as
-- it was read, so running it again (or after either handle moved) does nothing.
DO $$
DECLARE
  v_member constant uuid := 'b3f6e5b9-dc9a-4349-b183-96c4866e7a46';
  v_coach  constant uuid := '3d502a48-303a-48cd-97d6-fad7ca5cc7e3';
  v_tmp    constant text := 'jared_handle_swap_tmp';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.community_profiles WHERE user_id = v_member AND username = 'jared')
     OR NOT EXISTS (SELECT 1 FROM public.community_profiles WHERE user_id = v_coach AND username = 'jaredmcintyre')
     OR EXISTS (SELECT 1 FROM public.community_profiles WHERE username = v_tmp) THEN
    RAISE NOTICE 'Handles not as read; nothing swapped';
    RETURN;
  END IF;
  UPDATE public.community_profiles SET username = v_tmp WHERE user_id = v_member;
  UPDATE public.community_profiles SET username = 'jared', username_set_at = now(), updated_at = now() WHERE user_id = v_coach;
  UPDATE public.community_profiles SET username = 'jaredmcintyre', username_set_at = now(), updated_at = now() WHERE user_id = v_member;
END $$;
