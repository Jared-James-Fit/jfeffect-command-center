\set ON_ERROR_STOP 1
-- people: a coaching client, a free member, a test login, the admin
insert into auth.users (id, email, created_at) values
  ('00000000-0000-0000-0000-00000000000a', 'client@jf.ca', now() - interval '40 days'),
  ('00000000-0000-0000-0000-00000000000b', 'member@jf.ca', now() - interval '3 days'),
  ('00000000-0000-0000-0000-00000000000c', 'qa@example.com', now() - interval '2 days'),
  ('00000000-0000-0000-0000-00000000000d', 'coach@jf.ca', now() - interval '200 days');
insert into public.user_roles values ('00000000-0000-0000-0000-00000000000d', 'admin'), ('00000000-0000-0000-0000-00000000000a', 'client');
insert into public.clients (id, user_id, service_tier, status) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'coaching', 'Active'),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', 'self_serve', 'Member'),
  ('10000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000c', 'self_serve', 'Member');

select t_assert(public.app_pulse_audience('00000000-0000-0000-0000-00000000000a') = 'client', 'a coaching login is a client');
select t_assert(public.app_pulse_audience('00000000-0000-0000-0000-00000000000b') = 'member', 'a self-serve login is a member');
select t_assert(public.app_pulse_audience('00000000-0000-0000-0000-00000000000c') = 'test', 'a test login is never counted');
select t_assert(public.app_pulse_audience('00000000-0000-0000-0000-00000000000d') = 'staff', 'a role other than client is staff');
select t_assert(public.app_pulse_audience(null) = 'visitor', 'no login is a visitor');
select t_assert(public.app_pulse_audience(gen_random_uuid()) = 'pending', 'a login with no record is pending');

-- a member's visit: first beat makes the session with a rounded place, later beats add views
select public.app_pulse_record('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-00000000000b', 'member', 'app', 'home_screen', 'phone', 'ios', '/portal', 'Home', null,
  null, null, null, 'ca', 'Manitoba', 'Selkirk', 50.14567, -96.88412,
  '[{"path":"/portal","feature":"Home"},{"path":"/portal/workouts","feature":"Workouts"}]'::jsonb, 30);
select t_assert((select lat = 50.1 and lng = -96.9 and country = 'CA' and views = 2 and active_seconds = 30
  from public.app_sessions where id = '20000000-0000-0000-0000-000000000001'), 'a place is kept to 0.1 degree and the country upper-cased');
select public.app_pulse_record('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-00000000000b', 'member', 'app', null, null, null, null, null, null,
  null, null, null, 'US', 'X', 'Elsewhere', 1, 1, '[{"path":"/portal/community","feature":"Crew"}]'::jsonb, 9999);
select t_assert((select city = 'Selkirk' and views = 3 and active_seconds = 330
  from public.app_sessions where id = '20000000-0000-0000-0000-000000000001'), 'a later beat never moves the place; active time per beat is capped at 5 minutes');
-- a different browser can't move someone else's session
select public.app_pulse_record('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000099',
  null, 'visitor', 'site', null, null, null, null, null, null, null, null, null, null, null, null, null, null,
  '[{"path":"/","feature":"Landing"}]'::jsonb, 10);
select t_assert((select views = 3 from public.app_sessions where id = '20000000-0000-0000-0000-000000000001'), 'another visitor id never adds to a session');
select t_assert((select count(*) = 3 from public.app_page_views where session_id = '20000000-0000-0000-0000-000000000001'), 'page views are kept per session');
-- an anonymous visitor who signs in part way through
select public.app_pulse_record('20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002',
  null, 'visitor', 'site', 'browser', 'desktop', 'macos', '/', 'Landing', 'instagram.com', 'ig', null, null, null, null, null, null, null,
  '[{"path":"/","feature":"Landing"}]'::jsonb, 5);
select public.app_pulse_record('20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-00000000000a', 'client', 'app', null, null, null, null, null, null, null, null, null, null, null, null, null, null,
  '[]'::jsonb, 5);
select t_assert((select user_id = '00000000-0000-0000-0000-00000000000a' and audience = 'client'
  from public.app_sessions where id = '20000000-0000-0000-0000-000000000002'), 'a visit that signs in becomes that login''s');
-- a flood of views stops at 600 a session
select public.app_pulse_record('20000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000003',
  null, 'visitor', 'site', null, null, null, '/', 'Landing', null, null, null, null, null, null, null, null, null,
  (select jsonb_agg(jsonb_build_object('path', '/', 'feature', 'Landing')) from generate_series(1, 100)), 5);
select t_assert((select views = 40 from public.app_sessions where id = '20000000-0000-0000-0000-000000000003'), 'at most 40 views a beat');

