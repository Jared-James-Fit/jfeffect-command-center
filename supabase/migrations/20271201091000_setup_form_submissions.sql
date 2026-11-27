-- Onboarding responses appear in the existing native Forms library.
-- Source records remain authoritative; no new questionnaire or assignment is sent.
-- Legacy records are current saved answers, not fabricated original snapshots.
insert into public.nf_forms
 (id,title,description,form_type,recurrence,active,archived,kind,visibility,auto_assign_new_clients,requires_client_identity,is_template,category,settings)
values
 ('a1e9fca0-6c31-4a00-9f00-000000000001','Goals & Intake','Current saved Goals & Setup answers. Clients complete and update these through account setup.','setup_goals','none',true,false,'native','selected',false,true,true,'Client Onboarding','{"system_setup":true}'::jsonb),
 ('a1e9fca0-6c31-4a00-9f00-000000000002','Competition Setup','Current saved competition onboarding answers, one response per meet. Clients update these through competition setup.','setup_competition','none',true,false,'native','selected',false,true,true,'Powerlifting & Competitions','{"system_setup":true}'::jsonb)
on conflict (id) do nothing;

insert into public.nf_questions (id,form_id,order_index,question_type,label,required,options,validation,conditional_logic)
select md5(v.form_id || ':' || v.field_key)::uuid, v.form_id::uuid,v.position,'long_text',v.label,false,'[]'::jsonb,jsonb_build_object('setup_key',v.field_key),'{}'::jsonb
from (values
  (('a1e9fca0-6c31-4a00-9f00-000000000001'), 'main_goal', 0, 'Main goal'),
  (('a1e9fca0-6c31-4a00-9f00-000000000001'), 'main_goal_other', 1, 'Other goal'),
  (('a1e9fca0-6c31-4a00-9f00-000000000001'), 'goal_target', 2, 'Target / deadline'),
  (('a1e9fca0-6c31-4a00-9f00-000000000001'), 'training_days_per_week', 3, 'Training days per week'),
  (('a1e9fca0-6c31-4a00-9f00-000000000001'), 'available_weekdays', 4, 'Available weekdays'),
  (('a1e9fca0-6c31-4a00-9f00-000000000001'), 'workout_length_minutes', 5, 'Workout length (minutes)'),
  (('a1e9fca0-6c31-4a00-9f00-000000000001'), 'training_experience', 6, 'Training experience'),
  (('a1e9fca0-6c31-4a00-9f00-000000000001'), 'training_styles', 7, 'Training styles'),
  (('a1e9fca0-6c31-4a00-9f00-000000000001'), 'training_location', 8, 'Training location'),
  (('a1e9fca0-6c31-4a00-9f00-000000000001'), 'equipment', 9, 'Equipment'),
  (('a1e9fca0-6c31-4a00-9f00-000000000001'), 'equipment_by_location', 10, 'Equipment by location'),
  (('a1e9fca0-6c31-4a00-9f00-000000000001'), 'nutrition_goal', 11, 'Nutrition goal'),
  (('a1e9fca0-6c31-4a00-9f00-000000000001'), 'nutrition_preference', 12, 'Nutrition preference'),
  (('a1e9fca0-6c31-4a00-9f00-000000000001'), 'food_restrictions_has', 13, 'Food restrictions'),
  (('a1e9fca0-6c31-4a00-9f00-000000000001'), 'food_restrictions_details', 14, 'Food restriction details'),
  (('a1e9fca0-6c31-4a00-9f00-000000000001'), 'nutrition_challenges', 15, 'Nutrition challenges'),
  (('a1e9fca0-6c31-4a00-9f00-000000000001'), 'cooking_skill', 16, 'Cooking skill'),
  (('a1e9fca0-6c31-4a00-9f00-000000000001'), 'food_dislikes', 17, 'Food dislikes'),
  (('a1e9fca0-6c31-4a00-9f00-000000000001'), 'injuries_has', 18, 'Injuries / limitations'),
  (('a1e9fca0-6c31-4a00-9f00-000000000001'), 'injuries_details', 19, 'Injury details'),
  (('a1e9fca0-6c31-4a00-9f00-000000000001'), 'final_notes', 20, 'Final notes'),
  (('a1e9fca0-6c31-4a00-9f00-000000000001'), 'committed_training_days', 21, 'Training days'),
  (('a1e9fca0-6c31-4a00-9f00-000000000002'), 'name', 0, 'Competition'),
  (('a1e9fca0-6c31-4a00-9f00-000000000002'), 'meet_date', 1, 'Meet date'),
  (('a1e9fca0-6c31-4a00-9f00-000000000002'), 'sport', 2, 'Sport'),
  (('a1e9fca0-6c31-4a00-9f00-000000000002'), 'federation', 3, 'Federation'),
  (('a1e9fca0-6c31-4a00-9f00-000000000002'), 'location', 4, 'Venue'),
  (('a1e9fca0-6c31-4a00-9f00-000000000002'), 'division', 5, 'Division'),
  (('a1e9fca0-6c31-4a00-9f00-000000000002'), 'weight_class', 6, 'Weight class'),
  (('a1e9fca0-6c31-4a00-9f00-000000000002'), 'weigh_in_at', 7, 'Weigh-in time'),
  (('a1e9fca0-6c31-4a00-9f00-000000000002'), 'lifting_start', 8, 'Lifting start'),
  (('a1e9fca0-6c31-4a00-9f00-000000000002'), 'flight', 9, 'Flight'),
  (('a1e9fca0-6c31-4a00-9f00-000000000002'), 'flights_in_session', 10, 'Flights in session'),
  (('a1e9fca0-6c31-4a00-9f00-000000000002'), 'lifters_per_flight', 11, 'Lifters per flight'),
  (('a1e9fca0-6c31-4a00-9f00-000000000002'), 'timezone', 12, 'Time zone'),
  (('a1e9fca0-6c31-4a00-9f00-000000000002'), 'unit', 13, 'Preferred weight unit'),
  (('a1e9fca0-6c31-4a00-9f00-000000000002'), 'bodyweightKg', 14, 'Bodyweight (kg)'),
  (('a1e9fca0-6c31-4a00-9f00-000000000002'), 'bodyweightOn', 15, 'Bodyweight date'),
  (('a1e9fca0-6c31-4a00-9f00-000000000002'), 'bests.squat', 16, 'Squat best meet lift (kg)'),
  (('a1e9fca0-6c31-4a00-9f00-000000000002'), 'bests.bench', 17, 'Bench best meet lift (kg)'),
  (('a1e9fca0-6c31-4a00-9f00-000000000002'), 'bests.deadlift', 18, 'Deadlift best meet lift (kg)'),
  (('a1e9fca0-6c31-4a00-9f00-000000000002'), 'recent.squat', 19, 'Squat recent training lift (kg)'),
  (('a1e9fca0-6c31-4a00-9f00-000000000002'), 'recent.bench', 20, 'Bench recent training lift (kg)'),
  (('a1e9fca0-6c31-4a00-9f00-000000000002'), 'recent.deadlift', 21, 'Deadlift recent training lift (kg)'),
  (('a1e9fca0-6c31-4a00-9f00-000000000002'), 'targets.squat', 22, 'Squat target (kg)'),
  (('a1e9fca0-6c31-4a00-9f00-000000000002'), 'targets.bench', 23, 'Bench target (kg)'),
  (('a1e9fca0-6c31-4a00-9f00-000000000002'), 'targets.deadlift', 24, 'Deadlift target (kg)'),
  (('a1e9fca0-6c31-4a00-9f00-000000000002'), 'attempts.squat', 25, 'Squat attempts (kg)'),
  (('a1e9fca0-6c31-4a00-9f00-000000000002'), 'attempts.bench', 26, 'Bench attempts (kg)'),
  (('a1e9fca0-6c31-4a00-9f00-000000000002'), 'attempts.deadlift', 27, 'Deadlift attempts (kg)'),
  (('a1e9fca0-6c31-4a00-9f00-000000000002'), 'attemptsBy', 28, 'Who plans attempts'),
  (('a1e9fca0-6c31-4a00-9f00-000000000002'), 'coach.has', 29, 'Has a coach'),
  (('a1e9fca0-6c31-4a00-9f00-000000000002'), 'coach.name', 30, 'Coach name'),
  (('a1e9fca0-6c31-4a00-9f00-000000000002'), 'coach.contact', 31, 'Coach contact'),
  (('a1e9fca0-6c31-4a00-9f00-000000000002'), 'coach.writesTraining', 32, 'Coach writes training'),
  (('a1e9fca0-6c31-4a00-9f00-000000000002'), 'shareWithCoach', 33, 'Share with existing coach'),
  (('a1e9fca0-6c31-4a00-9f00-000000000002'), 'warmupStyle', 34, 'Warm-up preference'),
  (('a1e9fca0-6c31-4a00-9f00-000000000002'), 'ownWarmups.squat', 35, 'Squat warm-ups (kg / reps)'),
  (('a1e9fca0-6c31-4a00-9f00-000000000002'), 'ownWarmups.bench', 36, 'Bench warm-ups (kg / reps)'),
  (('a1e9fca0-6c31-4a00-9f00-000000000002'), 'ownWarmups.deadlift', 37, 'Deadlift warm-ups (kg / reps)'),
  (('a1e9fca0-6c31-4a00-9f00-000000000002'), 'racks.squat.height', 38, 'Squat rack height'),
  (('a1e9fca0-6c31-4a00-9f00-000000000002'), 'racks.squat.safety', 39, 'Squat safety height'),
  (('a1e9fca0-6c31-4a00-9f00-000000000002'), 'racks.bench.height', 40, 'Bench rack height'),
  (('a1e9fca0-6c31-4a00-9f00-000000000002'), 'racks.bench.safety', 41, 'Bench safety height'),
  (('a1e9fca0-6c31-4a00-9f00-000000000002'), 'racks.bench.footBlocks', 42, 'Bench foot blocks'),
  (('a1e9fca0-6c31-4a00-9f00-000000000002'), 'gear', 43, 'Equipment'),
  (('a1e9fca0-6c31-4a00-9f00-000000000002'), 'limitations', 44, 'Limitations'),
  (('a1e9fca0-6c31-4a00-9f00-000000000002'), 'travel.mode', 45, 'Travel mode'),
  (('a1e9fca0-6c31-4a00-9f00-000000000002'), 'travel.minutesToVenue', 46, 'Minutes to venue'),
  (('a1e9fca0-6c31-4a00-9f00-000000000002'), 'travel.arrive', 47, 'Arrival'),
  (('a1e9fca0-6c31-4a00-9f00-000000000002'), 'travel.accommodation', 48, 'Accommodation'),
  (('a1e9fca0-6c31-4a00-9f00-000000000002'), 'travel.flightDetails', 49, 'Flight details'),
  (('a1e9fca0-6c31-4a00-9f00-000000000002'), 'nutrition.afterWeighIn', 50, 'Post-weigh-in nutrition'),
  (('a1e9fca0-6c31-4a00-9f00-000000000002'), 'nutrition.snacks', 51, 'Meet snacks'),
  (('a1e9fca0-6c31-4a00-9f00-000000000002'), 'nutrition.caffeineMg', 52, 'Caffeine (mg)'),
  (('a1e9fca0-6c31-4a00-9f00-000000000002'), 'nutrition.notes', 53, 'Nutrition notes'),
  (('a1e9fca0-6c31-4a00-9f00-000000000002'), 'meetDay.phone', 54, 'Meet day phone'),
  (('a1e9fca0-6c31-4a00-9f00-000000000002'), 'meetDay.emergencyName', 55, 'Emergency contact name'),
  (('a1e9fca0-6c31-4a00-9f00-000000000002'), 'meetDay.emergencyPhone', 56, 'Emergency contact phone'),
  (('a1e9fca0-6c31-4a00-9f00-000000000002'), 'officialTimes', 57, 'Official meet times'),
  (('a1e9fca0-6c31-4a00-9f00-000000000002'), 'proposed_event_changes', 58, 'Pending event corrections (not yet confirmed)')
) v(form_id,field_key,position,label)
on conflict (id) do nothing;

