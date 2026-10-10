-- Pulse: a finished workout shows up in the crew's feed by itself, as its
-- session's finish post (the one slot per session: no duplicates, and
-- sharing it later just fills that post in). It leads with the session's
-- real win (the card picks it from the stats: a PR, a milestone, the top set).
--   * Each client can turn it off (community_profiles.auto_share_workouts).
--   * Only members of the community, only sessions finished in the last 2
--     days (no flood from a backfill), never when the session already has a
--     lock-in (that post becomes the finished card itself) or a finish post.
--   * Hides weights if the client's last post did.
--   * Earns no share points by itself: auto_shared posts are skipped by the
--     daily share XP until the client makes it theirs (a caption or photo
--     through community_save_post clears the flag).
ALTER TABLE public.community_posts ADD COLUMN IF NOT EXISTS auto_shared boolean NOT NULL DEFAULT false;
ALTER TABLE public.community_profiles ADD COLUMN IF NOT EXISTS auto_share_workouts boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.community_pulse_on_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  c record;
  v_hide boolean;
BEGIN
  IF NEW.completed_at IS NULL OR (TG_OP = 'UPDATE' AND OLD.completed_at IS NOT NULL) THEN RETURN NULL; END IF;
  IF NEW.completed_at < now() - interval '2 days' THEN RETURN NULL; END IF;
  SELECT cl.id, cl.user_id INTO c FROM public.clients cl
   WHERE cl.id = NEW.client_id AND cl.user_id IS NOT NULL
     AND coalesce(cl.archived, false) = false AND cl.archived_at IS NULL
     AND coalesce(cl.status, '') <> 'Archived'
     AND coalesce(cl.portal_access_disabled, false) = false;
  IF c.id IS NULL THEN RETURN NULL; END IF;
  IF NOT coalesce((SELECT cp.auto_share_workouts FROM public.community_profiles cp WHERE cp.user_id = c.user_id), true) THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM public.community_posts p WHERE p.completion_id = NEW.id) THEN RETURN NULL; END IF;
  SELECT p.hide_loads INTO v_hide FROM public.community_posts p
   WHERE p.client_id = c.id AND p.kind = 'workout' ORDER BY p.created_at DESC LIMIT 1;
  INSERT INTO public.community_posts (author_user_id, client_id, completion_id, caption, visibility, hide_loads, extra_media, auto_shared)
  VALUES (c.user_id, c.id, NEW.id, NULL, 'community', coalesce(v_hide, false), '[]'::jsonb, true)
  ON CONFLICT DO NOTHING;
  RETURN NULL;
EXCEPTION WHEN others THEN
  -- a feed post must never stop a workout from finishing
  RAISE WARNING 'community_pulse_on_completion: %', sqlerrm;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_community_pulse ON public.pl_day_completions;
CREATE TRIGGER trg_community_pulse
  AFTER INSERT OR UPDATE OF completed_at ON public.pl_day_completions
  FOR EACH ROW EXECUTE FUNCTION public.community_pulse_on_completion();

-- The client's switch.
CREATE OR REPLACE FUNCTION public.community_set_auto_share(_on boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.community_profiles (user_id, auto_share_workouts) VALUES (uid, coalesce(_on, true))
  ON CONFLICT (user_id) DO UPDATE SET auto_share_workouts = EXCLUDED.auto_share_workouts, updated_at = now();
END;
$function$;
REVOKE ALL ON FUNCTION public.community_set_auto_share(boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.community_set_auto_share(boolean) TO authenticated;

-- Rebuilt from the live definitions, one expression each:
DO $$
DECLARE def text;
BEGIN
  -- sharing (caption / photo) makes the post the client's own
  def := pg_get_functiondef('public.community_save_post(uuid, text, text, text, text, text, text, integer, integer, boolean, jsonb, boolean)'::regprocedure);
  def := replace(def, $r$    archived_at = NULL,
    archived_from = NULL,
    updated_at = now()$r$, $r$    archived_at = NULL,
    archived_from = NULL,
    auto_shared = false,
    updated_at = now()$r$);
  IF position('auto_shared = false' in def) = 0 THEN RAISE EXCEPTION 'community_save_post: update list not found'; END IF;
  EXECUTE def;

  -- no share points for a post nobody shared
  def := pg_get_functiondef('public.community_post_xp_sync(uuid, date)'::regprocedure);
  def := replace(def, $r$    and cp.archived_at is null
    and pc.completed_at is not null$r$, $r$    and cp.archived_at is null
    and not cp.auto_shared
    and pc.completed_at is not null$r$);
  IF position('not cp.auto_shared' in def) = 0 THEN RAISE EXCEPTION 'community_post_xp_sync: filter not found'; END IF;
  EXECUTE def;

  -- the feed knows a Pulse post
  def := pg_get_functiondef('public.community_post_json(uuid, uuid)'::regprocedure);
  def := replace(def, $r$    'hide_loads', n.hide_loads,$r$, $r$    'hide_loads', n.hide_loads,
    'auto', n.auto_shared,$r$);
  IF position('''auto'', n.auto_shared' in def) = 0 THEN RAISE EXCEPTION 'community_post_json: hide_loads not found'; END IF;
  EXECUTE def;
END $$;

-- Your own community settings (the profile table has no read policies).
CREATE OR REPLACE FUNCTION public.community_my_settings()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'auto_share_workouts', coalesce((SELECT cp.auto_share_workouts FROM public.community_profiles cp WHERE cp.user_id = auth.uid()), true),
    'private_views', coalesce((SELECT cp.private_views FROM public.community_profiles cp WHERE cp.user_id = public.community_main_account(auth.uid())), false))
  WHERE auth.uid() IS NOT NULL;
$function$;
REVOKE ALL ON FUNCTION public.community_my_settings() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.community_my_settings() TO authenticated;
