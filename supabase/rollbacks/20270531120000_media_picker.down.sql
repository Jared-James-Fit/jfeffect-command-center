-- Rollback for 20270531120000_media_picker.sql (by hand, only if it has to be undone).
-- First re-run community_add_comment and community_set_post_extras from
-- 20261029150000_community_gif_voice.sql (library-only GIFs), then:

-- Sticker comments would break the old check: turn them into nothing first.
UPDATE public.community_comments
   SET media_path = NULL, media_thumb_path = NULL, media_type = NULL, media_width = NULL, media_height = NULL
 WHERE media_type = 'sticker' AND btrim(body) <> '';
DELETE FROM public.community_comments WHERE media_type = 'sticker';
ALTER TABLE public.community_comments DROP CONSTRAINT IF EXISTS community_comments_media_check;
ALTER TABLE public.community_comments ADD CONSTRAINT community_comments_media_check
  CHECK (((media_path IS NULL) = (media_type IS NULL)) AND ((media_type IS NULL) OR (media_type = ANY (ARRAY['image', 'video', 'gif', 'audio']))));

DROP FUNCTION IF EXISTS public.is_allowed_media_url(text);
DROP TRIGGER IF EXISTS user_media_saved_trim ON public.user_media_saved;
DROP FUNCTION IF EXISTS public.tg_user_media_saved_trim();
-- The old chat_gif_favorites / chat_gif_recent were never touched.
DROP TABLE IF EXISTS public.user_media_saved;
ALTER TABLE public.chat_gifs DROP CONSTRAINT IF EXISTS chat_gifs_kind_check;
DROP INDEX IF EXISTS public.chat_gifs_media_url_idx;
-- Library stickers would then show as GIFs; delete them first if that matters:
-- DELETE FROM public.chat_gifs WHERE kind = 'sticker';
ALTER TABLE public.chat_gifs DROP COLUMN IF EXISTS kind;
ALTER TABLE public.chat_gifs DROP COLUMN IF EXISTS width;
ALTER TABLE public.chat_gifs DROP COLUMN IF EXISTS height;

-- Story replies: back to words only (re-run community_message_author from
-- 20261130090000_crew_private_accounts_close_friends.sql after this drop).
DROP FUNCTION IF EXISTS public.community_message_author(uuid, text, boolean, jsonb);
DROP FUNCTION IF EXISTS public.picked_media_attachment(jsonb);
