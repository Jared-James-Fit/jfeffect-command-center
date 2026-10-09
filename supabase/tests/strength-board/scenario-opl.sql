-- Powerlifting careers + OpenPowerlifting sync
-- (20261029090000_powerlifting_careers_opl_sync.sql), on real OpenPowerlifting
-- exports (supabase/tests/strength-board/opl/*.csv; two are edited to cover a
-- quoted meet name and a meet entered in two divisions).
-- Run from the repo root, after the other scenarios.
\set kenneth `cat supabase/tests/strength-board/opl/kennethmorris.csv`
\set dwayne `cat supabase/tests/strength-board/opl/dwaynegordon.csv`
\set nicole `cat supabase/tests/strength-board/opl/nicolecarta.csv`
\set phillip `cat supabase/tests/strength-board/opl/phillipbennett4.csv`
create temp table fx (slug text primary key, csv text);
insert into fx values ('kennethmorris', :'kenneth'), ('dwaynegordon', :'dwayne'), ('nicolecarta', :'nicole'), ('phillipbennett4', :'phillip');

do $$
declare
  ken uuid; dw uuid; nic uuid; phil uuid;
  viewer uuid := gen_random_uuid();
  res jsonb;
  car jsonb;
  r record;
  n int;
begin
  -- Meet level, from the meet itself.
  perform t_assert(powerlifting_meet_level('Commonwealth Championships', 'CommonwealthPF') = 'international'
    and powerlifting_meet_level('Regional Powerlifting Championships', 'NAPF') = 'international'
    and powerlifting_meet_level('World Junior and Sub-Juniors Powerlifting Championships', 'IPF') = 'international'
    and powerlifting_meet_level('Nationals', 'CPU') = 'national'
    and powerlifting_meet_level('2025 CPU Nationals', 'CPU') = 'national'
    and powerlifting_meet_level('The National Pursuit', 'CPU') = 'local'
    and powerlifting_meet_level('Western Canadian Championships', 'CPU') = 'regional'
    and powerlifting_meet_level('Easterns', 'CPU') = 'regional'
    and powerlifting_meet_level('Southeast Regionals', 'USAPL') = 'regional'
    and powerlifting_meet_level('MPA Provincials', 'CPU') = 'provincial'
    and powerlifting_meet_level('MPA Powerlifting and Bench Press Championships', 'CPU') = 'provincial'
    and powerlifting_meet_level('OPA Masters and Open Provincial Powerlifting Championship', 'CPU') = 'provincial'
    and powerlifting_meet_level('35th Annual Florida State Powerlifting Championship', 'USAPL') = 'provincial'
    and powerlifting_meet_level('Wheat Meet V Peak Provincials Preparation', 'CPU') = 'local'
    and powerlifting_meet_level('Winter Swolestice OPA', 'CPU') = 'local'
    and powerlifting_meet_level('Manitoba Collegiate Powerlifting Challenge', 'CPU') = 'local'
    and powerlifting_meet_level('MPA Summer Classic', 'CPU') = 'local',
    'meet levels: international / national / regional / provincial (state) / local');

  select count(*) into n from opl_csv_records((select csv from fx where slug = 'kennethmorris'));
  perform t_assert(n = 5, 'CSV: one record per meet line');
  perform t_assert(exists (select 1 from opl_csv_records((select csv from fx where slug = 'kennethmorris')) x
      where x->>'MeetName' = '10th Annual South Florida Open, Powerlifting Championships' and x->>'Date' = '2016-09-25'),
    'CSV: a quoted meet name with a comma stays one field');
  perform t_assert((powerlifting_opl_profile('https://www.openpowerlifting.org/u/PhillipBennett4')).slug = 'phillipbennett4'
    and (powerlifting_opl_profile('https://www.openipf.org/u/vickytshibasu')).host = 'https://www.openipf.org',
    'profile link -> host and lifter id');

  -- Kenneth: coached in Canada only, until Dec 14 2024. One meet already on file (entered by hand).
  insert into powerlifting_athletes (athlete_name, sex, status, country_filter, openpowerlifting_url, auto_sync)
    values ('Kenneth Morris', 'male', 'retired', 'Canada', 'https://www.openpowerlifting.org/u/kennethmorris', true) returning id into ken;
  insert into powerlifting_coaching_periods (athlete_id, end_date) values (ken, '2024-12-14');
  insert into athlete_powerlifting_results (athlete_id, athlete_name, sex, bodyweight_kg, squat_kg, bench_kg, deadlift_kg,
      meet_name, meet_location, meet_date, federation, competition_level, source, source_key)
    values (ken, 'Kenneth Morris', 'male', 103.0, 240, 115, 230, 'MPA Total Fortification V', 'Canada-MB', '2024-12-14', 'CPU', 'national', 'manual', null);

  res := powerlifting_opl_apply(ken, 'kennethmorris', (select csv from fx where slug = 'kennethmorris'));
  perform t_assert(res = '{"meets": 5, "added": 4, "updated": 1}', 'Kenneth: 4 meets added, the one on file updated');
  select * into r from athlete_powerlifting_results where athlete_id = ken and meet_date = '2024-12-14';
  perform t_assert(r.bodyweight_kg = 103.0 and r.place = '1' and r.division = 'Sub-Juniors' and r.equipment = 'Raw'
      and r.attempts->'s' = '[220, 235, 240]' and r.attempts->'d' = '[215, 230, -241]' and r.source_key = 'opl:kennethmorris:2024-12-14:SBD'
      and r.competition_level = 'local',
    'a meet on file keeps its numbers (103.0 kg, not OPL''s 103.12), gains placing / division / attempts, and its level is recomputed');

  res := powerlifting_opl_apply(ken, 'kennethmorris', (select csv from fx where slug = 'kennethmorris'));
  perform t_assert(res->>'added' = '0' and (select count(*) from athlete_powerlifting_results where athlete_id = ken) = 5,
    'syncing again adds nothing');

  insert into auth_ctx (uid) values (viewer);
  car := get_powerlifting_career(ken);
  perform t_assert(jsonb_array_length(car->'meets') = 5 and car->'meets'->0->>'date' = '2024-12-14', 'career: every meet, newest first');
  perform t_assert(
      (select bool_and((m->>'coached')::boolean = (m->>'location') like 'Canada%') from jsonb_array_elements(car->'meets') m),
    'career: the USA meets show as not coached (Canada-only coaching), the Canadian ones as coached');
  perform t_assert(
      (select m->>'level' from jsonb_array_elements(car->'meets') m where m->>'date' = '2016-05-28') = 'provincial'
      and (select m->>'level' from jsonb_array_elements(car->'meets') m where m->>'date' = '2023-08-10') = 'regional',
    'career: each meet carries its level');
  perform t_assert(not exists (select 1 from strength_board_meet_lifts() where athlete_id = ken and meet_date < '2017-01-01'),
    'the Competition board still only counts coached meets');

  -- Dwayne: a DQ, and a meet listed under two divisions.
  insert into powerlifting_athletes (athlete_name, sex, openpowerlifting_url, auto_sync)
    values ('Dwayne Gordon', 'male', 'https://www.openpowerlifting.org/u/dwaynegordon', true) returning id into dw;
  insert into powerlifting_coaching_periods (athlete_id) values (dw);
  res := powerlifting_opl_apply(dw, 'dwaynegordon', (select csv from fx where slug = 'dwaynegordon'));
  perform t_assert(res->>'meets' = '3' and (select count(*) from athlete_powerlifting_results where athlete_id = dw and meet_date = '2025-08-24') = 1
      and (select division || '/' || place from athlete_powerlifting_results where athlete_id = dw and meet_date = '2025-08-24') = 'Open/1',
    'a meet entered in two divisions is one meet (the Open entry)');
  car := get_powerlifting_career(dw);
  perform t_assert((select m->>'place' = 'DQ' and m->'total_kg' = 'null' from jsonb_array_elements(car->'meets') m where m->>'date' = '2026-09-11'),
    'a DQ shows as DQ with no total');
  perform t_assert(not exists (select 1 from strength_board_meet_lifts() where athlete_id = dw and meet_date = '2026-09-11'),
    'a DQ never counts on the boards');

  -- Nicole: a bench-only meet is its own entry.
  insert into powerlifting_athletes (athlete_name, sex, openpowerlifting_url, auto_sync)
    values ('Nicole Yusi', 'female', 'https://www.openpowerlifting.org/u/nicolecarta', true) returning id into nic;
  insert into powerlifting_coaching_periods (athlete_id) values (nic);
  res := powerlifting_opl_apply(nic, 'nicolecarta', (select csv from fx where slug = 'nicolecarta'));
  select * into r from athlete_powerlifting_results where athlete_id = nic and meet_date = '2025-03-22';
  perform t_assert(r.event = 'B' and r.bench_kg = 47.5 and r.squat_kg = 0 and r.deadlift_kg = 0 and r.athlete_name = 'Nicole Carta',
    'bench-only meet stored as bench only, under the name she competed under');

  -- Phillip: OpenPowerlifting's "#4" (namesake number) is dropped; a Worlds lifter.
  insert into powerlifting_athletes (athlete_name, sex, openpowerlifting_url, auto_sync)
    values ('Phillip Bennett', 'male', 'https://www.openpowerlifting.org/u/phillipbennett4', false) returning id into phil;
  insert into powerlifting_coaching_periods (athlete_id) values (phil);
  res := powerlifting_opl_apply(phil, 'phillipbennett4', (select csv from fx where slug = 'phillipbennett4'));
  perform t_assert((select bool_and(athlete_name = 'Phillip Bennett') from athlete_powerlifting_results where athlete_id = phil),
    'namesake number dropped from the name');
  select * into r from get_powerlifting_athlete_tiers() where athlete_id = phil;
  perform t_assert(r.top_level = 'international' and r.top_place = 6 and r.meets = 2 and r.coached_meets = 2,
    'tiers: highest level and best finish there');
  select * into r from get_powerlifting_athlete_tiers() where athlete_id = ken;
  perform t_assert(r.top_level = 'regional' and r.top_place = 3 and r.meets = 5 and r.coached_meets = 3,
    'tiers count coached meets');

  res := powerlifting_opl_apply(phil, 'phillipbennett4',
    'Name,Sex,Event,Equipment,Division,BodyweightKg,WeightClassKg,Best3SquatKg,Best3BenchKg,Best3DeadliftKg,TotalKg,Place,Federation,Date,MeetCountry,MeetName'
    || E'\n' || 'Phillip Bennett #4,M,SBD,Raw,Open,,93,200,150,250,600,1,CPU,2015-01-01,Canada,No Scale Classic');
  perform t_assert(res = '{"meets": 1, "added": 0, "updated": 0}'
      and not exists (select 1 from athlete_powerlifting_results where athlete_id = phil and meet_date = '2015-01-01'),
    'a meet with no bodyweight is left out, without failing the sync');

  -- The sync round (pg_net stand-in): auto sync athletes only; coach can sync anyone now.
  delete from powerlifting_opl_sync_requests;
  perform powerlifting_opl_request();
  perform t_assert((select count(*) from powerlifting_opl_sync_requests) = 3
      and not exists (select 1 from powerlifting_opl_sync_requests where athlete_id = phil)
      and exists (select 1 from net.http_request_queue where url = 'https://www.openpowerlifting.org/api/liftercsv/dwaynegordon'),
    'daily round: every linked athlete with auto sync on, from their CSV export');
  insert into net._http_response (id, status_code, content)
    select s.request_id, case when s.slug = 'nicolecarta' then 404 else 200 end, case when s.slug = 'nicolecarta' then 'not found' else fx.csv end
    from powerlifting_opl_sync_requests s join fx on fx.slug = s.slug where s.slug <> 'kennethmorris';
  res := powerlifting_opl_collect();
  perform t_assert(res = '{"merged": 1, "failed": 1}', 'collect merges what came back, records failures, waits for the rest');
  perform t_assert((select opl_sync_status from powerlifting_athletes where id = nic) = 'Profile not found on OpenPowerlifting'
      and (select opl_sync_status from powerlifting_athletes where id = dw) = 'ok'
      and (select collected_at is null from powerlifting_opl_sync_requests where slug = 'kennethmorris'),
    'per-athlete sync status; a slow download is picked up next time');
  res := powerlifting_opl_tick();
  perform t_assert(not res ? 'requested', 'no new round while one ran in the last 20 hours');

  -- pg_net restarted (20261030090000): request ids start over.
  n := (select request_id from powerlifting_opl_sync_requests where slug = 'kennethmorris');
  insert into net._http_response (id, status_code, content, created)
    values (n, 200, (select csv from fx where slug = 'dwaynegordon'), now() - interval '1 hour');
  perform t_assert(powerlifting_opl_collect(n) = '{"merged": 0, "failed": 0}'
      and (select collected_at is null from powerlifting_opl_sync_requests where request_id = n),
    'a response older than its request (an old download with the same id) is ignored');
  -- Time passes; a new download for Phillip gets the id Dwayne's download had.
  select request_id into r from powerlifting_opl_sync_requests where slug = 'dwaynegordon';
  update net._http_response set created = now() - interval '2 hours' where id = r.request_id;
  perform setval('net.http_request_queue_id_seq', r.request_id - 1);
  n := (powerlifting_opl_request(phil))[1];
  perform t_assert(n = r.request_id
      and (select athlete_id = phil and slug = 'phillipbennett4' and collected_at is null and result is null
           from powerlifting_opl_sync_requests where request_id = n)
      and powerlifting_opl_collect(n) = '{"merged": 0, "failed": 0}',
    'a reused id belongs to the new download, which waits for its own response');
  insert into net._http_response (id, status_code, content) values (n, 200, (select csv from fx where slug = 'phillipbennett4'));
  res := powerlifting_opl_collect(n);
  perform t_assert(res = '{"merged": 1, "failed": 0}'
      and (select result = '{"meets": 2, "added": 0, "updated": 2}' from powerlifting_opl_sync_requests where request_id = n)
      and (select count(*) from athlete_powerlifting_results where athlete_id = dw) = 3,
    'then merges into the right athlete (Dwayne untouched)');
  perform setval('net.http_request_queue_id_seq', 1000);

  -- Coach "Sync now".
  delete from auth_ctx;
  insert into auth_ctx (uid) values (gen_random_uuid());
  insert into user_roles (user_id, role) select uid, 'admin' from auth_ctx;
  n := powerlifting_opl_sync_now(phil);
  perform t_assert(powerlifting_opl_sync_status(n)->>'state' = 'pending', 'sync now: pending until the download is back');
  insert into net._http_response (id, status_code, content) values (n, 200, (select csv from fx where slug = 'phillipbennett4'));
  perform t_assert(powerlifting_opl_sync_status(n) = '{"state": "done", "meets": 2, "added": 0, "updated": 2}', 'sync now: done, nothing new');

  delete from auth_ctx;
  perform t_assert(get_powerlifting_career(ken) is null, 'signed out: no career');
end $$;
