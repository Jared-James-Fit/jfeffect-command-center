-- Reactions: ❤️ is the one-tap default (tap the heart, or double-tap the
-- post); hold the heart for 👍 ‼️ 🔥 😂. Still one per person per post, and
-- posts still show one number with faces, not split counts.
--   heart ❤️ · thumbs 👍 · bang ‼️ · fire 🔥 · laugh 😂
-- 🔥s already given stay 🔥 (it's still one of the five).

ALTER TABLE public.community_reactions DROP CONSTRAINT IF EXISTS community_reactions_emoji_check;
ALTER TABLE public.community_reactions ADD CONSTRAINT community_reactions_emoji_check
  CHECK (emoji IN ('heart', 'thumbs', 'bang', 'fire', 'laugh'));

CREATE OR REPLACE FUNCTION public.community_react(_post_id uuid, _emoji text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  -- 💪 / 👏 from very old app versions count as ❤️
  v text := CASE WHEN _emoji IN ('muscle', 'clap') THEN 'heart' ELSE nullif(_emoji, '') END;
BEGIN
  IF uid IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.community_posts p
                  WHERE p.id = _post_id AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id)) THEN
    RAISE EXCEPTION 'Post not found';
  END IF;
  IF v IS NULL THEN
    DELETE FROM public.community_reactions WHERE post_id = _post_id AND user_id = uid;
  ELSE
    IF v NOT IN ('heart', 'thumbs', 'bang', 'fire', 'laugh') THEN RAISE EXCEPTION 'Invalid reaction'; END IF;
    INSERT INTO public.community_reactions (post_id, user_id, emoji) VALUES (_post_id, uid, v)
    ON CONFLICT (post_id, user_id) DO UPDATE SET emoji = EXCLUDED.emoji;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.community_react(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_react(uuid, text) TO authenticated;

-- The who-reacted list now says which one each person gave.
CREATE OR REPLACE FUNCTION public.community_post_reactors(_post_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.community_posts p
                  WHERE p.id = _post_id AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id)) THEN
    RAISE EXCEPTION 'Post not found';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'author', public.community_author(r.user_id),
             'is_me', public.community_main_account(r.user_id) = public.community_main_account(uid),
             'emoji', r.emoji,
             'created_at', r.created_at)
           ORDER BY public.community_is_coach(r.user_id) DESC, r.created_at DESC)
      FROM public.community_reactions r WHERE r.post_id = _post_id), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.community_post_reactors(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_post_reactors(uuid) TO authenticated;

-- One-time tips the person has already got (e.g. "double-tap to like"),
-- kept on the account so a tip doesn't come back on another device.
CREATE TABLE IF NOT EXISTS public.community_hints_seen (
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  hint text NOT NULL CHECK (hint ~ '^[a-z_]{1,40}$'),
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, hint)
);
ALTER TABLE public.community_hints_seen ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE public.community_hints_seen ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Own hints - read" ON public.community_hints_seen;
CREATE POLICY "Own hints - read" ON public.community_hints_seen
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Own hints - insert" ON public.community_hints_seen;
CREATE POLICY "Own hints - insert" ON public.community_hints_seen
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT ON public.community_hints_seen TO authenticated;
