-- Verified CPU/OpenPowerlifting results for Nicole Carta and Fionna Gaburno.
update public.powerlifting_athletes
set openpowerlifting_url='https://www.openpowerlifting.org/u/nicolecarta', auto_sync=true, updated_at=now()
where lower(athlete_name)=lower('Nicole Carta');

with seed(athlete_name,bodyweight_kg,squat_kg,bench_kg,deadlift_kg,points,points_system,meet_name,meet_location,meet_date,competition_level,weight_class_kg,federation,source_key) as (
 values
 ('Nicole Carta',50.5,80,42.5,115,295.33,'DOTS','MPA Total Fortification V','Canada-MB','2024-12-14'::date,'local','52','CPU','opl:2024-12-14:cpu:nicolecarta'),
 ('Nicole Carta',51.3,0,47.5,0,58.38,'DOTS','The One Powerlifting Classic 3.0','Canada-ON','2025-03-22'::date,'local','52','CPU','opl:2025-03-22:cpu:nicolecarta:bench'),
 ('Nicole Carta',50.8,77.5,47.5,110,291.08,'DOTS','Total Fortification','Canada-MB','2025-12-13'::date,'local','52','CPU','opl:2025-12-13:cpu:nicolecarta'),
 ('Fionna Gaburno',51.7,65,42.5,85,48.85,'GL','Manitoba Provincials','Canada-MB','2020-10-17'::date,'provincial','52','CPU','opl:2020-10-17:cpu:fionnafayegaburno')
)
insert into public.athlete_powerlifting_results
 (athlete_id,client_id,athlete_name,sex,bodyweight_kg,squat_kg,bench_kg,deadlift_kg,points,points_system,meet_name,meet_location,meet_date,competition_level,weight_class_kg,federation,source,source_key)
select a.id,a.client_id,a.athlete_name,a.sex,s.bodyweight_kg,s.squat_kg,s.bench_kg,s.deadlift_kg,s.points,s.points_system,s.meet_name,s.meet_location,s.meet_date,s.competition_level,s.weight_class_kg,s.federation,'openpowerlifting',s.source_key
from seed s join public.powerlifting_athletes a on lower(a.athlete_name)=lower(s.athlete_name)
where (a.jf_start_date is null or s.meet_date>=a.jf_start_date) and (a.jf_end_date is null or s.meet_date<=a.jf_end_date)
on conflict (athlete_id,source,source_key) where source_key is not null do update set
 bodyweight_kg=excluded.bodyweight_kg,squat_kg=excluded.squat_kg,bench_kg=excluded.bench_kg,deadlift_kg=excluded.deadlift_kg,
 points=excluded.points,points_system=excluded.points_system,meet_name=excluded.meet_name,meet_location=excluded.meet_location,
 meet_date=excluded.meet_date,competition_level=excluded.competition_level,weight_class_kg=excluded.weight_class_kg,federation=excluded.federation,updated_at=now();
