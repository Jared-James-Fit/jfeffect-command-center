-- Challenges, leaderboard first: what the redesign needs from the database.
--
-- * Search the whole board (not just the rows a phone has loaded), forgiving
--   of capitals, accents and a typo: challenge_board_find (unaccent, pg_trgm,
--   fuzzystrmatch).
-- * "Find my ranking": challenge_board_around gives an athlete's place, the
--   athletes just above and below and the next place up; challenge_public
--   carries the signed-in person's own entry (my_code), never anyone else's.
-- * Big boards: challenge_board_page pages the ranked board (5 or 5,000
--   athletes cost the same per page).
-- * The athlete on the platform: challenge_now (one row per challenge, a
--   judge sets it and the rep count while they count; realtime pushes it to
--   the big screen). It's always shown as in progress, never as a result.
-- * The organizer's screen: challenge_dashboard (counts, leader, recent
--   activity) in one read.
-- * Registration can open and close at set times (registration_opens_at /
--   registration_closes_at), enforced for self sign-up in challenge_register.
-- * The builder autosaves, so scoring locks once a published challenge has a
--   verified score (challenge_guard).
-- Nothing here changes ranking, scores or who may write them.

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch WITH SCHEMA extensions;

ALTER TABLE public.challenges ADD COLUMN IF NOT EXISTS registration_opens_at timestamptz;
ALTER TABLE public.challenges ADD COLUMN IF NOT EXISTS registration_closes_at timestamptz;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'challenges_registration_window') THEN
    ALTER TABLE public.challenges ADD CONSTRAINT challenges_registration_window
      CHECK (registration_closes_at IS NULL OR registration_opens_at IS NULL OR registration_closes_at > registration_opens_at);
  END IF;
END $$;

-- A name as search reads it: no case, no accents, single spaces.
CREATE OR REPLACE FUNCTION public._challenge_norm(p text)
RETURNS text LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT btrim(regexp_replace(lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p, ''))), '\s+', ' ', 'g'))
$$;

