-- OpenIPF discovery, approval, new meets, Remove / Add back, and who sees what.
\set ON_ERROR_STOP 1
set client_min_messages = notice;

-- People: the owner (admin), coach Ana (Marc and Jared), coach Ben (Fionna), a
-- free member, and Kaydon, an alumni record with no client.
insert into auth.users values
  ('00000000-0000-0000-0000-0000000000a1', 'owner@example.test'),
  ('00000000-0000-0000-0000-0000000000c1', 'ana@example.test'),
  ('00000000-0000-0000-0000-0000000000c2', 'ben@example.test'),
  ('00000000-0000-0000-0000-0000000000d1', 'marc@example.test');
insert into user_roles values
  ('00000000-0000-0000-0000-0000000000a1', 'admin'),
  ('00000000-0000-0000-0000-0000000000c1', 'coach'),
  ('00000000-0000-0000-0000-0000000000c2', 'coach'),
  ('00000000-0000-0000-0000-0000000000d1', 'client');
insert into coaches (id, user_id, full_name) values
  ('00000000-0000-0000-0000-00000000c0a1', '00000000-0000-0000-0000-0000000000c1', 'Ana'),
  ('00000000-0000-0000-0000-00000000c0b2', '00000000-0000-0000-0000-0000000000c2', 'Ben');
insert into clients (id, user_id, full_name, first_name, last_name, sex, service_tier, assigned_coach_id, openpowerlifting_url) values
  ('00000000-0000-0000-0000-0000000c0001', '00000000-0000-0000-0000-0000000000d1', 'Marc Asugui', 'Marc', 'Asugui', 'Male', 'coaching', '00000000-0000-0000-0000-00000000c0a1', null),
  ('00000000-0000-0000-0000-0000000c0002', null, 'Jared McIntyre', 'Jared', 'McIntyre', 'Male', 'coaching', '00000000-0000-0000-0000-00000000c0a1', 'https://www.openpowerlifting.org/u/jaredmcintyre'),
  ('00000000-0000-0000-0000-0000000c0003', null, 'Fionna Faye Gaburno', 'Fionna', 'Gaburno', 'Female', 'coaching', '00000000-0000-0000-0000-00000000c0b2', 'https://www.openipf.org/u/fionnafaye'),
  ('00000000-0000-0000-0000-0000000c0004', null, 'Mia Member', 'Mia', 'Member', 'Female', 'self_serve', null, null),
  ('00000000-0000-0000-0000-0000000c0005', null, 'Devin Buth', 'Devin', 'Buth', 'Male', 'coaching', '00000000-0000-0000-0000-00000000c0a1', null),
  ('00000000-0000-0000-0000-0000000c0006', null, 'Lee Lead', 'Lee', 'Lead', 'Male', 'coaching', null, null);
