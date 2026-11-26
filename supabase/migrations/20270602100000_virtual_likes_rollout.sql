-- Virtual Crew accounts start liking gradually, and like while a post is fresh.
--
-- A gradual start: one virtual account starts liking, the rest wait in a queue, and the next one
-- starts only when the timing is right: the gap since the last one started has passed
-- (rollout_gap_days, 3 by default), there has been at least one automated like since then (so the
-- system is working and real people are posting; nobody new appears in a quiet week), and it's
-- daytime in Winnipeg (10 AM to 8 PM), at a time that differs day to day. Nothing starts while the
-- global switch or the gradual start is off. An admin can start any account now, move it in the
-- queue or take it out.
--
-- Fresh posts first: of the posts an account may like, newer ones are much likelier (a post's
-- weight halves about every 8 hours), so a like lands while the person who posted is still looking,
-- as real likes do, instead of on a day-old post.

SET lock_timeout = '3s';

ALTER TABLE public.virtual_accounts ADD COLUMN IF NOT EXISTS likes_started_at timestamptz;
ALTER TABLE public.virtual_accounts ADD COLUMN IF NOT EXISTS rollout_position integer;

ALTER TABLE public.virtual_account_activity DROP CONSTRAINT IF EXISTS virtual_account_activity_action_check;
ALTER TABLE public.virtual_account_activity ADD CONSTRAINT virtual_account_activity_action_check
  CHECK (action IN ('created', 'updated', 'activated', 'deactivated', 'likes_on', 'likes_off',
                    'like', 'unlike', 'likes_cleared', 'settings', 'renamed',
                    'rollout_started', 'rollout_queued', 'rollout_unqueued'));

RESET lock_timeout;

-- Accounts already liking keep liking; their start is when likes were switched on (else now).
UPDATE public.virtual_accounts va
   SET likes_started_at = coalesce(
         (SELECT max(a.created_at) FROM public.virtual_account_activity a WHERE a.user_id = va.user_id AND a.action = 'likes_on'),
         now())
 WHERE va.likes_enabled AND va.likes_started_at IS NULL;

/** Switching likes on (by hand or by the gradual start) stamps when it started and takes it out of the queue. */
CREATE OR REPLACE FUNCTION public.tg_virtual_accounts_likes_started()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.likes_enabled AND (TG_OP = 'INSERT' OR NOT OLD.likes_enabled) THEN
    NEW.likes_started_at := now();
    NEW.rollout_position := NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS virtual_accounts_likes_started ON public.virtual_accounts;
CREATE TRIGGER virtual_accounts_likes_started
  BEFORE INSERT OR UPDATE OF likes_enabled ON public.virtual_accounts
  FOR EACH ROW EXECUTE FUNCTION public.tg_virtual_accounts_likes_started();

/* ─────────────────────────── Settings: the gradual start ─────────────────────────── */

CREATE OR REPLACE FUNCTION public.virtual_accounts_settings()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v jsonb;
BEGIN
  BEGIN
    SELECT nullif(btrim(s.value), '')::jsonb INTO v FROM public.app_settings s WHERE s.key = 'virtual_accounts';
  EXCEPTION WHEN others THEN v := NULL;
  END;
  RETURN jsonb_build_object(
    'automation_enabled', coalesce((v->>'automation_enabled')::boolean, false),
    'per_post_max', least(greatest(coalesce((v->>'per_post_max')::int, 2), 1), 5),
    'max_post_age_hours', least(greatest(coalesce((v->>'max_post_age_hours')::int, 36), 6), 96),
    'min_post_age_minutes', least(greatest(coalesce((v->>'min_post_age_minutes')::int, 20), 5), 240),
    'include_coach_posts', coalesce((v->>'include_coach_posts')::boolean, false),
    'rollout_enabled', coalesce((v->>'rollout_enabled')::boolean, false),
    'rollout_gap_days', least(greatest(coalesce((v->>'rollout_gap_days')::int, 3), 1), 14));
END;
$$;
REVOKE ALL ON FUNCTION public.virtual_accounts_settings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.virtual_accounts_settings() TO service_role;

