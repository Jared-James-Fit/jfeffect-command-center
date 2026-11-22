-- Coach platform early access: who reads and writes what, and what the site may say.
\set ON_ERROR_STOP 1
\set owner '00000000-0000-0000-0000-0000000000a1'
\set coach '00000000-0000-0000-0000-0000000000c1'
\set member '00000000-0000-0000-0000-0000000000f1'

-- the public sees no price and registration closed
select t_assert((coach_platform_public() -> 'pricing') = 'null'::jsonb, 'no price on the site until the owner publishes it');
select t_assert((coach_platform_public() ->> 'registration_open')::boolean = false, 'registration is closed');
select t_assert((coach_platform_public() ->> 'early_access')::boolean, 'the site says early access');

-- anon can ask what the site may say, and nothing else
set role anon;
select t_assert((coach_platform_public() ->> 'registration_open') = 'false', 'anon reads the public view');
do $$ begin
  perform 1 from coach_platform_applications;
  raise exception 'ASSERT FAILED: anon read the waitlist';
exception when insufficient_privilege then raise notice 'ok: anon cannot read the waitlist'; end $$;
do $$ begin
  perform coach_platform_get();
  raise exception 'ASSERT FAILED: anon read the settings';
exception when insufficient_privilege then raise notice 'ok: anon cannot read the settings'; end $$;
reset role;

-- a coach and a member: no waitlist, no settings, no pricing changes
select t_as(:'coach');
set role authenticated;
do $$ begin
  perform 1 from coach_platform_applications;
  raise exception 'ASSERT FAILED: a coach read the waitlist';
exception when insufficient_privilege then raise notice 'ok: a coach cannot read the waitlist'; end $$;
do $$ begin
  perform coach_platform_get();
  raise exception 'ASSERT FAILED: a coach read the settings';
exception when insufficient_privilege then raise notice 'ok: a coach cannot read the settings'; end $$;
do $$ begin
  perform coach_platform_set_pricing(true, 1, 100);
  raise exception 'ASSERT FAILED: a coach published a price';
exception when insufficient_privilege then raise notice 'ok: a coach cannot publish a price'; end $$;
do $$ begin
  perform coach_platform_settings();
  raise exception 'ASSERT FAILED: a coach called the internal settings';
exception when insufficient_privilege then raise notice 'ok: the internal settings are the server''s'; end $$;
select t_assert(count(*) = 0, 'a coach sees no pricing history') from coach_platform_pricing_history;
reset role;

select t_as(:'member');
set role authenticated;
do $$ begin
  perform coach_platform_set_pricing(true, 1, 500);
  raise exception 'ASSERT FAILED: a member published a price';
exception when insufficient_privilege then raise notice 'ok: a member cannot publish a price'; end $$;
reset role;

-- the owner publishes, which the public then sees, with a history row
select t_as(:'owner');
set role authenticated;
select t_assert((coach_platform_get() ->> 'pricing_published')::boolean = false, 'the owner reads the settings');
select t_assert((coach_platform_set_pricing(true, 1, 500) ->> 'pricing_published')::boolean, 'the owner publishes the proposed price');
reset role;
select t_assert((coach_platform_public() -> 'pricing' ->> 'per_client_cents')::int = 500, 'the site now shows $5 a client');
select t_assert((coach_platform_public() -> 'pricing' ->> 'free_clients')::int = 1, 'with one free client');
select t_assert((coach_platform_public() -> 'pricing' -> 'volume_from') = 'null'::jsonb, 'and no volume step');
select t_assert((coach_platform_settings() ->> 'published_by') = :'owner', 'who approved it is kept');
select t_assert((coach_platform_public() ->> 'registration_open')::boolean = false, 'publishing a price never opens registration');
select t_assert(count(*) = 1, 'one history row') from coach_platform_pricing_history;