update clients set status = 'Lead' where id = '00000000-0000-0000-0000-0000000c0006';
update clients set date_of_birth = '1995-06-01', country = 'Canada' where id = '00000000-0000-0000-0000-0000000c0001';
-- Reece: born 1996 in Canada; the only "Reece Robinson" on OpenIPF lifted in the USA in 2009, aged 15
-- (production's own case, Nov 24 2026): born 1994 or 1993, never 1996
insert into clients (id, full_name, first_name, last_name, sex, service_tier, assigned_coach_id, date_of_birth, country) values
  ('00000000-0000-0000-0000-0000000c0007', 'Reece Robinson', 'Reece', 'Robinson', 'Male', 'coaching', '00000000-0000-0000-0000-00000000c0a1', '1996-09-28', 'Canada');
insert into powerlifting_athletes (id, client_id, athlete_name, sex, openpowerlifting_url, auto_sync, opl_synced_at) values
  ('00000000-0000-0000-0000-00000000a002', '00000000-0000-0000-0000-0000000c0002', 'Jared McIntyre', 'male', 'https://www.openpowerlifting.org/u/jaredmcintyre', true, null),
  ('00000000-0000-0000-0000-00000000a003', '00000000-0000-0000-0000-0000000c0003', 'Fionna Gaburno', 'female', null, false, null),
  ('00000000-0000-0000-0000-00000000a004', '00000000-0000-0000-0000-0000000c0004', 'Mia Member', 'female', 'https://www.openipf.org/u/miamember', true, now() - interval '1 day'),
  ('00000000-0000-0000-0000-00000000a009', null, 'Kaydon Laurin', 'male', null, false, null);
-- Jared's meets: one entered by hand, one the sync made
insert into athlete_powerlifting_results (athlete_id, client_id, athlete_name, sex, bodyweight_kg, squat_kg, bench_kg, deadlift_kg, meet_date, meet_name, source, source_key) values
  ('00000000-0000-0000-0000-00000000a002', '00000000-0000-0000-0000-0000000c0002', 'Jared McIntyre', 'male', 73, 230, 150, 270, '2018-08-11', 'Hand entered', 'manual', null),
  ('00000000-0000-0000-0000-00000000a002', '00000000-0000-0000-0000-0000000c0002', 'Jared McIntyre', 'male', 74, 260, 170, 290, '2024-03-10', 'Provincials', 'OpenPowerlifting', 'opl:jaredmcintyre:2024-03-10:SBD');
update powerlifting_athletes set opl_synced_at = now() - interval '1 day' where id = '00000000-0000-0000-0000-00000000a002';

-- What OpenIPF / OpenPowerlifting answer.
insert into fake_web (url, body) values
  ('https://www.openipf.org/api/search/rankings?q=marc%20asugui&start=0', '{"next_index":100}'),
  ('https://www.openipf.org/api/rankings?start=100&end=100&lang=en&units=kg',
   '{"total_length":5,"rows":[[100,101,"Marc Asugui","marcasugui",null,null,"Canada","Canada-MB","CPU","2025-11-02","Canada","MB","cpu/x","M","Classic","30","Open","82.1","83","200","140","240","580","80.2"]]}'),
  ('https://www.openipf.org/api/liftercsv/marcasugui',
   E'Name,Sex,Event,Equipment,Age,Division,BodyweightKg,WeightClassKg,Best3SquatKg,Best3BenchKg,Best3DeadliftKg,TotalKg,Place,Dots,Goodlift,Tested,Country,State,Federation,ParentFederation,Date,MeetCountry,MeetState,MeetTown,MeetName,Sanctioned\nMarc Asugui,M,SBD,Raw,30,Open,82.1,83,200,140,240,580,2,,80.2,Yes,Canada,MB,CPU,IPF,2025-11-02,Canada,MB,Winnipeg,Manitoba Provincials,Yes\nMarc Asugui,M,SBD,Raw,29,Open,83,83,190,130,230,550,3,,75,Yes,Canada,MB,CPU,IPF,2024-11-02,Canada,MB,Winnipeg,Manitoba Provincials,Yes'),
  ('https://www.openipf.org/api/search/rankings?q=fionna%20faye&start=0', '{"next_index":200}'),
  ('https://www.openipf.org/api/rankings?start=200&end=200&lang=en&units=kg',
   '{"rows":[[200,201,"Fionna Faye","fionnafaye",null,null,"Canada",null,"CPU","2024-05-02","Canada","MB","cpu/y","F","Classic","27","Open","62","63","120","62.5","150","332.5","70"]]}'),
  ('https://www.openipf.org/api/liftercsv/fionnafaye',
   E'Name,Sex,Event,Best3SquatKg,Best3BenchKg,Best3DeadliftKg,TotalKg,Country,Federation,Date,MeetName\nFionna Faye,F,SBD,120,62.5,150,332.5,Canada,CPU,2024-05-02,Westerns'),
  -- Kaydon isn't on OpenIPF; OpenPowerlifting has two lifters by that name
  ('https://www.openpowerlifting.org/api/search/rankings?q=kaydon%20laurin&start=0', '{"next_index":5}'),
  ('https://www.openpowerlifting.org/api/rankings?start=5&end=5&lang=en&units=kg',
   '{"rows":[[5,6,"Kaydon Laurin #1","kaydonlaurin1",null,null,"Canada",null,"CPU","2019-02-02","Canada","MB","cpu/z","M","Classic","20","Junior","90","93","180","120","220","520","66"]]}'),
  ('https://www.openpowerlifting.org/api/search/rankings?q=kaydon%20laurin&start=6', '{"next_index":7}'),
  ('https://www.openpowerlifting.org/api/rankings?start=7&end=7&lang=en&units=kg',
   '{"rows":[[7,8,"Kaydon Laurin #2","kaydonlaurin2",null,null,"USA",null,"USAPL","2021-02-02","USA","TX","usapl/z","M","Raw","40","Masters","100","105","150","100","200","450","50"]]}'),
  ('https://www.openpowerlifting.org/api/liftercsv/kaydonlaurin1', E'Name,Sex,Event,TotalKg,Country,Federation,Date,MeetName\nKaydon Laurin #1,M,SBD,520,Canada,CPU,2019-02-02,Provincials'),
  ('https://www.openipf.org/api/search/rankings?q=reece%20robinson&start=0', '{"next_index":400}'),
  ('https://www.openipf.org/api/rankings?start=400&end=400&lang=en&units=kg',
   '{"rows":[[400,401,"Reece Robinson","reecerobinson",null,null,"USA",null,"USAPL","2009-05-16","USA","PA","x","M","Raw","15","Teen","82","83","82.5","62.5","105","250","40"]]}'),
  -- a search that finds someone whose name only contains the client's
  ('https://www.openipf.org/api/search/rankings?q=devin%20buth&start=0', '{"next_index":300}'),
  ('https://www.openipf.org/api/rankings?start=300&end=300&lang=en&units=kg',
   '{"rows":[[300,301,"Devin Buthelezi","devinbuthelezi",null,null,"South Africa",null,"SAPF","2023-01-01","South Africa",null,"x","M","Classic","22","Open","80","83","180","120","210","510","70"]]}');

-- 1. Who's searched
select t_assert((select count(*) from openipf_targets() where client_id = '00000000-0000-0000-0000-0000000c0001') = 1, 'an unlinked coaching client is searched');
select t_assert((select count(*) from openipf_targets() where client_id = '00000000-0000-0000-0000-0000000c0002') = 0, 'a linked client isn''t');
select t_assert((select count(*) from openipf_targets() where client_id = '00000000-0000-0000-0000-0000000c0004') = 0, 'a free member never is');
select t_assert((select count(*) from openipf_targets() where client_id = '00000000-0000-0000-0000-0000000c0006') = 0, 'a lead isn''t');
select t_assert((select count(*) from openipf_targets() where athlete_id = '00000000-0000-0000-0000-00000000a009') = 1, 'an alumni record with no profile is');
select t_assert((select queries from openipf_targets() where client_id = '00000000-0000-0000-0000-0000000c0003') = array['fionna faye gaburno', 'fionna gaburno', 'fionna faye'], 'a three-part name is searched three ways');
select t_assert((select profile_slug from openipf_targets() where client_id = '00000000-0000-0000-0000-0000000c0003') = 'fionnafaye', 'the profile saved on their record is read');

-- 2. The monthly scan, run the way the tick runs it
create temp table scan as select _openipf_scan_start(null, null, null) id;
select t_run((select id from scan));
select t_assert((select count(*) from net.requests where method = 'GET' and url like 'https://www.openpowerlifting.org/api/search/rankings?q=marc%') = 0, 'found on OpenIPF, OpenPowerlifting isn''t asked');
select t_assert((select count(*) from net.requests where url = 'https://www.openpowerlifting.org/api/search/rankings?q=kaydon%20laurin&start=0') = 1, 'nobody on OpenIPF: OpenPowerlifting is asked');
select t_assert((select confidence = 'likely' and meet_count = 2 and last_meet = '2025-11-02' and total_kg = 580 and born_about = 1995
  and reasons = array['Same name', 'Same sex', 'Same age']
  from openipf_suggestions where kind = 'match' and slug = 'marcasugui'), 'one lifter with their name and age: a likely match with their meets');
select t_assert((select confidence = 'possible' and 'Age doesn''t match (born about 1994)' = any (reasons) and 'Competes in USA' = any (reasons)
  from openipf_suggestions where kind = 'match' and slug = 'reecerobinson'), 'the only lifter by that name, but another age and country: only possible');
select t_assert((select confidence = 'likely' and 'Saved on their profile' = any (reasons) from openipf_suggestions where kind = 'match' and slug = 'fionnafaye'), 'the saved profile is a likely match');
select t_assert((select count(*) = 1 from openipf_suggestions where client_id = '00000000-0000-0000-0000-0000000c0003'), 'found by profile and by name: one suggestion');
select t_assert((select count(*) = 2 and bool_and(confidence = 'possible') and bool_and('One of 2 possible profiles' = any (reasons))
  from openipf_suggestions where athlete_id = '00000000-0000-0000-0000-00000000a009'), 'two lifters by one name: both only possible');
select t_assert((select host from openipf_suggestions where kind = 'match' and slug = 'kaydonlaurin1') = 'https://www.openpowerlifting.org', 'kept on the site it was found on');
select t_assert(not exists (select 1 from openipf_suggestions where slug = 'devinbuthelezi'), 'a name that only contains theirs isn''t a match');
select t_assert(not exists (select 1 from openipf_suggestions where client_id in ('00000000-0000-0000-0000-0000000c0004', '00000000-0000-0000-0000-0000000c0002')), 'nothing for a member or a linked client');
select t_assert((select finished_at is not null and targets = 5 and found = 5 from openipf_scans where id = (select id from scan)), 'the scan finishes and counts');

-- 3. The push is asked for once, not every minute
select openipf_tick();
select openipf_tick();
select t_assert((select count(*) from net.requests where method = 'POST' and url like '%/hooks/openipf-notify') = 1, 'the notify hook is woken once');

-- 4. Who sees what
set role authenticated;
select t_as('00000000-0000-0000-0000-0000000000c1');
select t_assert((select count(*) from openipf_suggestions) = 2, 'a coach sees only their own clients'' suggestions');
select t_assert((select array_agg(slug order by slug) from openipf_suggestions) = array['marcasugui', 'reecerobinson'], '(Marc''s and Reece''s)');
do $$ begin
  perform openipf_decide((select id from openipf_suggestions where kind = 'match' and slug = 'fionnafaye' limit 1), 'approve');
  raise exception 'should have failed';
exception when others then
  if sqlerrm = 'should have failed' then raise; end if;
  raise notice 'ok: a coach can''t decide another coach''s client';
end $$;
do $$ begin
  perform openipf_scan_start(null, null);
  raise exception 'should have failed';
exception when others then
  if sqlerrm = 'should have failed' then raise; end if;
  raise notice 'ok: only the admin searches everyone';
end $$;
select t_as('00000000-0000-0000-0000-0000000000d1');
select t_assert((select count(*) from openipf_suggestions) = 0, 'a client sees none');
reset role;

-- 5. Approve Marc as his coach: an athlete record, the link, a sync
set role authenticated;
select t_as('00000000-0000-0000-0000-0000000000c1');
create temp table ok as select openipf_decide((select id from openipf_suggestions where kind = 'match' and slug = 'marcasugui'), 'approve') r;
reset role;
select t_assert((select (r->>'created')::boolean from ok), 'the approval made his athlete record');
select t_assert((select openpowerlifting_url = 'https://www.openipf.org/u/marcasugui' and auto_sync and opl_synced_at is null and sex = 'male'
  from powerlifting_athletes where client_id = '00000000-0000-0000-0000-0000000c0001'), 'linked, syncing, first import still to come');
select t_assert((select openpowerlifting_url from clients where id = '00000000-0000-0000-0000-0000000c0001') = 'https://www.openipf.org/u/marcasugui', 'his client record shows the link');
select t_assert((select status = 'approved' and decided_by = '00000000-0000-0000-0000-0000000000c1' from openipf_suggestions where kind = 'match' and slug = 'marcasugui'), 'the suggestion is approved by his coach');
select t_assert((select count(*) from net.requests where url = 'https://www.openipf.org/api/liftercsv/marcasugui') = 2, 'and a sync is asked for');

-- 6. The first import is history; a meet after it is news, with its records
insert into athlete_powerlifting_results (athlete_id, client_id, athlete_name, sex, bodyweight_kg, squat_kg, bench_kg, deadlift_kg, meet_date, meet_name, source, source_key)
select id, client_id, 'Marc Asugui', 'male', 82, 200, 140, 240, '2025-11-02', 'Manitoba Provincials', 'OpenPowerlifting', 'opl:marcasugui:2025-11-02:SBD'
from powerlifting_athletes where client_id = '00000000-0000-0000-0000-0000000c0001';
select t_assert(not exists (select 1 from openipf_suggestions where kind = 'new_meet'), 'the first import isn''t news');
update powerlifting_athletes set opl_synced_at = now() where client_id = '00000000-0000-0000-0000-0000000c0001';
insert into athlete_powerlifting_results (athlete_id, client_id, athlete_name, sex, bodyweight_kg, squat_kg, bench_kg, deadlift_kg, meet_date, meet_name, source, source_key)
select id, client_id, 'Marc Asugui', 'male', 82.5, 210, 137.5, 240, '2026-11-15', 'Westerns', 'OpenPowerlifting', 'opl:marcasugui:2026-11-15:SBD'
from powerlifting_athletes where client_id = '00000000-0000-0000-0000-0000000c0001';
select t_assert((select prs = array['squat', 'total'] and total_kg = 587.5 and meet_name = 'Westerns' and status = 'pending'
  from openipf_suggestions where kind = 'new_meet'), 'a new meet, its squat and total records named');
select t_assert(exists (select 1 from openipf_suggestions x join openipf_scans s on true where x.kind = 'new_meet' and x.notified_at is null), 'and waiting to be told');
-- a free member's meet is never news
insert into athlete_powerlifting_results (athlete_id, athlete_name, sex, bodyweight_kg, squat_kg, bench_kg, deadlift_kg, meet_date, source, source_key)
values ('00000000-0000-0000-0000-00000000a004', 'Mia Member', 'female', 60, 100, 50, 120, '2026-11-15', 'OpenPowerlifting', 'opl:miamember:2026-11-15:SBD');
select t_assert(not exists (select 1 from openipf_suggestions where athlete_id = '00000000-0000-0000-0000-00000000a004'), 'a free member''s meet isn''t');
-- an alumni record's meet is
update powerlifting_athletes set openpowerlifting_url = 'https://www.openpowerlifting.org/u/kaydonlaurin1', auto_sync = true, opl_synced_at = now()
where id = '00000000-0000-0000-0000-00000000a009';
insert into athlete_powerlifting_results (athlete_id, athlete_name, sex, bodyweight_kg, squat_kg, bench_kg, deadlift_kg, meet_date, source, source_key)
values ('00000000-0000-0000-0000-00000000a009', 'Kaydon Laurin', 'male', 90, 200, 120, 230, '2026-11-15', 'OpenPowerlifting', 'opl:kaydonlaurin1:2026-11-15:SBD');
select t_assert(exists (select 1 from openipf_suggestions where kind = 'new_meet' and athlete_id = '00000000-0000-0000-0000-00000000a009' and client_id is null), 'an alumni meet is news (the admin''s)');
update powerlifting_athletes set openpowerlifting_url = null, auto_sync = false, opl_synced_at = null where id = '00000000-0000-0000-0000-00000000a009';

-- 7. Got it, and its Undo
set role authenticated;
select t_as('00000000-0000-0000-0000-0000000000c1');
select openipf_decide((select id from openipf_suggestions where kind = 'new_meet' and client_id is not null), 'approve');
reset role;
select t_assert((select status from openipf_suggestions where kind = 'new_meet' and client_id is not null) = 'seen', 'Got it');
set role authenticated;
select t_as('00000000-0000-0000-0000-0000000000c1');
select openipf_decide((select id from openipf_suggestions where kind = 'new_meet' and client_id is not null), 'undo');
reset role;
select t_assert((select status from openipf_suggestions where kind = 'new_meet' and client_id is not null) = 'pending', 'and back');

-- 8. Undo the approval: what it added comes off, the record it made goes, the match is back in the queue
set role authenticated;
select t_as('00000000-0000-0000-0000-0000000000c1');
select openipf_decide((select id from openipf_suggestions where kind = 'match' and slug = 'marcasugui'), 'undo');
reset role;
select t_assert(not exists (select 1 from powerlifting_athletes where client_id = '00000000-0000-0000-0000-0000000c0001'), 'the record the approval made is gone');
select t_assert(not exists (select 1 from athlete_powerlifting_results where client_id = '00000000-0000-0000-0000-0000000c0001'), 'with its meets');
select t_assert((select status from openipf_suggestions where kind = 'match' and slug = 'marcasugui') = 'pending', 'the match waits again');
select t_assert((select openpowerlifting_url from clients where id = '00000000-0000-0000-0000-0000000c0001') is null, 'his client record has no link');

-- 9. Remove and Add back (Jared): only what the sync made comes off, and the same rows come back
create temp table jared_rows as select id, source from athlete_powerlifting_results where athlete_id = '00000000-0000-0000-0000-00000000a002';
set role authenticated;
select t_as('00000000-0000-0000-0000-0000000000c1');
create temp table hist as select openipf_unlink('00000000-0000-0000-0000-00000000a002') id;
reset role;
select t_assert((select count(*) from athlete_powerlifting_results where athlete_id = '00000000-0000-0000-0000-00000000a002') = 1, 'the meet entered by hand stays');
select t_assert((select source from athlete_powerlifting_results where athlete_id = '00000000-0000-0000-0000-00000000a002') = 'manual', '(that one)');
select t_assert((select meet_count = 1 and url = 'https://www.openpowerlifting.org/u/jaredmcintyre' from openipf_link_history where id = (select id from hist)), 'what came off is kept');
select t_assert((select openpowerlifting_url is null and not auto_sync from powerlifting_athletes where id = '00000000-0000-0000-0000-00000000a002'), 'the link and its sync are off');
select t_assert((select count(*) from openipf_targets() where client_id = '00000000-0000-0000-0000-0000000c0002') = 1, 'removed: searched again next month');
select t_assert((select status from openipf_suggestions where client_id = '00000000-0000-0000-0000-0000000c0002' and slug = 'jaredmcintyre') is distinct from 'pending', 'but not suggested back by itself');
set role authenticated;
select t_as('00000000-0000-0000-0000-0000000000c1');
select openipf_restore((select id from hist));
reset role;
select t_assert((select count(*) from athlete_powerlifting_results r join jared_rows j on j.id = r.id) = 2, 'Add back: the same rows, the same ids');
select t_assert((select openpowerlifting_url = 'https://www.openpowerlifting.org/u/jaredmcintyre' and auto_sync and opl_synced_at is not null
  from powerlifting_athletes where id = '00000000-0000-0000-0000-00000000a002'), 'the link is back and synced');
select t_assert(not exists (select 1 from openipf_suggestions where kind = 'new_meet' and athlete_id = '00000000-0000-0000-0000-00000000a002'), 'what came back isn''t news');
select t_assert((select restored_at is not null from openipf_link_history where id = (select id from hist)), 'the history says it''s back');
do $$ begin
  perform openipf_restore((select id from hist));
  raise exception 'should have failed';
exception when others then
  if sqlerrm = 'should have failed' then raise; end if;
  raise notice 'ok: it can''t come back twice';
end $$;

-- 10. Not them is never suggested again; its Undo brings it back
select t_as('00000000-0000-0000-0000-0000000000a1');
select openipf_decide((select id from openipf_suggestions where kind = 'match' and slug = 'kaydonlaurin2'), 'dismiss');
create temp table scan2 as select _openipf_scan_start(null, '00000000-0000-0000-0000-00000000a009', null) id;
select t_run((select id from scan2));
select t_assert((select status from openipf_suggestions where kind = 'match' and slug = 'kaydonlaurin2') = 'dismissed', 'Not them stays not them');
select t_assert((select count(*) from net.requests where url = 'https://www.openpowerlifting.org/api/liftercsv/kaydonlaurin2') <= 1, '(and isn''t read again)');
select openipf_decide((select id from openipf_suggestions where kind = 'match' and slug = 'kaydonlaurin2'), 'undo');
select t_assert((select status from openipf_suggestions where kind = 'match' and slug = 'kaydonlaurin2') = 'pending', 'Undo puts it back');

-- 11. A coach typing a profile link on the client's record links it; clearing it removes nothing
select t_as('00000000-0000-0000-0000-0000000000a1');
update clients set openpowerlifting_url = 'https://www.openipf.org/u/devinbuth' where id = '00000000-0000-0000-0000-0000000c0005';
select t_assert((select openpowerlifting_url = 'https://www.openipf.org/u/devinbuth' and auto_sync from powerlifting_athletes where client_id = '00000000-0000-0000-0000-0000000c0005'), 'a link typed on the profile is a link');
update clients set openpowerlifting_url = null where id = '00000000-0000-0000-0000-0000000c0005';
select t_assert((select openpowerlifting_url is not null from powerlifting_athletes where client_id = '00000000-0000-0000-0000-0000000c0005'), 'clearing it isn''t Remove');
-- a member's record never links
update clients set openpowerlifting_url = 'https://www.openipf.org/u/miamember2' where id = '00000000-0000-0000-0000-0000000c0004';
select t_assert((select openpowerlifting_url from powerlifting_athletes where client_id = '00000000-0000-0000-0000-0000000c0004') = 'https://www.openipf.org/u/miamember', 'a member''s link typed on the profile does nothing');

-- 12. Linking by a pasted link, and its checks
set role authenticated;
select t_as('00000000-0000-0000-0000-0000000000a1');
select openipf_link_url(null, '00000000-0000-0000-0000-00000000a009', 'https://www.openpowerlifting.org/u/kaydonlaurin1');
do $$ begin
  perform openipf_link_url('00000000-0000-0000-0000-0000000c0001', null, 'https://www.openpowerlifting.org/u/kaydonlaurin1');
  raise exception 'should have failed';
exception when others then
  if sqlerrm = 'should have failed' then raise; end if;
  raise notice 'ok: one profile is one person (%)', sqlerrm;
end $$;
do $$ begin
  perform openipf_link_url('00000000-0000-0000-0000-0000000c0001', null, 'https://example.com/u/marc');
  raise exception 'should have failed';
exception when others then
  if sqlerrm = 'should have failed' then raise; end if;
  raise notice 'ok: only an OpenIPF / OpenPowerlifting link';
end $$;
do $$ begin
  perform openipf_scan_start('00000000-0000-0000-0000-0000000c0004', null);
  raise exception 'should have failed';
exception when others then
  if sqlerrm = 'should have failed' then raise; end if;
  raise notice 'ok: a free member is never searched (%)', sqlerrm;
end $$;
select t_assert((select (s->>'linked')::boolean and (s->>'meet_count')::int = 2 from (select openipf_status('00000000-0000-0000-0000-0000000c0002', null) s) x), 'status: linked, two meets');
reset role;
set role anon;
do $$ begin
  perform openipf_status('00000000-0000-0000-0000-0000000c0002', null);
  raise exception 'should have failed';
exception when others then
  if sqlerrm = 'should have failed' then raise; end if;
  raise notice 'ok: anonymous gets nothing';
end $$;
reset role;
select 'passed' as openipf;