-- A word's letters in order ("jraed" → "adejr"): two letters swapped keep it.
CREATE OR REPLACE FUNCTION public._challenge_letters(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT string_agg(ch, '' ORDER BY ch) FROM regexp_split_to_table(coalesce(p, ''), '') ch
$$;

-- Every word typed is in the name: as the start of a word, one letter off
-- (two for long words) or two letters swapped, so "jraed" finds Jared and
-- "mcintire" McIntyre, while "james" never finds Jared.
CREATE OR REPLACE FUNCTION public._challenge_words_match(p_q text, p_name text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT coalesce(bool_and(EXISTS (
    SELECT 1 FROM unnest(string_to_array(p_name, ' ')) nt
    WHERE nt LIKE qt || '%'
       OR (length(qt) >= 4 AND (
             extensions.levenshtein_less_equal(qt, left(nt, length(qt)), lim) <= lim
          OR extensions.levenshtein_less_equal(qt, nt, lim) <= lim
          OR (public._challenge_letters(qt) = public._challenge_letters(left(nt, length(qt)))
              AND extensions.levenshtein_less_equal(qt, left(nt, length(qt)), 2) <= 2))))), false)
  FROM (SELECT qt, CASE WHEN length(qt) >= 7 THEN 2 ELSE 1 END AS lim
        FROM unnest(string_to_array(p_q, ' ')) qt WHERE qt <> '') x
$$;

-- Who may see a challenge's board: published, or this challenge's staff.
CREATE OR REPLACE FUNCTION public._challenge_visible(p_slug text)
RETURNS public.challenges LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.challenges%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public.challenges WHERE slug = lower(btrim(coalesce(p_slug, ''))) AND NOT is_template;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF c.status = 'draft' AND public.challenge_role(c.id) IS NULL THEN RETURN NULL; END IF;
  RETURN c;
END $$;

-- One board row as the public sees it (no contact details, no bodyweight).
CREATE OR REPLACE FUNCTION public._challenge_row_json(e public.challenge_entries, p public.challenge_people,
  r_score numeric, r_rank int, r_rank_div int, r_tied boolean, r_tied_div boolean, r_valid int, r_attempts int, r_at timestamptz)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'code', e.share_code, 'name', e.public_name, 'bib', e.bib,
    'photo', CASE WHEN e.show_photo THEN p.photo_path END,
    'handle', CASE WHEN p.discoverable THEN p.handle END,
    'division_id', e.division_id, 'score', r_score,
    'rank', r_rank, 'rank_div', r_rank_div, 'tied', r_tied, 'tied_div', r_tied_div,
    'valid', r_valid, 'attempts', r_attempts, 'at', r_at)
$$;

-- One page of the ranked board (everyone, or one division ranked within it).
CREATE OR REPLACE FUNCTION public.challenge_board_page(p_slug text, p_division uuid DEFAULT NULL,
  p_offset int DEFAULT 0, p_limit int DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.challenges; v_rows jsonb; v_total int; v_off int := greatest(0, coalesce(p_offset, 0));
        v_lim int := least(200, greatest(1, coalesce(p_limit, 50)));
BEGIN
  c := public._challenge_visible(p_slug);
  IF c.id IS NULL THEN RETURN NULL; END IF;
  WITH r AS MATERIALIZED (SELECT * FROM public._challenge_rank(c.id)),
  f AS (
    SELECT r.*, CASE WHEN p_division IS NULL THEN r.rank_all ELSE r.rank_div END AS place
    FROM r WHERE p_division IS NULL OR r.division_id = p_division
  ),
  pg AS (
    SELECT public._challenge_row_json(e, p, f.score, f.rank_all, f.rank_div, f.tied_all, f.tied_div, f.valid_count, f.attempt_count, f.last_at) AS j,
           f.place, e.public_name
    FROM f JOIN public.challenge_entries e ON e.id = f.entry_id JOIN public.challenge_people p ON p.id = e.person_id
    ORDER BY f.place, e.public_name, e.bib
    OFFSET v_off LIMIT v_lim
  )
  SELECT (SELECT count(*) FROM f), coalesce((SELECT jsonb_agg(pg.j ORDER BY pg.place, pg.public_name) FROM pg), '[]'::jsonb)
    INTO v_total, v_rows;
  RETURN jsonb_build_object(
    'challenge_id', c.id, 'status', c.status, 'final', c.results_final_at IS NOT NULL, 'as_of', now(),
    'version', (SELECT l.version FROM public.challenge_live l WHERE l.challenge_id = c.id),
    'registered', (SELECT count(*) FROM public.challenge_entries e WHERE e.challenge_id = c.id AND e.status <> 'withdrawn'),
    'total', v_total, 'offset', v_off, 'limit', v_lim, 'rows', v_rows,
    'recent', CASE WHEN v_off = 0 THEN coalesce((
      SELECT jsonb_agg(x ORDER BY (x ->> 'at') DESC) FROM (
        SELECT jsonb_build_object('id', a.id, 'code', e.share_code, 'name', e.public_name,
          'photo', CASE WHEN e.show_photo THEN p.photo_path END,
          'value', a.value, 'valid', a.valid, 'attempt_no', a.attempt_no, 'tiebreak', a.is_tiebreak,
          'division_id', e.division_id, 'at', a.created_at) AS x
        FROM public.challenge_attempts a
        JOIN public.challenge_entries e ON e.id = a.entry_id
        JOIN public.challenge_people p ON p.id = e.person_id
        WHERE a.challenge_id = c.id AND a.status = 'verified' AND e.status NOT IN ('withdrawn','disqualified')
          AND (p_division IS NULL OR e.division_id = p_division)
        ORDER BY a.created_at DESC LIMIT 6) t), '[]'::jsonb) ELSE '[]'::jsonb END);
END $$;

-- Search the whole event by name or bib: capitals, accents and a small typo forgiven.
-- Registered athletes with no score yet are found too (to check they're in).
CREATE OR REPLACE FUNCTION public.challenge_board_find(p_slug text, p_q text, p_division uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.challenges; v_q text := public._challenge_norm(left(coalesce(p_q, ''), 60)); v_bib int;
BEGIN
  c := public._challenge_visible(p_slug);
  IF c.id IS NULL THEN RETURN NULL; END IF;
  IF length(v_q) < 2 AND v_q !~ '^\d+$' THEN RETURN '[]'::jsonb; END IF;
  v_bib := CASE WHEN v_q ~ '^#?\d{1,5}$' THEN ltrim(v_q, '#')::int END;
  RETURN coalesce((
    WITH r AS MATERIALIZED (SELECT * FROM public._challenge_rank(c.id)),
    cand AS (
      SELECT e, p, public._challenge_norm(e.public_name) AS n
      FROM public.challenge_entries e JOIN public.challenge_people p ON p.id = e.person_id
      WHERE e.challenge_id = c.id AND e.status IN ('registered','checked_in')
        AND (p_division IS NULL OR e.division_id = p_division)
    ),
    s AS (
      SELECT cand.*, CASE
          WHEN v_bib IS NOT NULL AND (cand.e).bib = v_bib THEN 4
          WHEN cand.n = v_q THEN 3
          WHEN cand.n LIKE v_q || '%' OR cand.n LIKE '% ' || v_q || '%' THEN 2
          WHEN position(v_q IN cand.n) > 0 THEN 1.5
          WHEN public._challenge_words_match(v_q, cand.n) THEN 1
          ELSE extensions.word_similarity(v_q, cand.n) END AS score
      FROM cand
    )
    SELECT jsonb_agg(public._challenge_row_json(s.e, s.p, r.score, r.rank_all, r.rank_div, r.tied_all, r.tied_div,
                       coalesce(r.valid_count, 0), coalesce(r.attempt_count, 0), r.last_at)
                     || jsonb_build_object('division', (SELECT d.name FROM public.challenge_divisions d WHERE d.id = (s.e).division_id))
                     ORDER BY s.score DESC, r.rank_all NULLS LAST, (s.e).public_name)
    FROM (SELECT * FROM s WHERE s.score >= 0.5 ORDER BY s.score DESC LIMIT 20) s
    LEFT JOIN r ON r.entry_id = (s.e).id), '[]'::jsonb);
END $$;

-- One athlete's place, the athletes around them and the next place up.
CREATE OR REPLACE FUNCTION public.challenge_board_around(p_slug text, p_code text, p_division uuid DEFAULT NULL, p_radius int DEFAULT 2)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.challenges; e public.challenge_entries; v_rad int := least(10, greatest(0, coalesce(p_radius, 2)));
        v_div uuid; v_out jsonb;
BEGIN
  c := public._challenge_visible(p_slug);
  IF c.id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO e FROM public.challenge_entries WHERE challenge_id = c.id AND share_code = lower(btrim(coalesce(p_code, '')));
  IF NOT FOUND OR e.status IN ('withdrawn','disqualified') THEN RETURN NULL; END IF;
  -- a division with its own load is its own board
  v_div := CASE WHEN p_division IS NOT NULL THEN e.division_id
                WHEN public._challenge_divisions_separate(c.id) THEN e.division_id END;
  IF p_division IS NOT NULL AND e.division_id IS DISTINCT FROM p_division THEN v_div := e.division_id; END IF;
  WITH r AS MATERIALIZED (SELECT * FROM public._challenge_rank(c.id)),
  f AS (
    SELECT r.*, CASE WHEN v_div IS NULL THEN r.rank_all ELSE r.rank_div END AS place,
           CASE WHEN v_div IS NULL THEN r.tied_all ELSE r.tied_div END AS shared,
           x.public_name, x.bib
    FROM r JOIN public.challenge_entries x ON x.id = r.entry_id
    WHERE v_div IS NULL OR r.division_id = v_div
  ),
  o AS (SELECT f.*, row_number() OVER (ORDER BY f.place, f.public_name, f.bib) AS pos FROM f),
  me AS (SELECT * FROM o WHERE o.entry_id = e.id)
  SELECT jsonb_build_object(
    'division_id', v_div,
    'total', (SELECT count(*) FROM o),
    'me', CASE WHEN (SELECT count(*) FROM me) = 0 THEN
             jsonb_build_object('code', e.share_code, 'name', e.public_name, 'bib', e.bib, 'division_id', e.division_id, 'score', NULL, 'rank', NULL)
           ELSE (SELECT public._challenge_row_json(e, p, me.score, me.rank_all, me.rank_div, me.tied_all, me.tied_div, me.valid_count, me.attempt_count, me.last_at)
                        || jsonb_build_object('place', me.place, 'shared', me.shared, 'pos', me.pos)
                 FROM me, public.challenge_people p WHERE p.id = e.person_id) END,
    'offset', (SELECT greatest(0, me.pos - 1 - v_rad) FROM me),
    'rows', coalesce((SELECT jsonb_agg(public._challenge_row_json(x, p, o.score, o.rank_all, o.rank_div, o.tied_all, o.tied_div, o.valid_count, o.attempt_count, o.last_at)
                                       || jsonb_build_object('place', o.place, 'shared', o.shared, 'pos', o.pos) ORDER BY o.pos)
                      FROM o, me, public.challenge_entries x, public.challenge_people p
                      WHERE o.pos BETWEEN me.pos - v_rad AND me.pos + v_rad AND x.id = o.entry_id AND p.id = x.person_id), '[]'::jsonb),
    -- the closest place strictly above (a tie with you isn't above you)
    'next', (SELECT jsonb_build_object('code', x.share_code, 'name', x.public_name, 'score', o.score, 'place', o.place)
             FROM o, me, public.challenge_entries x WHERE o.place < me.place AND x.id = o.entry_id
             ORDER BY o.place DESC, o.public_name LIMIT 1)
  ) INTO v_out;
  RETURN v_out;
END $$;

-- ── The athlete on the platform ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.challenge_now (
  challenge_id uuid PRIMARY KEY REFERENCES public.challenges(id) ON DELETE CASCADE,
  entry_id uuid NOT NULL REFERENCES public.challenge_entries(id) ON DELETE CASCADE,
  live_value numeric(12,3) CHECK (live_value IS NULL OR (live_value >= 0 AND live_value <= 100000)),
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- readable by anyone for realtime, so it holds nothing personal: no judge, no contact details
ALTER TABLE public.challenge_now ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.challenge_now FROM anon, authenticated;
GRANT SELECT ON public.challenge_now TO anon, authenticated;
DROP POLICY IF EXISTS "Anyone reads who's up on published challenges" ON public.challenge_now;
CREATE POLICY "Anyone reads who's up on published challenges" ON public.challenge_now FOR SELECT TO anon, authenticated
  USING (challenge_id IN (SELECT public.challenge_public_ids()) OR challenge_id IN (SELECT public.challenge_my_ids()));
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'challenge_now') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.challenge_now;
  END IF;
END $$;

-- A judge calls an athlete up (p_entry) and counts (p_value); p_entry NULL clears the platform.
CREATE OR REPLACE FUNCTION public.challenge_set_now(p_challenge uuid, p_entry uuid, p_value numeric DEFAULT NULL)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE e public.challenge_entries%ROWTYPE; c public.challenges%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public.challenges WHERE id = p_challenge;
  IF NOT FOUND THEN RAISE EXCEPTION 'Challenge not found.' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.challenge_can(c.id, 'judge') THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  IF p_entry IS NULL THEN
    DELETE FROM public.challenge_now WHERE challenge_id = c.id;
    RETURN;
  END IF;
  SELECT * INTO e FROM public.challenge_entries WHERE id = p_entry AND challenge_id = c.id;
  IF NOT FOUND OR e.status IN ('withdrawn','disqualified') THEN RAISE EXCEPTION 'That athlete isn''t competing.' USING ERRCODE = 'P0001'; END IF;
  IF p_value IS NOT NULL AND (p_value < 0 OR p_value > 100000) THEN RAISE EXCEPTION 'That count is out of range.' USING ERRCODE = 'P0001'; END IF;
  INSERT INTO public.challenge_now (challenge_id, entry_id, live_value, started_at, updated_at)
  VALUES (c.id, e.id, p_value, now(), now())
  ON CONFLICT (challenge_id) DO UPDATE SET
    started_at = CASE WHEN public.challenge_now.entry_id = EXCLUDED.entry_id THEN public.challenge_now.started_at ELSE now() END,
    entry_id = EXCLUDED.entry_id, live_value = EXCLUDED.live_value, updated_at = now();
END $$;

-- A judge done with an athlete takes them off the platform, but only them:
-- another judge's athlete stays up.
CREATE OR REPLACE FUNCTION public.challenge_clear_now(p_challenge uuid, p_entry uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.challenge_can(p_challenge, 'judge') THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  DELETE FROM public.challenge_now WHERE challenge_id = p_challenge AND entry_id = p_entry;
END $$;

-- Who's up, as the public sees it (only while fresh: a judge's phone that dropped mid-set doesn't leave a ghost).
CREATE OR REPLACE FUNCTION public.challenge_now_public(p_slug text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.challenges;
BEGIN
  c := public._challenge_visible(p_slug);
  IF c.id IS NULL OR c.status NOT IN ('live','draft') THEN RETURN NULL; END IF;
  RETURN (SELECT jsonb_build_object('code', e.share_code, 'name', e.public_name, 'bib', e.bib,
            'photo', CASE WHEN e.show_photo THEN p.photo_path END, 'division_id', e.division_id,
            'live_value', n.live_value, 'started_at', n.started_at, 'updated_at', n.updated_at,
            'attempt_no', (SELECT count(*) + 1 FROM public.challenge_attempts a WHERE a.entry_id = e.id AND a.status = 'verified' AND NOT a.is_tiebreak))
          FROM public.challenge_now n
          JOIN public.challenge_entries e ON e.id = n.entry_id
          JOIN public.challenge_people p ON p.id = e.person_id
          WHERE n.challenge_id = c.id AND n.updated_at > now() - interval '15 minutes'
            AND e.status NOT IN ('withdrawn','disqualified'));
END $$;

-- ── The organizer's screen ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.challenge_dashboard(p_challenge uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.challenges%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public.challenges WHERE id = p_challenge;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF public.challenge_role(c.id) IS NULL THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  RETURN (WITH r AS MATERIALIZED (SELECT * FROM public._challenge_rank(c.id))
  SELECT jsonb_build_object(
    'version', (SELECT l.version FROM public.challenge_live l WHERE l.challenge_id = c.id),
    'registered', (SELECT count(*) FROM public.challenge_entries e WHERE e.challenge_id = c.id AND e.status <> 'withdrawn'),
    'checked_in', (SELECT count(*) FROM public.challenge_entries e WHERE e.challenge_id = c.id AND e.status = 'checked_in'),
    'scored', (SELECT count(*) FROM r),
    'waiting', (SELECT count(*) FROM public.challenge_entries e WHERE e.challenge_id = c.id AND e.status = 'checked_in'
                AND NOT EXISTS (SELECT 1 FROM public.challenge_attempts a WHERE a.entry_id = e.id AND a.status = 'verified')),
    'prizes', (SELECT count(*) FROM public.challenge_prizes pz WHERE pz.challenge_id = c.id),
    'prizes_open', (SELECT count(*) FROM public.challenge_prizes pz WHERE pz.challenge_id = c.id AND pz.winner_entry_id IS NULL),
    'staff', (SELECT count(*) FROM public.challenge_staff s WHERE s.challenge_id = c.id),
    'leaders', coalesce((SELECT jsonb_agg(jsonb_build_object('name', e.public_name, 'code', e.share_code, 'score', r.score,
                    'tied', r.tied_all, 'photo', CASE WHEN e.show_photo THEN p.photo_path END) ORDER BY e.public_name)
                  FROM r JOIN public.challenge_entries e ON e.id = r.entry_id JOIN public.challenge_people p ON p.id = e.person_id
                  WHERE r.rank_all = 1), '[]'::jsonb),
    'recent', coalesce((SELECT jsonb_agg(x ORDER BY (x ->> 'at') DESC) FROM (
        SELECT jsonb_build_object('at', a.created_at, 'action', a.action, 'entity', a.entity,
          'name', coalesce(en.public_name, ea.public_name),
          'value', CASE WHEN a.action = 'correct' THEN a.detail #> '{to,value}' ELSE a.detail -> 'value' END,
          'valid', CASE WHEN a.action = 'correct' THEN a.detail #> '{to,valid}' ELSE a.detail -> 'valid' END,
          'to', CASE WHEN a.action = 'status' THEN a.detail ->> 'to' END,
          'change_status', a.detail #>> '{change,status}', 'tiebreak', a.detail -> 'tiebreak',
          'reason', a.detail ->> 'reason', 'source', a.detail ->> 'source',
          'by', coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), split_part(u.email, '@', 1))) AS x
        FROM public.challenge_audit a
        LEFT JOIN public.challenge_entries en ON a.entity = 'entry' AND en.id = a.entity_id
        LEFT JOIN public.challenge_entries ea ON a.entity = 'attempt' AND ea.id = nullif(a.detail ->> 'entry_id', '')::uuid
        LEFT JOIN auth.users u ON u.id = a.actor
        WHERE a.challenge_id = c.id
        ORDER BY a.created_at DESC LIMIT 12) t), '[]'::jsonb)
  ));
END $$;

-- ── Registration window and the viewer's own entry ─────────────────────────

CREATE OR REPLACE FUNCTION public.challenge_public(p_slug text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.challenges%ROWTYPE; v_role text;
BEGIN
  SELECT * INTO c FROM public.challenges WHERE slug = lower(btrim(p_slug)) AND NOT is_template;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_role := public.challenge_role(c.id);
  IF c.status = 'draft' AND v_role IS NULL THEN RETURN NULL; END IF;
  RETURN public._challenge_card(c) || jsonb_build_object(
    'description', c.description, 'address', c.address,
    'max_participants', c.max_participants, 'min_age', c.min_age, 'eligibility', c.eligibility,
    'rules', c.rules, 'safety', c.safety, 'warmup', c.warmup,
    'self_registration', c.self_registration, 'collect', c.collect, 'acknowledgments', c.acknowledgments,
    'announcement', c.announcement, 'announcement_at', c.announcement_at,
    'my_role', v_role,
    -- the signed-in person's own entry here ("Find my ranking"), never anyone else's
    'my_code', (SELECT e.share_code FROM public.challenge_entries e JOIN public.challenge_people p ON p.id = e.person_id
                WHERE e.challenge_id = c.id AND p.user_id IS NOT NULL AND p.user_id = auth.uid() AND e.status <> 'withdrawn' LIMIT 1),
    'registration_opens_at', c.registration_opens_at, 'registration_closes_at', c.registration_closes_at,
    'registration_open', c.self_registration AND c.status IN ('upcoming','live','paused')
        AND (c.registration_opens_at IS NULL OR now() >= c.registration_opens_at)
        AND (c.registration_closes_at IS NULL OR now() < c.registration_closes_at)
        AND (c.max_participants IS NULL OR (SELECT count(*) FROM public.challenge_entries e
              WHERE e.challenge_id = c.id AND e.status <> 'withdrawn') < c.max_participants),
    'version', (SELECT l.version FROM public.challenge_live l WHERE l.challenge_id = c.id),
    'registered', (SELECT count(*) FROM public.challenge_entries e WHERE e.challenge_id = c.id AND e.status <> 'withdrawn'),
    'divisions', coalesce((SELECT jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'load_label', d.load_label) ORDER BY d.sort, d.name)
                           FROM public.challenge_divisions d WHERE d.challenge_id = c.id), '[]'::jsonb),
    'sponsors', coalesce((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'url', s.url, 'logo_path', s.logo_path, 'blurb', s.blurb) ORDER BY s.sort, s.name)
                          FROM public.challenge_sponsors s WHERE s.challenge_id = c.id), '[]'::jsonb),
    'prizes', coalesce((SELECT jsonb_agg(jsonb_build_object(
                  'place', pz.place, 'title', pz.title, 'value_cents', pz.value_cents, 'division_id', pz.division_id,
                  'sponsor', (SELECT s.name FROM public.challenge_sponsors s WHERE s.id = pz.sponsor_id),
                  'winner', CASE WHEN c.results_final_at IS NOT NULL AND pz.winner_entry_id IS NOT NULL THEN
                    (SELECT jsonb_build_object('name', e.public_name, 'code', e.share_code,
                                               'photo', CASE WHEN e.show_photo THEN p.photo_path END)
                     FROM public.challenge_entries e JOIN public.challenge_people p ON p.id = e.person_id
                     WHERE e.id = pz.winner_entry_id) END
                ) ORDER BY pz.division_id NULLS FIRST, pz.place)
                FROM public.challenge_prizes pz WHERE pz.challenge_id = c.id), '[]'::jsonb)
  );
END $$;

CREATE OR REPLACE FUNCTION public.challenge_register(p_challenge uuid, p jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c public.challenges%ROWTYPE;
  v_staff boolean := public.challenge_can(p_challenge, 'register');
  v_uid uuid := auth.uid();
  v_public text := btrim(coalesce(p ->> 'public_name', ''));
  v_full text := btrim(coalesce(p ->> 'full_name', ''));
  v_email text := lower(btrim(coalesce(p ->> 'email', '')));
  v_phone text := nullif(btrim(coalesce(p ->> 'phone', '')), '');
  v_ig text := nullif(ltrim(btrim(coalesce(p ->> 'instagram', '')), '@'), '');
  v_div uuid;
  v_show boolean := coalesce((p ->> 'show_photo')::boolean, false);
  v_mkt boolean := coalesce((p ->> 'marketing_opt_in')::boolean, false);
  v_ack jsonb := coalesce(p -> 'acknowledged', '[]'::jsonb);
  v_bw numeric := CASE WHEN v_staff THEN nullif(p ->> 'bodyweight_kg', '')::numeric END;
  v_ref uuid;
  v_ref_source text := nullif(p ->> 'ref_source', '');
  v_person uuid; v_entry uuid; v_bib int; v_code text; v_token text; v_existing uuid;
  v_count int; v_ip text;
BEGIN
  SELECT * INTO c FROM public.challenges WHERE id = p_challenge FOR UPDATE;
  IF NOT FOUND OR c.is_template THEN RAISE EXCEPTION 'Challenge not found.' USING ERRCODE = 'P0002'; END IF;

  IF v_staff THEN
    IF c.status NOT IN ('draft','upcoming','live','paused','verifying') THEN
      RAISE EXCEPTION 'Registration is closed for this challenge.' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    IF NOT c.self_registration OR c.status NOT IN ('upcoming','live','paused') THEN
      RAISE EXCEPTION 'Registration is closed for this challenge.' USING ERRCODE = 'P0001';
    END IF;
    IF c.registration_opens_at IS NOT NULL AND now() < c.registration_opens_at THEN
      RAISE EXCEPTION 'Registration hasn''t opened yet.' USING ERRCODE = 'P0001';
    END IF;
    IF c.registration_closes_at IS NOT NULL AND now() >= c.registration_closes_at THEN
      RAISE EXCEPTION 'Registration has closed.' USING ERRCODE = 'P0001';
    END IF;
    v_ip := public._challenge_client_ip();
    -- a gym's Wi-Fi puts the whole room behind one address, so the limits are
    -- sized for a QR rush at the door (each sign-up still needs its own email)
    IF NOT public._challenge_rate_ok('reg:' || p_challenge || ':' || v_ip, 60, interval '15 minutes')
       OR NOT public._challenge_rate_ok('reg:' || v_ip, 150, interval '1 hour') THEN
      RAISE EXCEPTION 'Too many sign-ups from this connection. Ask event staff to register you.' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- validation
  IF length(v_public) NOT BETWEEN 1 AND 40 THEN RAISE EXCEPTION 'Add the name to show on the leaderboard (40 characters max).' USING ERRCODE = 'P0001'; END IF;
  IF length(v_full) NOT BETWEEN 2 AND 80 THEN RAISE EXCEPTION 'Add your full name.' USING ERRCODE = 'P0001'; END IF;
  IF v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(v_email) > 200 THEN RAISE EXCEPTION 'Add a valid email.' USING ERRCODE = 'P0001'; END IF;
  IF v_phone IS NOT NULL AND (length(regexp_replace(v_phone, '\D', '', 'g')) NOT BETWEEN 7 AND 15) THEN RAISE EXCEPTION 'That phone number doesn''t look right.' USING ERRCODE = 'P0001'; END IF;
  IF coalesce(c.collect ->> 'phone', 'optional') = 'required' AND v_phone IS NULL THEN RAISE EXCEPTION 'Add a phone number.' USING ERRCODE = 'P0001'; END IF;
  IF coalesce(c.collect ->> 'instagram', 'optional') = 'required' AND v_ig IS NULL THEN RAISE EXCEPTION 'Add your Instagram.' USING ERRCODE = 'P0001'; END IF;
  IF coalesce(c.collect ->> 'phone', 'optional') = 'off' THEN v_phone := NULL; END IF;
  IF coalesce(c.collect ->> 'instagram', 'optional') = 'off' THEN v_ig := NULL; END IF;
  IF v_ig IS NOT NULL AND v_ig !~ '^[A-Za-z0-9._]{1,30}$' THEN RAISE EXCEPTION 'That Instagram handle doesn''t look right.' USING ERRCODE = 'P0001'; END IF;
  IF jsonb_typeof(v_ack) <> 'array' OR jsonb_array_length(v_ack) < jsonb_array_length(c.acknowledgments)
     OR NOT (c.acknowledgments <@ v_ack) THEN
    RAISE EXCEPTION 'Every box has to be ticked to compete.' USING ERRCODE = 'P0001';
  END IF;
  IF v_bw IS NOT NULL AND (v_bw < 25 OR v_bw > 350) THEN RAISE EXCEPTION 'That bodyweight doesn''t look right.' USING ERRCODE = 'P0001'; END IF;

  IF EXISTS (SELECT 1 FROM public.challenge_divisions d WHERE d.challenge_id = c.id) THEN
    SELECT d.id INTO v_div FROM public.challenge_divisions d WHERE d.challenge_id = c.id AND d.id = nullif(p ->> 'division_id', '')::uuid;
    IF v_div IS NULL THEN RAISE EXCEPTION 'Pick a division.' USING ERRCODE = 'P0001'; END IF;
  END IF;

  IF c.max_participants IS NOT NULL THEN
    SELECT count(*) INTO v_count FROM public.challenge_entries WHERE challenge_id = c.id AND status <> 'withdrawn';
    IF v_count >= c.max_participants THEN RAISE EXCEPTION 'This challenge is full.' USING ERRCODE = 'P0001'; END IF;
  END IF;

  -- already in this challenge with that email?
  SELECT e.id INTO v_existing FROM public.challenge_entries e
    JOIN public.challenge_people_private pp ON pp.person_id = e.person_id
    WHERE e.challenge_id = c.id AND lower(pp.email) = v_email AND e.status <> 'withdrawn' LIMIT 1;
  IF v_existing IS NOT NULL THEN
    IF v_staff THEN
      RETURN (SELECT jsonb_build_object('entry_id', e.id, 'code', e.share_code, 'bib', e.bib, 'existing', true) FROM public.challenge_entries e WHERE e.id = v_existing);
    END IF;
    RAISE EXCEPTION 'That email is already registered for this challenge. Find event staff if you need a hand.' USING ERRCODE = 'P0001';
  END IF;

  -- who is this? staff entries (trusted) and signed-in people reuse their profile;
  -- a public sign-up never attaches to someone else's profile by typing their email.
  IF v_uid IS NOT NULL AND NOT v_staff THEN
    SELECT id INTO v_person FROM public.challenge_people WHERE user_id = v_uid;
  END IF;
  IF v_person IS NULL AND v_staff THEN
    SELECT pp.person_id INTO v_person FROM public.challenge_people_private pp
      JOIN public.challenge_people pe ON pe.id = pp.person_id
      WHERE lower(pp.email) = v_email
      ORDER BY (pe.user_id IS NOT NULL) DESC, pe.created_at LIMIT 1;
  END IF;
  -- a withdrawn entry in this challenge comes back instead of a second row
  IF v_person IS NOT NULL THEN
    SELECT e.id INTO v_existing FROM public.challenge_entries e WHERE e.challenge_id = c.id AND e.person_id = v_person;
    IF v_existing IS NOT NULL THEN
      IF (SELECT status FROM public.challenge_entries WHERE id = v_existing) <> 'withdrawn' THEN
        IF v_staff THEN
          RETURN (SELECT jsonb_build_object('entry_id', e.id, 'code', e.share_code, 'bib', e.bib, 'existing', true) FROM public.challenge_entries e WHERE e.id = v_existing);
        END IF;
        RAISE EXCEPTION 'You''re already registered for this challenge.' USING ERRCODE = 'P0001';
      END IF;
      UPDATE public.challenge_entries SET status = 'registered', status_reason = NULL, public_name = v_public,
        division_id = v_div, show_photo = v_show, acknowledged = v_ack, acknowledged_at = now(),
        bodyweight_kg = coalesce(v_bw, bodyweight_kg)
      WHERE id = v_existing;
      PERFORM public._challenge_audit(c.id, 'reregister', 'entry', v_existing, jsonb_build_object('source', CASE WHEN v_staff THEN 'staff' ELSE 'self' END));
      IF v_show THEN
        v_token := encode(extensions.gen_random_bytes(24), 'hex');
        INSERT INTO public.challenge_photo_tickets(token_hash, person_id, entry_id) VALUES (encode(extensions.digest(v_token, 'sha256'), 'hex'), v_person, v_existing);
      END IF;
      RETURN (SELECT jsonb_build_object('entry_id', e.id, 'code', e.share_code, 'bib', e.bib, 'existing', true, 'photo_ticket', v_token) FROM public.challenge_entries e WHERE e.id = v_existing);
    END IF;
  END IF;

  IF v_person IS NULL THEN
    INSERT INTO public.challenge_people(handle, display_name, user_id)
    VALUES (public._challenge_handle(v_public), v_public,
            CASE WHEN v_uid IS NOT NULL AND NOT v_staff
                      AND lower((SELECT u.email FROM auth.users u WHERE u.id = v_uid AND u.email_confirmed_at IS NOT NULL)) = v_email
                 THEN v_uid END)
    RETURNING id INTO v_person;
    INSERT INTO public.challenge_people_private(person_id, full_name, email, phone, instagram, marketing_opt_in, marketing_opt_in_at)
    VALUES (v_person, v_full, v_email, v_phone, v_ig, v_mkt, CASE WHEN v_mkt THEN now() END);
  ELSE
    -- keep their contact details current; marketing consent is only ever added here, never removed silently
    UPDATE public.challenge_people_private SET
      full_name = v_full, phone = coalesce(v_phone, phone), instagram = coalesce(v_ig, instagram),
      marketing_opt_in = marketing_opt_in OR v_mkt,
      marketing_opt_in_at = CASE WHEN v_mkt AND NOT marketing_opt_in THEN now() ELSE marketing_opt_in_at END
    WHERE person_id = v_person;
  END IF;

  IF p ->> 'ref' IS NOT NULL THEN
    SELECT e.id INTO v_ref FROM public.challenge_entries e WHERE e.share_code = lower(btrim(p ->> 'ref'));
  END IF;
  IF v_ref_source IS NOT NULL AND v_ref_source NOT IN ('qr','link','friend','display') THEN v_ref_source := NULL; END IF;
  IF v_ref IS NOT NULL THEN v_ref_source := 'friend'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext('challenge_bib:' || c.id::text));
  SELECT coalesce(max(bib), 0) + 1 INTO v_bib FROM public.challenge_entries WHERE challenge_id = c.id;
  LOOP
    v_code := public._challenge_code(8);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.challenge_entries WHERE share_code = v_code);
  END LOOP;

  INSERT INTO public.challenge_entries(challenge_id, person_id, division_id, bib, share_code, public_name, show_photo,
    bodyweight_kg, source, ref_source, referred_by, acknowledged, registered_by)
  VALUES (c.id, v_person, v_div, v_bib, v_code, v_public, v_show, v_bw,
    CASE WHEN v_staff THEN 'staff' ELSE 'self' END, v_ref_source, v_ref, v_ack, v_uid)
  RETURNING id INTO v_entry;

  IF v_show THEN
    v_token := encode(extensions.gen_random_bytes(24), 'hex');
    INSERT INTO public.challenge_photo_tickets(token_hash, person_id, entry_id)
    VALUES (encode(extensions.digest(v_token, 'sha256'), 'hex'), v_person, v_entry);
  END IF;

  PERFORM public._challenge_audit(c.id, 'register', 'entry', v_entry,
    jsonb_build_object('source', CASE WHEN v_staff THEN 'staff' ELSE 'self' END, 'bib', v_bib, 'ref_source', v_ref_source));

  RETURN jsonb_build_object('entry_id', v_entry, 'code', v_code, 'bib', v_bib, 'existing', false,
    'photo_ticket', v_token, 'handle', (SELECT handle FROM public.challenge_people WHERE id = v_person));