-- the read
insert into public.client_activity_log (actor_user_id, action, created_at) values
  ('00000000-0000-0000-0000-00000000000a', 'signed_in', now() - interval '2 days'),
  ('00000000-0000-0000-0000-00000000000d', 'signed_in', now());
insert into public.membership_funnel_events (day, visitor_id, event, source, device) values
  ((now() at time zone 'America/Winnipeg')::date, gen_random_uuid(), 'landing_view', 'instagram', 'phone'),
  ((now() at time zone 'America/Winnipeg')::date, gen_random_uuid(), 'landing_view', null, 'desktop');
insert into public.pl_day_completions (client_id, completed_at) values ('10000000-0000-0000-0000-00000000000b', now());
insert into public.payment_ledger (txn_type, amount_minor, tax_minor) values ('payment', 13650, 650), ('refund', 1050, 50);
insert into public.payment_ledger (txn_type, amount_minor, tax_minor, voided) values ('payment', 99999, 0, true);
insert into public.purchase_records (stripe_subscription_id, stripe_subscription_status, cancel_at_period_end) values
  ('sub_1', 'active', false), ('sub_2', 'active', true), ('sub_3', 'past_due', false), ('sub_4', 'canceled', false);

do $$
declare r jsonb := public.app_intel_report(30);
begin
  perform t_assert((r -> 'now' ->> 'people')::int = 2, 'people leave out staff and test logins');
  perform t_assert((r -> 'now' ->> 'mau')::int = 2, 'active people read visits and the old sign-in record, never staff');
  perform t_assert((r -> 'now' ->> 'members')::int = 1 and (r -> 'now' ->> 'clients')::int = 1, 'members and clients are counted apart');
  perform t_assert((r -> 'site' ->> 'landing_visitors')::int = 2, 'landing visitors come from the funnel');
  perform t_assert(jsonb_array_length(r -> 'places') = 1, 'only placed visits are on the map');
  perform t_assert((r ->> 'unplaced_sessions')::int = 2, 'visits with no place are counted apart');
  perform t_assert((r -> 'live' ->> 'total')::int = 3, 'live visits (staff never counted)');
  perform t_assert(exists (select 1 from jsonb_array_elements(r -> 'actions') a where a ->> 'action' = 'Logged a workout' and (a ->> 'people')::int = 1),
    'feature adoption reads the records each feature keeps');
  perform t_assert(exists (select 1 from jsonb_array_elements(r -> 'revenue') a where (a ->> 'cash_in')::numeric = 130 and (a ->> 'refunds')::numeric = 10),
    'revenue is cash in before tax, voided rows left out');
  perform t_assert((r -> 'subscriptions' ->> 'active')::int = 3 and (r -> 'subscriptions' ->> 'ending')::int = 1
    and (r -> 'subscriptions' ->> 'failing')::int = 1, 'subscriptions: running, ending, failing');
  perform t_assert((r -> 'onboarding' ->> 'joined')::int = 2 and (r -> 'onboarding' ->> 'trained_week1')::int = 1, 'onboarding funnel');
end $$;
select 'ok: app_intel_report';

-- usage reads
insert into public.ai_call_log (model, task, ok, failure, cost_usd, ms) values
  ('openai:gpt-5.5', 'post_write', true, null, 0.5, 1000),
  ('openai:gpt-5.5', 'post_write', false, 'credits', null, 100),
  ('openai:gpt-5-mini', 'checkin_recap', true, null, 0.01, 500),
  ('openai:gpt-5-mini', 'probe', true, null, 0.0001, 5),
  ('openai:gpt-5.5', 'edit', false, 'paused', null, null);
select t_assert((select sum(calls) = 4 and sum(failed) = 1 and sum(paused) = 1 and round(sum(cost), 2) = 0.51 from public.ops_ai_daily(7)),
  'AI by day: probes left out, paused counted apart');
select t_assert((select calls = 3 and failed = 1 and round(ok_cost / ok_priced, 2) = 0.5 from public.ops_ai_by_model(now() - interval '1 day') where model = 'openai:gpt-5.5'),
  'AI by model: cost per answered call');
insert into public.sms_log (category, kind, status, twilio_sid, twilio_status, segments, price_usd, est_cost_usd, blocked_reason) values
  ('session', 'session', 'sent', 'SM1', 'delivered', 1, 0.0083, 0.0079, null),
  ('reminder', 'reminder', 'sent', 'SM2', 'accepted', 2, null, 0.0158, null),
  ('reminder', 'reminder', 'skipped', null, null, null, null, null, 'push_delivered'),
  ('payment', 'automation', 'sent', 'SM3', 'undelivered', 1, 0.0079, 0.0079, null);
