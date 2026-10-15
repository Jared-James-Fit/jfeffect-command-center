-- Crew: find athletes. @usernames, a public "what I train" and home gym,
-- search by name or @username, and suggestions with a reason.
--
--   * community_profiles gains username (lowercase, unique, auto-assigned from the
--     name people already see, changeable), disciplines (up to 3 from a fixed
--     list), home_gym and discoverable. They live on the main account (a coach's
--     linked athlete login shares it), like is_private.
--   * community_people_search(q): matches the shown name (a client's first name
--     only, never a last name) and @username. Blocked people (either way) never
--     appear; someone who turned off "Suggest my account" only appears to people
--     they're already connected with.
--   * community_suggestions(context, limit): one ranked list, each person with
--     the reason they're there: your coach, follows you, followed by people you
--     follow, same gym, new to the Crew, trains the same way, you interact,
--     popular, active this week. With a context person (a profile you just
--     followed) people close to them rank first. Already followed, requested,
--     blocked, hidden and not-suggestable people are left out.
--   * Everything is read through these functions; the tables stay closed to
--     clients. Coaches stay findable (like they stay public).
--
-- Who is "in the Crew" is still community_member_directory() / community_is_member().

-- ── Shape ───────────────────────────────────────────────────────────────────
ALTER TABLE public.community_profiles
  ADD COLUMN IF NOT EXISTS username text,
  ADD COLUMN IF NOT EXISTS username_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS disciplines text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS home_gym text,
  ADD COLUMN IF NOT EXISTS discoverable boolean NOT NULL DEFAULT true;

ALTER TABLE public.community_profiles DROP CONSTRAINT IF EXISTS community_profiles_username_format;
ALTER TABLE public.community_profiles ADD CONSTRAINT community_profiles_username_format CHECK (
  username IS NULL OR (
    username::text = lower(username::text)
    AND username::text ~ '^[a-z0-9._]{3,24}$'
    AND username::text !~ '^[._]|[._]$|\.\.'));
ALTER TABLE public.community_profiles DROP CONSTRAINT IF EXISTS community_profiles_disciplines_check;
ALTER TABLE public.community_profiles ADD CONSTRAINT community_profiles_disciplines_check CHECK (
  cardinality(disciplines) <= 3
  AND disciplines <@ ARRAY['powerlifting', 'bodybuilding', 'strength', 'glutes', 'fitness']::text[]);
ALTER TABLE public.community_profiles DROP CONSTRAINT IF EXISTS community_profiles_home_gym_check;
ALTER TABLE public.community_profiles ADD CONSTRAINT community_profiles_home_gym_check CHECK (
  home_gym IS NULL OR char_length(home_gym) BETWEEN 2 AND 60);
CREATE UNIQUE INDEX IF NOT EXISTS community_profiles_username_key ON public.community_profiles (username) WHERE username IS NOT NULL;

-- "Not for me" on a suggestion: that person stops being suggested to you.
CREATE TABLE IF NOT EXISTS public.community_suggestion_hides (
  user_id uuid NOT NULL,
  hidden_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, hidden_user_id),
  CONSTRAINT community_suggestion_hides_not_self CHECK (user_id <> hidden_user_id)
);
ALTER TABLE public.community_suggestion_hides ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_suggestion_hides FROM anon, authenticated;

