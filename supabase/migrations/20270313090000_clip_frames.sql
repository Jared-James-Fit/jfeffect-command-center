-- A clip framed in the studio (Instagram's: the post's shape, drag to place it,
-- pinch to size it) keeps its frame in its focus: `a` the shape it shows at
-- (w / h, 0.5 to 1.8: a story's 9:16 to 16:9), `z` the zoom over just filling
-- that shape (1 to 5) and `x` / `y` the middle of what shows, as shares of the
-- clip. Without `a` a focus is the older one (CSS object-position). Every save
-- path already runs a slide's focus through this function (the cover's into
-- community_posts.media_focus, the rest inside extra_media), and the app reads
-- it back from community_post_json, so only the cleaner changes.
CREATE OR REPLACE FUNCTION public.community_media_focus(_f jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN jsonb_typeof(_f) = 'object' AND jsonb_typeof(_f->'x') = 'number' AND jsonb_typeof(_f->'y') = 'number'
    THEN jsonb_build_object('x', round(least(1, greatest(0, (_f->>'x')::numeric)), 4),
                            'y', round(least(1, greatest(0, (_f->>'y')::numeric)), 4))
         || CASE
              WHEN jsonb_typeof(_f->'a') = 'number' AND (_f->>'a')::numeric BETWEEN 0.5 AND 1.8
              THEN jsonb_build_object(
                     'a', round((_f->>'a')::numeric, 4),
                     'z', CASE WHEN jsonb_typeof(_f->'z') = 'number'
                               THEN round(least(5, greatest(1, (_f->>'z')::numeric)), 4)
                               ELSE 1 END)
              ELSE '{}'::jsonb
            END
  END
$$;

REVOKE ALL ON FUNCTION public.community_media_focus(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.community_media_focus(jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
