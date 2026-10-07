-- Coach posts: Monday Motivation + Finish Strong Friday, as real posts.
--
-- Same table, same feed, same reactions/comments/profile as every other post:
--   * community_posts.kind: 'workout' (a session, as before) or 'note' (text
--     from a coach, optionally featuring a quote with its speaker + source).
--     Notes have no completion; workouts must have one.
--   * series + series_key: a note can belong to a weekly series. series_key
--     ("monday_motivation:2026-W41") is UNIQUE, so a theme can only ever be
--     published once per ISO week, however many times the job runs.
--   * community_series_items: the curated library (prepared reflections, and
--     quotes only where the wording + source were verified). Coaches can edit
--     or switch off items before they go out; use is tracked for rotation.
--   * community_series_settings: one row: paused + whose account publishes.
--   * Coach identity: community_profiles.title ("Coach · JF Effect") marks a
--     person as coach in the community without changing their app role, and
--     same_person_as folds a second account (an admin login) into that one
--     face, so the coach shows up once, with one profile.
--   * community_publish_series() runs from pg_cron every 15 min on Mondays
--     and Fridays (UTC); it only publishes between 07:00 and 12:00
--     America/Winnipeg (DST handled by the time zone), never when paused.

-- ── Posts: notes ───────────────────────────────────────────────────────────
ALTER TABLE public.community_posts ALTER COLUMN completion_id DROP NOT NULL;
ALTER TABLE public.community_posts ALTER COLUMN client_id DROP NOT NULL;
ALTER TABLE public.community_posts ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'workout';
ALTER TABLE public.community_posts ADD COLUMN IF NOT EXISTS series text;
ALTER TABLE public.community_posts ADD COLUMN IF NOT EXISTS series_key text;
ALTER TABLE public.community_posts ADD COLUMN IF NOT EXISTS series_item_id uuid;
ALTER TABLE public.community_posts ADD COLUMN IF NOT EXISTS quote text;
ALTER TABLE public.community_posts ADD COLUMN IF NOT EXISTS quote_author text;
ALTER TABLE public.community_posts ADD COLUMN IF NOT EXISTS quote_source text;
ALTER TABLE public.community_posts ADD COLUMN IF NOT EXISTS edited_at timestamptz;

ALTER TABLE public.community_posts DROP CONSTRAINT IF EXISTS community_posts_kind_check;
ALTER TABLE public.community_posts ADD CONSTRAINT community_posts_kind_check CHECK (kind IN ('workout', 'note'));
ALTER TABLE public.community_posts DROP CONSTRAINT IF EXISTS community_posts_kind_shape;
ALTER TABLE public.community_posts ADD CONSTRAINT community_posts_kind_shape CHECK ((kind = 'workout') = (completion_id IS NOT NULL));
ALTER TABLE public.community_posts DROP CONSTRAINT IF EXISTS community_posts_series_check;
ALTER TABLE public.community_posts ADD CONSTRAINT community_posts_series_check
  CHECK (series IS NULL OR (kind = 'note' AND series IN ('monday_motivation', 'finish_strong_friday')));
ALTER TABLE public.community_posts DROP CONSTRAINT IF EXISTS community_posts_caption_check;
ALTER TABLE public.community_posts ADD CONSTRAINT community_posts_caption_check
  CHECK (caption IS NULL OR char_length(caption) <= CASE WHEN kind = 'note' THEN 1200 ELSE 280 END);
ALTER TABLE public.community_posts DROP CONSTRAINT IF EXISTS community_posts_quote_check;
ALTER TABLE public.community_posts ADD CONSTRAINT community_posts_quote_check
  CHECK (quote IS NULL OR (kind = 'note' AND char_length(quote) <= 400 AND quote_author IS NOT NULL));
CREATE UNIQUE INDEX IF NOT EXISTS community_posts_series_key_uidx ON public.community_posts (series_key) WHERE series_key IS NOT NULL;

