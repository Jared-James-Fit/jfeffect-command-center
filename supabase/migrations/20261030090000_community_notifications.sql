-- Crew activity: someone reacted to your post, commented on it, replied to
-- your comment or liked it. Written here, by triggers, so every path counts
-- and nobody can fake one. One row per person per post (reactions) or per
-- comment; taking a reaction or like back takes its notification away.
-- Never your own, never from someone you've blocked. People come in as
-- their main community account (a coach's two logins are one person).
-- Read in the bell, grouped (one line per post's reactions, per comment);
-- the push for it is claimed once, by the person who did it.
CREATE TABLE IF NOT EXISTS public.community_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('reaction', 'comment', 'reply', 'comment_like')),
  post_id uuid NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  comment_id uuid REFERENCES public.community_comments(id) ON DELETE CASCADE,
  emoji text,
  created_at timestamptz NOT NULL DEFAULT now(),
  pushed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS community_notifications_reaction_uq ON public.community_notifications (recipient_user_id, post_id, actor_user_id) WHERE kind = 'reaction';
CREATE UNIQUE INDEX IF NOT EXISTS community_notifications_like_uq ON public.community_notifications (recipient_user_id, comment_id, actor_user_id) WHERE kind = 'comment_like';
CREATE UNIQUE INDEX IF NOT EXISTS community_notifications_comment_uq ON public.community_notifications (recipient_user_id, comment_id) WHERE kind IN ('comment', 'reply');
CREATE INDEX IF NOT EXISTS community_notifications_recipient_idx ON public.community_notifications (recipient_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS community_notifications_unpushed_idx ON public.community_notifications (actor_user_id, created_at DESC) WHERE pushed_at IS NULL;
-- only through the functions below
ALTER TABLE public.community_notifications ENABLE ROW LEVEL SECURITY;

-- Push switch: "Crew activity" (on unless turned off).
ALTER TABLE public.push_notification_preferences ADD COLUMN IF NOT EXISTS community boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.community_notify(_recipient uuid, _actor uuid, _kind text, _post_id uuid, _comment_id uuid, _emoji text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r uuid := public.community_main_account(_recipient);
  a uuid := public.community_main_account(_actor);
BEGIN
  IF r IS NULL OR a IS NULL OR r = a THEN RETURN; END IF;
  IF public.chat_has_blocked(r, a) OR public.chat_has_blocked(r, _actor) THEN RETURN; END IF;
  INSERT INTO public.community_notifications (recipient_user_id, actor_user_id, kind, post_id, comment_id, emoji)
  VALUES (r, a, _kind, _post_id, _comment_id, _emoji)
  ON CONFLICT DO NOTHING;
END;
$function$;
REVOKE ALL ON FUNCTION public.community_notify(uuid, uuid, text, uuid, uuid, text) FROM public, anon, authenticated;

-- Reactions: a new one notifies; changing the emoji just updates it; taking it back removes it.
CREATE OR REPLACE FUNCTION public.community_notify_on_reaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_author uuid;
BEGIN
  BEGIN
    IF TG_OP = 'DELETE' THEN
      DELETE FROM public.community_notifications n
       WHERE n.kind = 'reaction' AND n.post_id = OLD.post_id AND n.actor_user_id = public.community_main_account(OLD.user_id);
      RETURN NULL;
    END IF;
    UPDATE public.community_notifications n SET emoji = NEW.emoji
     WHERE n.kind = 'reaction' AND n.post_id = NEW.post_id AND n.actor_user_id = public.community_main_account(NEW.user_id);
    IF NOT FOUND THEN
      SELECT p.author_user_id INTO v_author FROM public.community_posts p WHERE p.id = NEW.post_id;
      PERFORM public.community_notify(v_author, NEW.user_id, 'reaction', NEW.post_id, NULL, NEW.emoji);
    END IF;
  EXCEPTION WHEN others THEN
    -- a notification must never stop the reaction
    RAISE WARNING 'community_notify_on_reaction: %', sqlerrm;
  END;
  RETURN NULL;
END;
$function$;
DROP TRIGGER IF EXISTS trg_community_notify_reaction ON public.community_reactions;
CREATE TRIGGER trg_community_notify_reaction AFTER INSERT OR UPDATE OF emoji OR DELETE ON public.community_reactions
  FOR EACH ROW EXECUTE FUNCTION public.community_notify_on_reaction();

-- Comments: a reply notifies whoever it answers; the post's author hears about it too (once).
CREATE OR REPLACE FUNCTION public.community_notify_on_comment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_author uuid;
  v_reply uuid := CASE WHEN NEW.parent_id IS NOT NULL THEN NEW.reply_to_user_id END;
BEGIN
  BEGIN
    SELECT p.author_user_id INTO v_author FROM public.community_posts p WHERE p.id = NEW.post_id;
    IF v_reply IS NOT NULL THEN
      PERFORM public.community_notify(v_reply, NEW.author_user_id, 'reply', NEW.post_id, NEW.id, NULL);
    END IF;
    IF v_reply IS NULL OR public.community_main_account(v_reply) IS DISTINCT FROM v_author THEN
      PERFORM public.community_notify(v_author, NEW.author_user_id, 'comment', NEW.post_id, NEW.id, NULL);
    END IF;
  EXCEPTION WHEN others THEN
    RAISE WARNING 'community_notify_on_comment: %', sqlerrm;
  END;
  RETURN NULL;
END;
$function$;
DROP TRIGGER IF EXISTS trg_community_notify_comment ON public.community_comments;
CREATE TRIGGER trg_community_notify_comment AFTER INSERT ON public.community_comments
  FOR EACH ROW EXECUTE FUNCTION public.community_notify_on_comment();

-- Comment likes: like notifies the comment's author; unlike removes it.
CREATE OR REPLACE FUNCTION public.community_notify_on_comment_like()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_author uuid;
BEGIN
  BEGIN
    IF TG_OP = 'DELETE' THEN
      DELETE FROM public.community_notifications n
       WHERE n.kind = 'comment_like' AND n.comment_id = OLD.comment_id AND n.actor_user_id = public.community_main_account(OLD.user_id);
      RETURN NULL;
    END IF;
    SELECT c.author_user_id INTO v_author FROM public.community_comments c WHERE c.id = NEW.comment_id;
    PERFORM public.community_notify(v_author, NEW.user_id, 'comment_like', NEW.post_id, NEW.comment_id, NULL);
  EXCEPTION WHEN others THEN
    RAISE WARNING 'community_notify_on_comment_like: %', sqlerrm;
  END;
  RETURN NULL;
END;
$function$;
DROP TRIGGER IF EXISTS trg_community_notify_comment_like ON public.community_comment_likes;
CREATE TRIGGER trg_community_notify_comment_like AFTER INSERT OR DELETE ON public.community_comment_likes
  FOR EACH ROW EXECUTE FUNCTION public.community_notify_on_comment_like();

REVOKE ALL ON FUNCTION public.community_notify_on_reaction() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.community_notify_on_comment() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.community_notify_on_comment_like() FROM public, anon, authenticated;

-- The bell: your last 30 days, grouped (a post's reactions are one line, each
-- comment / reply its own, a comment's likes one line). Only posts you can
-- still see and comments that are still up.
CREATE OR REPLACE FUNCTION public.community_my_notifications()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_me uuid := public.community_main_account(auth.uid());
  v_out jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_view_community() THEN RETURN '[]'::jsonb; END IF;
  WITH n AS (
    SELECT n.*,
           CASE n.kind WHEN 'reaction' THEN 'r:' || n.post_id WHEN 'comment_like' THEN 'l:' || n.comment_id ELSE 'c:' || n.comment_id END AS gkey,
           CASE WHEN n.kind = 'reaction' THEN n.post_id ELSE n.comment_id END AS anchor
      FROM public.community_notifications n
      JOIN public.community_posts p ON p.id = n.post_id
      LEFT JOIN public.community_comments c ON c.id = n.comment_id
     WHERE n.recipient_user_id = v_me
       AND n.created_at > now() - interval '30 days'
       AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id)
       AND (n.comment_id IS NULL OR c.hidden_at IS NULL)
  ), g AS (
    SELECT n.gkey,
           min(n.kind) AS kind,
           (array_agg(n.anchor))[1] AS anchor,
           (array_agg(n.post_id))[1] AS post_id,
           (array_agg(n.comment_id))[1] AS comment_id,
           count(*) AS cnt,
           max(n.created_at) AS latest,
           (array_agg(n.actor_user_id ORDER BY n.created_at DESC))[1:3] AS actors,
           array_agg(DISTINCT n.emoji) FILTER (WHERE n.emoji IS NOT NULL) AS emojis
      FROM n GROUP BY n.gkey
     ORDER BY max(n.created_at) DESC
     LIMIT 60
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'key', g.gkey,
      'kind', g.kind,
      'anchor', g.anchor,
      'post_id', g.post_id,
      'comment_id', g.comment_id,
      'count', g.cnt,
      'at', g.latest,
      'actors', (SELECT jsonb_agg(public.community_author(u.a) ORDER BY u.o) FROM unnest(g.actors) WITH ORDINALITY u(a, o)),
      'emojis', coalesce(to_jsonb(g.emojis), '[]'::jsonb),
      'snippet', (SELECT left(c.body, 90) FROM public.community_comments c WHERE c.id = g.comment_id),
      'media_type', (SELECT c.media_type FROM public.community_comments c WHERE c.id = g.comment_id),
      'post_kind', CASE WHEN p.kind = 'note' THEN 'post' WHEN p.locked_in_at IS NOT NULL THEN 'lockin' WHEN p.completion_id IS NOT NULL THEN 'workout' ELSE 'post' END
    ) ORDER BY g.latest DESC), '[]'::jsonb)
    INTO v_out
    FROM g JOIN public.community_posts p ON p.id = g.post_id;
  RETURN v_out;
END;
$function$;
REVOKE ALL ON FUNCTION public.community_my_notifications() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.community_my_notifications() TO authenticated;

-- The server, right after someone acts: their notifications not pushed yet
-- (last 10 minutes), claimed so each pushes once, with what the push says.
-- Only ever the caller's own (the server passes the signed-in user).
CREATE OR REPLACE FUNCTION public.community_claim_pushes(_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := public.community_main_account(_actor);
  v_out jsonb;
BEGIN
  WITH claimed AS (
    UPDATE public.community_notifications n SET pushed_at = now()
     WHERE n.actor_user_id = v_actor AND n.pushed_at IS NULL AND n.created_at > now() - interval '10 minutes'
    RETURNING n.*
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id,
      'recipient', c.recipient_user_id,
      'kind', c.kind,
      'post_id', c.post_id,
      'comment_id', c.comment_id,
      'emoji', c.emoji,
      'actor_name', public.community_author(c.actor_user_id)->>'name',
      'actor_is_staff', coalesce((public.community_author(c.actor_user_id)->>'is_coach')::boolean, false),
      -- others on the same post / comment today (the push says "and N others")
      'others', (SELECT count(DISTINCT o.actor_user_id) FROM public.community_notifications o
                  WHERE o.recipient_user_id = c.recipient_user_id AND o.kind = c.kind AND o.actor_user_id <> c.actor_user_id
                    AND o.created_at > now() - interval '24 hours'
                    AND CASE WHEN c.kind = 'reaction' THEN o.post_id = c.post_id ELSE o.comment_id = c.comment_id END
                    AND c.kind IN ('reaction', 'comment_like')),
      'media_type', (SELECT cm.media_type FROM public.community_comments cm WHERE cm.id = c.comment_id),
      'post_kind', CASE WHEN p.kind = 'note' THEN 'post' WHEN p.locked_in_at IS NOT NULL THEN 'lockin' WHEN p.completion_id IS NOT NULL THEN 'workout' ELSE 'post' END
    )), '[]'::jsonb)
    INTO v_out
    FROM claimed c JOIN public.community_posts p ON p.id = c.post_id;
  RETURN v_out;
END;
$function$;
REVOKE ALL ON FUNCTION public.community_claim_pushes(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.community_claim_pushes(uuid) TO service_role;
