\set ON_ERROR_STOP 1
-- 1. the provider's fault, read from stored errors (the same cases as ai-errors.test.ts)
select t_assert(ai_error_is_provider('No model answered (openai:gpt-5-mini: 429 {"error": {"message": "You have no credits remaining. Add credits to continue"'), 'credits ran out is the provider''s');
select t_assert(ai_error_is_provider('Couldn''t make it: OpenAI gpt-5.1: You have no credits remaining.'), 'Athlete Insights'' credits wording too');
select t_assert(ai_error_is_provider('AI is paused: OpenAI says the account has no credits left.'), 'the breaker''s own refusal');
select t_assert(ai_error_is_provider('Waiting for AI: OpenAI credits ran out'), 'a parked item');
select t_assert(ai_error_is_provider('openai:gpt-5.5: 503 {"error":"overloaded"}'), 'an outage');
select t_assert(ai_error_is_provider('401 {"error":{"code":"invalid_api_key"}}'), 'a refused key');
select t_assert(not ai_error_is_provider('Couldn''t write a draft. Try again.'), 'a bad draft is not the provider''s');
select t_assert(not ai_error_is_provider('No draft passed the checks and the editor'), 'a deck that failed its checks is not');
select t_assert(not ai_error_is_provider('The answer said 500 kcal for lunch'), 'a number in the text is not an outage');
select t_assert(not ai_error_is_provider('openai:gpt-5-mini: 429 Rate limit reached for requests'), 'a rate limit is not (it retries on its own)');
select t_assert(not ai_error_is_provider(null), 'no error is not');

-- 2. what's put back after an outage
insert into coach_automation_items (id, status, attempts, error, created_at) values
  ('00000000-0000-0000-0000-0000000000a1', 'failed', 3, 'No model answered (openai:gpt-5-mini: 429 {"error":{"message":"You have no credits remaining.', now() - interval '1 day'),
  ('00000000-0000-0000-0000-0000000000a2', 'failed', 3, 'Couldn''t write a draft. Try again.', now() - interval '1 day'),
  ('00000000-0000-0000-0000-0000000000a3', 'failed', 3, 'no credits remaining', now() - interval '9 days'),
  ('00000000-0000-0000-0000-0000000000a4', 'sent', 1, null, now() - interval '1 day');
insert into coach_automation_items (id, status, attempts, error, due_at) values
  ('00000000-0000-0000-0000-0000000000a5', 'queued', 0, 'Waiting for AI: OpenAI credits ran out', now() + interval '12 minutes');
insert into community_daily_visuals (id, day, status, regen, attempts, error) values
  ('00000000-0000-0000-0000-0000000000b1', (now() + interval '3 days')::date, 'failed', null, 0, 'Couldn''t make it: OpenAI gpt-5.1: You have no credits remaining.'),
  ('00000000-0000-0000-0000-0000000000b2', (now() - interval '3 days')::date, 'failed', null, 0, 'Couldn''t make it: OpenAI gpt-5.1: You have no credits remaining.'),
  ('00000000-0000-0000-0000-0000000000b3', (now() + interval '4 days')::date, 'failed', null, 0, 'Couldn''t make it: the review kept failing'),
  ('00000000-0000-0000-0000-0000000000b4', (now() + interval '5 days')::date, 'planned', 'full', 2, 'Waiting for AI: AI is paused');
insert into community_post_decks (id, status, attempts, error) values
  ('00000000-0000-0000-0000-0000000000c1', 'failed', 1, 'No model answered (openai:gpt-5-mini: 429 no credits remaining'),
  ('00000000-0000-0000-0000-0000000000c2', 'failed', 3, 'No draft passed the checks and the editor');
insert into coaching_lead_replies (application_id, status, attempts, error, created_at) values
  ('00000000-0000-0000-0000-0000000000d1', 'error', 3, 'no credits remaining', now() - interval '1 day'),
  ('00000000-0000-0000-0000-0000000000d2', 'error', 3, 'no credits remaining', now() - interval '5 days');
insert into nutrition_ai_plans (submission_id, status, error, progress) values
  ('00000000-0000-0000-0000-0000000000e1', 'error', 'No model answered. The OpenAI account has no credits left: add credits at platform.openai.com (billing).', '{"pending":{"targets":{"failed":["openai:gpt-6-astra"]}}}'),
  ('00000000-0000-0000-0000-0000000000e2', 'ready', 'no credits remaining', null);
insert into program_intel_jobs (status, error) values ('error', 'No model answered (no credits remaining)');

