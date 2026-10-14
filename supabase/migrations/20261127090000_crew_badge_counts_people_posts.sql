-- Crew's "N new" badge (Home header, the Crew tab's ring) counts what people
-- posted, not the finished sessions that post themselves (auto_shared
-- Pulses). Those live in the athlete's story, which rings on its own, and
-- never in the feed, so counting them sent people to a feed with nothing new
-- in it. A Pulse someone captions or adds a photo to becomes their own post
-- (auto_shared = false) and counts like any other.
DO $$
DECLARE
  v_def text := pg_get_functiondef('public.community_activity()'::regprocedure);
  v_anchor text := '                    AND p.author_user_id <> uid';
  v_new text := '                    AND p.author_user_id <> uid
                    AND NOT coalesce(p.auto_shared, false)';
BEGIN
  IF position('auto_shared' in v_def) > 0 THEN
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 THEN
    RAISE EXCEPTION 'community_activity: anchor not found exactly once';
  END IF;
  EXECUTE replace(v_def, v_anchor, v_new);
END $$;
