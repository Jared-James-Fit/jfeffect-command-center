-- Photos and videos on every kind of post, with the same rules as a shared
-- workout (up to 10, at most 3 of them videos, every new file the uploader's
-- own): the coach's "+ Post", scheduled birthday and daily posts, and
-- swapping the photos on a post you made, any time.
--
-- Points never move: they are awarded by trigger on visibility / archive /
-- kind / client changes only (athlete_xp_events), and nothing here touches
-- those columns.

-- ── One media list, checked the same way everywhere ────────────────────────
-- _keep: files already on the post / draft, which may stay even if someone
-- else uploaded them (a coach editing a co-coach's draft, a linked account).
CREATE OR REPLACE FUNCTION public.community_clean_media(_media jsonb, _uid uuid, _keep jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  v_prefix text := _uid::text || '/';
  v_keep jsonb := coalesce(_keep, '[]'::jsonb);
  v_out jsonb;
BEGIN
  IF _media IS NULL THEN RETURN '[]'::jsonb; END IF;
  IF jsonb_typeof(_media) <> 'array' THEN RAISE EXCEPTION 'Invalid media'; END IF;
  IF jsonb_array_length(_media) > 10 THEN RAISE EXCEPTION 'Up to 10 photos or videos on a post'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'path', x.e->>'path', 'thumb', nullif(x.e->>'thumb', ''), 'type', x.e->>'type',
           'width', CASE WHEN x.e->>'width' ~ '^[0-9]{1,5}(\.[0-9]+)?$' THEN round((x.e->>'width')::numeric)::int END,
           'height', CASE WHEN x.e->>'height' ~ '^[0-9]{1,5}(\.[0-9]+)?$' THEN round((x.e->>'height')::numeric)::int END)
         ORDER BY x.i), '[]'::jsonb)
    INTO v_out
    FROM jsonb_array_elements(_media) WITH ORDINALITY AS x(e, i);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_out) e
              WHERE e->>'type' IS NULL OR e->>'type' NOT IN ('image', 'video') OR e->>'path' IS NULL
                 OR (left(e->>'path', length(v_prefix)) <> v_prefix
                     AND NOT v_keep @> jsonb_build_array(jsonb_build_object('path', e->>'path')))
                 OR (e->>'thumb' IS NOT NULL AND left(e->>'thumb', length(v_prefix)) <> v_prefix
                     AND NOT v_keep @> jsonb_build_array(jsonb_build_object('thumb', e->>'thumb')))) THEN
    RAISE EXCEPTION 'Invalid media';
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(v_out) e WHERE e->>'type' = 'video') > 3 THEN
    RAISE EXCEPTION 'Up to 3 videos on a post';
  END IF;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.community_clean_media(jsonb, uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- A post's photos as one list: the cover first, then the rest.
CREATE OR REPLACE FUNCTION public.community_post_media_list(_post_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN p.media_path IS NULL THEN p.extra_media
              ELSE jsonb_build_array(jsonb_build_object('path', p.media_path, 'thumb', p.media_thumb_path, 'type', p.media_type,
                                                        'width', p.media_width, 'height', p.media_height)) || p.extra_media END
    FROM public.community_posts p WHERE p.id = _post_id
$$;
REVOKE ALL ON FUNCTION public.community_post_media_list(uuid) FROM PUBLIC, anon, authenticated;

-- Put a (checked) list on a post: the first is the cover, the rest slides.
CREATE OR REPLACE FUNCTION public.community_apply_media(_post_id uuid, _media jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.community_posts p
     SET media_path = _media->0->>'path', media_thumb_path = _media->0->>'thumb', media_type = _media->0->>'type',
         media_width = (_media->0->>'width')::int, media_height = (_media->0->>'height')::int,
         extra_media = CASE WHEN jsonb_array_length(_media) > 1 THEN _media - 0 ELSE '[]'::jsonb END,
         updated_at = now()
   WHERE p.id = _post_id
$$;
REVOKE ALL ON FUNCTION public.community_apply_media(uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- ── Swap the photos on a post, any time ────────────────────────────────────
-- Its author (either linked account) on any post; staff on a coach note.
-- Caption, audience and archive state stay as they are.
CREATE OR REPLACE FUNCTION public.community_set_post_media(_post_id uuid, _media jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  v_kind text;
  v_media jsonb;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT p.kind INTO v_kind FROM public.community_posts p WHERE p.id = _post_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Post not found'; END IF;
  IF NOT (public.community_is_post_author(_post_id) OR (v_kind = 'note' AND public.is_community_staff())) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  v_media := public.community_clean_media(coalesce(_media, '[]'::jsonb), uid, public.community_post_media_list(_post_id));
  PERFORM public.community_apply_media(_post_id, v_media);
  UPDATE public.community_posts SET edited_at = now() WHERE id = _post_id;
  RETURN jsonb_build_object('id', _post_id, 'media', v_media);
END;
$$;
REVOKE ALL ON FUNCTION public.community_set_post_media(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_set_post_media(uuid, jsonb) TO authenticated;

-- ── The coach's "+ Post" can carry photos ──────────────────────────────────
-- (rebuilt from 20261023090000_community_polls; _media is new)
DROP FUNCTION IF EXISTS public.community_create_note(text, text[]);
CREATE OR REPLACE FUNCTION public.community_create_note(_body text, _poll text[] DEFAULT NULL, _media jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  v_author uuid;
  v_body text := btrim(coalesce(_body, ''));
  v_id uuid;
  v_opts text[];
  v_media jsonb;
BEGIN
  IF uid IS NULL OR NOT public.community_is_coach(uid) THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF v_body = '' OR char_length(v_body) > 1200 THEN RAISE EXCEPTION 'Write 1–1200 characters'; END IF;
  IF _poll IS NOT NULL THEN
    SELECT array_agg(btrim(u.x) ORDER BY u.i) INTO v_opts
      FROM unnest(_poll) WITH ORDINALITY AS u(x, i)
     WHERE btrim(coalesce(u.x, '')) <> '';
    IF coalesce(array_length(v_opts, 1), 0) NOT BETWEEN 2 AND 4 THEN RAISE EXCEPTION 'A poll needs 2 to 4 options'; END IF;
    IF EXISTS (SELECT 1 FROM unnest(v_opts) AS o(x) WHERE char_length(o.x) > 60) THEN RAISE EXCEPTION 'Keep each option to 60 characters'; END IF;
    IF (SELECT count(DISTINCT lower(o.x)) FROM unnest(v_opts) AS o(x)) < array_length(v_opts, 1) THEN RAISE EXCEPTION 'Each option needs to be different'; END IF;
  END IF;
  v_media := public.community_clean_media(_media, uid);
  v_author := public.community_main_account(uid);
  INSERT INTO public.community_posts (author_user_id, client_id, kind, visibility, caption)
  VALUES (v_author, (SELECT c.id FROM public.clients c WHERE c.user_id = v_author LIMIT 1), 'note', 'community', v_body)
  RETURNING id INTO v_id;
  IF jsonb_array_length(v_media) > 0 THEN PERFORM public.community_apply_media(v_id, v_media); END IF;
  IF v_opts IS NOT NULL THEN
    INSERT INTO public.community_poll_options (post_id, pos, label)
    SELECT v_id, u.i, u.x FROM unnest(v_opts) WITH ORDINALITY AS u(x, i);
  END IF;
  RETURN jsonb_build_object('id', v_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.community_create_note(text, text[], jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_create_note(text, text[], jsonb) TO authenticated;

-- ── Birthday posts carry photos ────────────────────────────────────────────
ALTER TABLE public.community_birthday_posts ADD COLUMN IF NOT EXISTS media jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.community_birthday_posts DROP CONSTRAINT IF EXISTS community_birthday_posts_media_check;
ALTER TABLE public.community_birthday_posts ADD CONSTRAINT community_birthday_posts_media_check
  CHECK (jsonb_typeof(media) = 'array' AND jsonb_array_length(media) <= 10);
CREATE INDEX IF NOT EXISTS community_birthday_posts_media ON public.community_birthday_posts USING gin (media jsonb_path_ops);

-- (rebuilt from 20261014120000_community_birthday_posts; 'media' is new)
CREATE OR REPLACE FUNCTION public.community_birthday_json(b public.community_birthday_posts)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id', b.id, 'client_id', b.client_id, 'birthday', b.birthday, 'birthday_year', b.birthday_year,
    'status', b.status, 'post_at', b.post_at, 'body', b.body, 'dm_body', b.dm_body, 'media', b.media,
    'post_id', b.post_id, 'message_id', b.message_id, 'posted_at', b.posted_at,
    'person', (SELECT jsonb_build_object(
                 'name', coalesce(nullif(btrim(c.preferred_name), ''), nullif(btrim(c.first_name), ''), 'Client'),
                 'full_name', coalesce(nullif(btrim(c.full_name), ''), btrim(concat_ws(' ', c.first_name, c.last_name))),
                 'avatar_url', public.community_author(c.user_id) ->> 'avatar_url',
                 'timezone', c.timezone)
                 FROM public.clients c WHERE c.id = b.client_id))
$$;
REVOKE ALL ON FUNCTION public.community_birthday_json(public.community_birthday_posts) FROM PUBLIC, anon, authenticated;

-- (rebuilt from 20261014120000_community_birthday_posts; the photos go on the post)
CREATE OR REPLACE FUNCTION public.community_birthday_publish_row(_id uuid)
RETURNS public.community_birthday_posts LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b public.community_birthday_posts;
  v_author uuid;
  v_post uuid;
  v_msg uuid;
BEGIN
  SELECT * INTO b FROM public.community_birthday_posts WHERE id = _id FOR UPDATE;
  IF NOT FOUND OR b.status <> 'scheduled' OR b.approved_by IS NULL THEN RETURN b; END IF;
  v_author := public.community_main_account(b.approved_by);
  INSERT INTO public.community_posts (author_user_id, client_id, kind, visibility, caption)
  VALUES (v_author, (SELECT c.id FROM public.clients c WHERE c.user_id = v_author LIMIT 1), 'note', 'community', b.body)
  RETURNING id INTO v_post;
  IF jsonb_array_length(b.media) > 0 THEN PERFORM public.community_apply_media(v_post, b.media); END IF;
  INSERT INTO public.messages (client_id, sender_id, sender_role, body, attachments, message_type, is_internal_note, read_by_admin_at)
  VALUES (b.client_id, b.approved_by, 'admin', b.dm_body,
    jsonb_build_array(jsonb_build_object(
      'type', 'link', 'kind', 'community_post', 'post_id', v_post,
      'url', '/portal/community#post=' || v_post,
      'name', '🎂 Your birthday post', 'title', 'Your birthday post',
      'request_note', split_part(b.body, E'\n', 1))),
    'General', false, now())
  RETURNING id INTO v_msg;
  INSERT INTO public.client_birthday_wishes (client_id, birthday_year, wished_by)
  VALUES (b.client_id, b.birthday_year, b.approved_by)
  ON CONFLICT (client_id, birthday_year) DO NOTHING;
  UPDATE public.community_birthday_posts
     SET status = 'posted', post_id = v_post, message_id = v_msg, posted_at = now(), updated_at = now()
   WHERE id = _id
  RETURNING * INTO b;
  RETURN b;
END;
$$;
REVOKE ALL ON FUNCTION public.community_birthday_publish_row(uuid) FROM PUBLIC, anon, authenticated;

-- (rebuilt from 20261014120000_community_birthday_posts; _media is new:
-- NULL keeps the photos, a list replaces them; fresh wording keeps them)
DROP FUNCTION IF EXISTS public.community_birthday_act(uuid, text, text, text);
CREATE OR REPLACE FUNCTION public.community_birthday_act(_id uuid, _action text, _body text DEFAULT NULL, _dm_body text DEFAULT NULL, _media jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  b public.community_birthday_posts;
  v_body text := nullif(btrim(coalesce(_body, '')), '');
  v_dm text := nullif(btrim(coalesce(_dm_body, '')), '');
  v_comp jsonb;
  v_media jsonb;
BEGIN
  IF NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF _action NOT IN ('save', 'reroll', 'approve', 'post_now', 'unschedule', 'skip') THEN RAISE EXCEPTION 'Unknown action'; END IF;
  SELECT * INTO b FROM public.community_birthday_posts WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not found'; END IF;
  IF b.status = 'posted' THEN RAISE EXCEPTION 'Already posted'; END IF;
  IF v_body IS NOT NULL AND char_length(v_body) > 1200 THEN RAISE EXCEPTION 'Post is too long'; END IF;
  IF v_dm IS NOT NULL AND char_length(v_dm) > 1000 THEN RAISE EXCEPTION 'Message is too long'; END IF;
  v_media := CASE WHEN _media IS NULL THEN b.media ELSE public.community_clean_media(_media, uid, b.media) END;

  IF _action = 'reroll' THEN
    v_comp := public.community_birthday_compose(b.client_id, b.slot + 1, nullif(b.facts, '{}'::jsonb));
    UPDATE public.community_birthday_posts
       SET slot = b.slot + 1, body = v_comp ->> 'body', dm_body = v_comp ->> 'dm_body', updated_at = now()
     WHERE id = _id RETURNING * INTO b;
  ELSIF _action = 'skip' THEN
    UPDATE public.community_birthday_posts SET status = 'skipped', updated_at = now() WHERE id = _id RETURNING * INTO b;
  ELSIF _action = 'unschedule' THEN
    UPDATE public.community_birthday_posts SET status = 'ready', approved_by = NULL, approved_at = NULL, updated_at = now()
     WHERE id = _id RETURNING * INTO b;
  ELSE
    UPDATE public.community_birthday_posts
       SET body = coalesce(v_body, body), dm_body = coalesce(v_dm, dm_body), media = v_media, updated_at = now(),
           status = CASE WHEN _action IN ('approve', 'post_now') THEN 'scheduled' ELSE status END,
           approved_by = CASE WHEN _action IN ('approve', 'post_now') THEN uid ELSE approved_by END,
           approved_at = CASE WHEN _action IN ('approve', 'post_now') THEN now() ELSE approved_at END
     WHERE id = _id RETURNING * INTO b;
    IF _action = 'post_now' OR (_action = 'approve' AND b.post_at <= now()) THEN
      b := public.community_birthday_publish_row(_id);
    END IF;
  END IF;
  RETURN public.community_birthday_json(b);
END;
$$;
REVOKE ALL ON FUNCTION public.community_birthday_act(uuid, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_birthday_act(uuid, text, text, text, jsonb) TO authenticated;

-- ── Daily posts: photos for the next one ───────────────────────────────────
-- Photos on a library post go out with its next run, once (the text stays
-- in the library as before).
ALTER TABLE public.community_series_items ADD COLUMN IF NOT EXISTS media jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.community_series_items DROP CONSTRAINT IF EXISTS community_series_items_media_check;
ALTER TABLE public.community_series_items ADD CONSTRAINT community_series_items_media_check
  CHECK (jsonb_typeof(media) = 'array' AND jsonb_array_length(media) <= 10);
CREATE INDEX IF NOT EXISTS community_series_items_media ON public.community_series_items USING gin (media jsonb_path_ops);

-- (rebuilt from 20261008090000_community_coach_posts; _media is new: NULL keeps them)
DROP FUNCTION IF EXISTS public.community_series_update_item(uuid, text, boolean);
CREATE OR REPLACE FUNCTION public.community_series_update_item(_id uuid, _body text, _active boolean DEFAULT true, _media jsonb DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_body text := btrim(coalesce(_body, ''));
BEGIN
  IF NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF v_body = '' OR char_length(v_body) > 1200 THEN RAISE EXCEPTION 'Write 1–1200 characters'; END IF;
  UPDATE public.community_series_items i
     SET body = v_body, active = coalesce(_active, true), updated_at = now(),
         media = CASE WHEN _media IS NULL THEN i.media ELSE public.community_clean_media(_media, auth.uid(), i.media) END
   WHERE i.id = _id;
END;
$$;
REVOKE ALL ON FUNCTION public.community_series_update_item(uuid, text, boolean, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_series_update_item(uuid, text, boolean, jsonb) TO authenticated;

-- (rebuilt from 20261017090000_community_week_series; 'media' is new on next)
CREATE OR REPLACE FUNCTION public.community_series_overview()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c_days constant text[] := ARRAY['monday_motivation', 'tuesday_tips', 'wednesday_wins', 'try_it_thursday',
                                  'finish_strong_friday', 'saturday_spirit', 'sunday_recap'];
  c_libs constant text[] := ARRAY['monday_motivation', 'tuesday_tips', 'try_it_thursday', 'finish_strong_friday', 'saturday_spirit'];
  v_settings record;
  v_local timestamp := now() AT TIME ZONE 'America/Winnipeg';
  v_wk text := to_char(now() AT TIME ZONE 'America/Winnipeg', 'IYYY-"W"IW');
  v_wins_posted boolean;
  v_preview jsonb;
BEGIN
  IF NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_settings FROM public.community_series_settings WHERE id;
  v_wins_posted := EXISTS (SELECT 1 FROM public.community_series_runs r WHERE r.series_key = 'wednesday_wins:' || v_wk);
  v_preview := public.community_compose_wins(date_trunc('week', v_local)::date - CASE WHEN v_wins_posted THEN 0 ELSE 7 END,
                                              public.community_main_account(v_settings.author_user_id));
  RETURN jsonb_build_object(
    'wins_preview', CASE WHEN v_preview IS NOT NULL THEN jsonb_build_object('body', v_preview->>'caption', 'featured', jsonb_array_length(v_preview->'featured'),
                                                                             'trainers', v_preview->'trainers', 'week_of', v_preview->>'week_of', 'next_week', v_wins_posted,
                                                                             'stats', v_preview->'stats') END,
    'paused', coalesce(v_settings.paused, false),
    'author', CASE WHEN v_settings.author_user_id IS NOT NULL THEN public.community_author(v_settings.author_user_id) END,
    'next', coalesce((SELECT jsonb_object_agg(s.series, jsonb_build_object('id', n.id, 'mentor', n.mentor, 'body', n.body,
                                                                           'quote', n.quote, 'quote_source', n.quote_source, 'data', n.data,
                                                                           'media', n.media))
                        FROM unnest(c_libs) s(series)
                        CROSS JOIN LATERAL public.community_series_next(s.series) n
                       WHERE n.id IS NOT NULL), '{}'::jsonb),
    'library', (SELECT jsonb_object_agg(s.series, (SELECT count(*) FROM public.community_series_items i WHERE i.series = s.series AND i.active))
                  FROM unnest(c_libs) s(series)),
    'history', coalesce((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'series', p.series, 'created_at', p.created_at,
                                                             'mentor', i.mentor, 'caption', left(p.caption, 120))
                                          ORDER BY p.created_at DESC)
                           FROM (SELECT * FROM public.community_posts WHERE series IS NOT NULL ORDER BY created_at DESC LIMIT 8) p
                           LEFT JOIN public.community_series_items i ON i.id = p.series_item_id), '[]'::jsonb),
    'this_week', (SELECT jsonb_object_agg(s.series, EXISTS (SELECT 1 FROM public.community_series_runs r WHERE r.series_key = s.series || ':' || v_wk))
                    FROM unnest(c_days) s(series)));
END;
$$;
REVOKE ALL ON FUNCTION public.community_series_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_series_overview() TO authenticated;

-- (rebuilt from 20261017090000_community_week_series; the library branch
-- puts the item's photos on the post, then clears them from the item)
CREATE OR REPLACE FUNCTION public.community_publish_series(_series text DEFAULT NULL, _force boolean DEFAULT false, _at timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c_days constant text[] := ARRAY['monday_motivation', 'tuesday_tips', 'wednesday_wins', 'try_it_thursday',
                                  'finish_strong_friday', 'saturday_spirit', 'sunday_recap'];
  v_local timestamp := (coalesce(_at, now()) AT TIME ZONE 'America/Winnipeg');
  v_dow int := extract(isodow FROM v_local);
  v_series text := coalesce(_series, c_days[extract(isodow FROM (coalesce(_at, now()) AT TIME ZONE 'America/Winnipeg'))::int]);
  v_settings record;
  v_author uuid;
  v_key text;
  v_item record;
  v_id uuid;
  v_start time;
  v_end time;
  v_comp jsonb;
  v_caption text;
  v_data jsonb;
  v_stat jsonb;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_community_staff() THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF NOT v_series = ANY (c_days) THEN RAISE EXCEPTION 'Unknown series'; END IF;
  v_start := CASE v_series
    WHEN 'monday_motivation' THEN time '07:00' WHEN 'finish_strong_friday' THEN time '07:00'
    WHEN 'saturday_spirit' THEN time '09:00' WHEN 'sunday_recap' THEN time '19:00'
    ELSE time '12:00' END;
  v_end := CASE WHEN v_start >= time '19:00' THEN time '23:59:59' ELSE v_start + interval '5 hours' END;
  IF NOT coalesce(_force, false) THEN
    IF v_dow <> array_position(c_days, v_series) OR v_local::time < v_start OR v_local::time >= v_end THEN
      RETURN jsonb_build_object('status', 'outside_window');
    END IF;
  END IF;

  SELECT * INTO v_settings FROM public.community_series_settings WHERE id;
  IF coalesce(v_settings.paused, false) THEN RETURN jsonb_build_object('status', 'paused'); END IF;
  v_author := public.community_main_account(v_settings.author_user_id);
  IF v_author IS NULL THEN RETURN jsonb_build_object('status', 'no_author'); END IF;

  v_key := v_series || ':' || to_char(v_local, 'IYYY-"W"IW');
  IF EXISTS (SELECT 1 FROM public.community_series_runs r WHERE r.series_key = v_key) THEN
    RETURN jsonb_build_object('status', 'exists', 'key', v_key);
  END IF;

  -- Built from the logs: Wednesday (last week's shout-outs) and Sunday (this week's report card).
  IF v_series IN ('wednesday_wins', 'sunday_recap') THEN
    IF v_series = 'wednesday_wins' THEN
      v_comp := public.community_compose_wins((date_trunc('week', v_local)::date - 7), v_author);
      IF v_comp IS NULL THEN RETURN jsonb_build_object('status', 'no_wins'); END IF;
      -- Sunday already showed that week's numbers: Wednesday is the shout-outs.
      v_data := CASE WHEN EXISTS (SELECT 1 FROM public.community_series_runs r
                                   WHERE r.series_key = 'sunday_recap:' || to_char(date_trunc('week', v_local)::date - 1, 'IYYY-"W"IW'))
                     THEN NULL ELSE v_comp->'stats' END;
    ELSE
      v_comp := public.community_compose_recap(date_trunc('week', v_local)::date, v_author);
      IF v_comp IS NULL THEN RETURN jsonb_build_object('status', 'no_wins'); END IF;
      v_data := v_comp->'stats';
    END IF;
    INSERT INTO public.community_series_runs (series_key, series) VALUES (v_key, v_series) ON CONFLICT (series_key) DO NOTHING;
    IF NOT FOUND THEN RETURN jsonb_build_object('status', 'exists', 'key', v_key); END IF;
    INSERT INTO public.community_posts (author_user_id, client_id, kind, visibility, caption, series, series_key, series_data, created_at)
    VALUES (v_author, (SELECT c.id FROM public.clients c WHERE c.user_id = v_author LIMIT 1), 'note', 'community',
            v_comp->>'caption', v_series, v_key, v_data, coalesce(_at, now()))
    RETURNING id INTO v_id;
    UPDATE public.community_series_runs SET post_id = v_id WHERE series_key = v_key;
    -- Sunday's top 3 count as featured too, so Wednesday spreads the shout-outs to others.
    INSERT INTO public.community_series_features (series_key, client_id, win_type, featured_at)
    SELECT v_key, (f->>'client_id')::uuid, f->>'type', coalesce(_at, now()) FROM jsonb_array_elements(coalesce(v_comp->'featured', '[]'::jsonb)) f
    ON CONFLICT DO NOTHING;
    RETURN jsonb_build_object('status', 'published', 'post_id', v_id, 'key', v_key);
  END IF;

  -- Tuesday: the crew's own data when it says something real, else the library.
  IF v_series = 'tuesday_tips' THEN
    v_comp := public.community_compose_observation(v_author);
    IF v_comp IS NOT NULL THEN
      INSERT INTO public.community_series_runs (series_key, series) VALUES (v_key, v_series) ON CONFLICT (series_key) DO NOTHING;
      IF NOT FOUND THEN RETURN jsonb_build_object('status', 'exists', 'key', v_key); END IF;
      INSERT INTO public.community_posts (author_user_id, client_id, kind, visibility, caption, series, series_key, series_data, created_at)
      VALUES (v_author, (SELECT c.id FROM public.clients c WHERE c.user_id = v_author LIMIT 1), 'note', 'community',
              v_comp->>'caption', v_series, v_key, v_comp - 'caption', coalesce(_at, now()))
      RETURNING id INTO v_id;
      UPDATE public.community_series_runs SET post_id = v_id WHERE series_key = v_key;
      RETURN jsonb_build_object('status', 'published', 'post_id', v_id, 'key', v_key, 'observation', v_comp->>'observation');
    END IF;
  END IF;

  -- The libraries.
  SELECT * INTO v_item FROM public.community_series_next(v_series);
  IF v_item.id IS NULL THEN RETURN jsonb_build_object('status', 'no_items'); END IF;

  v_caption := v_item.body;
  v_data := v_item.data;
  IF v_series = 'try_it_thursday' THEN
    v_stat := public.community_feature_stat(v_item.data, v_author);
    IF v_stat IS NOT NULL THEN
      v_caption := v_caption || E'\n\n📊 ' || (v_stat->>'line');
      v_data := coalesce(v_data, '{}'::jsonb) || jsonb_build_object('stat', v_stat - 'line');
    END IF;
  END IF;

  INSERT INTO public.community_series_runs (series_key, series, item_id) VALUES (v_key, v_series, v_item.id)
  ON CONFLICT (series_key) DO NOTHING;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'exists', 'key', v_key); END IF;

  INSERT INTO public.community_posts (author_user_id, client_id, kind, visibility, caption, quote, quote_author, quote_source,
                                      series, series_key, series_item_id, series_data, created_at)
  VALUES (v_author, (SELECT c.id FROM public.clients c WHERE c.user_id = v_author LIMIT 1), 'note', 'community', v_caption,
          v_item.quote, CASE WHEN v_item.quote IS NOT NULL THEN v_item.mentor END, v_item.quote_source,
          v_series, v_key, v_item.id, v_data, coalesce(_at, now()))
  ON CONFLICT (series_key) WHERE series_key IS NOT NULL DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN jsonb_build_object('status', 'exists', 'key', v_key); END IF;
  IF jsonb_array_length(coalesce(v_item.media, '[]'::jsonb)) > 0 THEN PERFORM public.community_apply_media(v_id, v_item.media); END IF;

  UPDATE public.community_series_runs SET post_id = v_id WHERE series_key = v_key;
  UPDATE public.community_series_items SET last_used_at = coalesce(_at, now()), use_count = use_count + 1, media = '[]'::jsonb WHERE id = v_item.id;
  RETURN jsonb_build_object('status', 'published', 'post_id', v_id, 'key', v_key, 'mentor', v_item.mentor);
END;
$$;
REVOKE ALL ON FUNCTION public.community_publish_series(text, boolean, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_publish_series(text, boolean, timestamptz) TO authenticated;

-- ── Staff can see photos waiting on a draft ────────────────────────────────
-- Before a birthday or daily post goes out, its files belong to no post, so
-- only the uploader could load them. Every coach can preview them. The
-- storage policy is unchanged; it already asks this function (rebuilt from
-- 20261020090000_community_carousel; the staff draft check is new).
CREATE OR REPLACE FUNCTION public.community_post_media_readable(_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.community_posts p
                  WHERE (p.media_path = _name OR p.media_thumb_path = _name
                         OR p.extra_media @> jsonb_build_array(jsonb_build_object('path', _name))
                         OR p.extra_media @> jsonb_build_array(jsonb_build_object('thumb', _name)))
                    AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id))
      OR (public.is_community_staff() AND (
            EXISTS (SELECT 1 FROM public.community_birthday_posts b
                     WHERE b.status IN ('ready', 'scheduled')
                       AND (b.media @> jsonb_build_array(jsonb_build_object('path', _name))
                            OR b.media @> jsonb_build_array(jsonb_build_object('thumb', _name))))
         OR EXISTS (SELECT 1 FROM public.community_series_items i
                     WHERE i.media @> jsonb_build_array(jsonb_build_object('path', _name))
                        OR i.media @> jsonb_build_array(jsonb_build_object('thumb', _name)))))
$$;
REVOKE ALL ON FUNCTION public.community_post_media_readable(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_post_media_readable(text) TO authenticated;