select t_assert((select (ai_recovery_requeue(7) ->> 'coaching_replies')::int = 1), 'one coaching reply back in line');
select t_assert((select status = 'queued' and attempts = 0 and error is null and due_at <= now() from coach_automation_items where id = '00000000-0000-0000-0000-0000000000a1'), 'the provider''s failure is queued again with its attempts back');
select t_assert((select status = 'failed' from coach_automation_items where id = '00000000-0000-0000-0000-0000000000a2'), 'a draft that failed on its own stays failed (the coach''s Try again)');
select t_assert((select status = 'failed' from coach_automation_items where id = '00000000-0000-0000-0000-0000000000a3'), 'older than a week stays as it was');
select t_assert((select status = 'sent' from coach_automation_items where id = '00000000-0000-0000-0000-0000000000a4'), 'a sent one is never touched');
select t_assert((select due_at <= now() from coach_automation_items where id = '00000000-0000-0000-0000-0000000000a5'), 'a parked one is due now');
select t_assert((select count(*) = 1 from coach_automation_events where item_id = '00000000-0000-0000-0000-0000000000a1' and kind = 'queued' and detail ->> 'after' = 'ai_back'), 'and the record says why');
select t_assert((select status = 'planned' and regen = 'full' and attempts = 0 and error is null from community_daily_visuals where id = '00000000-0000-0000-0000-0000000000b1'), 'an Athlete Insight still to come is made again');
select t_assert((select status = 'failed' from community_daily_visuals where id = '00000000-0000-0000-0000-0000000000b2'), 'a day already gone stays failed');
select t_assert((select status = 'failed' from community_daily_visuals where id = '00000000-0000-0000-0000-0000000000b3'), 'one that failed its own review stays failed');
select t_assert((select attempts = 0 from community_daily_visuals where id = '00000000-0000-0000-0000-0000000000b4'), 'a waiting one is tried at once');
select t_assert((select status = 'pending' and attempts = 0 from community_post_decks where id = '00000000-0000-0000-0000-0000000000c1'), 'a deck the credits stopped is back in line');
select t_assert((select status = 'failed' from community_post_decks where id = '00000000-0000-0000-0000-0000000000c2'), 'a deck that failed its checks stays failed');
select t_assert((select status = 'pending' from coaching_lead_replies where application_id = '00000000-0000-0000-0000-0000000000d1'), 'a fresh lead''s text is written');
select t_assert((select status = 'error' from coaching_lead_replies where application_id = '00000000-0000-0000-0000-0000000000d2'), 'a lead days old is left');
select t_assert((select status = 'pending' and progress is null from nutrition_ai_plans where submission_id = '00000000-0000-0000-0000-0000000000e1'), 'a plan never written is written, its failed models forgotten');
select t_assert((select status = 'ready' from nutrition_ai_plans where submission_id = '00000000-0000-0000-0000-0000000000e2'), 'a ready plan (the coach''s change failed) is never rewritten');
select t_assert((select (ai_recovery_requeue(7) -> 'left_for_you' ->> 'program_generations')::int = 1 and (ai_recovery_requeue(7) -> 'left_for_you' ->> 'plan_changes')::int = 1), 'what a coach asked for is only counted');
select t_assert((select (r ->> 'coaching_replies')::int = 0 and (r ->> 'post_decks')::int = 0 and (r ->> 'athlete_insights')::int = 0 from (select ai_recovery_requeue(7) r) x), 'a second run puts nothing back twice');
select t_assert((select count(*) = 1 from coach_automation_events where item_id = '00000000-0000-0000-0000-0000000000a1'), 'nor records it twice');

-- 3. the deck writer: never while OpenAI is down, and the library paced
delete from community_post_decks;
insert into community_post_decks (status, priority) select 'pending', 100 from generate_series(1, 6);
insert into community_post_decks (status, priority) values ('pending', 12);
update ai_provider_health set status = 'credits', next_probe_at = now() + interval '10 minutes' where provider = 'openai';
select t_assert(not community_post_decks_kick(), 'no deck is written while the credits are out');
select t_assert((select count(*) = 0 from net.calls), 'nothing woken while they''re out');
update ai_provider_health set status = 'ok', next_probe_at = null where provider = 'openai';
select t_assert(community_post_decks_kick(), 'the writer wakes when it answers');
select t_assert((select count(*) = 3 from net.calls), 'three at once');
select t_assert((select count(*) = 1 from community_post_decks where priority = 12 and run_after > now()), 'the one planned soon goes first');
delete from net.calls;
delete from net.calls;
update community_post_decks set status = 'done', claimed_at = now() - interval '1 hour' where run_after > now();
insert into community_post_decks (status, priority, claimed_at) select 'done', 100, now() - interval '2 hours' from generate_series(1, 2);
-- four background decks in the last day now (two just done above, two more)
select t_assert((select count(*) from community_post_decks where priority >= 40 and claimed_at > now() - interval '24 hours') = 4, 'four library decks today');
select t_assert(not community_post_decks_kick(), 'and no fifth one until tomorrow');
select t_assert((select count(*) = 0 from net.calls), 'nothing was woken');
insert into community_post_decks (status, priority) values ('pending', 15);
select t_assert(community_post_decks_kick(), 'a lesson planned soon still goes at once');
select t_assert((select count(*) = 1 from net.calls), 'just that one');

-- 4. what's on record from before, and usage
select t_assert((select count(*) = 3 from ai_call_log), 'the generator''s and edits'' calls are on record');
select t_assert((select cost_usd = 1.5 from ai_call_log where model = 'openai:gpt-6-astra'), 'Astra priced at $10 / $50');
select t_assert((select cost_usd = 0.11 from ai_call_log where model = 'gateway:openai/gpt-5.5'), 'GPT-5.5 priced at $5 / $30');
select t_assert((select task = 'construct' and not ok from ai_call_log where model = 'openai:gpt-5.5'), 'a stage''s task is its first word');
select t_assert((select calls = 1 and cost = 0.11 from ai_usage_by_task(now() - interval '7 days') where task = 'edit'), 'usage by task');
select t_assert((select sum(calls) = 3 from ai_usage_by_month(12)), 'usage by month');

-- 5. nobody but the server
select t_assert(not has_table_privilege('authenticated', 'public.ai_call_log', 'select'), 'a signed-in person can''t read the call log');
select t_assert(not has_table_privilege('authenticated', 'public.ai_provider_health', 'select'), 'nor the health');
select t_assert(not has_function_privilege('authenticated', 'public.ai_recovery_requeue(integer)', 'execute'), 'nor put anything back');
select t_assert(not has_function_privilege('anon', 'public.ai_usage_by_task(timestamptz)', 'execute'), 'nor read usage');
select t_assert(exists (select 1 from cron.job where jobname = 'ai-health-tick' and schedule = '*/5 * * * *'), 'the health tick runs every 5 minutes');
select 'ai-reliability: passed';
