-- A finished workout goes to your story only when you share it (Nov 18 2026).
--
-- Until now every finished workout posted itself to the athlete's story (a
-- Pulse, `auto_shared`) unless they found "Share my workouts" in Privacy and
-- switched it off. In the 30 days to Nov 18 2026 that was 144 automatic
-- stories from 16 people, seen by 0.9 people each on average, while the 20
-- workouts people chose to share to the feed were seen by 8.2 each; and the
-- recap said "On your story for 24 hours" beside "Share to Crew", so nobody
-- could tell what was already public. The coach wants a story to go up only
-- when the athlete taps Share to Story (the recap now paints it for them and
-- offers that one tap).
--
-- What this changes, and what it doesn't:
--   * New finished workouts no longer post themselves. The switch stays in
--     Privacy ("Post my workouts to my story automatically") for anyone who
--     wants the old way back, and it's off for everyone now: all 20 profiles
--     were on the default (nobody had switched it off), so there was no
--     choice of anyone's to keep.
--   * Every story already posted stays exactly as it is (rows untouched).
--   * League points are unchanged: an automatic story never earned any
--     (community_post_xp_sync skips auto_shared), and a story shared from the
--     recap is a story-only post, which doesn't either.

ALTER TABLE public.community_profiles ALTER COLUMN auto_share_workouts SET DEFAULT false;

UPDATE public.community_profiles SET auto_share_workouts = false WHERE auto_share_workouts;

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
  -- only for someone who switched automatic sharing on (off unless they did)
  IF NOT coalesce((SELECT cp.auto_share_workouts FROM public.community_profiles cp WHERE cp.user_id = c.user_id), false) THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM public.community_posts p WHERE p.completion_id = NEW.id) THEN RETURN NULL; END IF;
  SELECT p.hide_loads INTO v_hide FROM public.community_posts p
   WHERE p.client_id = c.id AND p.kind = 'workout' ORDER BY p.created_at DESC LIMIT 1;
  INSERT INTO public.community_posts (author_user_id, client_id, completion_id, caption, visibility, hide_loads, extra_media, auto_shared)
  VALUES (c.user_id, c.id, NEW.id, NULL, 'community', coalesce(v_hide, false), '[]'::jsonb, true)
  ON CONFLICT DO NOTHING;
  RETURN NULL;
EXCEPTION WHEN others THEN
  RAISE WARNING 'community_pulse_on_completion: %', sqlerrm;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.community_set_auto_share(_on boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.community_profiles (user_id, auto_share_workouts) VALUES (uid, coalesce(_on, false))
  ON CONFLICT (user_id) DO UPDATE SET auto_share_workouts = EXCLUDED.auto_share_workouts, updated_at = now();
END;
$function$;

CREATE OR REPLACE FUNCTION public.community_my_settings()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'auto_share_workouts', coalesce((SELECT cp.auto_share_workouts FROM public.community_profiles cp WHERE cp.user_id = auth.uid()), false),
    'private_views', coalesce((SELECT cp.private_views FROM public.community_profiles cp WHERE cp.user_id = public.community_main_account(auth.uid())), false),
    'discoverable', coalesce((SELECT cp.discoverable FROM public.community_profiles cp WHERE cp.user_id = public.community_main_account(auth.uid())), true),
    'username', (SELECT cp.username::text FROM public.community_profiles cp WHERE cp.user_id = public.community_main_account(auth.uid())),
    'disciplines', coalesce((SELECT to_jsonb(cp.disciplines) FROM public.community_profiles cp WHERE cp.user_id = public.community_main_account(auth.uid())), '[]'::jsonb),
    'home_gym', (SELECT cp.home_gym FROM public.community_profiles cp WHERE cp.user_id = public.community_main_account(auth.uid())),
    'feed_suggestions_hidden_until', (SELECT cp.feed_suggestions_hidden_until FROM public.community_profiles cp
                                       WHERE cp.user_id = public.community_main_account(auth.uid()) AND cp.feed_suggestions_hidden_until > now()))
  WHERE auth.uid() IS NOT NULL;
$function$;