END $$;

-- ── Scoring can't change under a live board ──────────────────────────────────
-- The builder autosaves. Once a published challenge has a verified score, how
-- it's scored (what's measured, who wins, attempts, ties, units) is locked, so
-- an edit can never reshuffle results people have already seen. A draft's
-- practice scores don't lock it.
CREATE OR REPLACE FUNCTION public.challenge_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE via_rpc boolean := coalesce(current_setting('jf.challenge_rpc', true), '') = 'on';
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT via_rpc AND (NEW.status <> 'draft' OR NEW.results_final_at IS NOT NULL OR NEW.started_at IS NOT NULL OR NEW.ended_at IS NOT NULL) THEN
      RAISE EXCEPTION 'A new challenge starts as a draft.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT via_rpc THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.results_final_at IS DISTINCT FROM OLD.results_final_at
       OR NEW.final_by IS DISTINCT FROM OLD.final_by
       OR NEW.started_at IS DISTINCT FROM OLD.started_at
       OR NEW.ended_at IS DISTINCT FROM OLD.ended_at THEN
      RAISE EXCEPTION 'Change a challenge''s status with its status buttons.' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.slug IS DISTINCT FROM OLD.slug AND OLD.status <> 'draft' AND NOT OLD.is_template THEN
      RAISE EXCEPTION 'The link can''t change once the challenge is published (shared links would break).' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.is_template IS DISTINCT FROM OLD.is_template AND OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'Only a draft can become a template.' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status <> 'draft' AND (
         NEW.measure IS DISTINCT FROM OLD.measure OR NEW.direction IS DISTINCT FROM OLD.direction
      OR NEW.unit IS DISTINCT FROM OLD.unit OR NEW.aggregate IS DISTINCT FROM OLD.aggregate
      OR NEW.attempts_allowed IS DISTINCT FROM OLD.attempts_allowed
      OR NEW.relative_to_bodyweight IS DISTINCT FROM OLD.relative_to_bodyweight
      OR NEW.tiebreak IS DISTINCT FROM OLD.tiebreak)
       AND EXISTS (SELECT 1 FROM public.challenge_attempts a WHERE a.challenge_id = OLD.id AND a.status = 'verified') THEN
      RAISE EXCEPTION 'Scoring is locked once scores are in: it decides the rankings people have already seen.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- ── Grants ─────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public._challenge_norm(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._challenge_words_match(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._challenge_letters(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._challenge_visible(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._challenge_row_json(public.challenge_entries, public.challenge_people, numeric, int, int, boolean, boolean, int, int, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.challenge_board_page(text, uuid, int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.challenge_board_find(text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.challenge_board_around(text, text, uuid, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.challenge_now_public(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.challenge_board_page(text, uuid, int, int) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.challenge_board_find(text, text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.challenge_board_around(text, text, uuid, int) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.challenge_now_public(text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.challenge_set_now(uuid, uuid, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.challenge_clear_now(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.challenge_clear_now(uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.challenge_dashboard(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.challenge_set_now(uuid, uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.challenge_dashboard(uuid) TO authenticated;