-- ── Usernames ───────────────────────────────────────────────────────────────
-- Gyms typed two ways ("Gold's Gym", "golds gym") are the same gym.
CREATE OR REPLACE FUNCTION public.community_gym_key(_gym text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT nullif(regexp_replace(lower(coalesce(_gym, '')), '[^a-z0-9]+', '', 'g'), '')
$$;

CREATE OR REPLACE FUNCTION public.community_username_reserved(_name text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT lower(coalesce(_name, '')) = ANY (ARRAY[
    'admin', 'administrator', 'support', 'help', 'jfeffect', 'jf_effect', 'jf.effect', 'jfeffectcoaching',
    'coach', 'coaches', 'crew', 'team', 'staff', 'official', 'system', 'root', 'null', 'undefined',
    'me', 'you', 'discover', 'search', 'settings', 'about', 'privacy', 'terms', 'login', 'signup'])
    OR lower(coalesce(_name, '')) LIKE 'jfeffect%'
$$;

-- "Nicole" → nicole, "José" → jose; at least 3 characters.
CREATE OR REPLACE FUNCTION public.community_username_base(_name text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT left(regexp_replace(lower(translate(coalesce(_name, ''),
           'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖØòóôõöøÙÚÛÜùúûüÑñÇçÝýÿ',
           'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOOooooooUUUUuuuuNnCcYyy')), '[^a-z0-9]+', '', 'g'), 18)
$$;

-- Gives the person's main account a username if it has none yet (never changes one).
CREATE OR REPLACE FUNCTION public.community_ensure_username(_user_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_main uuid := public.community_main_account(_user_id);
  v_have text;
  v_base text;
  v_try text;
  n int := 1;
BEGIN
  IF v_main IS NULL THEN RETURN NULL; END IF;
  SELECT cp.username::text INTO v_have FROM public.community_profiles cp WHERE cp.user_id = v_main;
  IF v_have IS NOT NULL THEN RETURN v_have; END IF;
  v_base := public.community_username_base(public.community_author(v_main)->>'name');
  IF char_length(v_base) < 3 THEN v_base := v_base || 'athlete'; END IF;
  LOOP
    v_try := CASE WHEN n = 1 THEN v_base ELSE v_base || n::text END;
    IF NOT public.community_username_reserved(v_try)
       AND NOT EXISTS (SELECT 1 FROM public.community_profiles cp WHERE cp.username = v_try) THEN
      BEGIN
        INSERT INTO public.community_profiles (user_id, username) VALUES (v_main, v_try)
        ON CONFLICT (user_id) DO UPDATE SET username = EXCLUDED.username
          WHERE public.community_profiles.username IS NULL;
        SELECT cp.username::text INTO v_have FROM public.community_profiles cp WHERE cp.user_id = v_main;
        RETURN v_have;
      EXCEPTION WHEN unique_violation THEN NULL;
      END;
    END IF;
    n := n + 1;
    IF n > 500 THEN RETURN NULL; END IF;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.community_ensure_username(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.community_ensure_username(uuid) TO service_role;

-- New people in the Crew get one straight away. Never blocks the write that triggered it.
CREATE OR REPLACE FUNCTION public.community_username_on_member()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.user_id IS NOT NULL AND (TG_TABLE_NAME <> 'user_roles' OR NEW.role IN ('admin', 'coach')) THEN
    BEGIN
      PERFORM public.community_ensure_username(NEW.user_id);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS community_username_on_client ON public.clients;
CREATE TRIGGER community_username_on_client AFTER INSERT OR UPDATE OF user_id ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.community_username_on_member();
DROP TRIGGER IF EXISTS community_username_on_role ON public.user_roles;
CREATE TRIGGER community_username_on_role AFTER INSERT ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.community_username_on_member();

-- Everyone already in the Crew.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT d.user_id FROM public.community_member_directory() d ORDER BY d.user_id LOOP
    PERFORM public.community_ensure_username(r.user_id);
  END LOOP;
END $$;

-- ── One person, as discovery shows them ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.community_person_json(_user_id uuid, _viewer uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.community_author(_user_id) || jsonb_build_object(
    'username', cp.username::text,
    'is_private', coalesce(cp.is_private, false),
    'disciplines', coalesce(to_jsonb(cp.disciplines), '[]'::jsonb),
    'follows_you', EXISTS (SELECT 1 FROM public.community_follows f WHERE f.follower_id = _user_id AND f.followee_id = _viewer))
  FROM (SELECT 1) one
  LEFT JOIN public.community_profiles cp ON cp.user_id = _user_id
$$;
REVOKE ALL ON FUNCTION public.community_person_json(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.community_person_json(uuid, uuid) TO service_role;

-- Crew accounts the viewer may find: members (no second logins), not the
-- viewer, no block either way. _connected_only_hidden: people who turned off
-- "Suggest my account" stay findable by people they're already connected with.
CREATE OR REPLACE FUNCTION public.community_findable_people(_viewer uuid)
RETURNS TABLE (user_id uuid, name text, username text, connected boolean, suggestable boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT d.user_id, d.name, cp.username::text,
         (EXISTS (SELECT 1 FROM public.community_follows f WHERE f.follower_id = _viewer AND f.followee_id = d.user_id)
          OR EXISTS (SELECT 1 FROM public.community_follows f WHERE f.follower_id = d.user_id AND f.followee_id = _viewer)
          OR EXISTS (SELECT 1 FROM public.community_follow_requests r WHERE r.requester_id = _viewer AND r.target_id = d.user_id)) AS connected,
         (coalesce(cp.discoverable, true) OR public.community_is_coach(d.user_id)) AS suggestable
    FROM public.community_member_directory() d
    LEFT JOIN public.community_profiles cp ON cp.user_id = d.user_id
   WHERE d.user_id <> _viewer
     AND public.community_main_account(d.user_id) <> _viewer
     AND NOT public.chat_has_blocked(_viewer, d.user_id)
     AND NOT public.chat_has_blocked(d.user_id, _viewer)
$$;
REVOKE ALL ON FUNCTION public.community_findable_people(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.community_findable_people(uuid) TO service_role;

-- ── Search ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.community_people_search(_q text, _limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me uuid := public.community_main_account(auth.uid());
  v_q text := left(lower(btrim(regexp_replace(coalesce(_q, ''), '^\s*@+', ''))), 40);
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF v_q = '' THEN RETURN '[]'::jsonb; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(public.community_person_json(x.user_id, v_me) ORDER BY x.rank, x.following DESC, x.followers DESC, x.lname)
      FROM (
        SELECT p.user_id, lower(coalesce(p.name, '')) AS lname,
               CASE WHEN starts_with(lower(coalesce(p.username, '')), v_q) THEN 0
                    WHEN starts_with(lower(coalesce(p.name, '')), v_q) THEN 1
                    WHEN position(' ' || v_q IN ' ' || lower(coalesce(p.name, ''))) > 0 THEN 2
                    ELSE 3 END AS rank,
               EXISTS (SELECT 1 FROM public.community_follows f WHERE f.follower_id = v_me AND f.followee_id = p.user_id) AS following,
               (SELECT count(*) FROM public.community_follows f WHERE f.followee_id = p.user_id) AS followers
          FROM public.community_findable_people(v_me) p
         WHERE (p.suggestable OR p.connected)
           AND (position(v_q IN lower(coalesce(p.username, ''))) > 0
                OR position(v_q IN lower(coalesce(p.name, ''))) > 0)
         ORDER BY 3, 4 DESC, 5 DESC, 2
         LIMIT greatest(1, least(coalesce(_limit, 20), 50))
      ) x), '[]'::jsonb);
END;
$$;

-- ── Suggestions ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.community_suggestions(_context uuid DEFAULT NULL, _limit integer DEFAULT 12)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me uuid := public.community_main_account(auth.uid());
  v_ctx uuid := CASE WHEN _context IS NULL THEN NULL ELSE public.community_main_account(_context) END;
  v_my_gym text;
  v_my_disc text[];
  v_ctx_gym text;
  v_ctx_disc text[];
  v_ctx_name text;
  v_coach uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT public.community_gym_key(cp.home_gym), cp.disciplines INTO v_my_gym, v_my_disc
    FROM public.community_profiles cp WHERE cp.user_id = v_me;
  IF v_ctx IS NOT NULL THEN
    SELECT public.community_gym_key(cp.home_gym), cp.disciplines INTO v_ctx_gym, v_ctx_disc
      FROM public.community_profiles cp WHERE cp.user_id = v_ctx;
    v_ctx_name := public.community_author(v_ctx)->>'name';
  END IF;
  -- the coach a coaching client is assigned to
  SELECT public.community_main_account(co.user_id) INTO v_coach
    FROM public.clients c JOIN public.coaches co ON co.id = c.assigned_coach_id
   WHERE c.user_id IN (SELECT a.user_id FROM public.community_profiles a WHERE a.same_person_as = v_me UNION SELECT v_me)
     AND coalesce(c.archived, false) = false AND co.user_id IS NOT NULL
   LIMIT 1;

  RETURN coalesce((
    WITH cand AS (
      SELECT p.user_id, p.name FROM public.community_findable_people(v_me) p
       WHERE p.suggestable
         AND p.user_id IS DISTINCT FROM v_ctx
         AND NOT EXISTS (SELECT 1 FROM public.community_follows f WHERE f.follower_id = v_me AND f.followee_id = p.user_id)
         AND NOT EXISTS (SELECT 1 FROM public.community_follow_requests r WHERE r.requester_id = v_me AND r.target_id = p.user_id)
         AND NOT EXISTS (SELECT 1 FROM public.community_suggestion_hides h WHERE h.user_id = v_me AND h.hidden_user_id = p.user_id)
    ),
    my_following AS (
      SELECT f.followee_id AS id FROM public.community_follows f WHERE f.follower_id = v_me
    ),
    feat AS (
      SELECT c.user_id,
             c.user_id = v_coach AS my_coach,
             public.community_is_coach(c.user_id) AS is_coach,
             EXISTS (SELECT 1 FROM public.community_follows f WHERE f.follower_id = c.user_id AND f.followee_id = v_me) AS follows_you,
             (SELECT array_agg(m.id ORDER BY m.at DESC) FROM (
                SELECT f2.follower_id AS id, f2.created_at AS at
                  FROM public.community_follows f2 JOIN my_following mf ON mf.id = f2.follower_id
                 WHERE f2.followee_id = c.user_id AND f2.follower_id <> v_me) m) AS mutual_ids,
             v_my_gym IS NOT NULL AND public.community_gym_key(cp.home_gym) = v_my_gym AS same_gym,
             cp.home_gym,
             (SELECT array_agg(x) FROM unnest(coalesce(cp.disciplines, '{}')) x WHERE x = ANY (coalesce(v_my_disc, '{}'))) AS shared_disc,
             EXISTS (SELECT 1 FROM public.clients cl WHERE cl.user_id = c.user_id AND coalesce(cl.archived, false) = false
                      AND cl.created_at > now() - interval '21 days') AS is_new,
             (SELECT count(*) FROM (
                SELECT 1 FROM public.community_reactions r JOIN public.community_posts po ON po.id = r.post_id
                 WHERE r.created_at > now() - interval '60 days'
                   AND ((r.user_id = v_me AND po.author_user_id = c.user_id) OR (r.user_id = c.user_id AND po.author_user_id = v_me))
                UNION ALL
                SELECT 1 FROM public.community_comments cm JOIN public.community_posts po ON po.id = cm.post_id
                 WHERE cm.created_at > now() - interval '60 days' AND cm.hidden_at IS NULL
                   AND ((cm.author_user_id = v_me AND po.author_user_id = c.user_id) OR (cm.author_user_id = c.user_id AND po.author_user_id = v_me))
              ) i) AS interactions,
             (SELECT count(*) FROM public.community_follows f WHERE f.followee_id = c.user_id) AS followers,
             (EXISTS (SELECT 1 FROM public.pl_day_completions pc JOIN public.clients cl ON cl.id = pc.client_id
                       WHERE cl.user_id = c.user_id AND pc.completed_at > now() - interval '7 days')
              OR EXISTS (SELECT 1 FROM public.community_posts po WHERE po.author_user_id = c.user_id
                          AND po.archived_at IS NULL AND po.created_at > now() - interval '14 days')) AS active,
             CASE WHEN v_ctx IS NULL THEN false ELSE EXISTS (SELECT 1 FROM public.community_follows f WHERE f.follower_id = v_ctx AND f.followee_id = c.user_id) END AS ctx_follows,
             CASE WHEN v_ctx IS NULL THEN 0 ELSE (SELECT count(*) FROM public.community_follows a JOIN public.community_follows b ON b.follower_id = a.follower_id
                                                   WHERE a.followee_id = v_ctx AND b.followee_id = c.user_id AND a.follower_id <> v_me) END AS co_followed,
             v_ctx_gym IS NOT NULL AND public.community_gym_key(cp.home_gym) = v_ctx_gym AS ctx_gym,
             CASE WHEN v_ctx IS NULL THEN 0 ELSE (SELECT count(*) FROM unnest(coalesce(cp.disciplines, '{}')) x WHERE x = ANY (coalesce(v_ctx_disc, '{}'))) END AS ctx_disc
        FROM cand c
        LEFT JOIN public.community_profiles cp ON cp.user_id = c.user_id
    ),
    scored AS (
      SELECT f.*,
             coalesce(cardinality(f.mutual_ids), 0) AS mutuals,
             ( CASE WHEN f.my_coach THEN 40 ELSE 0 END
             + CASE WHEN f.follows_you THEN 12 ELSE 0 END
             + 4 * least(coalesce(cardinality(f.mutual_ids), 0), 5)
             + CASE WHEN f.same_gym THEN 8 ELSE 0 END
             + 3 * coalesce(cardinality(f.shared_disc), 0)
             + CASE WHEN f.is_new THEN 4 ELSE 0 END
             + least(f.interactions, 6)
             + CASE WHEN f.is_coach THEN 3 ELSE 0 END
             + CASE WHEN f.active THEN 2 ELSE 0 END
             + least(floor(ln(1 + f.followers) * 1.5), 6)
             + CASE WHEN f.ctx_follows THEN 10 ELSE 0 END
             + 3 * least(f.co_followed, 4)
             + CASE WHEN f.ctx_gym THEN 6 ELSE 0 END
             + 2 * f.ctx_disc )::numeric AS score
        FROM feat f
    ),
    top AS (
      SELECT s.* FROM scored s
       WHERE s.score > 0
       ORDER BY s.score DESC, s.followers DESC, s.user_id
       LIMIT greatest(1, least(coalesce(_limit, 12), 30))
    )
    SELECT jsonb_agg(
             public.community_person_json(t.user_id, v_me) || jsonb_build_object(
               'reason', CASE
                 WHEN t.my_coach THEN jsonb_build_object('kind', 'coach')
                 WHEN v_ctx IS NOT NULL AND t.ctx_follows THEN jsonb_build_object('kind', 'followed_by', 'names', jsonb_build_array(v_ctx_name), 'count', 1)
                 WHEN t.follows_you THEN jsonb_build_object('kind', 'follows_you')
                 WHEN t.mutuals > 0 THEN jsonb_build_object('kind', 'followed_by', 'count', t.mutuals,
                        'names', (SELECT jsonb_agg(public.community_author(m)->>'name') FROM unnest(t.mutual_ids[1:2]) m))
                 WHEN t.same_gym OR t.ctx_gym THEN jsonb_build_object('kind', 'gym', 'label', t.home_gym)
                 WHEN t.is_new THEN jsonb_build_object('kind', 'new')
                 WHEN coalesce(cardinality(t.shared_disc), 0) > 0 THEN jsonb_build_object('kind', 'discipline', 'label', t.shared_disc[1])
                 WHEN t.interactions > 0 THEN jsonb_build_object('kind', 'interacts')
                 WHEN t.is_coach THEN jsonb_build_object('kind', 'coach_any')
                 WHEN t.followers >= 3 THEN jsonb_build_object('kind', 'popular')
                 WHEN t.active THEN jsonb_build_object('kind', 'active')
                 ELSE jsonb_build_object('kind', 'crew') END)
             ORDER BY t.score DESC, t.followers DESC, t.user_id)
      FROM top t), '[]'::jsonb);
END;
$$;

-- ── Settings ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.community_username_check(_username text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me uuid := public.community_main_account(auth.uid());
  v_u text := lower(btrim(regexp_replace(coalesce(_username, ''), '^\s*@+', '')));
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF v_u !~ '^[a-z0-9._]{3,24}$' OR v_u ~ '^[._]|[._]$|\.\.' THEN
    RETURN jsonb_build_object('ok', false, 'username', v_u, 'reason', 'format');
  END IF;
  IF public.community_username_reserved(v_u) THEN
    RETURN jsonb_build_object('ok', false, 'username', v_u, 'reason', 'reserved');
  END IF;
  IF EXISTS (SELECT 1 FROM public.community_profiles cp WHERE cp.username = v_u AND cp.user_id <> v_me) THEN
    RETURN jsonb_build_object('ok', false, 'username', v_u, 'reason', 'taken');
  END IF;
  RETURN jsonb_build_object('ok', true, 'username', v_u);
END;
$$;

CREATE OR REPLACE FUNCTION public.community_set_username(_username text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me uuid := public.community_main_account(auth.uid());
  v_check jsonb := public.community_username_check(_username);
BEGIN
  IF NOT (v_check->>'ok')::boolean THEN
    RAISE EXCEPTION '%', CASE v_check->>'reason'
      WHEN 'taken' THEN 'That username is taken'
      WHEN 'reserved' THEN 'That username isn''t available'
      ELSE 'Use 3–24 letters, numbers, dots or underscores' END USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.community_profiles (user_id, username, username_set_at) VALUES (v_me, v_check->>'username', now())
  ON CONFLICT (user_id) DO UPDATE SET username = EXCLUDED.username, username_set_at = now(), updated_at = now();
  RETURN jsonb_build_object('username', v_check->>'username');
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'That username is taken' USING ERRCODE = '22023';
END;
$$;

CREATE OR REPLACE FUNCTION public.community_set_training(_disciplines text[], _home_gym text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me uuid := public.community_main_account(auth.uid());
  v_disc text[] := coalesce((SELECT array_agg(DISTINCT d) FROM unnest(coalesce(_disciplines, '{}')) d WHERE d IS NOT NULL), '{}');
  v_gym text := nullif(regexp_replace(btrim(coalesce(_home_gym, '')), '\s+', ' ', 'g'), '');
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF cardinality(v_disc) > 3 THEN RAISE EXCEPTION 'Pick up to 3' USING ERRCODE = '22023'; END IF;
  IF NOT v_disc <@ ARRAY['powerlifting', 'bodybuilding', 'strength', 'glutes', 'fitness']::text[] THEN
    RAISE EXCEPTION 'Unknown training type' USING ERRCODE = '22023';
  END IF;
  IF v_gym IS NOT NULL AND char_length(v_gym) NOT BETWEEN 2 AND 60 THEN
    RAISE EXCEPTION 'Keep your gym under 60 characters' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.community_profiles (user_id, disciplines, home_gym) VALUES (v_me, v_disc, v_gym)
  ON CONFLICT (user_id) DO UPDATE SET disciplines = EXCLUDED.disciplines, home_gym = EXCLUDED.home_gym, updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.community_set_discoverable(_on boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me uuid := public.community_main_account(auth.uid());
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF NOT coalesce(_on, true) AND (public.community_is_staff(auth.uid()) OR public.community_is_coach(v_me)) THEN
    RAISE EXCEPTION 'Coach accounts stay findable' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.community_profiles (user_id, discoverable) VALUES (v_me, coalesce(_on, true))
  ON CONFLICT (user_id) DO UPDATE SET discoverable = EXCLUDED.discoverable, updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.community_hide_suggestion(_user_id uuid, _hidden boolean DEFAULT true)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me uuid := public.community_main_account(auth.uid());
  v_them uuid := public.community_main_account(_user_id);
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF v_them IS NULL OR v_them = v_me THEN RETURN; END IF;
  IF coalesce(_hidden, true) THEN
    INSERT INTO public.community_suggestion_hides (user_id, hidden_user_id) VALUES (v_me, v_them) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.community_suggestion_hides WHERE user_id = v_me AND hidden_user_id = v_them;
  END IF;
END;
$$;

-- Gyms people already put on their profile, so the same gym is typed the same way.
CREATE OR REPLACE FUNCTION public.community_gym_names(_q text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_q text := public.community_gym_key(_q);
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(g.name ORDER BY g.n DESC, g.name)
      FROM (SELECT DISTINCT ON (public.community_gym_key(cp.home_gym)) cp.home_gym AS name,
                   count(*) OVER (PARTITION BY public.community_gym_key(cp.home_gym)) AS n
              FROM public.community_profiles cp
             WHERE cp.home_gym IS NOT NULL AND cp.discoverable AND cp.same_person_as IS NULL
               AND public.community_is_member(cp.user_id)
               AND (v_q IS NULL OR position(v_q IN public.community_gym_key(cp.home_gym)) > 0)
             ORDER BY public.community_gym_key(cp.home_gym), cp.updated_at DESC) g
     LIMIT 8), '[]'::jsonb);
END;
$$;

-- ── Profile + settings carry the new fields ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.community_profile(_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  v_me uuid := public.community_main_account(auth.uid());
  v_them uuid := public.community_main_account(_user_id);
  v_mine boolean := v_them = v_me;
  v_blocked boolean;
  v_blocked_by_me boolean;
BEGIN
  IF NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  -- blocked either way: no posts, lists or counts to open (staff still see everything)
  v_blocked := NOT v_mine AND NOT public.community_is_staff(uid) AND v_them IN (SELECT public.community_blocked_authors());
  v_blocked_by_me := NOT v_mine AND EXISTS (
    SELECT 1 FROM public.chat_user_blocks b
     WHERE public.community_main_account(b.user_id) = v_me AND public.community_main_account(b.blocked_user_id) = v_them);
  RETURN jsonb_build_object(
    'blocked', v_blocked,
    'blocked_by_me', v_blocked_by_me,
    'author', public.community_author(_user_id),
    'bio', (SELECT cp.bio FROM public.community_profiles cp WHERE cp.user_id = _user_id),
    'is_me', _user_id = uid,
    'posts', (SELECT count(*) FROM public.community_posts p
               WHERE (p.author_user_id = _user_id OR _user_id = ANY (public.community_post_collab_ids(p.id)))
                 AND p.archived_at IS NULL
                 AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id)),
    'archived', CASE WHEN _user_id = uid OR _user_id = public.community_main_account(uid)
                     THEN (SELECT count(*) FROM public.community_posts p WHERE p.author_user_id = _user_id AND p.archived_at IS NOT NULL) END,
    'training_since', (SELECT min(pc.completed_at) FROM public.pl_day_completions pc
                         JOIN public.clients c ON c.id = pc.client_id
                        WHERE c.user_id = _user_id AND pc.completed_at IS NOT NULL),
    'is_private', public.community_is_private(v_them),
    'can_see', public.community_can_see_account(v_them) AND NOT v_blocked,
    'followers', (SELECT count(*) FROM public.community_follows f WHERE f.followee_id = v_them AND public.community_is_member(f.follower_id)),
    'following', (SELECT count(*) FROM public.community_follows f WHERE f.follower_id = v_them AND public.community_is_member(f.followee_id)),
    'username', (SELECT cp.username::text FROM public.community_profiles cp WHERE cp.user_id = v_them),
    'disciplines', coalesce((SELECT to_jsonb(cp.disciplines) FROM public.community_profiles cp WHERE cp.user_id = v_them), '[]'::jsonb),
    'home_gym', (SELECT cp.home_gym FROM public.community_profiles cp WHERE cp.user_id = v_them),
    -- people you follow who follow them ("Followed by Nicole and 2 others")
    'followed_by', CASE WHEN v_mine OR v_blocked THEN NULL ELSE (
      SELECT jsonb_build_object('count', count(*),
               'names', coalesce((array_agg(public.community_author(m.id)->>'name' ORDER BY m.at DESC))[1:2], '{}'))
        FROM (SELECT f2.follower_id AS id, f2.created_at AS at
                FROM public.community_follows f1
                JOIN public.community_follows f2 ON f2.follower_id = f1.followee_id
               WHERE f1.follower_id = v_me AND f2.followee_id = v_them AND f2.follower_id NOT IN (v_me, v_them)
                 AND public.community_is_member(f2.follower_id)
                 AND NOT public.chat_has_blocked(v_me, f2.follower_id)) m) END);
END;
$$;

CREATE OR REPLACE FUNCTION public.community_my_settings()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'auto_share_workouts', coalesce((SELECT cp.auto_share_workouts FROM public.community_profiles cp WHERE cp.user_id = auth.uid()), true),
    'private_views', coalesce((SELECT cp.private_views FROM public.community_profiles cp WHERE cp.user_id = public.community_main_account(auth.uid())), false),
    'discoverable', coalesce((SELECT cp.discoverable FROM public.community_profiles cp WHERE cp.user_id = public.community_main_account(auth.uid())), true),
    'username', (SELECT cp.username::text FROM public.community_profiles cp WHERE cp.user_id = public.community_main_account(auth.uid())),
    'disciplines', coalesce((SELECT to_jsonb(cp.disciplines) FROM public.community_profiles cp WHERE cp.user_id = public.community_main_account(auth.uid())), '[]'::jsonb),
    'home_gym', (SELECT cp.home_gym FROM public.community_profiles cp WHERE cp.user_id = public.community_main_account(auth.uid())))
  WHERE auth.uid() IS NOT NULL;
$$;

-- ── Blocking reaches the Crew ───────────────────────────────────────────────
-- Accounts the signed-in person blocked or was blocked by (with their linked
-- logins), read once per query as a set. Coaches are never in it: they can't be
-- blocked, and a coach's posts reach every client.
CREATE OR REPLACE FUNCTION public.community_blocked_authors()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH me AS (SELECT public.community_main_account(auth.uid()) AS id),
  mine AS (SELECT me.id FROM me UNION SELECT cp.user_id FROM public.community_profiles cp, me WHERE cp.same_person_as = me.id),
  other AS (
    SELECT public.community_main_account(b.blocked_user_id) AS id FROM public.chat_user_blocks b WHERE b.user_id IN (SELECT id FROM mine)
    UNION
    SELECT public.community_main_account(b.user_id) FROM public.chat_user_blocks b WHERE b.blocked_user_id IN (SELECT id FROM mine))
  SELECT o.id FROM other o WHERE NOT public.community_is_coach(o.id)
  UNION
  SELECT cp.user_id FROM public.community_profiles cp JOIN other o ON cp.same_person_as = o.id WHERE NOT public.community_is_coach(o.id)
$$;
REVOKE ALL ON FUNCTION public.community_blocked_authors() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.community_blocked_authors() TO service_role;

-- The feed (and profiles, and stories, which are read from it): people blocked
-- either way don't see each other's posts. Staff still see everything.
CREATE OR REPLACE FUNCTION public.community_feed(_limit integer DEFAULT 10, _before_at timestamp with time zone DEFAULT NULL::timestamp with time zone, _before_id uuid DEFAULT NULL::uuid, _author_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  lim int := least(greatest(coalesce(_limit, 10), 1), 30);
  result jsonb;
BEGIN
  IF NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  WITH page AS (
    SELECT p.id, p.created_at FROM public.community_posts p
     WHERE (p.visibility = 'community'
            OR (p.visibility = 'coach' AND p.author_user_id <> uid AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id))
            OR (p.visibility = 'followers' AND (p.author_user_id = uid OR (SELECT public.community_is_staff(uid))
                                                OR p.author_user_id IN (SELECT public.community_followed_authors())))
            OR (p.visibility = 'close_friends' AND (p.author_user_id = uid OR (SELECT public.community_is_staff(uid))
                                                    OR p.author_user_id IN (SELECT public.community_close_friend_authors())))
            OR (p.author_user_id = uid AND _author_user_id = uid))
       AND p.archived_at IS NULL
       AND ((SELECT public.community_is_staff(uid)) OR p.author_user_id NOT IN (SELECT public.community_blocked_authors()))
       AND (_author_user_id IS NULL OR p.author_user_id = _author_user_id
            OR _author_user_id = ANY (public.community_post_collab_ids(p.id)))
       AND (_before_at IS NULL OR (p.created_at, p.id) < (_before_at, coalesce(_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
     ORDER BY p.created_at DESC, p.id DESC
     LIMIT lim + 1
  ),
  numbered AS (SELECT page.*, row_number() OVER (ORDER BY page.created_at DESC, page.id DESC) rn FROM page)
  SELECT jsonb_build_object(
           'posts', coalesce((SELECT jsonb_agg(public.community_post_json(n.id, uid) ORDER BY n.rn) FROM numbered n WHERE n.rn <= lim), '[]'::jsonb),
           'has_more', (SELECT count(*) FROM page) > lim)
    INTO result;
  RETURN result;
END;
$function$;

-- The "N new" badge counts what the feed shows.
CREATE OR REPLACE FUNCTION public.community_activity()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  v_seen timestamptz;
BEGIN
  IF NOT public.can_view_community() THEN RETURN jsonb_build_object('unseen', 0, 'seen_at', null, 'enabled', false); END IF;
  SELECT s.seen_at INTO v_seen FROM public.community_seen s WHERE s.user_id = uid;
  RETURN jsonb_build_object(
    'enabled', true,
    'seen_at', v_seen,
    'unseen', (SELECT count(*) FROM (
                 SELECT 1 FROM public.community_posts p
                  WHERE (p.visibility = 'community' OR (p.visibility = 'coach' AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id))
                      OR (p.visibility = 'followers' AND ((SELECT public.community_is_staff(uid)) OR p.author_user_id IN (SELECT public.community_followed_authors())))
                      OR (p.visibility = 'close_friends' AND ((SELECT public.community_is_staff(uid)) OR p.author_user_id IN (SELECT public.community_close_friend_authors()))))
                    AND p.author_user_id <> uid
                    AND NOT coalesce(p.auto_shared, false)
                    AND ((SELECT public.community_is_staff(uid)) OR p.author_user_id NOT IN (SELECT public.community_blocked_authors()))
                    AND p.created_at > coalesce(v_seen, now() - interval '7 days')
                  LIMIT 99) x));
END;
$function$;

-- Everyone in the Crew (the list under Find athletes): blocked people either
-- way are left out, and each row says whether the account is private and its @username.
CREATE OR REPLACE FUNCTION public.community_members()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  tz constant text := 'America/Winnipeg';
  v_week timestamptz := (date_trunc('week', now() AT TIME ZONE tz)::timestamp AT TIME ZONE tz);
BEGIN
  IF uid IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'author', public.community_author(m.user_id),
             'bio', cp.bio,
             'username', cp.username::text,
             'is_private', coalesce(cp.is_private, false),
             'posts', s.posts,
             'last_post_at', s.last_at,
             'live', s.live,
             'trained_at', t.trained_at,
             'week_days', t.week_days,
             'training_since', t.since)
           ORDER BY s.live DESC, (public.community_author(m.user_id)->>'is_coach')::boolean DESC, t.trained_at DESC NULLS LAST,
                    lower(coalesce(public.community_author(m.user_id)->>'name', '')))
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
      CROSS JOIN LATERAL (
        SELECT max(pc.completed_at) FILTER (WHERE pc.completed_at > now() - interval '7 days') AS trained_at,
               coalesce(array_agg(DISTINCT extract(isodow FROM pc.completed_at AT TIME ZONE tz)::int)
                          FILTER (WHERE pc.completed_at >= v_week), '{}') AS week_days,
               min(pc.completed_at) AS since
          FROM public.pl_day_completions pc
          JOIN public.clients c ON c.id = pc.client_id
         WHERE c.user_id = m.user_id AND pc.completed_at IS NOT NULL
      ) t
     WHERE m.user_id <> uid
       AND NOT EXISTS (SELECT 1 FROM public.community_profiles l WHERE l.user_id = m.user_id AND l.same_person_as IS NOT NULL)
       AND m.user_id <> coalesce((SELECT l2.same_person_as FROM public.community_profiles l2 WHERE l2.user_id = uid), uid)
       AND ((SELECT public.community_is_staff(uid)) OR m.user_id NOT IN (SELECT public.community_blocked_authors()))
  ), '[]'::jsonb);
END;
$function$;

-- Following needs no block either way (it fails quietly: the button just stays "Follow").
CREATE OR REPLACE FUNCTION public.community_follow(_user_id uuid, _on boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me uuid := public.community_main_account(auth.uid());
  v_them uuid := public.community_main_account(_user_id);
  v_rows int := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF v_them IS NULL OR v_them = v_me OR NOT public.community_is_member(v_them) THEN
    RAISE EXCEPTION 'That account isn''t in the crew' USING ERRCODE = '22023';
  END IF;
  IF NOT coalesce(_on, true) THEN
    DELETE FROM public.community_follows WHERE follower_id = v_me AND followee_id = v_them;
    DELETE FROM public.community_follow_requests WHERE requester_id = v_me AND target_id = v_them;
    DELETE FROM public.community_notifications WHERE kind = 'follow_request' AND recipient_user_id = v_them AND actor_user_id = v_me;
    RETURN public.community_follow_state();
  END IF;
  IF EXISTS (SELECT 1 FROM public.community_follows f WHERE f.follower_id = v_me AND f.followee_id = v_them) THEN
    RETURN public.community_follow_state();
  END IF;
  IF NOT public.community_is_staff(auth.uid())
     AND (public.chat_has_blocked(v_them, v_me) OR public.chat_has_blocked(v_me, v_them)) THEN
    RETURN public.community_follow_state();
  END IF;
  IF public.community_is_private(v_them) AND NOT public.community_is_staff(auth.uid()) THEN
    INSERT INTO public.community_follow_requests (requester_id, target_id) VALUES (v_me, v_them) ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows > 0 THEN
      DELETE FROM public.community_notifications WHERE kind = 'follow_request' AND recipient_user_id = v_them AND actor_user_id = v_me;
      PERFORM public.community_notify(v_them, v_me, 'follow_request', NULL, NULL, NULL);
    END IF;
    RETURN public.community_follow_state();
  END IF;
  INSERT INTO public.community_follows (follower_id, followee_id) VALUES (v_me, v_them) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows > 0 AND NOT EXISTS (SELECT 1 FROM public.community_notifications n
                                 WHERE n.kind = 'follow' AND n.recipient_user_id = v_them AND n.actor_user_id = v_me) THEN
    PERFORM public.community_notify(v_them, v_me, 'follow', NULL, NULL, NULL);
  END IF;
  RETURN public.community_follow_state();
END;
$function$;

-- ── Grants ──────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.community_findable_people(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.community_username_on_member() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.community_people_search(text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.community_suggestions(uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.community_username_check(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.community_set_username(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.community_set_training(text[], text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.community_set_discoverable(boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.community_hide_suggestion(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.community_gym_names(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_people_search(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.community_suggestions(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.community_username_check(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.community_set_username(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.community_set_training(text[], text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.community_set_discoverable(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.community_hide_suggestion(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.community_gym_names(text) TO authenticated;
