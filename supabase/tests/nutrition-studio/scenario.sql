\set ON_ERROR_STOP 1
set client_min_messages = notice;
\set mia  '''00000000-0000-0000-0000-0000000000e1'''
\set marc '''00000000-0000-0000-0000-0000000000e2'''
\set coach '''00000000-0000-0000-0000-0000000000c1'''
\set mia_c '''00000000-0000-0000-0000-0000000c1e01'''
\set marc_c '''00000000-0000-0000-0000-0000000c1e02'''
\set dee_c '''00000000-0000-0000-0000-0000000c1e03'''

set role authenticated;

-- ── A member writes their own plan ──────────────────────────────────────────
select t_as(:mia);
insert into nutrition_targets (id, client_id, assigned_coach_id, visible_to_client, phase)
  values ('00000000-0000-0000-0000-00000000aa01', :mia_c, '00000000-0000-0000-0000-00000000c0a1', false, 'Maintenance');
select t_assert((select assigned_coach_id is null and visible_to_client from nutrition_targets where id = '00000000-0000-0000-0000-00000000aa01'), 'a member''s plan never names a coach and is always theirs to see');
insert into nutrition_target_days (target_id, day_label, notes) values ('00000000-0000-0000-0000-00000000aa01', 'Training Day', 'Meal 1');
update nutrition_target_days set calories = 2400 where target_id = '00000000-0000-0000-0000-00000000aa01';
select t_assert((select calories = 2400 from nutrition_target_days where target_id = '00000000-0000-0000-0000-00000000aa01'), 'a member edits their own days');
update nutrition_targets set status = 'Archived' where id = '00000000-0000-0000-0000-00000000aa01';
select t_assert((select status = 'Archived' from nutrition_targets where id = '00000000-0000-0000-0000-00000000aa01'), 'a member archives their own plan');

-- ── …and nobody else's ──────────────────────────────────────────────────────
do $$ begin
  insert into nutrition_targets (client_id) values ('00000000-0000-0000-0000-0000000c1e03');
  raise exception 'ASSERT FAILED: a member wrote a plan for another member';
exception when insufficient_privilege then raise notice 'ok: a member can''t make a plan for another member';
end $$;
select t_assert((select count(*) = 0 from nutrition_targets where id = '00000000-0000-0000-0000-00000000aa03'), 'a member can''t see another member''s plan');
update nutrition_target_days set notes = 'x' where target_id = '00000000-0000-0000-0000-00000000aa03';
reset role; select t_assert((select count(*) = 0 from nutrition_target_days where notes = 'x'), 'nor change it'); set role authenticated;

-- ── A coaching client can read their coach's plan, never write it ───────────
select t_as(:marc);
select t_assert((select count(*) = 1 from nutrition_targets), 'a coaching client sees their plan');
update nutrition_targets set phase = 'Bulk' where client_id = :marc_c;
reset role; select t_assert((select phase is null from nutrition_targets where client_id = :marc_c), 'a coaching client can''t change their coach''s plan'); set role authenticated;
select t_as(:marc);
do $$ begin
  insert into nutrition_targets (client_id) values ('00000000-0000-0000-0000-0000000c1e02');
  raise exception 'ASSERT FAILED: a coaching client made their own plan';
exception when insufficient_privilege then raise notice 'ok: a coaching client can''t make a plan';
end $$;

-- ── The coach's own write is untouched by the member rule ───────────────────
select t_as(:coach);
update nutrition_targets set visible_to_client = false where client_id = :marc_c;
reset role; select t_assert((select not visible_to_client and assigned_coach_id is not null from nutrition_targets where client_id = :marc_c), 'a coach''s plan keeps its coach and visibility'); set role authenticated;

-- ── Custom foods and saved meals are their owner's ──────────────────────────
select t_as(:mia);
insert into nutrition_custom_foods (name, basis, kcal, protein, carbs, fat) values ('Oikos Pro', 'per_100g', 70, 12, 4, 0);
insert into nutrition_meal_templates (name, lines) values ('Breakfast', array['80 g dry oats', '1 scoop whey protein']);
select t_assert((select count(*) = 1 from nutrition_custom_foods), 'a member sees their food');
do $$ begin
  insert into nutrition_custom_foods (name, basis, kcal, protein, carbs, fat) values ('Impossible', 'per_100g', 900, 60, 60, 10);
  raise exception 'ASSERT FAILED: 130 g of macros in 100 g';
exception when check_violation then raise notice 'ok: 100 g can''t hold more than 100 g of macros';
end $$;
do $$ begin
  insert into nutrition_custom_foods (owner_user_id, name, basis, kcal, protein, carbs, fat) values ('00000000-0000-0000-0000-0000000000e2', 'Planted', 'per_100g', 100, 10, 10, 1);
  raise exception 'ASSERT FAILED: made a food for someone else';
exception when insufficient_privilege then raise notice 'ok: a food is only ever its maker''s';
end $$;
select t_as(:coach);
select t_assert((select count(*) = 0 from nutrition_custom_foods) and (select count(*) = 0 from nutrition_meal_templates), 'nobody else sees them, not even a coach');

reset role;
select 'nutrition-studio: all assertions passed';