CREATE OR REPLACE FUNCTION public.admin_virtual_settings_set(_patch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_now jsonb;
  v_next jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  v_now := public.virtual_accounts_settings();
  v_next := v_now || (coalesce(_patch, '{}'::jsonb) - ARRAY(SELECT k FROM jsonb_object_keys(coalesce(_patch, '{}'::jsonb)) k
                                                              WHERE k NOT IN ('automation_enabled', 'per_post_max', 'max_post_age_hours',
                                                                              'min_post_age_minutes', 'include_coach_posts',
                                                                              'rollout_enabled', 'rollout_gap_days')));
  INSERT INTO public.app_settings (key, value) VALUES ('virtual_accounts', v_next::text)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  INSERT INTO public.virtual_account_activity (user_id, action, actor_user_id, detail)
  VALUES (auth.uid(), 'settings', auth.uid(), jsonb_build_object('before', v_now, 'after', public.virtual_accounts_settings()));
  RETURN public.virtual_accounts_settings();
END;
$$;
REVOKE ALL ON FUNCTION public.admin_virtual_settings_set(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_virtual_settings_set(jsonb) TO authenticated;

/* ─────────────────────────── The queue ─────────────────────────── */

/**
 * Sets the queue: the accounts listed, in that order, wait their turn; any other account not
 * liking yet leaves the queue. Accounts already liking, or inactive, are never queued (one made
 * inactive while queued is skipped until it's active again). Admins only; kept.
 */
CREATE OR REPLACE FUNCTION public.admin_virtual_rollout_set(_order uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_ids uuid[] := coalesce(_order, '{}');
  v_before jsonb;
BEGIN
  IF NOT public.has_role(v_actor, 'admin') THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT coalesce(jsonb_agg(user_id ORDER BY rollout_position), '[]'::jsonb) INTO v_before
    FROM public.virtual_accounts WHERE rollout_position IS NOT NULL;
  -- positions 1, 2, 3… over the listed accounts not liking yet, in the order given (a repeat counts once)
  UPDATE public.virtual_accounts va
     SET rollout_position = q.pos, updated_by = v_actor, updated_at = now()
    FROM (SELECT t.u, row_number() OVER (ORDER BY min(t.i))::int AS pos
            FROM unnest(v_ids) WITH ORDINALITY AS t(u, i)
            JOIN public.virtual_accounts w ON w.user_id = t.u AND w.active AND NOT w.likes_enabled
           GROUP BY t.u) q
   WHERE va.user_id = q.u
     AND va.rollout_position IS DISTINCT FROM q.pos;
  UPDATE public.virtual_accounts va
     SET rollout_position = NULL, updated_by = v_actor, updated_at = now()
   WHERE va.rollout_position IS NOT NULL AND (va.likes_enabled OR NOT va.active OR NOT (va.user_id = ANY (v_ids)));
  INSERT INTO public.virtual_account_activity (user_id, action, actor_user_id, detail)
  VALUES (v_actor, 'settings', v_actor,
          jsonb_build_object('rollout_before', v_before,
                             'rollout_after', (SELECT coalesce(jsonb_agg(user_id ORDER BY rollout_position), '[]'::jsonb)
                                                 FROM public.virtual_accounts WHERE rollout_position IS NOT NULL)));
  RETURN public.admin_virtual_accounts();
END;
$$;
REVOKE ALL ON FUNCTION public.admin_virtual_rollout_set(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_virtual_rollout_set(uuid[]) TO authenticated;

/**
 * When the next queued account starts, or why it's waiting: the same rule the tick uses, for the
 * admin page. due_after is when the gap has passed; needs_like says no automated like has happened
 * since the last start.
 */
CREATE OR REPLACE FUNCTION public.virtual_rollout_state()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH s AS (SELECT public.virtual_accounts_settings() AS v),
  last AS (
    SELECT max(likes_started_at) AS started FROM public.virtual_accounts WHERE active AND likes_enabled
  ),
  nxt AS (
    SELECT user_id FROM public.virtual_accounts
     WHERE active AND NOT likes_enabled AND rollout_position IS NOT NULL
     ORDER BY rollout_position, created_at LIMIT 1
  )
  SELECT jsonb_build_object(
    'enabled', (s.v->>'rollout_enabled')::boolean AND (s.v->>'automation_enabled')::boolean,
    'gap_days', (s.v->>'rollout_gap_days')::int,
    'next_user_id', (SELECT user_id FROM nxt),
    'queued', (SELECT count(*) FROM public.virtual_accounts WHERE active AND NOT likes_enabled AND rollout_position IS NOT NULL),
    'last_started_at', last.started,
    'due_after', last.started + make_interval(days => (s.v->>'rollout_gap_days')::int),
    'needs_like', last.started IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.virtual_account_activity a
        WHERE a.action = 'like' AND a.actor_user_id IS NULL AND a.created_at > last.started))
  FROM s, last;
$$;
REVOKE ALL ON FUNCTION public.virtual_rollout_state() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.virtual_rollout_state() TO service_role;

CREATE OR REPLACE FUNCTION public.admin_virtual_rollout_state()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT ((SELECT public.has_role(auth.uid(), 'admin')) OR (SELECT public.is_admin_viewer())) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN public.virtual_rollout_state();
END;
$$;
REVOKE ALL ON FUNCTION public.admin_virtual_rollout_state() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_virtual_rollout_state() TO authenticated;

/**
 * One step of the gradual start, from the tick. Starts the next queued account only while the
 * global switch and the gradual start are on, between 10 AM and 8 PM Winnipeg, once the gap since
 * the last start has passed and an automated like has happened since it, and then only by chance
 * (about 1 eligible tick in 6) so the start time differs day to day. Returns who started, or null.
 */
CREATE OR REPLACE FUNCTION public.virtual_accounts_rollout_step()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  st jsonb := public.virtual_rollout_state();
  v_hour integer := extract(hour FROM public.instant_to_local(now(), 'America/Winnipeg'))::int;
  v_next uuid;
  v_pos integer;
BEGIN
  IF NOT coalesce((st->>'enabled')::boolean, false) THEN RETURN NULL; END IF;
  v_next := (st->>'next_user_id')::uuid;
  IF v_next IS NULL THEN RETURN NULL; END IF;
  IF v_hour < 10 OR v_hour >= 20 THEN RETURN NULL; END IF;
  IF st->>'last_started_at' IS NOT NULL THEN
    IF now() < (st->>'due_after')::timestamptz THEN RETURN NULL; END IF;
    IF (st->>'needs_like')::boolean THEN RETURN NULL; END IF;
  END IF;
  IF random() > 0.17 THEN RETURN NULL; END IF;
  SELECT rollout_position INTO v_pos FROM public.virtual_accounts WHERE user_id = v_next;
  UPDATE public.virtual_accounts SET likes_enabled = true, updated_at = now()
   WHERE user_id = v_next AND NOT likes_enabled;
  IF NOT FOUND THEN RETURN NULL; END IF;
  INSERT INTO public.virtual_account_activity (user_id, action, detail)
  VALUES (v_next, 'rollout_started', jsonb_build_object('position', v_pos, 'gap_days', (st->>'gap_days')::int,
                                                        'previous_start', st->'last_started_at'));
  RETURN v_next;
END;
$$;
REVOKE ALL ON FUNCTION public.virtual_accounts_rollout_step() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.virtual_accounts_rollout_step() TO service_role;

/* ─────────────────────────── The admin list carries the rollout ─────────────────────────── */

CREATE OR REPLACE FUNCTION public.admin_virtual_accounts()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT ((SELECT public.has_role(auth.uid(), 'admin')) OR (SELECT public.is_admin_viewer())) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'user_id', va.user_id, 'slug', va.slug, 'first_name', va.first_name, 'last_name', va.last_name,
             'background', va.background, 'notes', va.notes, 'active', va.active, 'likes_enabled', va.likes_enabled,
             'daily_like_limit', va.daily_like_limit, 'quiet_start', va.quiet_start, 'quiet_end', va.quiet_end,
             'bio', cp.bio, 'disciplines', to_jsonb(coalesce(cp.disciplines, '{}')), 'username', cp.username,
             'created_at', va.created_at,
             'name_gender', va.name_gender, 'name_origin', va.name_origin, 'name_source', va.name_source,
             'name_set_at', va.name_set_at,
             'name_problem', public.virtual_name_problem(va.first_name, coalesce(va.last_name, ''), va.user_id),
             'likes_started_at', va.likes_started_at, 'rollout_position', va.rollout_position,
             'likes_24h', (SELECT count(*) FROM public.virtual_account_activity a
                            WHERE a.user_id = va.user_id AND a.action = 'like' AND a.created_at > now() - interval '24 hours'),
             'likes_total', (SELECT count(*) FROM public.community_reactions r WHERE r.user_id = va.user_id),
             'followers', (SELECT count(*) FROM public.community_follows f WHERE f.followee_id = va.user_id),
             'last_like_at', (SELECT max(a.created_at) FROM public.virtual_account_activity a WHERE a.user_id = va.user_id AND a.action = 'like')
           ) ORDER BY va.likes_started_at NULLS LAST, va.rollout_position NULLS LAST, va.created_at), '[]'::jsonb)
      FROM public.virtual_accounts va
      LEFT JOIN public.community_profiles cp ON cp.user_id = va.user_id
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_virtual_accounts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_virtual_accounts() TO authenticated;

