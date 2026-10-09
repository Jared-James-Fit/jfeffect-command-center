-- Powerlifting careers: every meet from each athlete's OpenPowerlifting
-- profile, kept in sync, with the meet's level, the placing and whether
-- JF Effect coached it.
--
--  * Sync: the database fetches each linked athlete's OpenPowerlifting CSV
--    (pg_net), parses it and merges it into athlete_powerlifting_results.
--    New meets are added; existing rows (entered by hand or imported before)
--    keep their numbers and only gain what was missing (placing, division,
--    equipment, attempts, ...). Runs from one pg_cron job: collect finished
--    downloads every 15 minutes, start a fresh round about once a day.
--    Athletes with auto_sync off are skipped; a coach can sync anyone now.
--  * Level: worked out from the meet itself (name + federation), so the same
--    meet always gets the same level: international, national, regional,
--    provincial (or state), local.
--  * Coached: a meet inside one of the athlete's coaching periods (and the
--    country restriction, if any), the same rule as the Competition board.
--  * get_powerlifting_career(): one athlete's whole career for the app;
--    get_powerlifting_athlete_tiers(): each athlete's highest level and best
--    finish there, for the badges on the boards.

-- ── Columns ───────────────────────────────────────────────────────────────
alter table public.athlete_powerlifting_results
  add column if not exists place text,
  add column if not exists division text,
  add column if not exists equipment text,
  add column if not exists event text,
  add column if not exists meet_town text,
  add column if not exists parent_federation text,
  add column if not exists tested boolean,
  add column if not exists sanctioned boolean,
  add column if not exists attempts jsonb;

alter table public.powerlifting_athletes
  add column if not exists opl_synced_at timestamptz,
  add column if not exists opl_sync_status text,
  add column if not exists opl_meet_count integer;

