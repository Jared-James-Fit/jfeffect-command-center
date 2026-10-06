\set ON_ERROR_STOP 1

-- Run after scenario.sql. Proves who can read what, and that nobody but the server can write.
-- Fixtures for this file: a fresh pair of clients, each with a signature, plus staff.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d4', 'dee@example.com'),
  ('00000000-0000-0000-0000-0000000000e5', 'eli@example.com'),
  ('00000000-0000-0000-0000-0000000000f6', 'admin@example.com'),
  ('00000000-0000-0000-0000-0000000000f7', 'coach1@example.com'),
  ('00000000-0000-0000-0000-0000000000f8', 'coach2@example.com');

insert into public.coaches (id, user_id) values
  ('30000000-0000-0000-0000-0000000000f7', '00000000-0000-0000-0000-0000000000f7'),
  ('30000000-0000-0000-0000-0000000000f8', '00000000-0000-0000-0000-0000000000f8');

insert into public.clients (id, user_id, assigned_coach_id, full_name, email) values
  ('10000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000d4', '30000000-0000-0000-0000-0000000000f7', 'Dee Dunn', 'dee@example.com'),
  ('10000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000e5', null, 'Eli Evans', 'eli@example.com');

insert into public.user_roles values
  ('00000000-0000-0000-0000-0000000000f6', 'admin'),
  ('00000000-0000-0000-0000-0000000000f7', 'coach'),
  ('00000000-0000-0000-0000-0000000000f8', 'coach');

insert into public.coaching_agreement_signatures (version_id, client_id, user_id, client_name, typed_name, signature_method, intent_statement)
values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000d4', 'Dee Dunn', 'Dee Dunn', 'typed', 'I agree'),
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000e5', 'Eli Evans', 'Eli Evans', 'typed', 'I agree');

insert into public.coaching_agreement_client_state (client_id, resign_requested_at, resign_note) values
  ('10000000-0000-0000-0000-0000000000d4', now(), 'Please re-sign'),
  ('10000000-0000-0000-0000-0000000000e5', now(), 'Please re-sign');
insert into public.coaching_agreement_events (client_id, event_type) values
  ('10000000-0000-0000-0000-0000000000d4', 'requested'),
  ('10000000-0000-0000-0000-0000000000e5', 'requested');

grant select on public.user_roles to authenticated;
grant select on public.coaches to authenticated;
grant select on public.clients to authenticated;

create function pg_temp.as_user(_uid uuid) returns void language plpgsql as $$
begin
  update public.auth_ctx set uid = _uid;
  execute 'set local role authenticated';
end $$;

-- A client sees only their own rows ----------------------------------------------------
do $$
begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000d4');
  perform t_assert((select count(*) from coaching_agreement_signatures) = 1, 'client sees exactly their own signature');
  perform t_assert((select client_name from coaching_agreement_signatures) = 'Dee Dunn', 'and it is their own');
  perform t_assert((select count(*) from coaching_agreement_client_state) = 1, 'client sees only their own agreement state');
  perform t_assert((select count(*) from coaching_agreement_events) = 0, 'client cannot read the audit log');
  perform t_assert((select count(*) from coaching_agreement_versions) >= 1, 'any signed-in user can read the agreement text');
  reset role; update public.auth_ctx set uid = null;
end $$;

-- Staff scoping --------------------------------------------------------------------------
do $$
begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000f6');
  perform t_assert((select count(*) from coaching_agreement_signatures where client_name in ('Dee Dunn', 'Eli Evans')) = 2, 'admin sees every client');
  perform t_assert((select count(*) from coaching_agreement_events) >= 2, 'admin reads the audit log');
  reset role;

  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000f7');
  perform t_assert((select count(*) from coaching_agreement_signatures where client_name in ('Dee Dunn', 'Eli Evans')) = 1, 'assigned coach sees only their own client');
  perform t_assert((select client_name from coaching_agreement_signatures where client_name in ('Dee Dunn', 'Eli Evans')) = 'Dee Dunn', 'the right one');
  perform t_assert((select count(*) from coaching_agreement_client_state) = 1, 'coach sees only assigned client state');
  reset role;

  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000f8');
  perform t_assert((select count(*) from coaching_agreement_signatures where client_name in ('Dee Dunn', 'Eli Evans')) = 0, 'an unassigned coach sees nothing');
  reset role;

  update public.auth_ctx set uid = null;
  set local role anon;
  begin perform count(*) from coaching_agreement_signatures; raise exception 'anon read signatures';
  exception when insufficient_privilege then raise notice 'ok: signed-out visitors cannot read signatures'; end;
  reset role;
end $$;

-- Nobody but the server can write ----------------------------------------------------------
do $$
begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000d4');
  begin insert into coaching_agreement_signatures (version_id, client_id, user_id, client_name, typed_name, signature_method, intent_statement)
        values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000d4', 'Dee', 'Dee Dunn', 'typed', 'x');
        raise exception 'client inserted a signature';
  exception when insufficient_privilege then raise notice 'ok: client cannot insert a signature directly'; end;
  begin update coaching_agreement_signatures set typed_name = 'Hacker'; raise exception 'client updated a signature';
  exception when insufficient_privilege then raise notice 'ok: client cannot update a signature'; end;
  begin delete from coaching_agreement_signatures; raise exception 'client deleted a signature';
  exception when insufficient_privilege then raise notice 'ok: client cannot delete a signature'; end;
  begin update coaching_agreement_client_state set exempt_kind = 'not_required'; raise exception 'client exempted themselves';
  exception when insufficient_privilege then raise notice 'ok: client cannot exempt themselves'; end;
  begin insert into coaching_agreement_versions (version, content_hash, content_json, effective_date) values ('9.9', repeat('c', 64), '{}', '2026-10-06'); raise exception 'client wrote a version';
  exception when insufficient_privilege then raise notice 'ok: client cannot write agreement versions'; end;
  begin perform public.coaching_agreement_record_signature('{}'::jsonb); raise exception 'client called the recorder';
  exception when insufficient_privilege then raise notice 'ok: client cannot call the signing function'; end;
  reset role; update public.auth_ctx set uid = null;

  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000f6');
  begin update coaching_agreement_client_state set exempt_kind = 'not_required'; raise exception 'admin wrote through RLS';
  exception when insufficient_privilege then raise notice 'ok: even admins write only through the server (service role)'; end;
  begin perform public.coaching_agreement_record_signature('{}'::jsonb); raise exception 'admin called the recorder';
  exception when insufficient_privilege then raise notice 'ok: admin session cannot call the signing function either'; end;
  reset role; update public.auth_ctx set uid = null;

  set local role anon;
  begin perform public.coaching_agreement_record_signature('{}'::jsonb); raise exception 'anon called the recorder';
  exception when insufficient_privilege then raise notice 'ok: anon cannot call the signing function'; end;
  reset role;

  set local role service_role;
  perform t_assert((select count(*) from coaching_agreement_signatures) >= 4, 'service role reads everything');
  reset role;
end $$;
