-- The finance login works the team's task board, and sees the crew's feed
-- with its photos.
--
-- Tasks: tasks.manage (granted to finance) adds, edits, completes and removes
-- tasks on the team board (scope 'admin'), like a coach. The media team's
-- board (scope 'media') stays theirs. Admins already pass has_permission for
-- every non-finance permission, so nothing changes for them.
--
-- Feed photos: the finance login already reads every post as the admin does
-- (20261020093700_finance_admin_view.sql), but photos are signed by storage,
-- which never sends the admin-view header. The two read checks the storage
-- rule calls let a view-only login (is_admin_viewer: MFA-verified, holds
-- admin.view, not an admin) read a posted photo too. The storage policy itself
-- is unchanged; changing it is what broke reads in #368.

INSERT INTO public.role_permissions (role, permission) VALUES ('finance', 'tasks.manage')
ON CONFLICT DO NOTHING;

DROP POLICY IF EXISTS "tasks.manage read" ON public.tasks;
CREATE POLICY "tasks.manage read" ON public.tasks
  FOR SELECT TO authenticated
  USING (scope = 'admin' AND public.has_permission(auth.uid(), 'tasks.manage'));
DROP POLICY IF EXISTS "tasks.manage insert" ON public.tasks;
CREATE POLICY "tasks.manage insert" ON public.tasks
  FOR INSERT TO authenticated
  WITH CHECK (scope = 'admin' AND public.has_permission(auth.uid(), 'tasks.manage'));
DROP POLICY IF EXISTS "tasks.manage update" ON public.tasks;
CREATE POLICY "tasks.manage update" ON public.tasks
  FOR UPDATE TO authenticated
  USING (scope = 'admin' AND public.has_permission(auth.uid(), 'tasks.manage'))
  WITH CHECK (scope = 'admin' AND public.has_permission(auth.uid(), 'tasks.manage'));
DROP POLICY IF EXISTS "tasks.manage delete" ON public.tasks;
CREATE POLICY "tasks.manage delete" ON public.tasks
  FOR DELETE TO authenticated
  USING (scope = 'admin' AND public.has_permission(auth.uid(), 'tasks.manage'));

-- 20261027100000_community_post_photos.sql, plus the view-only login on posted photos.
CREATE OR REPLACE FUNCTION public.community_post_media_readable(_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.community_posts p
                  WHERE (p.media_path = _name OR p.media_thumb_path = _name
                         OR p.extra_media @> jsonb_build_array(jsonb_build_object('path', _name))
                         OR p.extra_media @> jsonb_build_array(jsonb_build_object('thumb', _name)))
                    AND (public.community_post_visible(p.visibility, p.author_user_id, p.client_id)
                         OR public.is_admin_viewer()))
      OR (public.is_community_staff() AND (
            EXISTS (SELECT 1 FROM public.community_birthday_posts b
                     WHERE b.status IN ('ready', 'scheduled')
                       AND (b.media @> jsonb_build_array(jsonb_build_object('path', _name))
                            OR b.media @> jsonb_build_array(jsonb_build_object('thumb', _name))))
         OR EXISTS (SELECT 1 FROM public.community_series_items i
                     WHERE i.media @> jsonb_build_array(jsonb_build_object('path', _name))
                        OR i.media @> jsonb_build_array(jsonb_build_object('thumb', _name)))))
$$;
REVOKE ALL ON FUNCTION public.community_post_media_readable(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_post_media_readable(text) TO authenticated;

-- 20261019100000_storage_read_fix.sql, plus the view-only login on comment photos.
CREATE OR REPLACE FUNCTION public.community_comment_media_readable(_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.community_comments c
                  WHERE (c.media_path = _name OR c.media_thumb_path = _name)
                    AND (public.community_comment_readable(c.post_id, c.author_user_id, c.hidden_at)
                         OR public.is_admin_viewer()))
$$;
REVOKE ALL ON FUNCTION public.community_comment_media_readable(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_comment_media_readable(text) TO authenticated;
