-- The holes as they were, before the three migrations (run between schema.sql
-- and the migrations): each line must hold here and be gone afterwards.
\set ON_ERROR_STOP 1
set client_min_messages = notice;

reset role; select t_as('00000000-0000-0000-0000-0000000000c1'); set role authenticated;   -- Ana
select t_assert((select count(*) = 2 from nutrition_ai_plans), 'before: a coach read every client''s AI meal plan');
insert into purchase_records (client_id, offer_name, payment_status, amount_paid_cents)
  values ('00000000-0000-0000-0000-0000000c1e01', 'made up', 'Paid', 999999);
select t_assert(true, 'before: a coach could write a sale marked paid for their client');
select t_assert((select count(*) = 2 from payment_share_links), 'before: a coach saw every payment link');
select t_assert((select count(*) = 4 from support_alerts), 'before: a coach saw every alert, system ones too');
select t_assert(exists (select 1 from submission_reviews where client_id is null), 'before: a coach saw unmatched submissions');
reset role;
delete from purchase_records where offer_name = 'made up';
\echo 'before: the holes are there'
