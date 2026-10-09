-- Hotfix (applied on prod 2026-10-09): the storage read rule looked at
-- community_comments.hidden_at directly, a column signed-in users can't read
-- (on purpose, so a hidden comment's writer can't tell). Postgres checks
-- column access for every table a policy's subquery touches, and one
-- storage.objects policy is part of every storage read, so every signed-in
-- file read failed with "permission denied for table community_comments"
-- (avatars, attachments, community photos). The comment check now runs
-- inside a function that can see the column.

CREATE OR REPLACE FUNCTION public.community_comment_media_readable(_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.community_comments c
                  WHERE (c.media_path = _name OR c.media_thumb_path = _name)
                    AND public.community_comment_readable(c.post_id, c.author_user_id, c.hidden_at))
$$;
REVOKE ALL ON FUNCTION public.community_comment_media_readable(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_comment_media_readable(text) TO authenticated;

DROP POLICY IF EXISTS "community media read" ON storage.objects;
CREATE POLICY "community media read" ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id = 'community-media' AND (
    (storage.foldername(name))[1] = (auth.uid())::text
    OR EXISTS (SELECT 1 FROM public.community_posts p
                WHERE (p.media_path = objects.name OR p.media_thumb_path = objects.name)
                  AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id))
    OR public.community_comment_media_readable(objects.name)));
