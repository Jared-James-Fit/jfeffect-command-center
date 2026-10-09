-- Hotfix: every signed-in storage read and upload has failed since
-- 20261019090000_community_comment_threads.sql.
--
-- Its "community media read" policy on storage.objects reads
-- community_comments.hidden_at in a subquery. authenticated may only read
-- some community_comments columns (hidden_at is left out on purpose), and
-- Postgres checks the privileges of every table and column a policy touches
-- before it runs the query, for every policy on the table at once. So the
-- denial wasn't limited to community media: reading, signing or uploading
-- anything in any bucket (chat media, progress photos, lift videos, avatars,
-- receipts) raised "permission denied for table community_comments".
--
-- The comment check moves into a SECURITY DEFINER function, so the policy
-- reads no comment columns itself. Who can see what is unchanged: your own
-- folder, media on a post you can see, media on a comment you can read.

CREATE OR REPLACE FUNCTION public.community_comment_media_readable(_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.community_comments c
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
