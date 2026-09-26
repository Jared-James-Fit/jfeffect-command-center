-- Seed verified qualifying JF meet performances so the client Powerlifting Records board has real data.
-- Values are sourced from the athlete OpenPowerlifting profiles and respect the JF eligibility windows.
with seed(athlete_name,bodyweight_kg,squat_kg,bench_kg,deadlift_kg,points,meet_name,meet_location,meet_date,competition_level,weight_class_kg,federation,source_key) as (
 values
 ('Shaina Sagar',55.6,120,60,145,378.42,'MPA Total Fortification V','Canada-MB','2024-12-14'::date,'local','57','CPU','opl:2024-12-14:cpu:shainasagar'),
 ('Dwayne Gordon',101.1,275,190,315,477.85,'Strength Collective Spring Special','Canada-ON','2025-04-05'::date,'local','105','CPU','opl:2025-04-05:cpu:dwaynegordon'),
 ('Laine Vandriel',61,92.5,62.5,110,290.59,'Western Canadian Championships','Canada-SK','2024-03-10'::date,'regional','63','CPU','opl:2024-03-10:cpu:lainevandriel'),
 ('Kenneth Morris',103.1,240,115,230,355.42,'MPA Total Fortification V','Canada-MB','2024-12-14'::date,'local','105','CPU','opl:2024-12-14:cpu:kennethmorris'),
 ('Jonathan Miranda',65.2,195,130,205,418.78,'The National Pursuit','Canada-MB','2024-07-13'::date,'local','66','CPU','opl:2024-07-13:cpu:jonathanmiranda'),
 ('Jared McIntyre',73,260,170,290,525.55,'Western Canadian Championships','Canada-SK','2024-03-10'::date,'regional','74','CPU','opl:2024-03-10:cpu:jaredmcintyre'),
 ('Sarah Anderson',62.9,145,88,167.5,431.08,'Powersurge XV','Canada-AB','2025-11-15'::date,'local','63','CPU','opl:2025-11-15:cpu:sarahanderson'),
 ('Elisa Concetta Vena',62.3,140,65,160,394.98,'Western Canadian Powerlifting Championships','Canada-BC','2025-10-05'::date,'regional','63','CPU','opl:2025-10-05:cpu:elisaconcettavena'),
 ('Leslie Emslie',59.8,120,52.5,142.5,349.78,'Western Canadian Championship','Canada-MB','2023-08-10'::date,'regional','63','CPU','opl:2023-08-10:cpu:leslieemslie'),
 ('Phillip Bennett',98.0,235,152.5,285,417.61,'World Junior and Sub-Juniors Powerlifting Championships','Costa Rica','2025-08-25'::date,'international','105','IPF','opl:2025-08-25:ipf:phillipbennett4'),
 ('Ashtyn Trudeau',93.1,127.5,85,137.5,307.40,'MPA Powerlifting and Bench Press Championships','Canada-MB','2023-06-17'::date,'provincial','84+','CPU','opl:2023-06-17:cpu:ashtyntrudeau'),
 ('Mikaela Macasaet',49.1,115,50,125,368.08,'Western Canadian Championship','Canada-MB','2023-08-10'::date,'regional','52','CPU','opl:2023-08-10:cpu:mikaelamacasaet'),
 ('Branden Delarosa',82.2,167.5,107.5,232.5,344.30,'MPA Provincials','Canada-MB','2024-02-03'::date,'provincial','83','CPU','opl:2024-02-03:cpu:brandendelarosa'),
 ('Brandon Ramkalawan',95.9,230,135,235,376.24,'MPA Provincials','Canada-MB','2025-05-02'::date,'provincial','105','CPU','opl:2025-05-02:cpu:brandonramkalawan'),
 ('Jarrett Simard',65.4,165,102.5,190,360.66,'The One Powerlifting Classic 3.0','Canada-ON','2025-03-22'::date,'local','66','CPU','opl:2025-03-22:cpu:jarrettsimard'),
 ('Frederick Callahan',73.8,235,147.5,235,447.37,'Nationals','Canada-PE','2024-09-14'::date,'national','74','CPU','opl:2024-09-14:cpu:frederickcallahan'),
 ('Alayna Wlodarczyk',62.8,90,52.5,135,298.89,'Summer Showdown Peel','Canada-ON','2024-08-09'::date,'local','63','CPU','opl:2024-08-09:cpu:alaynawlodarczyk'),
 ('Nabil Ahmed',88.6,175,127.5,227.5,345.30,'Classic AF','Canada-ON','2024-05-04'::date,'local','93','CPU','opl:2024-05-04:cpu:nabilahmed'),
 ('Jeremy Martin',82.3,180,117.5,212.5,345.90,'MPA Total Fortification V','Canada-MB','2024-12-14'::date,'local','83','CPU','opl:2024-12-14:cpu:jeremymartin')
)
insert into public.athlete_powerlifting_results
 (athlete_id,client_id,athlete_name,sex,bodyweight_kg,squat_kg,bench_kg,deadlift_kg,points,points_system,meet_name,meet_location,meet_date,competition_level,weight_class_kg,federation,source,source_key)
select a.id,a.client_id,a.athlete_name,a.sex,s.bodyweight_kg,s.squat_kg,s.bench_kg,s.deadlift_kg,s.points,'DOTS',s.meet_name,s.meet_location,s.meet_date,s.competition_level,s.weight_class_kg,s.federation,'openpowerlifting',s.source_key
from seed s join public.powerlifting_athletes a on lower(a.athlete_name)=lower(s.athlete_name)
where (a.jf_start_date is null or s.meet_date>=a.jf_start_date)
  and (a.jf_end_date is null or s.meet_date<=a.jf_end_date)
  and (a.country_filter is null or a.country_filter='Canada')
on conflict (athlete_id,source,source_key) where source_key is not null do update set
 bodyweight_kg=excluded.bodyweight_kg,squat_kg=excluded.squat_kg,bench_kg=excluded.bench_kg,deadlift_kg=excluded.deadlift_kg,
 points=excluded.points,points_system=excluded.points_system,meet_name=excluded.meet_name,meet_location=excluded.meet_location,
 meet_date=excluded.meet_date,competition_level=excluded.competition_level,weight_class_kg=excluded.weight_class_kg,federation=excluded.federation,updated_at=now();

-- Ensure the two collision-prone identities only qualify CPU Canadian records.
update public.powerlifting_athletes set country_filter='Canada' where athlete_name in ('Kenneth Morris','Jeremy Martin');