-- ── Coach identity ─────────────────────────────────────────────────────────
ALTER TABLE public.community_profiles ADD COLUMN IF NOT EXISTS title text CHECK (title IS NULL OR char_length(title) <= 40);
ALTER TABLE public.community_profiles ADD COLUMN IF NOT EXISTS same_person_as uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Name, photo and coach status for any account, folded onto its main account.
-- Coaches (staff role on any of the person's accounts, or a title) show their
-- full name and their coach photo when they haven't set a community photo;
-- athletes show first name + their own community photo only.
CREATE OR REPLACE FUNCTION public.community_author(_user_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH me AS (
    SELECT coalesce((SELECT cp0.same_person_as FROM public.community_profiles cp0 WHERE cp0.user_id = _user_id), _user_id) AS uid
  ),
  accounts AS (
    SELECT me.uid AS user_id FROM me
    UNION
    SELECT cpl.user_id FROM public.community_profiles cpl JOIN me ON cpl.same_person_as = me.uid
  )
  SELECT jsonb_build_object(
    'user_id', me.uid,
    'is_coach', (staff.yes OR cp.title IS NOT NULL),
    'title', CASE WHEN staff.yes OR cp.title IS NOT NULL THEN coalesce(cp.title, 'Coach · JF Effect') END,
    'name', CASE
      WHEN cp.title IS NOT NULL THEN coalesce(nullif(btrim(c.full_name), ''), nullif(btrim(co.full_name), ''), nullif(btrim(p.full_name), ''), 'Coach')
      WHEN staff.yes THEN coalesce(nullif(btrim(co.first_name), ''), nullif(split_part(btrim(coalesce(co.full_name, p.full_name, '')), ' ', 1), ''), 'Coach')
      ELSE coalesce(nullif(btrim(c.preferred_name), ''), nullif(btrim(c.first_name), ''),
                    nullif(split_part(btrim(coalesce(c.full_name, p.full_name, '')), ' ', 1), ''), 'Athlete') END,
    'avatar_url', coalesce(cp.avatar_path, CASE WHEN staff.yes OR cp.title IS NOT NULL THEN coachpic.pic END))
  FROM me
  LEFT JOIN public.community_profiles cp ON cp.user_id = me.uid
  LEFT JOIN public.profiles p ON p.id = me.uid
  LEFT JOIN LATERAL (SELECT * FROM public.clients c1 WHERE c1.user_id = me.uid LIMIT 1) c ON true
  LEFT JOIN LATERAL (SELECT * FROM public.coaches c2 WHERE c2.user_id = me.uid LIMIT 1) co ON true
  LEFT JOIN LATERAL (SELECT EXISTS (SELECT 1 FROM accounts a WHERE public.has_role(a.user_id, 'admin') OR public.has_role(a.user_id, 'coach')) AS yes) staff ON true
  LEFT JOIN LATERAL (SELECT c3.profile_picture_url AS pic FROM public.coaches c3 JOIN accounts a ON a.user_id = c3.user_id
                      WHERE nullif(btrim(c3.profile_picture_url), '') IS NOT NULL LIMIT 1) coachpic ON true
$$;
REVOKE ALL ON FUNCTION public.community_author(uuid) FROM PUBLIC, anon, authenticated;

-- The account a person posts from (their linked main account, else itself).
CREATE OR REPLACE FUNCTION public.community_main_account(_user_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT cp.same_person_as FROM public.community_profiles cp WHERE cp.user_id = _user_id), _user_id)
$$;
REVOKE ALL ON FUNCTION public.community_main_account(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_main_account(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.community_is_coach(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((public.community_author(_user_id)->>'is_coach')::boolean, false)
$$;
REVOKE ALL ON FUNCTION public.community_is_coach(uuid) FROM PUBLIC, anon, authenticated;

-- ── Library + settings ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.community_series_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  series text NOT NULL CHECK (series IN ('monday_motivation', 'finish_strong_friday')),
  mentor text NOT NULL,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1200),
  quote text CHECK (quote IS NULL OR char_length(quote) <= 400),
  quote_source text,
  sort_order int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  last_used_at timestamptz,
  use_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT community_series_items_quote_has_source CHECK (quote IS NULL OR quote_source IS NOT NULL)
);
ALTER TABLE public.community_series_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_series_items FROM anon, authenticated;
GRANT ALL ON public.community_series_items TO service_role;
ALTER TABLE public.community_posts DROP CONSTRAINT IF EXISTS community_posts_series_item_fk;
ALTER TABLE public.community_posts ADD CONSTRAINT community_posts_series_item_fk
  FOREIGN KEY (series_item_id) REFERENCES public.community_series_items(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.community_series_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  paused boolean NOT NULL DEFAULT false,
  author_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.community_series_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- One row per theme per week that has run. Survives the post being deleted,
-- so deleting a weekly post never makes the job publish a replacement.
CREATE TABLE IF NOT EXISTS public.community_series_runs (
  series_key text PRIMARY KEY,
  series text NOT NULL,
  item_id uuid REFERENCES public.community_series_items(id) ON DELETE SET NULL,
  post_id uuid REFERENCES public.community_posts(id) ON DELETE SET NULL,
  published_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.community_series_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_series_runs FROM anon, authenticated;
GRANT ALL ON public.community_series_runs TO service_role;
ALTER TABLE public.community_series_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_series_settings FROM anon, authenticated;
GRANT ALL ON public.community_series_settings TO service_role;

-- ── Publish ────────────────────────────────────────────────────────────────
-- _series NULL = whatever today's theme is (Monday / Friday, Winnipeg time).
-- _force (coaches only): publish now, outside the 07:00–12:00 window and on
-- any day; still once per theme per ISO week, still not while paused.
-- _at: evaluate as if it were that moment (tests); defaults to now().
CREATE OR REPLACE FUNCTION public.community_publish_series(_series text DEFAULT NULL, _force boolean DEFAULT false, _at timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_local timestamp := (coalesce(_at, now()) AT TIME ZONE 'America/Winnipeg');
  v_dow int := extract(isodow FROM v_local);
  v_series text := _series;
  v_settings record;
  v_author uuid;
  v_key text;
  v_item record;
  v_recent text[];
  v_id uuid;
  v_day int;
BEGIN
  -- Cron runs as the database owner (no auth.uid()); people must be coaches.
  IF auth.uid() IS NOT NULL AND NOT public.is_community_staff() THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF v_series IS NULL THEN
    v_series := CASE v_dow WHEN 1 THEN 'monday_motivation' WHEN 5 THEN 'finish_strong_friday' END;
    IF v_series IS NULL THEN RETURN jsonb_build_object('status', 'not_today'); END IF;
  END IF;
  IF v_series NOT IN ('monday_motivation', 'finish_strong_friday') THEN RAISE EXCEPTION 'Unknown series'; END IF;
  v_day := CASE v_series WHEN 'monday_motivation' THEN 1 ELSE 5 END;
  IF NOT coalesce(_force, false) THEN
    IF v_dow <> v_day OR v_local::time < time '07:00' OR v_local::time >= time '12:00' THEN
      RETURN jsonb_build_object('status', 'outside_window');
    END IF;
  END IF;

  SELECT * INTO v_settings FROM public.community_series_settings WHERE id;
  IF coalesce(v_settings.paused, false) THEN RETURN jsonb_build_object('status', 'paused'); END IF;
  v_author := public.community_main_account(v_settings.author_user_id);
  IF v_author IS NULL THEN RETURN jsonb_build_object('status', 'no_author'); END IF;

  v_key := v_series || ':' || to_char(v_local, 'IYYY-"W"IW');

  -- Rotate: never a post that's been used more recently than another, and
  -- not the mentor of either of the last two posts (Monday or Friday).
  SELECT array_agg(x.mentor) INTO v_recent FROM (
    SELECT i.mentor FROM public.community_series_items i WHERE i.last_used_at IS NOT NULL ORDER BY i.last_used_at DESC LIMIT 2) x;
  SELECT * INTO v_item FROM public.community_series_items i
   WHERE i.series = v_series AND i.active
   ORDER BY (i.mentor = ANY (coalesce(v_recent, '{}'))) ASC, i.last_used_at ASC NULLS FIRST, i.sort_order, i.created_at
   LIMIT 1;
  IF v_item.id IS NULL THEN RETURN jsonb_build_object('status', 'no_items'); END IF;

  -- Claim this week's slot first (the PK makes concurrent runs harmless).
  INSERT INTO public.community_series_runs (series_key, series, item_id) VALUES (v_key, v_series, v_item.id)
  ON CONFLICT (series_key) DO NOTHING;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'exists', 'key', v_key); END IF;

  INSERT INTO public.community_posts (author_user_id, client_id, kind, visibility, caption, quote, quote_author, quote_source,
                                      series, series_key, series_item_id, created_at)
  VALUES (v_author, (SELECT c.id FROM public.clients c WHERE c.user_id = v_author LIMIT 1), 'note', 'community', v_item.body,
          v_item.quote, CASE WHEN v_item.quote IS NOT NULL THEN v_item.mentor END, v_item.quote_source,
          v_series, v_key, v_item.id, coalesce(_at, now()))
  ON CONFLICT (series_key) WHERE series_key IS NOT NULL DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN jsonb_build_object('status', 'exists', 'key', v_key); END IF;

  UPDATE public.community_series_runs SET post_id = v_id WHERE series_key = v_key;
  UPDATE public.community_series_items SET last_used_at = coalesce(_at, now()), use_count = use_count + 1 WHERE id = v_item.id;
  RETURN jsonb_build_object('status', 'published', 'post_id', v_id, 'key', v_key, 'mentor', v_item.mentor);
END;
$$;
REVOKE ALL ON FUNCTION public.community_publish_series(text, boolean, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_publish_series(text, boolean, timestamptz) TO authenticated;

-- ── Coach controls ─────────────────────────────────────────────────────────
-- Everything the coach screen needs: paused, who posts, what goes out next
-- for each theme, and the recent history.
CREATE OR REPLACE FUNCTION public.community_series_overview()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_settings record;
  v_recent text[];
BEGIN
  IF NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_settings FROM public.community_series_settings WHERE id;
  SELECT array_agg(x.mentor) INTO v_recent FROM (
    SELECT i.mentor FROM public.community_series_items i WHERE i.last_used_at IS NOT NULL ORDER BY i.last_used_at DESC LIMIT 2) x;
  RETURN jsonb_build_object(
    'paused', coalesce(v_settings.paused, false),
    'author', CASE WHEN v_settings.author_user_id IS NOT NULL THEN public.community_author(v_settings.author_user_id) END,
    'next', coalesce((SELECT jsonb_object_agg(s.series, to_jsonb(n))
                        FROM (VALUES ('monday_motivation'), ('finish_strong_friday')) s(series)
                        CROSS JOIN LATERAL (
                          SELECT i.id, i.mentor, i.body, i.quote, i.quote_source FROM public.community_series_items i
                           WHERE i.series = s.series AND i.active
                           ORDER BY (i.mentor = ANY (coalesce(v_recent, '{}'))) ASC, i.last_used_at ASC NULLS FIRST, i.sort_order, i.created_at
                           LIMIT 1) n), '{}'::jsonb),
    'library', jsonb_build_object(
      'monday_motivation', (SELECT count(*) FROM public.community_series_items WHERE series = 'monday_motivation' AND active),
      'finish_strong_friday', (SELECT count(*) FROM public.community_series_items WHERE series = 'finish_strong_friday' AND active)),
    'history', coalesce((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'series', p.series, 'created_at', p.created_at,
                                                             'mentor', i.mentor, 'caption', left(p.caption, 120))
                                          ORDER BY p.created_at DESC)
                           FROM (SELECT * FROM public.community_posts WHERE series IS NOT NULL ORDER BY created_at DESC LIMIT 8) p
                           LEFT JOIN public.community_series_items i ON i.id = p.series_item_id), '[]'::jsonb),
    'this_week', jsonb_build_object(
      'monday_motivation', EXISTS (SELECT 1 FROM public.community_series_runs r
                                    WHERE r.series_key = 'monday_motivation:' || to_char(now() AT TIME ZONE 'America/Winnipeg', 'IYYY-"W"IW')),
      'finish_strong_friday', EXISTS (SELECT 1 FROM public.community_series_runs r
                                       WHERE r.series_key = 'finish_strong_friday:' || to_char(now() AT TIME ZONE 'America/Winnipeg', 'IYYY-"W"IW'))));
END;
$$;
REVOKE ALL ON FUNCTION public.community_series_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_series_overview() TO authenticated;

CREATE OR REPLACE FUNCTION public.community_series_set_paused(_paused boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  UPDATE public.community_series_settings SET paused = coalesce(_paused, false), updated_at = now() WHERE id;
END;
$$;
REVOKE ALL ON FUNCTION public.community_series_set_paused(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_series_set_paused(boolean) TO authenticated;

-- Edit a library item before it goes out (or switch it off with _active).
CREATE OR REPLACE FUNCTION public.community_series_update_item(_id uuid, _body text, _active boolean DEFAULT true)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_body text := btrim(coalesce(_body, ''));
BEGIN
  IF NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF v_body = '' OR char_length(v_body) > 1200 THEN RAISE EXCEPTION 'Write 1–1200 characters'; END IF;
  UPDATE public.community_series_items SET body = v_body, active = coalesce(_active, true), updated_at = now() WHERE id = _id;
END;
$$;
REVOKE ALL ON FUNCTION public.community_series_update_item(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_series_update_item(uuid, text, boolean) TO authenticated;

-- A coach writes a note by hand (posted as their main account). Same post
-- type the weekly series uses, so it looks and behaves the same.
CREATE OR REPLACE FUNCTION public.community_create_note(_body text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  v_author uuid;
  v_body text := btrim(coalesce(_body, ''));
  v_id uuid;
BEGIN
  IF uid IS NULL OR NOT public.community_is_coach(uid) THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF v_body = '' OR char_length(v_body) > 1200 THEN RAISE EXCEPTION 'Write 1–1200 characters'; END IF;
  v_author := public.community_main_account(uid);
  INSERT INTO public.community_posts (author_user_id, client_id, kind, visibility, caption)
  VALUES (v_author, (SELECT c.id FROM public.clients c WHERE c.user_id = v_author LIMIT 1), 'note', 'community', v_body)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id);
END;
$$;
REVOKE ALL ON FUNCTION public.community_create_note(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_create_note(text) TO authenticated;

-- Edit a published note (its author, either of their accounts, or staff).
-- The featured quote is fixed: it only ever comes from the verified library.
CREATE OR REPLACE FUNCTION public.community_update_note(_post_id uuid, _body text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  v_me uuid;
  v_body text := btrim(coalesce(_body, ''));
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF v_body = '' OR char_length(v_body) > 1200 THEN RAISE EXCEPTION 'Write 1–1200 characters'; END IF;
  v_me := public.community_main_account(uid);
  UPDATE public.community_posts p SET caption = v_body, edited_at = now(), updated_at = now()
   WHERE p.id = _post_id AND p.kind = 'note' AND (p.author_user_id = v_me OR public.is_community_staff());
  IF NOT FOUND THEN RAISE EXCEPTION 'Post not found'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.community_update_note(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_update_note(uuid, text) TO authenticated;

-- Deleting: the author's other account may delete too (RLS checks author_user_id).
DROP POLICY IF EXISTS community_posts_delete ON public.community_posts;
CREATE POLICY community_posts_delete ON public.community_posts FOR DELETE TO authenticated
  USING (author_user_id = auth.uid()
         OR author_user_id = public.community_main_account(auth.uid())
         OR public.is_community_staff());

-- ── Read paths: notes have no completion ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.community_post_json(_post_id uuid, _viewer uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id', n.id,
    'created_at', n.created_at,
    'visibility', n.visibility,
    'caption', n.caption,
    'media_path', n.media_path,
    'media_thumb_path', n.media_thumb_path,
    'media_type', n.media_type,
    'media_width', n.media_width,
    'media_height', n.media_height,
    'completion_id', n.completion_id,
    'kind', n.kind,
    'series', n.series,
    'quote', n.quote,
    'quote_author', n.quote_author,
    'quote_source', n.quote_source,
    'edited_at', n.edited_at,
    'locked_in_at', n.locked_in_at,
    'hide_loads', n.hide_loads,
    'live', n.kind = 'workout' AND pc.completed_at IS NULL,
    'session_title', CASE WHEN n.kind = 'workout' THEN coalesce(nullif(btrim(d.title), ''), nullif(btrim(d.focus), ''), 'Workout') END,
    'is_mine', n.author_user_id = public.community_main_account(_viewer),
    'author', public.community_author(n.author_user_id),
    -- "Hide my weights": loads are removed for everyone but the author.
    'stats', CASE WHEN n.hide_loads AND n.author_user_id IS DISTINCT FROM _viewer
                  THEN public.community_hide_loads(public.community_workout_stats(n.completion_id))
                  ELSE public.community_workout_stats(n.completion_id) END,
    'reactions', coalesce((SELECT jsonb_object_agg(x.emoji, x.c)
                             FROM (SELECT r.emoji, count(*) c FROM public.community_reactions r
                                    WHERE r.post_id = n.id GROUP BY r.emoji) x), '{}'::jsonb),
    'my_reaction', (SELECT r.emoji FROM public.community_reactions r WHERE r.post_id = n.id AND r.user_id = _viewer),
    'coach_reactions', coalesce((SELECT jsonb_agg(jsonb_build_object(
                                    'name', public.community_author(r.user_id)->>'name', 'emoji', r.emoji)
                                    ORDER BY r.created_at)
                                   FROM public.community_reactions r
                                  WHERE r.post_id = n.id
                                    AND public.community_is_coach(r.user_id)), '[]'::jsonb),
    'comment_count', (SELECT count(*) FROM public.community_comments c WHERE c.post_id = n.id),
    'coach_commented', EXISTS (SELECT 1 FROM public.community_comments c
                                WHERE c.post_id = n.id
                                  AND public.community_is_coach(c.author_user_id)))
  FROM public.community_posts n
  LEFT JOIN public.pl_day_completions pc ON pc.id = n.completion_id
  LEFT JOIN public.pl_days d ON d.id = pc.day_id
  WHERE n.id = _post_id
$$;
REVOKE ALL ON FUNCTION public.community_post_json(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.community_post(_post_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  v_completion uuid;
  v_hide boolean;
  v_found boolean := false;
BEGIN
  IF NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT true, p.completion_id, p.hide_loads AND p.author_user_id <> uid INTO v_found, v_completion, v_hide FROM public.community_posts p
   WHERE p.id = _post_id AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id);
  IF NOT coalesce(v_found, false) THEN RAISE EXCEPTION 'Post not found'; END IF;
  RETURN public.community_post_json(_post_id, uid)
         || jsonb_build_object('exercises', CASE WHEN v_completion IS NULL THEN '[]'::jsonb WHEN v_hide THEN public.community_hide_exercise_loads(public.community_workout_exercises(v_completion))
                                                ELSE public.community_workout_exercises(v_completion) END);
END;
$$;
REVOKE ALL ON FUNCTION public.community_post(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_post(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.community_members()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'author', public.community_author(m.user_id),
             'bio', cp.bio,
             'posts', s.posts,
             'last_post_at', s.last_at,
             'live', s.live)
           ORDER BY (public.community_author(m.user_id)->>'is_coach')::boolean DESC, s.last_at DESC NULLS LAST, lower(coalesce(public.community_author(m.user_id)->>'name', '')))
      FROM (
        SELECT DISTINCT ON (x.user_id) x.user_id, x.is_staff FROM (
          SELECT c.user_id, false AS is_staff FROM public.clients c
           WHERE c.user_id IS NOT NULL
             AND coalesce(c.archived, false) = false AND c.archived_at IS NULL
             AND coalesce(c.status, '') <> 'Archived'
             AND coalesce(c.portal_access_disabled, false) = false
          UNION ALL
          SELECT ur.user_id, true FROM public.user_roles ur WHERE ur.role IN ('admin', 'coach')
        ) x ORDER BY x.user_id, x.is_staff DESC
      ) m
      LEFT JOIN public.community_profiles cp ON cp.user_id = m.user_id
      CROSS JOIN LATERAL (
        SELECT count(*) AS posts, max(p.created_at) AS last_at,
               coalesce(bool_or(p.locked_in_at > now() - interval '3 hours' AND pc.completed_at IS NULL), false) AS live
          FROM public.community_posts p
          LEFT JOIN public.pl_day_completions pc ON pc.id = p.completion_id
         WHERE p.author_user_id = m.user_id
           AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id)
      ) s
     WHERE m.user_id <> uid
       -- a linked second account (same person) isn't listed twice
       AND NOT EXISTS (SELECT 1 FROM public.community_profiles l WHERE l.user_id = m.user_id AND l.same_person_as IS NOT NULL)
       AND m.user_id <> coalesce((SELECT l2.same_person_as FROM public.community_profiles l2 WHERE l2.user_id = uid), uid)
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.community_members() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_members() TO authenticated;

-- ── Library (seeded once; edit or switch items off from the coach screen) ──
-- Quotes: only wording found in the speaker's own posts/columns, a published
-- transcript, their book, or a reputable outlet quoting them directly. Posts
-- without a quote are original reflections built on documented facts and
-- never put words in anyone's mouth.
INSERT INTO public.community_series_items (series, mentor, quote, quote_source, body, sort_order)
SELECT v.* FROM (VALUES
  ('monday_motivation', 'Alex Hormozi', 'You must first become consistent before you can become exceptional.', 'on X', 'Everyone wants the exceptional part. The PR, the meet, the physique.

But exceptional is just consistent, repeated long enough that people start calling it talent.

This week isn''t about one big session. It''s about every session. Show up for all of them.', 1),
  ('monday_motivation', 'Tim Grover', 'Talent and skill aren''t the same thing; the world is full of talented people who have never achieved anything.', 'Sports Illustrated, 2014', 'Talent gets you noticed. Skill gets built, one rep at a time, with intent.

You don''t need more talent this week. You need to stop wasting reps.', 2),
  ('monday_motivation', 'Dorian Yates', NULL, NULL, 'Dorian Yates won six straight Mr. Olympias doing one or two working sets per exercise.

Not because he did less. Because every one of those sets was taken all the way.

Most people do five sets at 80% and call it volume. Pick your hardest set this week and actually finish it.', 3),
  ('monday_motivation', 'Kobe Bryant', 'You could say I dared people to be their best selves.', 'The Mamba Mentality', 'Kobe didn''t make the people around him comfortable. He made them better.

That''s what a good training partner, a good coach and a good crew does.

Raise the standard for yourself this week. Then bring someone with you.', 4),
  ('monday_motivation', 'Dave Alred', 'Focus on what you want to achieve, not what you want to avoid.', 'talk on The Pressure Principle', 'Not "don''t miss depth." Hit depth.
Not "don''t skip sessions." Train four times.

The words you use with yourself decide where your head goes under the bar. Write this week''s target as something you''ll do, not something you''ll avoid.', 5),
  ('monday_motivation', 'Tim Grover', NULL, NULL, 'In Relentless, Tim Grover sorts competitors into three groups: Coolers, Closers and Cleaners.

Coolers do what''s asked. Closers deliver when it counts. Cleaners are never satisfied and don''t stop.

Most people are Coolers who think they''re Cleaners. Be honest this week about which one you''ve been.', 6),
  ('monday_motivation', 'Alex Hormozi', 'Work + Big Goals = Ambition
Lazy + Big Goals = Entitlement
Big goals don''t make you different.
Big work does.', 'on X', 'Everyone in this crew has big goals. Good.

The goal isn''t the flex. The work is. Let''s see it this week.', 7),
  ('monday_motivation', 'Kobe Bryant', NULL, NULL, 'Kobe scored 81 points in one game in 2006. People still talk about that night.

Nobody talks about the practice that made it possible. It was there anyway.

This week is practice. Treat it like it matters, because it''s the only part you control.', 8),
  ('monday_motivation', 'Dorian Yates', 'Muscle growth is an adaptation to stress. You''ve got to give your muscles more stress than they''re accustomed to, otherwise they won''t change.', 'The Tim Ferriss Show', 'Same weight. Same reps. Same effort. Same body.

Your body only changes when you give it a reason to. Add a rep. Add a little load. Add intent. Something has to go up this week.', 9),
  ('monday_motivation', 'Tim Grover', 'Mental toughness is knowing what you want and refusing to waver in your pursuit of achieving it.', 'Sports Illustrated, 2015', 'Notice there''s nothing in there about feeling motivated.

Know what you want. Then stop negotiating with yourself every morning about whether you''ll go get it.', 10),
  ('monday_motivation', 'Dave Alred', 'You should always be in a position that there''s nothing I will do today that I haven''t already done.', 'The Irish Times', 'That''s why the best look calm on the platform. They''ve already done it in training, over and over.

Pressure isn''t the meet. Pressure is finding out on the day that you never practised for it. Train this week like the day is coming, because it is.', 11),
  ('monday_motivation', 'Alex Hormozi', 'Your competition isn''t lucky. They just got tired of their excuses before you got tired of yours.', 'on X', 'Read that twice.

The person ahead of you isn''t special. They stopped arguing with the plan sooner.

Pick the excuse you''re done with this week. Then be done with it.', 12),
  ('monday_motivation', 'Dave Alred', NULL, NULL, 'Dave Alred coached Jonny Wilkinson''s kicking for years. The drop goal that won the 2003 World Cup took a second.

The preparation behind it didn''t.

You won''t get one big moment this week. You''ll get a handful of ordinary sessions. That''s where the moment gets built.', 13),
  ('monday_motivation', 'Kobe Bryant', 'Mamba mentality is all about focusing on the process and trusting in the hard work when it matters most.', '2018 interview', 'Process first. Trust second.

You can''t trust work you didn''t do. So do it this week, and you''ll have something to lean on when it gets heavy.', 14),
  ('finish_strong_friday', 'Alex Hormozi', 'Do the work tired. Do the work nervous. Do the work imperfectly. Do the work even when you don''t feel like it. Because no matter how bad you feel when you start, you know exactly how you''ll feel when you finish.', 'on X', 'It''s Friday. You''re tired. So is everyone.

The session you don''t feel like doing is the one that tells you who you are. Go finish the week.', 1),
  ('finish_strong_friday', 'Tim Grover', 'The harder the offseason, the easier the season.', 'Sports Illustrated, 2014', 'For most of you this week was the offseason. No meet, no show, no audience.

That''s exactly where it''s won. Don''t coast the last session because nobody''s watching.', 2),
  ('finish_strong_friday', 'Dorian Yates', 'That last set you''ve just got to put everything into it. It''s not about throwing weights around and screaming and shouting. It''s about concentrating. It''s about doing the movement correctly.', 'The Tim Ferriss Show', 'Last session of the week. Last set of the session.

That''s the one most people coast. Quiet, focused, every rep clean, all the way to the end.', 3),
  ('finish_strong_friday', 'Kobe Bryant', NULL, NULL, 'Kobe played all 20 of his seasons for one team. Five titles. Twenty years of showing up for the same thing.

Commitment isn''t exciting. It''s staying when leaving would be easier.

Finish this week the way you said you would on Monday.', 4),
  ('finish_strong_friday', 'Dave Alred', 'I''ve learnt to accelerate the learning and be prepared to push them more: to take them into an ugly place and be comfortable with that.', 'The Irish Times', 'Ugly is normal at the end of a hard week. Slower bar, heavier legs, less patience.

Train there anyway. Being comfortable in the ugly place is the whole skill.', 5),
  ('finish_strong_friday', 'Alex Hormozi', 'You''d be amazed how far a person can get when they simply refuse to fold under pressure.', 'on X', 'Friday pressure isn''t a meet. It''s the couch, the drinks, the "I''ll make it up Monday."

Don''t fold to that either. Get today''s session done.', 6),
  ('finish_strong_friday', 'Tim Grover', '"Have to" is driven by someone else. "Want to" can only be driven by you.', 'Sports Illustrated, 2015', 'If you''re only training because the program says so, Friday is where that breaks.

Remember why you started. Then go train like it.', 7),
  ('finish_strong_friday', 'Dorian Yates', NULL, NULL, 'Dorian Yates built six Olympia titles mostly out of sight, training at his own gym in Birmingham. Nobody saw the work until he walked on stage.

Nobody needs to see today''s session either. It just needs to get done.', 8),
  ('finish_strong_friday', 'Alex Hormozi', '"Boring" is what most people call the work it takes to become the best.', 'on X', 'The warm-ups. The accessories. The food prep. The early night.

None of it is exciting and all of it counts. Finish the boring stuff this week too.', 9),
  ('finish_strong_friday', 'Kobe Bryant', 'Working harder wasn''t enough. I had to study [Iverson] maniacally.', 'CNBC, 2018', 'Effort is the minimum. Attention is what moves you.

On your last session this week, film a top set. Watch it. Fix one thing.', 10),
  ('finish_strong_friday', 'Dave Alred', 'The athlete has to recognise when it''s right, that''s really important, not looking for what''s wrong.', 'The Irish Times', 'End-of-week reviews usually turn into a list of what went wrong.

Flip it. Name one thing you did right this week, then do it again today.', 11),
  ('finish_strong_friday', 'Tim Grover', 'You keep pushing yourself harder when everyone else has had enough.', 'Relentless', 'Everyone has had enough by Friday. That''s the point.

This is where the separation happens. One more session, done properly.', 12),
  ('finish_strong_friday', 'Tim Grover', NULL, NULL, 'Michael Jordan gave Tim Grover 30 days to prove himself. It turned into about fifteen years.

Thirty days becomes fifteen years when you keep delivering. Finish this week like you''re still earning the next one.', 13),
  ('finish_strong_friday', 'Alex Hormozi', 'Volume negates luck.', 'The Game podcast', 'One good session is luck. A full week of them isn''t.

Get the last one in.', 14)
) AS v(series, mentor, quote, quote_source, body, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM public.community_series_items);


-- ── Schedule ───────────────────────────────────────────────────────────────
-- Mondays and Fridays, every 15 min across the UTC hours that cover
-- 07:00–12:00 Winnipeg in both CST and CDT; the function does the rest.
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'community-weekly-coach-posts';
  PERFORM cron.schedule('community-weekly-coach-posts', '*/15 11-18 * * 1,5', 'select public.community_publish_series();');
EXCEPTION WHEN undefined_table OR invalid_schema_name OR undefined_function THEN
  RAISE NOTICE 'pg_cron not available; community-weekly-coach-posts not scheduled';
END $$;