-- republishing the same price keeps its first approval; bounds hold
select t_as(:'owner');
set role authenticated;
select coach_platform_set_pricing(true, 1, 500);
select t_assert((select count(*) from coach_platform_pricing_history) = 1, 'republishing the same price adds no history');
select t_assert((coach_platform_set_pricing(true, 9, 1) ->> 'free_clients')::int = 3, 'free clients capped at 3');
select t_assert((coach_platform_get() ->> 'per_client_cents')::int = 100, 'price floored at $1');
select t_assert((select count(*) from coach_platform_pricing_history) = 2, 'a new price is a new history row');
select t_assert(count(*) = 2, 'the owner reads the history') from coach_platform_pricing_history;
select t_assert((coach_platform_set_pricing(true, 1, 500, 26, 300) ->> 'volume_from')::int = 26, 'the volume step is kept');
select t_assert((coach_platform_get() ->> 'volume_cents')::int = 300, 'at $3');
select t_assert((coach_platform_set_pricing(true, 1, 500, 26, 700) -> 'volume_from') = 'null'::jsonb, 'a volume price that isn''t lower is none');
select t_assert((coach_platform_set_pricing(true, 2, 500, 1, 300) ->> 'volume_from')::int = 4, 'a volume step starts after the free clients');
select t_assert((coach_platform_set_pricing(false, 1, 500) -> 'published_at') = 'null'::jsonb, 'taking it down clears the approval');
reset role;
select t_assert((coach_platform_public() -> 'pricing') = 'null'::jsonb, 'unpublished: no price on the site');

-- the waitlist's own rules (the server writes it)
set role service_role;
insert into coach_platform_applications (full_name, email, country, region, specialties, client_band, works_as, privacy_notice_version, privacy_notice_text, privacy_ack_at)
values ('Sam Coach', 'sam@coach.test', 'CA', 'MB', '{powerlifting}', '6-15', 'solo', 'v1', 'notice', now());
do $$ begin
  insert into coach_platform_applications (full_name, email, country, specialties, client_band, works_as, privacy_notice_version, privacy_notice_text, privacy_ack_at)
  values ('Sam Again', 'sam@coach.test', 'CA', '{strength}', '1-5', 'solo', 'v1', 'notice', now());
  raise exception 'ASSERT FAILED: a second open application for one email';
exception when unique_violation then raise notice 'ok: one open application per email'; end $$;
update coach_platform_applications set status = 'declined' where email = 'sam@coach.test';
insert into coach_platform_applications (full_name, email, country, specialties, client_band, works_as, privacy_notice_version, privacy_notice_text, privacy_ack_at)
values ('Sam Later', 'sam@coach.test', 'CA', '{strength}', '1-5', 'solo', 'v1', 'notice', now());
select t_assert(count(*) = 2, 'a declined application leaves room for a new one') from coach_platform_applications where email = 'sam@coach.test';
do $$ begin
  insert into coach_platform_applications (full_name, email, country, specialties, client_band, works_as, privacy_notice_version, privacy_notice_text, privacy_ack_at, marketing_consent)
  values ('No Words', 'nw@coach.test', 'US', '{general}', '0', 'solo', 'v1', 'notice', now(), true);
  raise exception 'ASSERT FAILED: marketing consent without its words';
exception when check_violation then raise notice 'ok: marketing consent needs its words and time'; end $$;
do $$ begin
  insert into coach_platform_applications (full_name, email, country, specialties, client_band, works_as, privacy_notice_version, privacy_notice_text, privacy_ack_at)
  values ('Odd', 'odd@coach.test', 'CA', '{yoga}', '0', 'solo', 'v1', 'notice', now());
  raise exception 'ASSERT FAILED: an unknown specialty';
exception when check_violation then raise notice 'ok: only known specialties'; end $$;
do $$ begin
  insert into coach_platform_applications (full_name, email, country, specialties, client_band, works_as, privacy_notice_version, privacy_notice_text, privacy_ack_at)
  values ('Upper', 'Upper@Coach.test', 'CA', '{general}', '0', 'solo', 'v1', 'notice', now());
  raise exception 'ASSERT FAILED: a mixed-case email';
exception when check_violation then raise notice 'ok: emails are stored lowercase'; end $$;
reset role;

select 'coach platform: all assertions passed';
