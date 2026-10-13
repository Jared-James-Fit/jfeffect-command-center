-- Replying to someone's story (a message or a quick emoji) reads like
-- Instagram's: "Replied to your story", with what the moment was ("Belt
-- Squat PR") when the post has no words of its own.
--
-- Same function, same checks and same routes (member to member as a message
-- request, coach and client in their coach chat); it just takes one more
-- optional argument. Older app versions keep calling it with two.
DO $$
DECLARE def text;
BEGIN
  def := pg_get_functiondef('public.community_message_author(uuid, text)'::regprocedure);
  def := replace(def,
    'community_message_author(_post_id uuid, _body text)',
    'community_message_author(_post_id uuid, _body text, _story boolean DEFAULT false)');
  -- a workout story's moment, worked out once (same label the alerts use)
  def := replace(def,
    $r$  SELECT * INTO p FROM public.community_posts cp$r$,
    $r$  IF coalesce(_story, false) THEN PERFORM public.community_fill_win_label(_post_id); END IF;
  SELECT * INTO p FROM public.community_posts cp$r$);
  def := replace(def,
    $r$'post_id', p.id, 'reply', true,$r$,
    $r$'post_id', p.id, 'reply', true, 'story', coalesce(_story, false),$r$);
  def := replace(def,
    $r$'title', (v_author->>'name') || '''s post',$r$,
    $r$'title', (v_author->>'name') || CASE WHEN coalesce(_story, false) THEN '''s story' ELSE '''s post' END,$r$);
  def := replace(def,
    $r$'request_note', nullif(left(split_part(btrim(coalesce(p.caption, p.quote, '')), E'\n', 1), 140), ''),$r$,
    $r$'request_note', coalesce(nullif(left(split_part(btrim(coalesce(p.caption, p.quote, '')), E'\n', 1), 140), ''),
                                CASE WHEN coalesce(_story, false) THEN nullif(p.win_label, '') END),$r$);
  IF position('_story boolean DEFAULT false' in def) = 0
     OR position('PERFORM public.community_fill_win_label(_post_id)' in def) = 0
     OR position($r$'story', coalesce(_story, false)$r$ in def) = 0
     OR position($r$'''s story'$r$ in def) = 0
     OR position('nullif(p.win_label' in def) = 0 THEN
    RAISE EXCEPTION 'community_message_author: anchors not found';
  END IF;
  -- one function, never two overloads (a two-argument call must not be ambiguous)
  DROP FUNCTION public.community_message_author(uuid, text);
  EXECUTE def;
END $$;

REVOKE ALL ON FUNCTION public.community_message_author(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_message_author(uuid, text, boolean) TO authenticated, service_role;