select t_assert((select sum(sent) = 3 and sum(delivered) = 1 and sum(undelivered) = 1 and sum(unconfirmed) = 1 and sum(blocked) = 1
  and round(sum(cost_usd), 4) = 0.0320 from public.ops_sms_daily(7)), 'texts by day: the larger of price and estimate, delivery read back');
select t_assert((select by_push = 1 and sent = 1 from public.ops_sms_by_category(now() - interval '1 day') where category = 'reminder'),
  'texts by purpose: ones a push already reached are counted');

-- the hold
insert into public.community_post_decks (status, priority) values ('pending', 50), ('pending', 10);
select t_assert(not public.ai_background_held(), 'no hold until the tick sets one');
select t_assert(public.community_post_decks_kick(), 'kick sends work');
select t_assert((select count(*) = 2 from net.calls), 'both the due lesson and a background deck start');
delete from net.calls; update public.community_post_decks set run_after = now() - interval '1 minute', status = 'pending', claimed_at = null;
insert into public.app_settings (key, value) values ('ai_spend_hold', '{"held":true}');
select t_assert(public.ai_background_held(), 'the hold reads');
select public.community_post_decks_kick();
select t_assert((select count(*) = 1 from net.calls), 'with the hold on only the due lesson starts');
select t_assert((select (body ->> 'jobId')::uuid from net.calls limit 1) = (select id from public.community_post_decks where priority = 10), 'the lesson, not the backlog');

-- nobody but the service role reads or calls any of it
select t_assert(not has_table_privilege('authenticated', 'public.app_sessions', 'select'), 'sessions closed to signed-in users');
select t_assert(not has_table_privilege('anon', 'public.app_page_views', 'select'), 'page views closed to the public');
select t_assert(not has_function_privilege('authenticated', 'public.app_intel_report(integer)', 'execute'), 'the read is the server''s');
select t_assert(not has_function_privilege('authenticated', 'public.app_pulse_record(uuid, uuid, uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text, numeric, numeric, jsonb, integer)', 'execute'), 'the writer is the server''s');
select t_assert(not has_function_privilege('authenticated', 'public.ops_ai_daily(integer)', 'execute'), 'usage reads are the server''s');
select t_assert((select count(*) = 1 from cron.job where jobname = 'app-visits-retention') or not exists (select 1 from pg_extension where extname = 'pg_cron'), 'retention job');
insert into public.account_lifecycle_events (event, actor_role) values ('moved_to_membership', 'admin'), ('moved_to_coaching', 'admin');
select t_assert((select count(*) = 2 from public.account_lifecycle_events), 'plan changes are history events');
-- the Membership home
insert into public.app_members (user_id, account_type, subscription_status, setup_completed_at) values
  ('00000000-0000-0000-0000-00000000000b', 'jf_member', 'Free', null);
insert into public.app_members (user_id, account_type, subscription_status, stripe_subscription_id) values
  (gen_random_uuid(), 'jf_member', 'Past Due', 'sub_legacy');
insert into public.membership_applications (status, full_name, created_at) values ('pending', 'Waiting Person', now() - interval '2 days'), ('approved', 'Approved Person', now());
insert into public.ai_credit_purchases (status, amount_minor, paid_at) values ('paid', 299, now());
update public.clients set created_at = now() - interval '10 days', full_name = 'Member Mo' where id = '10000000-0000-0000-0000-00000000000b';
do $$
declare r jsonb := public.membership_overview(30);
begin
  perform t_assert((r -> 'members' ->> 'total')::int = 1, 'members: the self-serve record, never a test login');
  perform t_assert((r -> 'members' ->> 'setup_unfinished')::int = 1, 'setup unfinished reads member_setup_complete');
  perform t_assert((r -> 'members' ->> 'trained30')::int = 1, 'members who trained');
  perform t_assert((r -> 'applications' ->> 'waiting')::int = 1, 'applications waiting');
  perform t_assert(jsonb_array_length(r -> 'applications' -> 'list') = 1, 'the waiting list');
  perform t_assert((r -> 'legacy_paid' ->> 'failing')::int = 1, 'legacy paid subscriptions failing');
  perform t_assert((r -> 'revenue' ->> 'credit_packs_minor')::int = 299, 'credit pack revenue');
  perform t_assert(jsonb_array_length(r -> 'growth') = 6, 'six months of growth');
end $$;
select 'ok: membership_overview';
select t_assert(not has_function_privilege('authenticated', 'public.membership_overview(integer)', 'execute'), 'the membership read is the server''s');
select 'ok: scenario passed';
