-- Birthday posts: the dashboard card is never empty any more.
--
-- Drafts still land the evening before (5pm Winnipeg, with a push), but the
-- card now also shows who's next and when their draft lands, and "Write it
-- now" drafts one early (same composer, same review sheet, still nothing
-- goes out until it's approved).

/** The next few birthdays that don't have a draft yet. */
CREATE OR REPLACE FUNCTION public.community_birthdays_next(_limit int DEFAULT 3)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE tz constant text := 'America/Winnipeg';
BEGIN
  IF NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(s.j ORDER BY s.day) FROM (
      SELECT b.day, jsonb_build_object(
               'client_id', c.id,
               'birthday', b.day,
               'days', b.day - l.ld,
               'draft_at', ((b.day - 1)::timestamp + time '17:00') AT TIME ZONE tz,
               'person', jsonb_build_object(
                 'name', coalesce(nullif(btrim(c.preferred_name), ''), nullif(btrim(c.first_name), ''), 'Client'),
                 'full_name', coalesce(nullif(btrim(c.full_name), ''), btrim(concat_ws(' ', c.first_name, c.last_name))),
                 'avatar_url', public.community_author(c.user_id) ->> 'avatar_url')) AS j
        FROM public.clients c
        CROSS JOIN LATERAL (SELECT (now() AT TIME ZONE coalesce(nullif(c.timezone, ''), tz))::date AS ld) l
        CROSS JOIN LATERAL (
          SELECT CASE WHEN public.community_birthday_on(c.date_of_birth, extract(year FROM l.ld)::int) >= l.ld
                      THEN public.community_birthday_on(c.date_of_birth, extract(year FROM l.ld)::int)
                      ELSE public.community_birthday_on(c.date_of_birth, extract(year FROM l.ld)::int + 1) END AS day) b
       WHERE c.date_of_birth IS NOT NULL AND c.user_id IS NOT NULL
         AND coalesce(c.archived, false) = false AND c.archived_at IS NULL
         AND coalesce(c.status, '') <> 'Archived' AND coalesce(c.portal_access_disabled, false) = false
         AND NOT EXISTS (SELECT 1 FROM public.community_birthday_posts p WHERE p.client_id = c.id AND p.birthday_year = extract(year FROM b.day)::int)
         AND NOT EXISTS (SELECT 1 FROM public.client_birthday_wishes w WHERE w.client_id = c.id AND w.birthday_year = extract(year FROM b.day)::int)
         AND NOT EXISTS (SELECT 1 FROM public.client_birthday_cards bc WHERE bc.client_id = c.id AND bc.enabled = false)
       ORDER BY b.day, c.id
       LIMIT greatest(1, least(coalesce(_limit, 3), 10))) s), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.community_birthdays_next(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_birthdays_next(int) TO authenticated;

/**
 * "Write it now": the draft their evening-before run would have written,
 * today. Their numbers take a few seconds for a busy client (longer than a
 * signed-in request is allowed), so the app calls this from the server
 * (draftBirthdayNow, which checks you're staff) as the service role, the
 * same way the hourly drafting runs.
 */
CREATE OR REPLACE FUNCTION public.community_birthday_draft_now(_client_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  tz constant text := 'America/Winnipeg';
  c public.clients;
  v_ctz text;
  v_ld date;
  v_day date;
  v_yr int;
  v_facts jsonb;
  v_slot int;
  v_comp jsonb;
  b public.community_birthday_posts;
BEGIN
  IF NOT (public.is_community_staff() OR coalesce(auth.role(), '') = 'service_role') THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public.clients WHERE id = _client_id;
  IF NOT FOUND OR c.date_of_birth IS NULL THEN RAISE EXCEPTION 'No birthday on file'; END IF;
  IF c.user_id IS NULL THEN RAISE EXCEPTION 'They aren''t on the app yet'; END IF;
  v_ctz := coalesce(nullif(c.timezone, ''), tz);
  v_ld := (now() AT TIME ZONE v_ctz)::date;
  v_day := CASE WHEN public.community_birthday_on(c.date_of_birth, extract(year FROM v_ld)::int) >= v_ld
                THEN public.community_birthday_on(c.date_of_birth, extract(year FROM v_ld)::int)
                ELSE public.community_birthday_on(c.date_of_birth, extract(year FROM v_ld)::int + 1) END;
  v_yr := extract(year FROM v_day)::int;

  SELECT * INTO b FROM public.community_birthday_posts WHERE client_id = c.id AND birthday_year = v_yr;
  IF FOUND THEN RETURN public.community_birthday_json(b); END IF;

  v_facts := public.community_birthday_facts(c.id);
  v_slot := abs(hashtext(c.id::text || v_yr)) % 997;
  v_comp := public.community_birthday_compose(c.id, v_slot, v_facts);
  -- ready_pushed_at: you're the one looking at it, no "it's ready" push.
  INSERT INTO public.community_birthday_posts (client_id, birthday_year, birthday, body, dm_body, slot, facts, post_at, ready_pushed_at)
  VALUES (c.id, v_yr, v_day, v_comp ->> 'body', v_comp ->> 'dm_body', v_slot, v_facts,
          (v_day::timestamp + time '08:00') AT TIME ZONE v_ctz, now())
  ON CONFLICT (client_id, birthday_year) DO NOTHING
  RETURNING * INTO b;
  IF b.id IS NULL THEN
    SELECT * INTO b FROM public.community_birthday_posts WHERE client_id = c.id AND birthday_year = v_yr;
  END IF;
  RETURN public.community_birthday_json(b);
END;
$$;
REVOKE ALL ON FUNCTION public.community_birthday_draft_now(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_birthday_draft_now(uuid) TO authenticated, service_role;