-- Stable response identity prevents duplicate records on re-save or migration replay.
-- Store answer values as human-readable text; preserve explicit false and zero.
create or replace function public.setup_form_answer_text(v jsonb)
returns text language sql immutable set search_path = public as $$
 select case jsonb_typeof(v)
   when 'null' then null
   when 'string' then nullif(v #>> '{}','')
   when 'boolean' then case when v = 'true'::jsonb then 'Yes' else 'No' end
   when 'array' then case when v = '[]'::jsonb then null else
     (select string_agg(public.setup_form_answer_text(e), E'\n' order by n) from jsonb_array_elements(v) with ordinality a(e,n)) end
   when 'object' then (select string_agg(initcap(replace(k,'_',' ')) || ': ' || public.setup_form_answer_text(e), E'\n' order by k) from jsonb_each(v) a(k,e) where e <> 'null'::jsonb)
   else v #>> '{}'
 end
$$;

create or replace function public.sync_setup_form_response(
 p_form uuid, p_source uuid, p_client uuid, p_completed timestamptz, p_payload jsonb
) returns void language plpgsql security definer set search_path = public as $$
declare
 s uuid := md5(p_form::text || ':' || p_source::text)::uuid;
begin
 if p_completed is null or p_client is null then return; end if;
 -- Old responses retain their review status unless a new completion was recorded.
 insert into public.nf_submissions(id,form_id,client_id,status,started_at,submitted_at,created_at)
 values(s,p_form,p_client,'pending_review',p_completed,p_completed,p_completed)
 on conflict (id) do update set
   client_id=excluded.client_id,
   submitted_at=excluded.submitted_at,
   status=case when nf_submissions.submitted_at is distinct from excluded.submitted_at then 'pending_review' else nf_submissions.status end,
   reviewed_at=case when nf_submissions.submitted_at is distinct from excluded.submitted_at then null else nf_submissions.reviewed_at end,
   reviewed_by=case when nf_submissions.submitted_at is distinct from excluded.submitted_at then null else nf_submissions.reviewed_by end
 where nf_submissions.submitted_at is distinct from excluded.submitted_at or nf_submissions.client_id is distinct from excluded.client_id;

 insert into public.nf_answers(submission_id,question_id,value_text)
 select s,q.id,public.setup_form_answer_text(p_payload #> string_to_array(q.validation->>'setup_key','.'))
 from public.nf_questions q where q.form_id=p_form
 on conflict (submission_id,question_id) do update set value_text=excluded.value_text,value_number=null,value_json=null
 where nf_answers.value_text is distinct from excluded.value_text or nf_answers.value_number is not null or nf_answers.value_json is not null;
end
$$;
revoke all on function public.sync_setup_form_response(uuid,uuid,uuid,timestamptz,jsonb) from public,anon,authenticated,service_role;

create or replace function public.sync_goals_setup_form(p_row public.client_goals_setup)
returns void language plpgsql security definer set search_path = public as $$
declare days jsonb;
begin
 if p_row.completed_at is null then return; end if;
 select to_jsonb(c.committed_training_days) into days from public.clients c where c.id=p_row.client_id;
 perform public.sync_setup_form_response('a1e9fca0-6c31-4a00-9f00-000000000001',p_row.client_id,p_row.client_id,p_row.completed_at,to_jsonb(p_row)||jsonb_build_object('committed_training_days',days));
end
$$;
revoke all on function public.sync_goals_setup_form(public.client_goals_setup) from public,anon,authenticated,service_role;

create or replace function public.sync_competition_setup_form(p_row public.competitions)
returns void language plpgsql security definer set search_path = public as $$
declare
 info jsonb := coalesce(p_row.athlete_info,'{}'::jsonb);
 finished timestamptz;
 required_steps text[];
 handled boolean;
begin
 if coalesce(p_row.internal_test,false) then return; end if;
 if nullif(info->>'completedAt','') is not null then
   finished := (info->>'completedAt')::timestamptz;
 else
   select exists(select 1 from public.competition_handling h where h.competition_id=p_row.id) into handled;
   required_steps := array['event','coach','travel','day'];
   if coalesce(p_row.sport,'powerlifting')='powerlifting' then required_steps := required_steps||array['body','lifts','warmups']; end if;
   if handled then required_steps := required_steps||array['confirm']; end if;
   if not (coalesce(info->'steps','{}'::jsonb) ?& required_steps) then return; end if;
   select max((info->'steps'->>step)::timestamptz) into finished from unnest(required_steps) step;
 end if;
 perform public.sync_setup_form_response('a1e9fca0-6c31-4a00-9f00-000000000002',p_row.id,p_row.client_id,finished,
   to_jsonb(p_row)||info||jsonb_build_object('proposed_event_changes',
   (select coalesce(jsonb_agg(x->>'text'),'[]'::jsonb) from jsonb_array_elements(coalesce(p_row.athlete_info_changes,'[]'::jsonb)) x where x->>'key' like 'event_%')));
end
$$;
revoke all on function public.sync_competition_setup_form(public.competitions) from public,anon,authenticated,service_role;

create or replace function public.tg_goals_setup_form() returns trigger language plpgsql security definer set search_path=public as $$
begin perform public.sync_goals_setup_form(new); return new; end $$;
create or replace function public.tg_competition_setup_form() returns trigger language plpgsql security definer set search_path=public as $$
begin perform public.sync_competition_setup_form(new); return new; end $$;
revoke all on function public.tg_goals_setup_form() from public,anon,authenticated,service_role;
revoke all on function public.tg_competition_setup_form() from public,anon,authenticated,service_role;

drop trigger if exists goals_setup_form_sync on public.client_goals_setup;
create trigger goals_setup_form_sync after insert or update on public.client_goals_setup for each row execute function public.tg_goals_setup_form();
drop trigger if exists competition_setup_form_sync on public.competitions;
create trigger competition_setup_form_sync after insert or update of athlete_info,athlete_info_changes,name,meet_date,sport,federation,location,division,weight_class,weigh_in_at,lifting_start,flight,flights_in_session,lifters_per_flight,timezone on public.competitions for each row execute function public.tg_competition_setup_form();

-- Backfill all actual saved completed records, including archived clients and past meets.
do $$ declare g public.client_goals_setup; c public.competitions; begin
 for g in select * from public.client_goals_setup where completed_at is not null loop perform public.sync_goals_setup_form(g); end loop;
 for c in select * from public.competitions where athlete_info is not null loop perform public.sync_competition_setup_form(c); end loop;
end $$;

-- The regular form editor must never create a parallel onboarding request.
-- Block assignment of the two system forms even via service-role send routes.
create or replace function public.tg_no_setup_form_assignment() returns trigger language plpgsql set search_path=public as $$
begin
 if new.form_id in ('a1e9fca0-6c31-4a00-9f00-000000000001'::uuid,'a1e9fca0-6c31-4a00-9f00-000000000002'::uuid) then
   raise exception 'Use the existing account or competition setup to request these answers.';
 end if;
 return new;
end $$;
drop trigger if exists no_setup_form_assignment on public.nf_assignments;
create trigger no_setup_form_assignment before insert or update on public.nf_assignments for each row execute function public.tg_no_setup_form_assignment();
notify pgrst,'reload schema';