-- ── Meet level ────────────────────────────────────────────────────────────
create or replace function public.powerlifting_meet_level(_name text, _federation text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select case
    -- Continental / world federations, and world-level meet names.
    when coalesce(_federation, '') ~* '^(ipf|napf|commonwealthpf|epf|asianpf|oceaniapf|africanpf|fesupo|orpf)$'
      or coalesce(_name, '') ~* '\m(worlds?|commonwealth|north american|pan ?am(erican)?|arnold|asian|european|oceania|african)\M'
      then 'international'
    when coalesce(_name, '') ~* '\mnationals\M'
      or coalesce(_name, '') ~* '\mnational (raw |classic |open |powerlifting |bench press |equipped )*championships?\M'
      or (coalesce(_name, '') ~* '\mcanadian (powerlifting |classic |open |raw )*championships?\M'
          and coalesce(_name, '') !~* '\m(western|eastern|central|atlantic) canadian\M')
      then 'national'
    when coalesce(_name, '') ~* '\m(western|eastern|central|atlantic) canadian\M'
      or coalesce(_name, '') ~* '\m(easterns|westerns|regionals?|prairies?)\M'
      then 'regional'
    when coalesce(_name, '') !~* '\m(prep|preparation)\M'
      and (coalesce(_name, '') ~* '\mprovincials?\M'
        or coalesce(_name, '') ~* '\mstate (powerlifting |raw |classic )*championships?\M'
        or (coalesce(_name, '') ~* '^(mpa|opa|apu|spa|bcpa|nspa|npa|pepa|nbpa|nlpa|fqd|fqdf)\M'
            and coalesce(_name, '') ~* 'championship'))
      then 'provincial'
    else 'local'
  end
$$;

-- ── CSV → records ─────────────────────────────────────────────────────────
-- One jsonb object per data line, keyed by the header. Handles quoted fields
-- ("a, b") and doubled quotes.
create or replace function public.opl_csv_records(_csv text)
returns setof jsonb
language sql
immutable
set search_path to 'public'
as $$
  with lines as (
    select l, n from regexp_split_to_table(coalesce(_csv, ''), E'\r?\n') with ordinality t(l, n)
    where l <> ''
  ),
  cells as (
    select ln.n, f.i,
      case when f.m[1] like '"%"' then replace(substr(f.m[1], 2, length(f.m[1]) - 2), '""', '"') else f.m[1] end v
    from lines ln
    cross join lateral regexp_matches(ln.l, '(?:^|,)("(?:[^"]|"")*"|[^,]*)', 'g') with ordinality f(m, i)
  ),
  header as (select array_agg(v order by i) h from cells where n = 1)
  select jsonb_object_agg(h.h[c.i], c.v)
  from cells c, header h
  where c.n > 1 and c.i <= coalesce(array_length(h.h, 1), 0)
  group by c.n
  order by c.n
$$;

-- ── Merge one athlete's CSV ───────────────────────────────────────────────
create or replace function public.powerlifting_opl_apply(_athlete uuid, _slug text, _csv text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  a public.powerlifting_athletes%rowtype;
  e record;
  existing uuid;
  ins integer := 0;
  upd integer := 0;
  n integer := 0;
begin
  select * into a from public.powerlifting_athletes where id = _athlete;
  if not found then raise exception 'Unknown athlete %', _athlete; end if;

  for e in
    with recs as (
      select r,
        nullif(r->>'Date', '')::date d,
        upper(coalesce(nullif(r->>'Event', ''), 'SBD')) ev
      from public.opl_csv_records(_csv) r
      where nullif(r->>'Date', '') is not null
    ),
    -- One entry per meet and event (OpenPowerlifting lists the same lifts
    -- again for each division entered): Open first, then the best total.
    picked as (
      select distinct on (d, lower(r->>'MeetName'), ev) *
      from recs
      order by d, lower(r->>'MeetName'), ev,
        (lower(coalesce(r->>'Division', '')) = 'open') desc,
        nullif(r->>'TotalKg', '')::numeric desc nulls last
    )
    select p.d, p.ev,
      case when p.ev = 'B' then 'B' else 'SBD' end kind,
      regexp_replace(trim(r->>'Name'), '\s*#\d+$', '') entered_name,
      case upper(coalesce(r->>'Sex', '')) when 'F' then 'female' when 'M' then 'male' end sex,
      nullif(r->>'BodyweightKg', '')::numeric bw,
      nullif(r->>'WeightClassKg', '') wc,
      case when nullif(r->>'Best3SquatKg', '')::numeric > 0 then (r->>'Best3SquatKg')::numeric end sq,
      case when nullif(r->>'Best3BenchKg', '')::numeric > 0 then (r->>'Best3BenchKg')::numeric end bp,
      case when nullif(r->>'Best3DeadliftKg', '')::numeric > 0 then (r->>'Best3DeadliftKg')::numeric end dl,
      case when nullif(r->>'TotalKg', '')::numeric > 0 then (r->>'TotalKg')::numeric end tot,
      nullif(r->>'Goodlift', '')::numeric gl,
      nullif(r->>'Dots', '')::numeric dots,
      nullif(r->>'Place', '') place,
      nullif(r->>'Division', '') division,
      nullif(r->>'Equipment', '') equipment,
      nullif(r->>'Federation', '') federation,
      nullif(r->>'ParentFederation', '') parent,
      nullif(r->>'MeetName', '') meet_name,
      nullif(r->>'MeetTown', '') town,
      nullif(concat_ws('-', nullif(r->>'MeetCountry', ''), nullif(r->>'MeetState', '')), '') location,
      case lower(coalesce(r->>'Tested', '')) when 'yes' then true when 'no' then false end tested,
      case lower(coalesce(r->>'Sanctioned', '')) when 'yes' then true when 'no' then false end sanctioned,
      jsonb_build_object(
        's', jsonb_build_array(nullif(r->>'Squat1Kg', '')::numeric, nullif(r->>'Squat2Kg', '')::numeric, nullif(r->>'Squat3Kg', '')::numeric),
        'b', jsonb_build_array(nullif(r->>'Bench1Kg', '')::numeric, nullif(r->>'Bench2Kg', '')::numeric, nullif(r->>'Bench3Kg', '')::numeric),
        'd', jsonb_build_array(nullif(r->>'Deadlift1Kg', '')::numeric, nullif(r->>'Deadlift2Kg', '')::numeric, nullif(r->>'Deadlift3Kg', '')::numeric)
      ) attempts
    from picked p
  loop
    n := n + 1;
    -- The same meet already on file: same day, same kind (full power or bench only).
    select x.id into existing
    from public.athlete_powerlifting_results x
    where x.athlete_id = _athlete and x.meet_date = e.d
      and (case when coalesce(x.squat_kg, 0) = 0 and coalesce(x.deadlift_kg, 0) = 0 and coalesce(x.bench_kg, 0) > 0 then 'B' else 'SBD' end) = e.kind
    order by (x.source_key = 'opl:' || _slug || ':' || e.d || ':' || e.ev) desc nulls last, x.created_at
    limit 1;

    if existing is null then
      insert into public.athlete_powerlifting_results (
        athlete_id, client_id, athlete_name, sex, bodyweight_kg, weight_class_kg,
        squat_kg, bench_kg, deadlift_kg, total_kg, gl_points, dots_points,
        meet_name, meet_location, meet_town, meet_date, federation, parent_federation,
        competition_level, place, division, equipment, event, tested, sanctioned, attempts,
        source, source_key)
      values (
        _athlete, a.client_id, coalesce(e.entered_name, a.athlete_name), coalesce(e.sex, a.sex), e.bw, e.wc,
        e.sq, e.bp, e.dl, e.tot, e.gl, e.dots,
        e.meet_name, e.location, e.town, e.d, e.federation, e.parent,
        public.powerlifting_meet_level(e.meet_name, e.federation), e.place, e.division, e.equipment, e.ev,
        e.tested, e.sanctioned, e.attempts,
        'OpenPowerlifting', 'opl:' || _slug || ':' || e.d || ':' || e.ev);
      ins := ins + 1;
    else
      -- Facts only OpenPowerlifting has are refreshed; numbers already on file
      -- (possibly corrected by hand) are kept, and only filled in when missing.
      update public.athlete_powerlifting_results x set
        place = e.place,
        division = e.division,
        equipment = e.equipment,
        event = e.ev,
        tested = e.tested,
        sanctioned = e.sanctioned,
        attempts = e.attempts,
        parent_federation = coalesce(e.parent, x.parent_federation),
        meet_town = coalesce(x.meet_town, e.town),
        meet_name = coalesce(nullif(x.meet_name, ''), e.meet_name),
        meet_location = coalesce(nullif(x.meet_location, ''), e.location),
        federation = coalesce(nullif(x.federation, ''), e.federation),
        weight_class_kg = coalesce(nullif(x.weight_class_kg, ''), e.wc),
        bodyweight_kg = coalesce(x.bodyweight_kg, e.bw),
        squat_kg = case when coalesce(x.squat_kg, 0) > 0 then x.squat_kg else e.sq end,
        bench_kg = case when coalesce(x.bench_kg, 0) > 0 then x.bench_kg else e.bp end,
        deadlift_kg = case when coalesce(x.deadlift_kg, 0) > 0 then x.deadlift_kg else e.dl end,
        total_kg = case when coalesce(x.total_kg, 0) > 0 then x.total_kg else e.tot end,
        gl_points = coalesce(x.gl_points, e.gl),
        dots_points = coalesce(x.dots_points, e.dots),
        competition_level = public.powerlifting_meet_level(coalesce(nullif(x.meet_name, ''), e.meet_name), coalesce(nullif(x.federation, ''), e.federation)),
        source_key = coalesce(x.source_key, 'opl:' || _slug || ':' || e.d || ':' || e.ev)
      where x.id = existing;
      upd := upd + 1;
    end if;
  end loop;

  update public.powerlifting_athletes set
    opl_synced_at = now(),
    opl_sync_status = case when n = 0 then 'No meets found on the profile' else 'ok' end,
    opl_meet_count = n
  where id = _athlete;

  return jsonb_build_object('meets', n, 'added', ins, 'updated', upd);
end;
$$;
revoke all on function public.powerlifting_opl_apply(uuid, text, text) from public, anon, authenticated;

-- ── Sync rounds (pg_net) ──────────────────────────────────────────────────
create table if not exists public.powerlifting_opl_sync_requests (
  request_id bigint primary key,
  athlete_id uuid not null references public.powerlifting_athletes(id) on delete cascade,
  slug text not null,
  requested_at timestamptz not null default now(),
  collected_at timestamptz,
  result jsonb
);
alter table public.powerlifting_opl_sync_requests enable row level security;
-- No policies: only the functions below (security definer) touch it.

-- 'https://www.openpowerlifting.org/u/jaredmcintyre' → (host, slug)
create or replace function public.powerlifting_opl_profile(_url text, out host text, out slug text)
language sql
immutable
set search_path to 'public'
as $$
  select
    case when _url ~* 'openipf\.org' then 'https://www.openipf.org' else 'https://www.openpowerlifting.org' end,
    lower((regexp_match(coalesce(_url, ''), '/u/([^/?#]+)', 'i'))[1])
$$;

-- Start downloads: one athlete (a coach's "Sync now"), or every linked
-- athlete with auto sync on. Returns the request ids.
create or replace function public.powerlifting_opl_request(_athlete uuid default null)
returns bigint[]
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  a record;
  rid bigint;
  ids bigint[] := '{}';
begin
  for a in
    select pa.id, p.host, p.slug
    from public.powerlifting_athletes pa
    cross join lateral public.powerlifting_opl_profile(pa.openpowerlifting_url) p
    where p.slug is not null
      and (case when _athlete is null then coalesce(pa.auto_sync, false) else pa.id = _athlete end)
  loop
    rid := net.http_get(url := a.host || '/api/liftercsv/' || a.slug, timeout_milliseconds := 30000);
    insert into public.powerlifting_opl_sync_requests (request_id, athlete_id, slug) values (rid, a.id, a.slug)
    on conflict (request_id) do nothing;
    ids := ids || rid;
  end loop;
  return ids;
end;
$$;
revoke all on function public.powerlifting_opl_request(uuid) from public, anon, authenticated;

-- Merge every finished download (one bad profile never stops the rest).
create or replace function public.powerlifting_opl_collect(_only bigint default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  q record;
  res jsonb;
  done integer := 0;
  failed integer := 0;
begin
  for q in
    select s.request_id, s.athlete_id, s.slug, s.requested_at, h.status_code, h.content, h.error_msg, h.timed_out,
      h.id is not null responded
    from public.powerlifting_opl_sync_requests s
    left join net._http_response h on h.id = s.request_id
    where s.collected_at is null and (_only is null or s.request_id = _only)
    order by s.requested_at
  loop
    if not q.responded then
      if q.requested_at < now() - interval '30 minutes' then
        update public.powerlifting_opl_sync_requests set collected_at = now(), result = jsonb_build_object('error', 'No response') where request_id = q.request_id;
        update public.powerlifting_athletes set opl_sync_status = 'OpenPowerlifting did not respond' where id = q.athlete_id;
        failed := failed + 1;
      end if;
      continue;
    end if;
    begin
      if q.status_code = 200 and q.content like 'Name,%' then
        res := public.powerlifting_opl_apply(q.athlete_id, q.slug, q.content);
        done := done + 1;
      else
        res := jsonb_build_object('error', coalesce(q.error_msg, 'HTTP ' || q.status_code));
        update public.powerlifting_athletes
          set opl_sync_status = case when q.status_code = 404 then 'Profile not found on OpenPowerlifting' else 'Sync failed: ' || (res->>'error') end
          where id = q.athlete_id;
        failed := failed + 1;
      end if;
    exception when others then
      res := jsonb_build_object('error', sqlerrm);
      update public.powerlifting_athletes set opl_sync_status = 'Sync failed: ' || sqlerrm where id = q.athlete_id;
      failed := failed + 1;
    end;
    update public.powerlifting_opl_sync_requests set collected_at = now(), result = res where request_id = q.request_id;
  end loop;
  delete from public.powerlifting_opl_sync_requests where requested_at < now() - interval '30 days';
  return jsonb_build_object('merged', done, 'failed', failed);
end;
$$;
revoke all on function public.powerlifting_opl_collect(bigint) from public, anon, authenticated;

-- The cron job: merge what came back; start a new round about once a day.
create or replace function public.powerlifting_opl_tick()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  res jsonb := public.powerlifting_opl_collect();
begin
  if coalesce((select max(requested_at) from public.powerlifting_opl_sync_requests), '-infinity') < now() - interval '20 hours' then
    res := res || jsonb_build_object('requested', coalesce(array_length(public.powerlifting_opl_request(), 1), 0));
  end if;
  return res;
end;
$$;
revoke all on function public.powerlifting_opl_tick() from public, anon, authenticated;

-- Coach: sync one athlete now (any athlete with a profile link), then poll.
create or replace function public.powerlifting_opl_sync_now(_athlete uuid)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $$
declare ids bigint[];
begin
  if not public.league_is_staff() then raise exception 'Staff access required' using errcode = '42501'; end if;
  ids := public.powerlifting_opl_request(_athlete);
  if coalesce(array_length(ids, 1), 0) = 0 then raise exception 'Add an OpenPowerlifting link first'; end if;
  return ids[1];
end;
$$;
revoke all on function public.powerlifting_opl_sync_now(uuid) from public, anon;
grant execute on function public.powerlifting_opl_sync_now(uuid) to authenticated;

create or replace function public.powerlifting_opl_sync_status(_request bigint)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare r public.powerlifting_opl_sync_requests%rowtype;
begin
  if not public.league_is_staff() then raise exception 'Staff access required' using errcode = '42501'; end if;
  perform public.powerlifting_opl_collect(_request);
  select * into r from public.powerlifting_opl_sync_requests where request_id = _request;
  if not found then return jsonb_build_object('state', 'unknown'); end if;
  if r.collected_at is null then return jsonb_build_object('state', 'pending'); end if;
  return jsonb_build_object('state', case when r.result ? 'error' then 'error' else 'done' end) || coalesce(r.result, '{}');
end;
$$;
revoke all on function public.powerlifting_opl_sync_status(bigint) from public, anon;
grant execute on function public.powerlifting_opl_sync_status(bigint) to authenticated;

-- ── Coached? ──────────────────────────────────────────────────────────────
create or replace function public.powerlifting_meet_coached(_athlete uuid, _date date, _location text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
      select 1 from public.powerlifting_coaching_periods p
      where p.athlete_id = _athlete
        and (p.start_date is null or _date >= p.start_date)
        and (p.end_date is null or _date <= p.end_date))
    and coalesce((select a.country_filter is null or coalesce(_location, '') ilike a.country_filter || '%'
                  from public.powerlifting_athletes a where a.id = _athlete), false)
$$;
revoke all on function public.powerlifting_meet_coached(uuid, date, text) from public, anon, authenticated;

-- ── One athlete's career ──────────────────────────────────────────────────
create or replace function public.get_powerlifting_career(_athlete_id uuid, _as_user uuid default null)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with viewer as (select public.portal_viewer_uid(_as_user) uid),
  a as (
    select pa.*, c.user_id, c.full_name client_name, pr.avatar_url
    from public.powerlifting_athletes pa
    left join public.clients c on c.id = pa.client_id
    left join public.profiles pr on pr.id = c.user_id
    where pa.id = _athlete_id
  )
  select case when v.uid is null or a.id is null then null else jsonb_build_object(
    'athlete', jsonb_build_object(
      'athlete_id', a.id,
      'client_id', a.client_id,
      'display_name', coalesce(nullif(regexp_replace(trim(coalesce(a.client_name, '')), '\s+', ' ', 'g'), ''), a.athlete_name),
      'athlete_name', a.athlete_name,
      'avatar_url', a.avatar_url,
      'sex', a.sex,
      'is_alumni', lower(coalesce(a.status, 'active')) = 'retired',
      'is_me', coalesce(a.user_id = v.uid, false),
      'opl_url', a.openpowerlifting_url,
      'synced_at', a.opl_synced_at,
      'periods', coalesce((select jsonb_agg(jsonb_build_object('start', p.start_date, 'end', p.end_date) order by p.start_date nulls first)
                           from public.powerlifting_coaching_periods p where p.athlete_id = a.id), '[]'),
      'country_filter', a.country_filter
    ),
    'meets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'date', r.meet_date,
        'meet_name', coalesce(nullif(r.meet_name, ''), 'Meet'),
        'town', r.meet_town,
        'location', r.meet_location,
        'federation', r.federation,
        'level', public.powerlifting_meet_level(r.meet_name, r.federation),
        'place', r.place,
        'division', r.division,
        'equipment', r.equipment,
        'event', coalesce(r.event, case when coalesce(r.squat_kg, 0) = 0 and coalesce(r.deadlift_kg, 0) = 0 and coalesce(r.bench_kg, 0) > 0 then 'B' else 'SBD' end),
        'weight_class', r.weight_class_kg,
        'bw_kg', r.bodyweight_kg,
        'squat_kg', nullif(r.squat_kg, 0),
        'bench_kg', nullif(r.bench_kg, 0),
        'deadlift_kg', nullif(r.deadlift_kg, 0),
        -- A disqualified entry has no total (the app's points trigger would otherwise sum what was made).
        'total_kg', case when upper(coalesce(r.place, '')) in ('DQ', 'DD') then null else nullif(r.total_kg, 0) end,
        'gl', r.gl_points,
        'dots', r.dots_points,
        'attempts', r.attempts,
        'entered_name', r.athlete_name,
        'coached', public.powerlifting_meet_coached(a.id, r.meet_date, r.meet_location)
      ) order by r.meet_date desc, r.created_at desc)
      from public.athlete_powerlifting_results r
      where r.athlete_id = a.id
    ), '[]')
  ) end
  from viewer v left join a on true
$$;
revoke all on function public.get_powerlifting_career(uuid, uuid) from public, anon;
grant execute on function public.get_powerlifting_career(uuid, uuid) to authenticated, service_role;

-- ── Badges on the boards ──────────────────────────────────────────────────
-- Highest level each athlete has competed at, their best finish there, and
-- how many of their meets JF Effect coached.
create or replace function public.get_powerlifting_athlete_tiers()
returns table(athlete_id uuid, top_level text, top_place integer, meets integer, coached_meets integer)
language sql
stable
security definer
set search_path to 'public'
as $$
  with m as (
    select r.athlete_id, public.powerlifting_meet_level(r.meet_name, r.federation) lvl,
      case when r.place ~ '^\d+$' then r.place::int end place,
      public.powerlifting_meet_coached(r.athlete_id, r.meet_date, r.meet_location) coached
    from public.athlete_powerlifting_results r
    where r.athlete_id is not null and auth.uid() is not null
  ),
  ranked as (
    select m.*, case lvl when 'international' then 5 when 'national' then 4 when 'regional' then 3 when 'provincial' then 2 else 1 end lv
    from m
  ),
  tops as (select athlete_id, max(lv) top from ranked group by athlete_id)
  select x.athlete_id,
    (array_agg(x.lvl order by x.lv desc))[1],
    min(x.place) filter (where x.lv = t.top),
    count(*)::int,
    count(*) filter (where x.coached)::int
  from ranked x
  join tops t on t.athlete_id = x.athlete_id
  group by x.athlete_id
$$;
revoke all on function public.get_powerlifting_athlete_tiers() from public, anon;
grant execute on function public.get_powerlifting_athlete_tiers() to authenticated, service_role;

-- ── Records: a disqualified entry never counts ────────────────────────────
-- (same as 20261024090000, plus the DQ filter)
create or replace function public.strength_board_meet_lifts()
returns table(
  result_id uuid,
  athlete_id uuid,
  entered_name text,
  lift text,
  kg numeric,
  bw_kg numeric,
  meet_date date,
  meet_name text,
  federation text,
  weight_class text,
  gl_points numeric
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select m.id, m.athlete_id, nullif(trim(m.athlete_name), ''), x.lift, x.kg,
    case when m.bodyweight_kg between 30 and 250 then m.bodyweight_kg end,
    m.meet_date,
    coalesce(nullif(trim(m.meet_name), ''), nullif(trim(m.meet_location), ''), 'Meet'),
    m.federation, m.weight_class_kg,
    case when x.lift = 'total' then m.gl_points end
  from public.athlete_powerlifting_results m
  join public.powerlifting_athletes a on a.id = m.athlete_id
  cross join lateral (values
    ('squat', m.squat_kg),
    ('bench', m.bench_kg),
    ('deadlift', m.deadlift_kg),
    ('total', case when m.squat_kg > 0 and m.bench_kg > 0 and m.deadlift_kg > 0
      then coalesce(nullif(m.total_kg, 0), m.squat_kg + m.bench_kg + m.deadlift_kg) end)
  ) x(lift, kg)
  where x.kg > 0
    and upper(coalesce(m.place, '')) not in ('DQ', 'DD')
    and exists (
      select 1 from public.powerlifting_coaching_periods p
      where p.athlete_id = m.athlete_id
        and (p.start_date is null or m.meet_date >= p.start_date)
        and (p.end_date is null or m.meet_date <= p.end_date))
    and (a.country_filter is null or m.meet_location ilike a.country_filter || '%')
$$;
revoke all on function public.strength_board_meet_lifts() from public, anon, authenticated;

-- ── Levels on file follow the same rule ───────────────────────────────────
update public.athlete_powerlifting_results
  set competition_level = public.powerlifting_meet_level(meet_name, federation)
  where competition_level is distinct from public.powerlifting_meet_level(meet_name, federation);

-- ── Schedule ──────────────────────────────────────────────────────────────
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'powerlifting-opl-sync';
  perform cron.schedule('powerlifting-opl-sync', '7,22,37,52 * * * *', 'select public.powerlifting_opl_tick();');
exception when undefined_table or invalid_schema_name or undefined_function then
  raise notice 'pg_cron not available; powerlifting-opl-sync not scheduled';
end $$;
