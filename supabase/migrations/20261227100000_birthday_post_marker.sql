-- ════════════════════════════════════════════════════════════════════
-- A birthday post says whose birthday it is.
--
-- Every automated post now shows as a picture with the words under it
-- (Instagram's layout), and a birthday post's picture is the birthday
-- card. A birthday post has no series, so it carries who it's for in
-- series_data: {"birthday": {"name", "user_id"}} (community_post_json
-- already sends series_data for posts with no series). Stamped the moment
-- the draft is posted (beside community_birthday_post_mention); the ones
-- already posted are stamped here. Never over a post that already has
-- series data of its own.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.community_birthday_marker(_client_id uuid, _caption text DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object('birthday', jsonb_build_object(
           'name', coalesce(
             -- the name the post itself uses ("happy birthday Amanda"), as the birthday mention picks it
             (SELECT btrim(t.n)
                FROM unnest(ARRAY[public.community_author(c.user_id)->>'name', c.preferred_name, c.first_name,
                                  split_part(coalesce(c.full_name, ''), ' ', 1)]) WITH ORDINALITY AS t(n, i)
               WHERE nullif(btrim(t.n), '') IS NOT NULL AND strpos(lower(coalesce(_caption, '')), lower(btrim(t.n))) > 0
               ORDER BY t.i LIMIT 1),
             -- else the name the crew sees, else what the client goes by
             nullif(btrim(public.community_author(c.user_id)->>'name'), ''),
             nullif(btrim(c.preferred_name), ''),
             nullif(btrim(c.first_name), '')),
           'user_id', c.user_id))
    FROM public.clients c
   WHERE c.id = _client_id
$$;
REVOKE ALL ON FUNCTION public.community_birthday_marker(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.community_birthday_post_marker()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.post_id IS NULL OR NEW.post_id IS NOT DISTINCT FROM OLD.post_id THEN RETURN NULL; END IF;
  UPDATE public.community_posts p
     SET series_data = public.community_birthday_marker(NEW.client_id, p.caption)
   WHERE p.id = NEW.post_id AND p.series IS NULL AND p.series_data IS NULL;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.community_birthday_post_marker() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS community_birthday_post_marker ON public.community_birthday_posts;
CREATE TRIGGER community_birthday_post_marker
  AFTER UPDATE OF post_id ON public.community_birthday_posts
  FOR EACH ROW EXECUTE FUNCTION public.community_birthday_post_marker();

-- the birthday posts already up
UPDATE public.community_posts p
   SET series_data = public.community_birthday_marker(b.client_id, p.caption)
  FROM public.community_birthday_posts b
 WHERE b.post_id = p.id AND p.series IS NULL AND p.series_data IS NULL;