/* ─────────────────────────── The tick: the gradual start, then fresh posts first ─────────────────────────── */

/**
 * Every 20 minutes: any placeholder name is corrected first; then, while the global switch is on,
 * the gradual start may start the next queued account; then each active virtual account with likes
 * on may like one recent crew-wide post by a real person (never a virtual account's, a story, an
 * automatic workout card, a followers-only or Close Friends post, a post whose author blocked it,
 * or one that already has the most virtual likes a post may get), outside its quiet hours
 * (Winnipeg), at most its daily limit and one an account per 45 minutes, by chance so it doesn't
 * run like a clock, fresher posts much likelier. A like is never a notification.
 */
CREATE OR REPLACE FUNCTION public.virtual_accounts_tick()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  s jsonb := public.virtual_accounts_settings();
  v record;
  v_hour integer;
  v_post uuid;
  v_n integer := 0;
  v_quiet boolean;
BEGIN
  IF EXISTS (SELECT 1 FROM public.virtual_accounts va WHERE public.virtual_name_placeholder(va.first_name, va.last_name) IS NOT NULL) THEN
    PERFORM public.virtual_accounts_fix_placeholder_names();
  END IF;
  IF NOT (s->>'automation_enabled')::boolean THEN RETURN 0; END IF;
  PERFORM public.virtual_accounts_rollout_step();
  v_hour := extract(hour FROM public.instant_to_local(now(), 'America/Winnipeg'))::int;
  FOR v IN SELECT * FROM public.virtual_accounts WHERE active AND likes_enabled AND daily_like_limit > 0 ORDER BY random() LOOP
    v_quiet := CASE
      WHEN v.quiet_start = v.quiet_end THEN false
      WHEN v.quiet_start > v.quiet_end THEN v_hour >= v.quiet_start OR v_hour < v.quiet_end
      ELSE v_hour >= v.quiet_start AND v_hour < v.quiet_end END;
    CONTINUE WHEN v_quiet;
    CONTINUE WHEN (SELECT count(*) FROM public.virtual_account_activity a
                    WHERE a.user_id = v.user_id AND a.action = 'like' AND a.actor_user_id IS NULL
                      AND a.created_at > now() - interval '24 hours') >= v.daily_like_limit;
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.virtual_account_activity a
                           WHERE a.user_id = v.user_id AND a.action = 'like' AND a.created_at > now() - interval '45 minutes');
    CONTINUE WHEN random() > least(1.0, v.daily_like_limit::numeric / 40.0);
    SELECT p.id INTO v_post
      FROM public.community_posts p
     WHERE p.archived_at IS NULL
       AND p.visibility = 'community'
       AND NOT coalesce(p.story_only, false)
       AND NOT coalesce(p.auto_shared, false)
       AND p.author_user_id IS NOT NULL
       AND p.created_at > now() - make_interval(hours => (s->>'max_post_age_hours')::int)
       AND p.created_at < now() - make_interval(mins => (s->>'min_post_age_minutes')::int)
       AND NOT EXISTS (SELECT 1 FROM public.virtual_accounts va WHERE va.user_id = p.author_user_id)
       AND ((s->>'include_coach_posts')::boolean
            OR (p.series IS NULL AND p.author_user_id NOT IN (SELECT x FROM public.community_staff_people() x WHERE x IS NOT NULL)))
       AND NOT EXISTS (SELECT 1 FROM public.community_reactions r WHERE r.post_id = p.id AND r.user_id = v.user_id)
       AND (SELECT count(*) FROM public.community_reactions r JOIN public.virtual_accounts va ON va.user_id = r.user_id
             WHERE r.post_id = p.id) < (s->>'per_post_max')::int
       AND NOT public.chat_has_blocked(p.author_user_id, v.user_id)
     -- fresher first: a weighted draw where a post's weight halves about every 8 hours
     ORDER BY -ln(1.0 - random()) / exp(-extract(epoch FROM now() - p.created_at) / 41544.0)
     LIMIT 1;
    CONTINUE WHEN v_post IS NULL;
    INSERT INTO public.community_reactions (post_id, user_id, emoji) VALUES (v_post, v.user_id, 'heart')
    ON CONFLICT DO NOTHING;
    IF FOUND THEN
      INSERT INTO public.virtual_account_activity (user_id, action, post_id, detail)
      VALUES (v.user_id, 'like', v_post, '{"by":"automation"}'::jsonb);
      v_n := v_n + 1;
    END IF;
  END LOOP;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.virtual_accounts_tick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.virtual_accounts_tick() TO service_role;
