-- Community: pinned comment + an Instagram-style comment preview in the feed.
--   * The post's author can pin one top-level comment (community_pin_comment).
--   * Every post carries `comment_preview`: at most 2 visible top-level comments, the pinned
--     one first, then the newest. Bodies are trimmed for the feed; the sheet has the rest.
--   * Pinning only touches community_posts.pinned_comment_id, which the XP trigger ignores.

ALTER TABLE public.community_posts
  ADD COLUMN IF NOT EXISTS pinned_comment_id uuid REFERENCES public.community_comments(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.community_comment_preview(_post_id uuid, _pinned uuid)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT coalesce(jsonb_agg(x.j ORDER BY x.ord, x.at DESC), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
               'id', c.id,
               'body', left(c.body, 160),
               'author', public.community_author(c.author_user_id),
               'pinned', c.id IS NOT DISTINCT FROM _pinned,
               'media', c.media_path IS NOT NULL,
               'created_at', c.created_at) AS j,
             CASE WHEN c.id IS NOT DISTINCT FROM _pinned THEN 0 ELSE 1 END AS ord,
             c.created_at AS at
        FROM public.community_comments c
       WHERE c.post_id = _post_id
         AND c.parent_id IS NULL
         AND c.hidden_at IS NULL
         AND public.community_comment_readable(c.post_id, c.author_user_id, c.hidden_at)
       ORDER BY (c.id IS NOT DISTINCT FROM _pinned) DESC, c.created_at DESC
       LIMIT 2
    ) x
$$;

CREATE OR REPLACE FUNCTION public.community_pin_comment(_comment_id uuid, _pinned boolean DEFAULT true)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_me uuid := public.community_main_account(auth.uid());
  v_post uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT c.post_id INTO v_post
    FROM public.community_comments c
    JOIN public.community_posts p ON p.id = c.post_id
   WHERE c.id = _comment_id
     AND p.author_user_id = v_me
     AND (NOT coalesce(_pinned, true) OR (c.parent_id IS NULL AND c.hidden_at IS NULL));
  IF v_post IS NULL THEN
    RAISE EXCEPTION 'Only the person who posted can pin a comment' USING ERRCODE = '42501';
  END IF;
  IF coalesce(_pinned, true) THEN
    UPDATE public.community_posts SET pinned_comment_id = _comment_id WHERE id = v_post;
  ELSE
    UPDATE public.community_posts SET pinned_comment_id = NULL WHERE id = v_post AND pinned_comment_id = _comment_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.community_pin_comment(uuid, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.community_pin_comment(uuid, boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.community_comment_preview(uuid, uuid) FROM public, anon, authenticated;

-- community_post_json: add pinned_comment_id + comment_preview (patched in place so the rest
-- of the function stays exactly as the latest migration left it).
DO $$
DECLARE
  def text := pg_get_functiondef('public.community_post_json(uuid,uuid)'::regprocedure);
  anchor text := '''comment_count'', (SELECT count(*)';
BEGIN
  IF position('comment_preview' IN def) > 0 THEN RETURN; END IF;
  IF position(anchor IN def) = 0 THEN RAISE EXCEPTION 'community_post_json: anchor not found'; END IF;
  def := replace(def, anchor,
    '''pinned_comment_id'', n.pinned_comment_id,' || E'\n    ' ||
    '''comment_preview'', public.community_comment_preview(n.id, n.pinned_comment_id),' || E'\n    ' || anchor);
  EXECUTE def;
END $$;
