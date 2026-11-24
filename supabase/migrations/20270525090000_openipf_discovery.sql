-- OpenIPF for the coach's athletes (Nov 24 2026).
--
-- The daily sync (powerlifting_opl_*, 20261029090000) already reads every
-- linked athlete's meets into athlete_powerlifting_results, which the Hall of
-- Strength and competition analytics read. What was missing:
--
-- 1. Finding them. Once a month (and on demand: the client's profile, Cleo)
--    every coaching client and every alumni record with no profile linked is
--    searched on OpenIPF by name (openipf.org first, openpowerlifting.org when
--    OpenIPF has nobody by that name), through pg_net like the sync. A lifter
--    whose name matches is a suggestion the coach approves; nothing is linked
--    by itself. Free members are never searched.
-- 2. Hearing about new meets. A meet the sync adds to a profile that was
--    already synced (never the first import, which is history) is a 'new_meet'
--    suggestion with the records it set, for coaching clients and alumni alike.
-- 3. Reversing it. Remove takes off what the link added (the meets the sync
--    created) and keeps them in openipf_link_history; Add back puts back the
--    same rows and the link. Not them is never suggested again.
--
-- Pushes are the server's: the tick wakes /api/public/hooks/openipf-notify when
-- something is ready to tell (openipf.server.ts), at most every 15 minutes.

-- ---------------------------------------------------------------- tables

CREATE TABLE IF NOT EXISTS public.openipf_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  athlete_id uuid REFERENCES public.powerlifting_athletes(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  targets integer NOT NULL DEFAULT 0,
  found integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.openipf_discovery_requests (
  id bigserial PRIMARY KEY,
  scan_id uuid NOT NULL REFERENCES public.openipf_scans(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  athlete_id uuid REFERENCES public.powerlifting_athletes(id) ON DELETE CASCADE,
  subject_name text NOT NULL,
  subject_sex text,
  step text NOT NULL CHECK (step IN ('search', 'row', 'lifter')),
  host text NOT NULL CHECK (host IN ('https://www.openipf.org', 'https://www.openpowerlifting.org')),
  query text,
  slug text,
  start_index integer,
  hits integer NOT NULL DEFAULT 0,
  state text NOT NULL DEFAULT 'planned' CHECK (state IN ('planned', 'requested', 'done', 'failed')),
  request_id bigint,
  planned_at timestamptz NOT NULL DEFAULT now(),
  requested_at timestamptz,
  collected_at timestamptz,
  result jsonb
);
CREATE INDEX IF NOT EXISTS openipf_discovery_requests_open ON public.openipf_discovery_requests (state, id) WHERE state IN ('planned', 'requested');
CREATE INDEX IF NOT EXISTS openipf_discovery_requests_scan ON public.openipf_discovery_requests (scan_id);

CREATE TABLE IF NOT EXISTS public.openipf_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('match', 'new_meet')),
  -- the client, else the alumni athlete record
  subject_id uuid NOT NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  athlete_id uuid REFERENCES public.powerlifting_athletes(id) ON DELETE CASCADE,
  subject_name text NOT NULL,
  subject_sex text,
  host text,
  slug text,
  lifter_name text,
  sex text,
  country text,
  federation text,
  equipment text,
  division text,
  bodyweight_kg numeric,
  weight_class text,
  squat_kg numeric,
  bench_kg numeric,
  deadlift_kg numeric,
  total_kg numeric,
  points numeric,
  -- match: the date of their best entry on the rankings, the year they were
  -- born by their age at it, and their meets
  best_date date,
  born_about integer,
  meet_count integer,
  first_meet date,
  last_meet date,
  last_meet_name text,
  -- new_meet: the meet and the records it set
  result_id uuid REFERENCES public.athlete_powerlifting_results(id) ON DELETE SET NULL,
  source_key text,
  meet_name text,
  meet_date date,
  prs text[] NOT NULL DEFAULT '{}',
  confidence text CHECK (confidence IN ('likely', 'possible')),
  reasons text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'dismissed', 'seen', 'expired')),
  scan_id uuid REFERENCES public.openipf_scans(id) ON DELETE SET NULL,
  -- an approval that made the athlete record, so its Undo takes the record away again
  created_athlete_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  notified_at timestamptz,
  decided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  CHECK (client_id IS NOT NULL OR athlete_id IS NOT NULL)
);
ALTER TABLE public.openipf_suggestions ADD COLUMN IF NOT EXISTS born_about integer;
CREATE UNIQUE INDEX IF NOT EXISTS openipf_suggestions_match ON public.openipf_suggestions (subject_id, slug) WHERE kind = 'match';
CREATE UNIQUE INDEX IF NOT EXISTS openipf_suggestions_meet ON public.openipf_suggestions (athlete_id, source_key) WHERE kind = 'new_meet';
CREATE INDEX IF NOT EXISTS openipf_suggestions_waiting ON public.openipf_suggestions (status, created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS openipf_suggestions_client ON public.openipf_suggestions (client_id);

CREATE TABLE IF NOT EXISTS public.openipf_link_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL REFERENCES public.powerlifting_athletes(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  url text NOT NULL,
  removed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  removed_at timestamptz NOT NULL DEFAULT now(),
  -- the meets the link had added, exactly as they were (Add back puts these rows back)
  result_rows jsonb NOT NULL DEFAULT '[]',
  meet_count integer NOT NULL DEFAULT 0,
  restored_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  restored_at timestamptz
);
CREATE INDEX IF NOT EXISTS openipf_link_history_athlete ON public.openipf_link_history (athlete_id, removed_at DESC);

ALTER TABLE public.openipf_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.openipf_discovery_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.openipf_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.openipf_link_history ENABLE ROW LEVEL SECURITY;

-- Staff read what's theirs: an admin everything, a coach their own clients'.
-- Alumni with no client are the admin's. Writes are the functions' only.
DROP POLICY IF EXISTS "Staff read OpenIPF suggestions" ON public.openipf_suggestions;
CREATE POLICY "Staff read OpenIPF suggestions" ON public.openipf_suggestions FOR SELECT TO authenticated
  USING (
    (SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
    OR ((SELECT public.has_role((SELECT auth.uid()), 'coach'::public.app_role)) AND client_id IN (SELECT public.coached_client_ids()))
  );
DROP POLICY IF EXISTS "Staff read OpenIPF link history" ON public.openipf_link_history;
CREATE POLICY "Staff read OpenIPF link history" ON public.openipf_link_history FOR SELECT TO authenticated
  USING (
    (SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
    OR ((SELECT public.has_role((SELECT auth.uid()), 'coach'::public.app_role)) AND client_id IN (SELECT public.coached_client_ids()))
  );
DROP POLICY IF EXISTS "Admin reads OpenIPF scans" ON public.openipf_scans;
CREATE POLICY "Admin reads OpenIPF scans" ON public.openipf_scans FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));
REVOKE ALL ON public.openipf_scans, public.openipf_discovery_requests, public.openipf_suggestions, public.openipf_link_history FROM anon;
GRANT SELECT ON public.openipf_scans, public.openipf_suggestions, public.openipf_link_history TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.openipf_scans, public.openipf_suggestions, public.openipf_link_history FROM authenticated;
REVOKE ALL ON public.openipf_discovery_requests FROM authenticated;

-- ---------------------------------------------------------------- names

-- Letters folded the way names are written in English (the same table as
-- openipfFold in src/lib/openipf.ts).
CREATE OR REPLACE FUNCTION public.openipf_fold(_s text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT translate(lower(coalesce(_s, '')),
    'áàâäãåāéèêëēíìîïīóòôöõøōúùûüūñńçćčýÿšžłß',
    'aaaaaaaeeeeeiiiiiooooooouuuuunncccyyszls')
$$;

-- What two names are compared by: letters only, "#2" (OpenPowerlifting's mark
-- for a second lifter of the same name) left off.
CREATE OR REPLACE FUNCTION public.openipf_name_key(_name text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT regexp_replace(public.openipf_fold(regexp_replace(coalesce(_name, ''), '\s*#\d+\s*$', '')), '[^a-z]', '', 'g')
$$;

-- What's typed into the search: plain lowercase words.
CREATE OR REPLACE FUNCTION public.openipf_query_text(_name text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT nullif(btrim(regexp_replace(public.openipf_fold(regexp_replace(coalesce(_name, ''), '\s*#\d+\s*$', '')), '[^a-z]+', ' ', 'g')), '')
$$;

-- The names a person might compete under, at most four, always two words or
-- more: their full name, first + last, preferred + last, the name on their
-- athlete record, and for a three-part name its first two and first + last.
CREATE OR REPLACE FUNCTION public.openipf_name_queries(_full text, _first text, _last text, _preferred text, _other text)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  WITH w AS (SELECT regexp_split_to_array(coalesce(public.openipf_query_text(_full), ''), ' ') p),
  c AS (
    SELECT q, ord FROM (VALUES
      (public.openipf_query_text(_full), 1),
      (public.openipf_query_text(concat_ws(' ', _first, _last)), 2),
      (public.openipf_query_text(concat_ws(' ', _preferred, _last)), 3),
      (public.openipf_query_text(_other), 4),
      ((SELECT CASE WHEN array_length(p, 1) >= 3 THEN p[1] || ' ' || p[2] END FROM w), 5),
      ((SELECT CASE WHEN array_length(p, 1) >= 3 THEN p[1] || ' ' || p[array_length(p, 1)] END FROM w), 6)
    ) v(q, ord)
    WHERE q IS NOT NULL AND position(' ' IN q) > 0
  )
  SELECT coalesce((SELECT array_agg(q ORDER BY ord) FROM (SELECT q, min(ord) ord FROM c GROUP BY q ORDER BY min(ord) LIMIT 4) d), '{}')
$$;

CREATE OR REPLACE FUNCTION public.openipf_sex(_s text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE lower(btrim(coalesce(_s, '')))
    WHEN 'male' THEN 'male' WHEN 'm' THEN 'male' WHEN 'man' THEN 'male'
    WHEN 'female' THEN 'female' WHEN 'f' THEN 'female' WHEN 'woman' THEN 'female'
  END
$$;

-- ---------------------------------------------------------------- who

-- A current coaching client (never a free member, a lead, or an account on its way out).
CREATE OR REPLACE FUNCTION public.openipf_client_eligible(_client uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = _client
      AND c.service_tier = 'coaching'
      AND coalesce(c.archived, false) = false
      AND coalesce(c.status, '') NOT IN ('Archived', 'Deactivated', 'Deleted', 'Lead')
      AND NOT EXISTS (SELECT 1 FROM public.account_deletions d WHERE d.client_id = c.id AND d.status = 'pending')
  )
$$;

-- Who may work a person's OpenIPF link: the admin, or the client's own coach.
-- An alumni record with no client is the admin's.
CREATE OR REPLACE FUNCTION public.openipf_reaches(_client uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR (_client IS NOT NULL
        AND public.has_role(auth.uid(), 'coach'::public.app_role)
        AND _client IN (SELECT public.coached_client_ids()))
  )
$$;

-- Everyone to search: coaching clients and alumni records with no profile linked.
CREATE OR REPLACE FUNCTION public.openipf_targets(_client uuid DEFAULT NULL, _athlete uuid DEFAULT NULL)
RETURNS TABLE (client_id uuid, athlete_id uuid, subject_name text, subject_sex text, queries text[], profile_host text, profile_slug text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id, pa.id,
    coalesce(nullif(btrim(c.full_name), ''), nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), ''), pa.athlete_name, 'Client'),
    coalesce(public.openipf_sex(c.sex), public.openipf_sex(pa.sex)),
    public.openipf_name_queries(c.full_name, c.first_name, c.last_name, c.preferred_name, pa.athlete_name),
    cp.host, cp.slug
  FROM public.clients c
  LEFT JOIN public.powerlifting_athletes pa ON pa.client_id = c.id
  LEFT JOIN LATERAL public.powerlifting_opl_profile(c.openpowerlifting_url) cp ON true
  WHERE _athlete IS NULL
    AND (_client IS NULL OR c.id = _client)
    AND public.openipf_client_eligible(c.id)
    AND (pa.id IS NULL OR (SELECT slug FROM public.powerlifting_opl_profile(pa.openpowerlifting_url)) IS NULL)
  UNION ALL
  SELECT pa.client_id, pa.id, pa.athlete_name, public.openipf_sex(pa.sex),
    public.openipf_name_queries(pa.athlete_name, NULL, NULL, NULL, NULL), NULL, NULL
  FROM public.powerlifting_athletes pa
  LEFT JOIN public.clients c ON c.id = pa.client_id
  WHERE _client IS NULL
    AND (_athlete IS NULL OR pa.id = _athlete)
    AND (SELECT slug FROM public.powerlifting_opl_profile(pa.openpowerlifting_url)) IS NULL
    AND (pa.client_id IS NULL OR (c.service_tier IS DISTINCT FROM 'self_serve' AND NOT public.openipf_client_eligible(pa.client_id)))
$$;

-- ---------------------------------------------------------------- scans

CREATE OR REPLACE FUNCTION public._openipf_scan_start(_client uuid, _athlete uuid, _by uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s uuid;
  t record;
  q text;
  n integer := 0;
BEGIN
  INSERT INTO public.openipf_scans (started_by, client_id, athlete_id) VALUES (_by, _client, _athlete) RETURNING id INTO s;
  FOR t IN SELECT * FROM public.openipf_targets(_client, _athlete) LOOP
    n := n + 1;
    -- the profile someone already saved on their record is read first
    IF t.profile_slug IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.openipf_suggestions x WHERE x.kind = 'match' AND x.subject_id = coalesce(t.client_id, t.athlete_id) AND x.slug = t.profile_slug AND x.status = 'dismissed'
    ) THEN
      INSERT INTO public.openipf_discovery_requests (scan_id, client_id, athlete_id, subject_name, subject_sex, step, host, slug, query)
      VALUES (s, t.client_id, t.athlete_id, t.subject_name, t.subject_sex, 'lifter', t.profile_host, t.profile_slug, 'profile');
    END IF;
    FOREACH q IN ARRAY t.queries LOOP
      INSERT INTO public.openipf_discovery_requests (scan_id, client_id, athlete_id, subject_name, subject_sex, step, host, query, start_index)
      VALUES (s, t.client_id, t.athlete_id, t.subject_name, t.subject_sex, 'search', 'https://www.openipf.org', q, 0);
    END LOOP;
  END LOOP;
  UPDATE public.openipf_scans SET targets = n, finished_at = CASE WHEN n = 0 THEN now() END WHERE id = s;
  RETURN s;
END $$;

-- A search from the app (one client, or everyone for the admin).
CREATE OR REPLACE FUNCTION public.openipf_scan_start(_client uuid DEFAULT NULL, _athlete uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.clients%ROWTYPE;
BEGIN
  IF _client IS NULL AND _athlete IS NULL THEN
    IF NOT public.openipf_reaches(NULL) THEN RAISE EXCEPTION 'Only the admin can search for everyone' USING ERRCODE = '42501'; END IF;
  ELSIF _client IS NOT NULL THEN
    IF NOT public.openipf_reaches(_client) THEN RAISE EXCEPTION 'Not your client' USING ERRCODE = '42501'; END IF;
    SELECT * INTO c FROM public.clients WHERE id = _client;
    IF c.service_tier IS DISTINCT FROM 'coaching' THEN RAISE EXCEPTION 'OpenIPF is for coaching clients'; END IF;
  ELSE
    IF NOT public.openipf_reaches((SELECT client_id FROM public.powerlifting_athletes WHERE id = _athlete)) THEN
      RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
    END IF;
  END IF;
  -- an archived coaching client (alumni) is searched by their athlete record
  IF _client IS NOT NULL AND NOT public.openipf_client_eligible(_client) THEN
    _athlete := (SELECT id FROM public.powerlifting_athletes WHERE client_id = _client);
    IF _athlete IS NULL THEN RAISE EXCEPTION 'They aren''t a current coaching client'; END IF;
    RETURN public._openipf_scan_start(NULL, _athlete, auth.uid());
  END IF;
  RETURN public._openipf_scan_start(_client, _athlete, auth.uid());
END $$;

CREATE OR REPLACE FUNCTION public._openipf_url(r public.openipf_discovery_requests)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE r.step
    WHEN 'search' THEN r.host || '/api/search/rankings?q=' || replace(r.query, ' ', '%20') || '&start=' || coalesce(r.start_index, 0)
    WHEN 'row' THEN r.host || '/api/rankings?start=' || r.start_index || '&end=' || r.start_index || '&lang=en&units=kg'
    ELSE r.host || '/api/liftercsv/' || r.slug
  END
$$;

-- A lifter whose name matches: kept as a suggestion (refreshed while it waits;
-- one the coach turned down is never brought back).
CREATE OR REPLACE FUNCTION public._openipf_upsert_match(r public.openipf_discovery_requests, _slug text, _data jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.openipf_suggestions AS x (
    kind, subject_id, client_id, athlete_id, subject_name, subject_sex, host, slug,
    lifter_name, sex, country, federation, equipment, division, bodyweight_kg, weight_class,
    squat_kg, bench_kg, deadlift_kg, total_kg, points, best_date, born_about,
    meet_count, first_meet, last_meet, last_meet_name, reasons, scan_id)
  VALUES (
    'match', coalesce(r.client_id, r.athlete_id), r.client_id, r.athlete_id, r.subject_name, r.subject_sex, r.host, _slug,
    _data->>'name', _data->>'sex', _data->>'country', _data->>'federation', _data->>'equipment', _data->>'division',
    (_data->>'bw')::numeric, _data->>'class',
    (_data->>'squat')::numeric, (_data->>'bench')::numeric, (_data->>'deadlift')::numeric, (_data->>'total')::numeric,
    (_data->>'points')::numeric, (_data->>'best_date')::date, (_data->>'born')::int,
    (_data->>'meets')::int, (_data->>'first')::date, (_data->>'last')::date, _data->>'last_name',
    CASE WHEN r.query = 'profile' THEN ARRAY['Saved on their profile'] ELSE '{}' END,
    r.scan_id)
  ON CONFLICT (subject_id, slug) WHERE kind = 'match' DO UPDATE SET
    -- OpenIPF's page is the one shown when it's there
    host = CASE WHEN x.host = 'https://www.openipf.org' THEN x.host ELSE excluded.host END,
    lifter_name = coalesce(excluded.lifter_name, x.lifter_name),
    sex = coalesce(excluded.sex, x.sex),
    country = coalesce(excluded.country, x.country),
    federation = coalesce(excluded.federation, x.federation),
    equipment = coalesce(excluded.equipment, x.equipment),
    division = coalesce(excluded.division, x.division),
    bodyweight_kg = coalesce(excluded.bodyweight_kg, x.bodyweight_kg),
    weight_class = coalesce(excluded.weight_class, x.weight_class),
    squat_kg = coalesce(excluded.squat_kg, x.squat_kg),
    bench_kg = coalesce(excluded.bench_kg, x.bench_kg),
    deadlift_kg = coalesce(excluded.deadlift_kg, x.deadlift_kg),
    total_kg = coalesce(excluded.total_kg, x.total_kg),
    points = coalesce(excluded.points, x.points),
    best_date = coalesce(excluded.best_date, x.best_date),
    born_about = coalesce(excluded.born_about, x.born_about),
    meet_count = coalesce(excluded.meet_count, x.meet_count),
    first_meet = coalesce(excluded.first_meet, x.first_meet),
    last_meet = coalesce(excluded.last_meet, x.last_meet),
    last_meet_name = coalesce(excluded.last_meet_name, x.last_meet_name),
    reasons = CASE WHEN r.query = 'profile' AND NOT ('Saved on their profile' = ANY (x.reasons))
      THEN array_append(x.reasons, 'Saved on their profile') ELSE x.reasons END,
    status = CASE WHEN x.status = 'expired' THEN 'pending' ELSE x.status END,
    scan_id = excluded.scan_id,
    updated_at = now()
  WHERE x.status IN ('pending', 'expired');
END $$;

CREATE OR REPLACE FUNCTION public._openipf_plan(r public.openipf_discovery_requests, _step text, _host text, _query text, _slug text, _start integer, _hits integer)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.openipf_discovery_requests (scan_id, client_id, athlete_id, subject_name, subject_sex, step, host, query, slug, start_index, hits)
  SELECT r.scan_id, r.client_id, r.athlete_id, r.subject_name, r.subject_sex, _step, _host, _query, _slug, _start, _hits
  WHERE NOT EXISTS (
    SELECT 1 FROM public.openipf_discovery_requests o
    WHERE o.scan_id = r.scan_id AND o.client_id IS NOT DISTINCT FROM r.client_id AND o.athlete_id IS NOT DISTINCT FROM r.athlete_id
      AND o.step = _step AND o.host = _host
      AND o.query IS NOT DISTINCT FROM _query AND o.slug IS NOT DISTINCT FROM _slug AND o.start_index IS NOT DISTINCT FROM _start
  )
$$;

-- One answer from OpenPowerlifting, and what to ask next.
CREATE OR REPLACE FUNCTION public._openipf_handle(r public.openipf_discovery_requests, _status integer, _content text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  body jsonb;
  rw jsonb;
  idx integer;
  nm text;
  sl text;
  matched boolean;
  data jsonb;
  dismissed boolean;
BEGIN
  IF _status IS DISTINCT FROM 200 THEN
    -- a profile that isn't there any more is simply not suggested
    RETURN jsonb_build_object('error', 'HTTP ' || coalesce(_status::text, '?'));
  END IF;

  IF r.step = 'search' THEN
    body := _content::jsonb;
    idx := (body->>'next_index')::int;
    IF idx IS NULL THEN
      -- nobody (more) by that name on OpenIPF: OpenPowerlifting has every federation
      IF r.host = 'https://www.openipf.org' AND NOT EXISTS (
        SELECT 1 FROM public.openipf_discovery_requests o
        WHERE o.scan_id = r.scan_id AND o.client_id IS NOT DISTINCT FROM r.client_id AND o.athlete_id IS NOT DISTINCT FROM r.athlete_id
          AND o.step = 'row' AND o.host = r.host AND o.query = r.query AND (o.result->>'match')::boolean
      ) THEN
        PERFORM public._openipf_plan(r, 'search', 'https://www.openpowerlifting.org', r.query, NULL, 0, 0);
      END IF;
      RETURN jsonb_build_object('next_index', NULL);
    END IF;
    PERFORM public._openipf_plan(r, 'row', r.host, r.query, NULL, idx, r.hits);
    RETURN jsonb_build_object('next_index', idx);
  END IF;

  IF r.step = 'row' THEN
    body := _content::jsonb;
    rw := body->'rows'->0;
    IF rw IS NULL OR jsonb_typeof(rw) <> 'array' THEN RETURN jsonb_build_object('match', false); END IF;
    nm := rw->>2;
    sl := lower(rw->>3);
    matched := public.openipf_name_key(nm) <> '' AND public.openipf_name_key(nm) = public.openipf_name_key(r.query) AND sl ~ '^[a-z0-9]+$';
    IF matched THEN
      dismissed := EXISTS (
        SELECT 1 FROM public.openipf_suggestions x
        WHERE x.kind = 'match' AND x.subject_id = coalesce(r.client_id, r.athlete_id) AND x.slug = sl AND x.status IN ('dismissed', 'approved')
      );
      IF NOT dismissed THEN
        data := jsonb_build_object(
          'name', regexp_replace(nm, '\s*#\d+\s*$', ''),
          'sex', CASE rw->>13 WHEN 'M' THEN 'male' WHEN 'F' THEN 'female' END,
          'country', nullif(rw->>6, ''),
          'federation', nullif(rw->>8, ''),
          'best_date', nullif(rw->>9, ''),
          'equipment', nullif(rw->>14, ''),
          'division', nullif(rw->>16, ''),
          'bw', nullif(rw->>17, ''),
          'class', nullif(rw->>18, ''),
          'squat', nullif(nullif(rw->>19, ''), '0'),
          'bench', nullif(nullif(rw->>20, ''), '0'),
          'deadlift', nullif(nullif(rw->>21, ''), '0'),
          'total', nullif(nullif(rw->>22, ''), '0'),
          'points', nullif(rw->>23, ''),
          'age', nullif(regexp_replace(coalesce(rw->>15, ''), '[^0-9.]', '', 'g'), ''));
        -- a number OpenPowerlifting couldn't give is left empty, never a failed scan
        BEGIN
          PERFORM (data->>'bw')::numeric, (data->>'squat')::numeric, (data->>'bench')::numeric, (data->>'deadlift')::numeric,
            (data->>'total')::numeric, (data->>'points')::numeric, (data->>'best_date')::date;
        EXCEPTION WHEN others THEN
          data := data - 'bw' - 'squat' - 'bench' - 'deadlift' - 'total' - 'points' - 'best_date';
        END;
        -- the year they were born, by their age at that meet (OpenPowerlifting's "22~" is approximate)
        BEGIN
          data := data || jsonb_build_object('born', extract(year FROM (data->>'best_date')::date)::int - floor((data->>'age')::numeric)::int);
        EXCEPTION WHEN others THEN
          NULL;
        END;
        PERFORM public._openipf_upsert_match(r, sl, data);
        PERFORM public._openipf_plan(r, 'lifter', r.host, NULL, sl, NULL, 0);
      END IF;
    END IF;
    -- the next lifter by that name, five at most (a common name stops there)
    IF r.hits + 1 < 5 THEN
      PERFORM public._openipf_plan(r, 'search', r.host, r.query, NULL, r.start_index + 1, r.hits + 1);
    END IF;
    RETURN jsonb_build_object('match', matched, 'slug', sl);
  END IF;

  -- lifter: their meets, read from the same CSV the sync reads
  IF _content IS NULL OR _content NOT LIKE 'Name,%' THEN RETURN jsonb_build_object('error', 'Not a lifter'); END IF;
  WITH recs AS (
    SELECT rec, nullif(rec->>'Date', '')::date d
    FROM public.opl_csv_records(_content) rec
    WHERE nullif(rec->>'Date', '') IS NOT NULL
  ),
  agg AS (
    SELECT count(DISTINCT d::text || lower(coalesce(rec->>'MeetName', ''))) meets, min(d) first, max(d) last,
      max(nullif(rec->>'Best3SquatKg', '')::numeric) FILTER (WHERE nullif(rec->>'Best3SquatKg', '')::numeric > 0) sq,
      max(nullif(rec->>'Best3BenchKg', '')::numeric) FILTER (WHERE nullif(rec->>'Best3BenchKg', '')::numeric > 0) bp,
      max(nullif(rec->>'Best3DeadliftKg', '')::numeric) FILTER (WHERE nullif(rec->>'Best3DeadliftKg', '')::numeric > 0) dl,
      max(nullif(rec->>'TotalKg', '')::numeric) FILTER (WHERE upper(coalesce(nullif(rec->>'Event', ''), 'SBD')) = 'SBD' AND nullif(rec->>'TotalKg', '')::numeric > 0) tot
    FROM recs
  ),
  latest AS (SELECT rec FROM recs ORDER BY d DESC LIMIT 1)
  SELECT jsonb_build_object(
    'meets', a.meets, 'first', a.first, 'last', a.last,
    'last_name', l.rec->>'MeetName',
    'name', regexp_replace(coalesce(l.rec->>'Name', ''), '\s*#\d+\s*$', ''),
    'sex', CASE l.rec->>'Sex' WHEN 'M' THEN 'male' WHEN 'F' THEN 'female' END,
    'country', nullif(l.rec->>'Country', ''),
    'federation', nullif(l.rec->>'Federation', ''),
    'squat', a.sq, 'bench', a.bp, 'deadlift', a.dl, 'total', a.tot,
    'born', (SELECT extract(year FROM r2.d)::int - floor(nullif(regexp_replace(coalesce(r2.rec->>'Age', ''), '[^0-9.]', '', 'g'), '')::numeric)::int
             FROM recs r2 WHERE nullif(regexp_replace(coalesce(r2.rec->>'Age', ''), '[^0-9.]', '', 'g'), '') IS NOT NULL
             ORDER BY r2.d DESC LIMIT 1))
  INTO data
  FROM agg a, latest l;
  IF data IS NULL THEN RETURN jsonb_build_object('meets', 0); END IF;
  IF r.query = 'profile' THEN
    -- the profile saved on their record: suggested whatever its name
    PERFORM public._openipf_upsert_match(r, r.slug, data);
  ELSE
    UPDATE public.openipf_suggestions x SET
      meet_count = (data->>'meets')::int, first_meet = (data->>'first')::date, last_meet = (data->>'last')::date,
      last_meet_name = data->>'last_name', country = coalesce(data->>'country', x.country),
      born_about = coalesce(x.born_about, (data->>'born')::int),
      squat_kg = coalesce((data->>'squat')::numeric, x.squat_kg), bench_kg = coalesce((data->>'bench')::numeric, x.bench_kg),
      deadlift_kg = coalesce((data->>'deadlift')::numeric, x.deadlift_kg), total_kg = coalesce((data->>'total')::numeric, x.total_kg),
      updated_at = now()
    WHERE x.kind = 'match' AND x.subject_id = coalesce(r.client_id, r.athlete_id) AND x.slug = r.slug AND x.status IN ('pending', 'expired');
  END IF;
  RETURN jsonb_build_object('meets', data->'meets');
END $$;

-- A scan is done: how sure each match is, in words.
CREATE OR REPLACE FUNCTION public._openipf_finish(_scan uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  WITH s AS (
    SELECT x.id, x.subject_sex, x.sex, x.lifter_name, x.subject_name, x.country, x.born_about,
      count(*) OVER (PARTITION BY x.subject_id) n_same,
      'Saved on their profile' = ANY (x.reasons) profile,
      -- what their record says: the year they were born and where they live.
      -- An age at a meet puts the birth year at born_about or the year before
      -- (a year either way for OpenPowerlifting's estimated "22~").
      extract(year FROM c.date_of_birth)::int - x.born_about age_gap,
      nullif(btrim(c.country), '') home
    FROM public.openipf_suggestions x
    LEFT JOIN public.clients c ON c.id = x.client_id
    WHERE x.scan_id = _scan AND x.kind = 'match' AND x.status = 'pending'
  )
  UPDATE public.openipf_suggestions x SET
    confidence = CASE
      WHEN s.profile THEN 'likely'
      WHEN s.n_same = 1 AND (s.subject_sex IS NULL OR s.sex IS NULL OR s.subject_sex = s.sex)
        AND public.openipf_name_key(s.lifter_name) = public.openipf_name_key(s.subject_name)
        AND (s.age_gap IS NULL OR s.age_gap BETWEEN -2 AND 1)
        AND (s.home IS NULL OR s.country IS NULL OR lower(s.home) = lower(s.country)) THEN 'likely'
      ELSE 'possible' END,
    reasons = array_remove(ARRAY[
      CASE WHEN s.profile THEN 'Saved on their profile' END,
      CASE WHEN public.openipf_name_key(s.lifter_name) = public.openipf_name_key(s.subject_name) THEN 'Same name' END,
      CASE WHEN s.subject_sex IS NOT NULL AND s.sex IS NOT NULL THEN
        CASE WHEN s.subject_sex = s.sex THEN 'Same sex' ELSE 'Different sex on file' END END,
      CASE WHEN s.age_gap IS NOT NULL THEN
        CASE WHEN s.age_gap BETWEEN -2 AND 1 THEN 'Same age' ELSE 'Age doesn''t match (born about ' || s.born_about || ')' END END,
      CASE WHEN s.home IS NOT NULL AND s.country IS NOT NULL AND lower(s.home) <> lower(s.country) THEN 'Competes in ' || s.country END,
      CASE WHEN s.n_same > 1 THEN 'One of ' || s.n_same || ' possible profiles' END
    ], NULL),
    updated_at = now()
  FROM s WHERE x.id = s.id;
  UPDATE public.openipf_scans SET
    finished_at = now(),
    found = (SELECT count(*) FROM public.openipf_suggestions x WHERE x.scan_id = _scan AND x.kind = 'match' AND x.status = 'pending')
  WHERE id = _scan AND finished_at IS NULL;
END $$;

-- Collect answers, send the next few requests, close finished scans.
CREATE OR REPLACE FUNCTION public._openipf_step(_scan uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.openipf_discovery_requests%ROWTYPE;
  h record;
  res jsonb;
  rid bigint;
  sent integer := 0;
  got integer := 0;
  sc uuid;
BEGIN
  FOR r IN
    SELECT * FROM public.openipf_discovery_requests
    WHERE state = 'requested' AND (_scan IS NULL OR scan_id = _scan)
    ORDER BY id
    FOR UPDATE SKIP LOCKED
  LOOP
    SELECT resp.status_code, resp.content, resp.error_msg INTO h
    FROM net._http_response resp
    WHERE resp.id = r.request_id AND resp.created >= r.requested_at - interval '5 seconds'
    ORDER BY resp.created DESC LIMIT 1;
    IF NOT FOUND THEN
      IF r.requested_at < now() - interval '3 minutes' THEN
        UPDATE public.openipf_discovery_requests SET state = 'failed', collected_at = now(), result = jsonb_build_object('error', 'No response') WHERE id = r.id;
      END IF;
      CONTINUE;
    END IF;
    BEGIN
      res := public._openipf_handle(r, h.status_code, h.content);
      UPDATE public.openipf_discovery_requests SET state = 'done', collected_at = now(), result = res WHERE id = r.id;
    EXCEPTION WHEN others THEN
      UPDATE public.openipf_discovery_requests SET state = 'failed', collected_at = now(), result = jsonb_build_object('error', sqlerrm) WHERE id = r.id;
    END;
    got := got + 1;
  END LOOP;

  -- a few at a time, so OpenPowerlifting is never flooded
  FOR r IN
    SELECT * FROM public.openipf_discovery_requests
    WHERE state = 'planned' AND (_scan IS NULL OR scan_id = _scan)
    ORDER BY id
    LIMIT CASE WHEN _scan IS NULL THEN 8 ELSE 6 END
    FOR UPDATE SKIP LOCKED
  LOOP
    rid := net.http_get(url := public._openipf_url(r), timeout_milliseconds := 20000);
    UPDATE public.openipf_discovery_requests SET state = 'requested', request_id = rid, requested_at = now() WHERE id = r.id;
    sent := sent + 1;
  END LOOP;

  FOR sc IN
    SELECT s.id FROM public.openipf_scans s
    WHERE s.finished_at IS NULL AND (_scan IS NULL OR s.id = _scan)
      AND NOT EXISTS (SELECT 1 FROM public.openipf_discovery_requests o WHERE o.scan_id = s.id AND o.state IN ('planned', 'requested'))
  LOOP
    PERFORM public._openipf_finish(sc);
  END LOOP;

  DELETE FROM public.openipf_discovery_requests WHERE planned_at < now() - interval '60 days';
  RETURN jsonb_build_object('collected', got, 'sent', sent);
END $$;

-- The app's poll while it waits on one search (the client's profile, Cleo).
CREATE OR REPLACE FUNCTION public.openipf_scan_step(_scan uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.openipf_scans%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.openipf_scans WHERE id = _scan;
  IF NOT FOUND THEN RAISE EXCEPTION 'No such search'; END IF;
  IF NOT public.openipf_reaches(coalesce(s.client_id, (SELECT client_id FROM public.powerlifting_athletes WHERE id = s.athlete_id))) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF s.finished_at IS NULL THEN PERFORM public._openipf_step(_scan); END IF;
  SELECT * INTO s FROM public.openipf_scans WHERE id = _scan;
  RETURN jsonb_build_object(
    'done', s.finished_at IS NOT NULL,
    'targets', s.targets,
    'suggestions', coalesce((
      SELECT jsonb_agg(x.id ORDER BY x.confidence = 'likely' DESC, x.total_kg DESC NULLS LAST)
      FROM public.openipf_suggestions x WHERE x.scan_id = _scan AND x.kind = 'match' AND x.status = 'pending'), '[]'));
END $$;

-- The tick (pg_cron every minute): the queue, then the push for what's ready.
CREATE OR REPLACE FUNCTION public.openipf_tick()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  res jsonb := public._openipf_step(NULL);
  last_post timestamptz;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.openipf_suggestions x
    LEFT JOIN public.openipf_scans s ON s.id = x.scan_id
    WHERE x.status = 'pending' AND x.notified_at IS NULL
      AND (x.kind = 'new_meet' OR s.id IS NULL OR s.finished_at IS NOT NULL)
  ) THEN
    SELECT nullif(value, '')::timestamptz INTO last_post FROM public.app_settings WHERE key = 'openipf_notify_posted_at';
    IF last_post IS NULL OR last_post < now() - interval '15 minutes' THEN
      INSERT INTO public.app_settings (key, value, updated_at) VALUES ('openipf_notify_posted_at', now()::text, now())
      ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now();
      PERFORM net.http_post(
        url := 'https://project--5f1f340c-5afa-4262-90c8-1f9406568c6c.lovable.app/api/public/hooks/openipf-notify',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-hook-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_hook_secret' LIMIT 1)),
        body := '{}'::jsonb,
        timeout_milliseconds := 120000);
      res := res || jsonb_build_object('notify', true);
    END IF;
  END IF;
  RETURN res;
END $$;

-- ---------------------------------------------------------------- link

CREATE OR REPLACE FUNCTION public._openipf_link(_client uuid, _athlete uuid, _host text, _slug text, _sex text, _by uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a public.powerlifting_athletes%ROWTYPE;
  c public.clients%ROWTYPE;
  url text;
  other text;
  created boolean := false;
  rid bigint[];
BEGIN
  IF _slug IS NULL OR _slug !~ '^[a-z0-9]+$' THEN RAISE EXCEPTION 'That isn''t an OpenIPF profile link'; END IF;
  IF _host NOT IN ('https://www.openipf.org', 'https://www.openpowerlifting.org') THEN RAISE EXCEPTION 'Only OpenIPF and OpenPowerlifting profiles'; END IF;
  url := _host || '/u/' || _slug;

  IF _client IS NOT NULL THEN
    SELECT * INTO c FROM public.clients WHERE id = _client;
    IF NOT FOUND THEN RAISE EXCEPTION 'No such client'; END IF;
    IF c.service_tier IS DISTINCT FROM 'coaching' THEN RAISE EXCEPTION 'OpenIPF is for coaching clients'; END IF;
    SELECT * INTO a FROM public.powerlifting_athletes WHERE client_id = _client;
    IF NOT FOUND THEN
      IF coalesce(public.openipf_sex(c.sex), public.openipf_sex(_sex)) IS NULL THEN
        RAISE EXCEPTION 'Add their sex on their profile first';
      END IF;
      INSERT INTO public.powerlifting_athletes (client_id, athlete_name, sex, status, auto_sync)
      VALUES (_client,
        coalesce(nullif(btrim(c.full_name), ''), nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), ''), 'Client'),
        coalesce(public.openipf_sex(c.sex), public.openipf_sex(_sex)),
        CASE WHEN public.openipf_client_eligible(_client) THEN 'active' ELSE 'retired' END,
        true)
      RETURNING * INTO a;
      created := true;
    END IF;
  ELSE
    SELECT * INTO a FROM public.powerlifting_athletes WHERE id = _athlete;
    IF NOT FOUND THEN RAISE EXCEPTION 'No such athlete'; END IF;
  END IF;

  SELECT x.athlete_name INTO other FROM public.powerlifting_athletes x
  WHERE x.id <> a.id AND (SELECT slug FROM public.powerlifting_opl_profile(x.openpowerlifting_url)) = _slug
  LIMIT 1;
  IF other IS NOT NULL THEN RAISE EXCEPTION 'That profile is already linked to %', other; END IF;

  UPDATE public.powerlifting_athletes SET
    openpowerlifting_url = url,
    auto_sync = true,
    -- a profile new to this person: its first import is history, never "new meets"
    opl_synced_at = CASE WHEN (SELECT slug FROM public.powerlifting_opl_profile(openpowerlifting_url)) IS DISTINCT FROM _slug THEN NULL ELSE opl_synced_at END,
    opl_sync_status = 'Syncing',
    updated_at = now()
  WHERE id = a.id;
  IF a.client_id IS NOT NULL THEN
    PERFORM set_config('jf.openipf_linking', 'on', true);
    UPDATE public.clients SET openpowerlifting_url = url WHERE id = a.client_id AND openpowerlifting_url IS DISTINCT FROM url;
  END IF;

  -- the person's matches are settled: this one approved, any other no longer needed
  UPDATE public.openipf_suggestions SET
    status = CASE WHEN slug = _slug THEN 'approved' ELSE 'expired' END,
    decided_by = CASE WHEN slug = _slug THEN _by ELSE decided_by END,
    decided_at = CASE WHEN slug = _slug THEN now() ELSE decided_at END,
    created_athlete_id = CASE WHEN slug = _slug AND created THEN a.id ELSE created_athlete_id END,
    updated_at = now()
  WHERE kind = 'match' AND subject_id = coalesce(a.client_id, a.id) AND status IN ('pending', 'expired');

  rid := public.powerlifting_opl_request(a.id);
  RETURN jsonb_build_object('athlete_id', a.id, 'url', url, 'request_id', rid[1], 'created', created);
END $$;

-- Link a profile by its link (the client's profile, Cleo's card).
CREATE OR REPLACE FUNCTION public.openipf_link_url(_client uuid, _athlete uuid, _url text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p record;
BEGIN
  IF NOT public.openipf_reaches(coalesce(_client, (SELECT client_id FROM public.powerlifting_athletes WHERE id = _athlete))) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO p FROM public.powerlifting_opl_profile(_url);
  IF p.slug IS NULL OR coalesce(_url, '') !~* '(openipf|openpowerlifting)\.org/u/' THEN
    RAISE EXCEPTION 'Paste their OpenIPF profile link (openipf.org/u/…)';
  END IF;
  RETURN public._openipf_link(_client, CASE WHEN _client IS NULL THEN _athlete END, p.host, p.slug, NULL, auth.uid());
END $$;

-- Remove: what the link added comes off and is kept for Add back; meets entered before stay.
CREATE OR REPLACE FUNCTION public._openipf_unlink(_athlete uuid, _by uuid, _back_to_queue boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a public.powerlifting_athletes%ROWTYPE;
  p record;
  h uuid;
  snap jsonb;
  n integer;
BEGIN
  SELECT * INTO a FROM public.powerlifting_athletes WHERE id = _athlete FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No such athlete'; END IF;
  SELECT * INTO p FROM public.powerlifting_opl_profile(a.openpowerlifting_url);
  IF p.slug IS NULL THEN RAISE EXCEPTION 'No OpenIPF profile is linked'; END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(r) - 'total_kg' ORDER BY r.meet_date), '[]'::jsonb), count(*)
  INTO snap, n
  FROM public.athlete_powerlifting_results r
  WHERE r.athlete_id = a.id AND r.source = 'OpenPowerlifting' AND r.source_key LIKE 'opl:' || p.slug || ':%';

  INSERT INTO public.openipf_link_history (athlete_id, client_id, url, removed_by, result_rows, meet_count)
  VALUES (a.id, a.client_id, a.openpowerlifting_url, _by, snap, n)
  RETURNING id INTO h;

  DELETE FROM public.athlete_powerlifting_results r
  WHERE r.athlete_id = a.id AND r.source = 'OpenPowerlifting' AND r.source_key LIKE 'opl:' || p.slug || ':%';

  UPDATE public.powerlifting_athletes SET
    openpowerlifting_url = NULL, auto_sync = false, opl_synced_at = NULL,
    opl_sync_status = 'Removed', opl_meet_count = NULL, updated_at = now()
  WHERE id = a.id;
  IF a.client_id IS NOT NULL THEN
    PERFORM set_config('jf.openipf_linking', 'on', true);
    UPDATE public.clients SET openpowerlifting_url = NULL WHERE id = a.client_id AND openpowerlifting_url IS NOT NULL;
  END IF;

  -- Undo of an approval goes back in the queue; a removal is never suggested again
  UPDATE public.openipf_suggestions SET
    status = CASE WHEN _back_to_queue THEN 'pending' ELSE 'dismissed' END,
    decided_by = CASE WHEN _back_to_queue THEN NULL ELSE _by END,
    decided_at = CASE WHEN _back_to_queue THEN NULL ELSE now() END,
    updated_at = now()
  WHERE kind = 'match' AND subject_id = coalesce(a.client_id, a.id) AND slug = p.slug;
  -- Undo of an approval also brings back the other matches it had set aside
  IF _back_to_queue THEN
    UPDATE public.openipf_suggestions SET status = 'pending', updated_at = now()
    WHERE kind = 'match' AND subject_id = coalesce(a.client_id, a.id) AND status = 'expired';
  END IF;
  RETURN h;
END $$;

CREATE OR REPLACE FUNCTION public.openipf_unlink(_athlete uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.openipf_reaches((SELECT client_id FROM public.powerlifting_athletes WHERE id = _athlete)) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN public._openipf_unlink(_athlete, auth.uid(), false);
END $$;

-- Add back: the same rows and the link, then a sync for anything newer.
CREATE OR REPLACE FUNCTION public.openipf_restore(_history uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  h public.openipf_link_history%ROWTYPE;
  a public.powerlifting_athletes%ROWTYPE;
  p record;
  other text;
  n integer;
  rid bigint[];
BEGIN
  SELECT * INTO h FROM public.openipf_link_history WHERE id = _history FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nothing to add back'; END IF;
  SELECT * INTO a FROM public.powerlifting_athletes WHERE id = h.athlete_id FOR UPDATE;
  IF NOT public.openipf_reaches(a.client_id) THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF h.restored_at IS NOT NULL THEN RAISE EXCEPTION 'It''s already back'; END IF;
  IF (SELECT slug FROM public.powerlifting_opl_profile(a.openpowerlifting_url)) IS NOT NULL THEN
    RAISE EXCEPTION 'Another profile is linked now. Remove it first.';
  END IF;
  SELECT * INTO p FROM public.powerlifting_opl_profile(h.url);
  SELECT x.athlete_name INTO other FROM public.powerlifting_athletes x
  WHERE x.id <> a.id AND (SELECT slug FROM public.powerlifting_opl_profile(x.openpowerlifting_url)) = p.slug LIMIT 1;
  IF other IS NOT NULL THEN RAISE EXCEPTION 'That profile is linked to % now', other; END IF;

  PERFORM set_config('jf.openipf_restore', 'on', true);
  INSERT INTO public.athlete_powerlifting_results (
    id, client_id, athlete_name, sex, bodyweight_kg, squat_kg, bench_kg, deadlift_kg, points, points_system,
    meet_name, meet_location, meet_date, competition_level, notes, created_at, updated_at, athlete_id, source, source_key,
    weight_class_kg, federation, gl_points, dots_points, place, division, equipment, event, meet_town, parent_federation,
    tested, sanctioned, attempts)
  SELECT
    x.id, a.client_id, x.athlete_name, x.sex, x.bodyweight_kg, x.squat_kg, x.bench_kg, x.deadlift_kg, x.points, x.points_system,
    x.meet_name, x.meet_location, x.meet_date, x.competition_level, x.notes, x.created_at, now(), a.id, x.source, x.source_key,
    x.weight_class_kg, x.federation, x.gl_points, x.dots_points, x.place, x.division, x.equipment, x.event, x.meet_town, x.parent_federation,
    x.tested, x.sanctioned, x.attempts
  FROM jsonb_populate_recordset(NULL::public.athlete_powerlifting_results, h.result_rows) x
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;

  UPDATE public.powerlifting_athletes SET
    openpowerlifting_url = h.url, auto_sync = true,
    -- what came back is known; a meet the sync finds now is new
    opl_synced_at = now(), opl_sync_status = 'Syncing', updated_at = now()
  WHERE id = a.id;
  IF a.client_id IS NOT NULL THEN
    PERFORM set_config('jf.openipf_linking', 'on', true);
    UPDATE public.clients SET openpowerlifting_url = h.url WHERE id = a.client_id AND openpowerlifting_url IS DISTINCT FROM h.url;
  END IF;
  UPDATE public.openipf_suggestions s SET result_id = r.id, updated_at = now()
  FROM public.athlete_powerlifting_results r
  WHERE s.kind = 'new_meet' AND s.athlete_id = a.id AND s.result_id IS NULL AND r.athlete_id = a.id AND r.source_key = s.source_key;
  UPDATE public.openipf_suggestions SET status = 'approved', decided_by = auth.uid(), decided_at = now(), updated_at = now()
  WHERE kind = 'match' AND subject_id = coalesce(a.client_id, a.id) AND slug = p.slug AND status <> 'approved';
  UPDATE public.openipf_link_history SET restored_at = now(), restored_by = auth.uid() WHERE id = h.id;
  rid := public.powerlifting_opl_request(a.id);
  RETURN jsonb_build_object('athlete_id', a.id, 'restored', n, 'request_id', rid[1]);
END $$;

-- Approve / Not them / Got it, and Undo of any of them.
CREATE OR REPLACE FUNCTION public.openipf_decide(_suggestion uuid, _action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s public.openipf_suggestions%ROWTYPE;
  ath uuid;
  res jsonb;
BEGIN
  SELECT * INTO s FROM public.openipf_suggestions WHERE id = _suggestion FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not found'; END IF;
  IF NOT public.openipf_reaches(s.client_id) THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;

  IF _action = 'approve' THEN
    IF s.kind = 'new_meet' THEN
      UPDATE public.openipf_suggestions SET status = 'seen', decided_by = auth.uid(), decided_at = now(), updated_at = now() WHERE id = s.id;
      RETURN jsonb_build_object('status', 'seen');
    END IF;
    IF s.status <> 'pending' THEN RAISE EXCEPTION 'Already decided'; END IF;
    res := public._openipf_link(s.client_id, CASE WHEN s.client_id IS NULL THEN s.athlete_id END, s.host, s.slug, s.sex, auth.uid());
    RETURN res || jsonb_build_object('status', 'approved');
  ELSIF _action = 'dismiss' THEN
    UPDATE public.openipf_suggestions SET
      status = CASE WHEN s.kind = 'match' THEN 'dismissed' ELSE 'seen' END,
      decided_by = auth.uid(), decided_at = now(), updated_at = now()
    WHERE id = s.id AND status = 'pending';
    RETURN jsonb_build_object('status', CASE WHEN s.kind = 'match' THEN 'dismissed' ELSE 'seen' END);
  ELSIF _action = 'undo' THEN
    IF s.kind = 'match' AND s.status = 'approved' THEN
      ath := coalesce((SELECT id FROM public.powerlifting_athletes WHERE client_id = s.client_id), s.athlete_id);
      IF ath IS NOT NULL AND (SELECT (SELECT p.slug FROM public.powerlifting_opl_profile(x.openpowerlifting_url) p) FROM public.powerlifting_athletes x WHERE x.id = ath) = s.slug THEN
        PERFORM public._openipf_unlink(ath, auth.uid(), true);
      ELSE
        UPDATE public.openipf_suggestions SET status = 'pending', decided_by = NULL, decided_at = NULL, updated_at = now() WHERE id = s.id;
      END IF;
      -- an athlete record the approval made goes again, while nothing else is on it
      IF s.created_athlete_id IS NOT NULL THEN
        DELETE FROM public.powerlifting_athletes x
        WHERE x.id = s.created_athlete_id AND x.openpowerlifting_url IS NULL
          AND NOT EXISTS (SELECT 1 FROM public.athlete_powerlifting_results r WHERE r.athlete_id = x.id)
          AND NOT EXISTS (SELECT 1 FROM public.powerlifting_coaching_periods cp WHERE cp.athlete_id = x.id);
        UPDATE public.openipf_suggestions SET created_athlete_id = NULL WHERE id = s.id;
      END IF;
    ELSIF s.status IN ('dismissed', 'seen') THEN
      UPDATE public.openipf_suggestions SET status = 'pending', decided_by = NULL, decided_at = NULL, updated_at = now() WHERE id = s.id;
    END IF;
    RETURN jsonb_build_object('status', 'pending');
  END IF;
  RAISE EXCEPTION 'Unknown action %', _action;
END $$;

-- Where a person's link stands (the client's profile, Cleo).
CREATE OR REPLACE FUNCTION public.openipf_status(_client uuid DEFAULT NULL, _athlete uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE
  a public.powerlifting_athletes%ROWTYPE;
  c public.clients%ROWTYPE;
  subj uuid;
BEGIN
  IF _client IS NOT NULL THEN
    SELECT * INTO c FROM public.clients WHERE id = _client;
    SELECT * INTO a FROM public.powerlifting_athletes WHERE client_id = _client;
  ELSE
    SELECT * INTO a FROM public.powerlifting_athletes WHERE id = _athlete;
  END IF;
  IF NOT public.openipf_reaches(coalesce(_client, a.client_id)) THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  subj := coalesce(_client, a.client_id, a.id);
  RETURN jsonb_build_object(
    'eligible', _client IS NULL OR c.service_tier = 'coaching',
    'athlete_id', a.id,
    'url', a.openpowerlifting_url,
    'linked', (SELECT slug FROM public.powerlifting_opl_profile(a.openpowerlifting_url)) IS NOT NULL,
    'meet_count', (SELECT count(*) FROM public.athlete_powerlifting_results r WHERE r.athlete_id = a.id),
    'last_meet', (SELECT max(r.meet_date) FROM public.athlete_powerlifting_results r WHERE r.athlete_id = a.id),
    'synced_at', a.opl_synced_at,
    'sync_status', a.opl_sync_status,
    'pending', (SELECT count(*) FROM public.openipf_suggestions x WHERE x.subject_id = subj AND x.status = 'pending'),
    'history', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', h.id, 'url', h.url, 'removed_at', h.removed_at, 'meet_count', h.meet_count) ORDER BY h.removed_at DESC)
      FROM (SELECT * FROM public.openipf_link_history h WHERE h.athlete_id = a.id AND h.restored_at IS NULL ORDER BY h.removed_at DESC LIMIT 3) h), '[]'));
END $$;

-- A coach saving a profile link on the client's record links it (the sync
-- only ever read the athlete record, so a link typed there did nothing).
-- Clearing it doesn't remove anything: Remove is its own action.
CREATE OR REPLACE FUNCTION public.tg_clients_openipf_link()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p record;
  cur text;
BEGIN
  IF current_setting('jf.openipf_linking', true) = 'on' THEN RETURN NEW; END IF;
  IF NEW.service_tier IS DISTINCT FROM 'coaching' THEN RETURN NEW; END IF;
  SELECT * INTO p FROM public.powerlifting_opl_profile(NEW.openpowerlifting_url);
  IF p.slug IS NULL OR coalesce(NEW.openpowerlifting_url, '') !~* '(openipf|openpowerlifting)\.org/u/' THEN RETURN NEW; END IF;
  SELECT (SELECT slug FROM public.powerlifting_opl_profile(x.openpowerlifting_url)) INTO cur FROM public.powerlifting_athletes x WHERE x.client_id = NEW.id;
  IF cur = p.slug THEN RETURN NEW; END IF;
  BEGIN
    PERFORM public._openipf_link(NEW.id, NULL, p.host, p.slug, NULL, auth.uid());
  EXCEPTION WHEN others THEN
    -- a link that can't be made (no sex on file, someone else's profile) never stops the profile saving
    RAISE WARNING 'OpenIPF link for client % not made: %', NEW.id, sqlerrm;
  END;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS clients_openipf_link ON public.clients;
CREATE TRIGGER clients_openipf_link AFTER UPDATE OF openpowerlifting_url ON public.clients
  FOR EACH ROW WHEN (NEW.openpowerlifting_url IS DISTINCT FROM OLD.openpowerlifting_url)
  EXECUTE FUNCTION public.tg_clients_openipf_link();

-- A meet the sync adds to a profile it had already read: news for the coach,
-- with the records it set. The first import is history (opl_synced_at is still
-- empty), and a free member's meets are never news.
CREATE OR REPLACE FUNCTION public.tg_openipf_new_meet()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a public.powerlifting_athletes%ROWTYPE;
  tier text;
  cname text;
  p record;
  prev record;
  prs text[] := '{}';
BEGIN
  IF current_setting('jf.openipf_restore', true) = 'on' THEN RETURN NEW; END IF;
  IF NEW.source IS DISTINCT FROM 'OpenPowerlifting' OR coalesce(NEW.source_key, '') NOT LIKE 'opl:%' THEN RETURN NEW; END IF;
  SELECT * INTO a FROM public.powerlifting_athletes WHERE id = NEW.athlete_id;
  IF NOT FOUND OR a.opl_synced_at IS NULL THEN RETURN NEW; END IF;
  IF a.client_id IS NOT NULL THEN
    SELECT c.service_tier, coalesce(nullif(btrim(c.full_name), ''), nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), ''))
    INTO tier, cname FROM public.clients c WHERE c.id = a.client_id;
    IF tier = 'self_serve' THEN RETURN NEW; END IF;
  END IF;
  SELECT * INTO p FROM public.powerlifting_opl_profile(a.openpowerlifting_url);
  SELECT
    max(r.squat_kg) FILTER (WHERE r.squat_kg > 0) sq,
    max(r.bench_kg) FILTER (WHERE r.bench_kg > 0) bp,
    max(r.deadlift_kg) FILTER (WHERE r.deadlift_kg > 0) dl,
    max(r.total_kg) FILTER (WHERE r.squat_kg > 0 AND r.deadlift_kg > 0) tot
  INTO prev
  FROM public.athlete_powerlifting_results r
  WHERE r.athlete_id = NEW.athlete_id AND r.id <> NEW.id;
  IF NEW.squat_kg > 0 AND prev.sq IS NOT NULL AND NEW.squat_kg > prev.sq THEN prs := array_append(prs, 'squat'); END IF;
  IF NEW.bench_kg > 0 AND prev.bp IS NOT NULL AND NEW.bench_kg > prev.bp THEN prs := array_append(prs, 'bench'); END IF;
  IF NEW.deadlift_kg > 0 AND prev.dl IS NOT NULL AND NEW.deadlift_kg > prev.dl THEN prs := array_append(prs, 'deadlift'); END IF;
  IF NEW.squat_kg > 0 AND NEW.deadlift_kg > 0 AND prev.tot IS NOT NULL AND NEW.total_kg > prev.tot THEN prs := array_append(prs, 'total'); END IF;
  INSERT INTO public.openipf_suggestions (
    kind, subject_id, client_id, athlete_id, subject_name, host, slug, lifter_name, sex, federation, equipment, division,
    bodyweight_kg, weight_class, squat_kg, bench_kg, deadlift_kg, total_kg, points,
    result_id, source_key, meet_name, meet_date, prs, status)
  VALUES (
    'new_meet', coalesce(a.client_id, a.id), a.client_id, a.id, coalesce(cname, a.athlete_name), p.host, p.slug, NEW.athlete_name, NEW.sex,
    NEW.federation, NEW.equipment, NEW.division, NEW.bodyweight_kg, NEW.weight_class_kg,
    nullif(NEW.squat_kg, 0), nullif(NEW.bench_kg, 0), nullif(NEW.deadlift_kg, 0), nullif(NEW.total_kg, 0), coalesce(NEW.gl_points, NEW.points),
    NEW.id, NEW.source_key, NEW.meet_name, NEW.meet_date, prs, 'pending')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS openipf_new_meet ON public.athlete_powerlifting_results;
CREATE TRIGGER openipf_new_meet AFTER INSERT ON public.athlete_powerlifting_results
  FOR EACH ROW EXECUTE FUNCTION public.tg_openipf_new_meet();

-- ---------------------------------------------------------------- grants

REVOKE ALL ON FUNCTION
  public.openipf_client_eligible(uuid), public.openipf_reaches(uuid), public.openipf_targets(uuid, uuid),
  public._openipf_scan_start(uuid, uuid, uuid), public.openipf_scan_start(uuid, uuid), public._openipf_url(public.openipf_discovery_requests),
  public._openipf_upsert_match(public.openipf_discovery_requests, text, jsonb),
  public._openipf_plan(public.openipf_discovery_requests, text, text, text, text, integer, integer),
  public._openipf_handle(public.openipf_discovery_requests, integer, text), public._openipf_finish(uuid), public._openipf_step(uuid),
  public.openipf_scan_step(uuid), public.openipf_tick(), public._openipf_link(uuid, uuid, text, text, text, uuid),
  public.openipf_link_url(uuid, uuid, text), public._openipf_unlink(uuid, uuid, boolean), public.openipf_unlink(uuid),
  public.openipf_restore(uuid), public.openipf_decide(uuid, text), public.openipf_status(uuid, uuid),
  public.tg_clients_openipf_link(), public.tg_openipf_new_meet()
FROM PUBLIC, anon, authenticated;
-- The app's calls, each checking who's asking itself.
GRANT EXECUTE ON FUNCTION
  public.openipf_scan_start(uuid, uuid), public.openipf_scan_step(uuid), public.openipf_link_url(uuid, uuid, text),
  public.openipf_unlink(uuid), public.openipf_restore(uuid), public.openipf_decide(uuid, text), public.openipf_status(uuid, uuid)
TO authenticated;
GRANT EXECUTE ON FUNCTION public.openipf_tick(), public._openipf_scan_start(uuid, uuid, uuid) TO service_role;

-- ---------------------------------------------------------------- jobs

DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('openipf-tick', 'openipf-monthly-scan');
  -- the queue: cheap when there's nothing in it
  PERFORM cron.schedule('openipf-tick', '* * * * *', $cmd$ SELECT public.openipf_tick(); $cmd$);
  -- every coaching client and alumni record with no profile, the 1st of each month at 10:41 Winnipeg
  PERFORM cron.schedule('openipf-monthly-scan', '41 15 1 * *', $cmd$ SELECT public._openipf_scan_start(NULL, NULL, NULL); $cmd$);
EXCEPTION
  WHEN undefined_table OR undefined_function THEN NULL;
END $$;
