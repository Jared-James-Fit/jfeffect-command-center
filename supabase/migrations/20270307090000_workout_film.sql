-- Workout film: a finished workout's set videos become its Crew post, one
-- clip per slide, each with its own caption (the exercise, the set and what
-- was lifted), made for the athlete.
--   * The slides are copies in community-media made by the server
--     (workout-film.functions.ts), so a clip only ever reaches the crew when
--     the athlete posts (or lets it post) their film; the set video in their
--     coach chat stays where it is.
--   * community_posts.film holds each clip's caption, keyed by its path; the
--     feed shows it on that slide.
--   * community_profiles.auto_post_film: their switch (on unless they turn it
--     off). Off, nothing posts by itself and "Post my film" posts it later.

ALTER TABLE public.community_posts ADD COLUMN IF NOT EXISTS film jsonb;
ALTER TABLE public.community_profiles ADD COLUMN IF NOT EXISTS auto_post_film boolean NOT NULL DEFAULT true;

-- Their switch, and reading it (a missing profile row means on).
CREATE OR REPLACE FUNCTION public.community_set_auto_post_film(_on boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.community_profiles (user_id, auto_post_film) VALUES (uid, coalesce(_on, true))
  ON CONFLICT (user_id) DO UPDATE SET auto_post_film = EXCLUDED.auto_post_film, updated_at = now();
END;
$function$;
REVOKE ALL ON FUNCTION public.community_set_auto_post_film(boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.community_set_auto_post_film(boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.community_auto_post_film()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT coalesce((SELECT cp.auto_post_film FROM public.community_profiles cp WHERE cp.user_id = auth.uid()), true);
$function$;
REVOKE ALL ON FUNCTION public.community_auto_post_film() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.community_auto_post_film() TO authenticated;

-- A post carries its film captions (in the second object: the first is at
-- Postgres's 100-argument limit).
DO $$
DECLARE
  v_def text := pg_get_functiondef('public.community_post_json(uuid,uuid)'::regprocedure);
  v_old text := '''shared_post'', public.community_shared_post_json(n.shared_post_id))';
  v_new text := '''shared_post'', public.community_shared_post_json(n.shared_post_id),'
             || E'\n    ''film'', CASE WHEN jsonb_typeof(n.film) = ''array'' AND jsonb_array_length(n.film) > 0 THEN n.film END)';
BEGIN
  IF position('''film''' IN v_def) > 0 THEN RETURN; END IF; -- already patched
  IF position(v_old IN v_def) = 0 THEN RAISE EXCEPTION 'community_post_json: shared_post anchor not found'; END IF;
  EXECUTE replace(v_def, v_old, v_new);
END $$;
