-- Crew Activity rows show the post they're about, like Instagram: its photo
-- (thumbnail path, signed by the app like the feed's) or, with no photo, what
-- kind of post it was. Same function, same rows and checks; three more keys.
DO $$
DECLARE def text;
BEGIN
  def := pg_get_functiondef('public.community_my_notifications()'::regprocedure);
  IF position('post_thumb' in def) > 0 THEN RETURN; END IF;
  def := replace(def,
    $r$'win', nullif(p.win_label, ''),$r$,
    $r$'win', nullif(p.win_label, ''),
      'post_thumb', coalesce(p.media_thumb_path, CASE WHEN p.media_type = 'image' THEN p.media_path END),
      'post_media', p.media_type,
      'post_text', CASE WHEN p.media_path IS NULL AND p.kind = 'note' THEN nullif(left(btrim(coalesce(p.caption, '')), 40), '') END,$r$);
  IF position($r$'post_thumb', coalesce(p.media_thumb_path$r$ in def) = 0 THEN
    RAISE EXCEPTION 'community_my_notifications: anchor not found';
  END IF;
  EXECUTE def;
END $$;
