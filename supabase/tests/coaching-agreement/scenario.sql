\set ON_ERROR_STOP 1

-- Fixtures -------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'amy@example.com'),
  ('00000000-0000-0000-0000-0000000000b2', 'ben@example.com'),
  ('00000000-0000-0000-0000-0000000000c3', 'cy@example.com');

insert into public.clients (id, user_id, full_name, email, phone, date_of_birth) values
  ('10000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', 'Amy Adams', 'amy@example.com', '204-111-0000', '1990-05-05'),
  ('10000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b2', 'Ben Brown', 'ben@example.com', null, null),
  ('10000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000c3', 'Cy Young', 'cy@example.com', null, '2012-01-01');

insert into public.coaching_agreement_versions (id, version, content_hash, content_json, effective_date)
values ('20000000-0000-0000-0000-000000000001', '2.0', repeat('a', 64), '{"v":"2.0"}', '2026-10-06');

-- Versions are immutable -----------------------------------------------------
do $$
begin
  begin update coaching_agreement_versions set content_json = 'x'; raise exception 'version edited';
  exception when check_violation then raise notice 'ok: version cannot be edited'; end;
  begin delete from coaching_agreement_versions; raise exception 'version deleted';
  exception when check_violation then raise notice 'ok: version cannot be deleted'; end;
  begin insert into coaching_agreement_versions (version, content_hash, content_json, effective_date)
        values ('2.0', repeat('b', 64), '{}', '2026-10-07'); raise exception 'same version, new text accepted';
  exception when unique_violation then raise notice 'ok: a published version number cannot be reused with different text'; end;
end $$;

-- Signing as the trusted server (service role: auth.uid() is null) -------------
create function pg_temp.payload(_user uuid, _client uuid, _idem text, _extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object(
    'user_id', _user, 'client_id', _client,
    'version_id', '20000000-0000-0000-0000-000000000001',
    'idempotency_key', _idem,
    'client_name', 'Amy Adams', 'client_email', 'amy@example.com',
    'typed_name', 'Amy Adams', 'signature_method', 'drawn',
    'signature_image', 'data:image/png;base64,AAAA',
    'details', jsonb_build_object(
      'phone', '204-555-0101', 'date_of_birth', '1999-09-09', 'is_minor', false,
      'address', jsonb_build_object('street', '1 Portage Ave', 'city', 'Winnipeg', 'province', 'MB', 'postal_code', 'R3B 0A1', 'country', 'Canada'),
      'emergency_contact_1', jsonb_build_object('name', 'Mom', 'phone', '204-555-0199')),
    'acknowledgements', '[{"id":"money","acknowledged_at":"2026-10-06T00:00:00Z"}]'::jsonb,
    'optional_consents', '{"testimonial_use": true, "social_publication": false}'::jsonb,
    'review', '{"sectionsOpened": 5, "reviewSeconds": 90, "scrolledToEnd": true}'::jsonb,
    'intent_statement', 'I agree',
    'signer_timezone', 'America/Winnipeg', 'ip_address', '203.0.113.7', 'user_agent', 'UnitTest/1.0'
  ) || _extra
$$;

do $$
declare r jsonb; r2 jsonb; c record; n int;
begin
  set local role service_role;
  r := public.coaching_agreement_record_signature(pg_temp.payload('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', 'idem-1'));
  reset role;
  perform t_assert((r ->> 'duplicate')::boolean = false and (r ->> 'id') is not null, 'signing returns a new signature id');

  select * into c from clients where id = '10000000-0000-0000-0000-0000000000a1';
  perform t_assert(c.agreement_signed and c.agreement_status = 'Signed' and c.agreement_version = 'v2.0', 'legacy clients.agreement_* mirror updated');
  perform t_assert(c.agreement_signed_date = (now() at time zone 'America/Winnipeg')::date, 'signed date is the Winnipeg calendar day');
  perform t_assert(c.phone = '204-555-0101' and c.city = 'Winnipeg' and c.postal_code = 'R3B 0A1' and c.country = 'Canada', 'confirmed contact details refreshed the profile');
  perform t_assert(c.emergency_contact_name = 'Mom' and c.emergency_contact_phone = '204-555-0199', 'emergency contact saved to the profile');
  perform t_assert(c.date_of_birth = '1990-05-05', 'an existing date of birth is never overwritten');

  perform t_assert((select granted from legal_consent_preferences where user_id = '00000000-0000-0000-0000-0000000000a1' and consent_key = 'testimonial_use') = true, 'testimonial consent recorded');
  perform t_assert((select granted from legal_consent_preferences where user_id = '00000000-0000-0000-0000-0000000000a1' and consent_key = 'social_publication') = false, 'social consent recorded as declined');
  perform t_assert((select count(*) from coaching_agreement_events where signature_id = (r ->> 'id')::uuid and event_type = 'signed') = 1, 'audit event written');

  -- Idempotent: a double tap or retry returns the same signature, creates nothing.
  set local role service_role;
  r2 := public.coaching_agreement_record_signature(pg_temp.payload('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', 'idem-1'));
  reset role;
  perform t_assert((r2 ->> 'duplicate')::boolean and r2 ->> 'id' = r ->> 'id', 'same idempotency key returns the original signature');
  select count(*) into n from coaching_agreement_signatures where client_id = '10000000-0000-0000-0000-0000000000a1';
  perform t_assert(n = 1, 'no second signature row from a retry');

  -- Re-signing later (admin asked for another one) is a new row.
  set local role service_role;
  r2 := public.coaching_agreement_record_signature(pg_temp.payload('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', 'idem-2'));
  reset role;
  perform t_assert(not (r2 ->> 'duplicate')::boolean, 'a fresh signing creates a new row');
  perform t_assert((select count(*) from coaching_agreement_signatures where client_id = '10000000-0000-0000-0000-0000000000a1') = 2, 'both signatures retained');
end $$;

-- DOB is filled only when the profile had none --------------------------------
do $$
declare r jsonb;
begin
  set local role service_role;
  r := public.coaching_agreement_record_signature(pg_temp.payload('00000000-0000-0000-0000-0000000000b2', '10000000-0000-0000-0000-0000000000b2', 'idem-ben',
        '{"client_name":"Ben Brown","client_email":"ben@example.com","typed_name":"Ben Brown"}'));
  reset role;
  perform t_assert((select date_of_birth from clients where id = '10000000-0000-0000-0000-0000000000b2') = '1999-09-09', 'missing date of birth is filled from the form');
end $$;

-- Validation inside the function (defence in depth) ------------------------------
do $$
begin
  set local role service_role;
  begin perform public.coaching_agreement_record_signature(pg_temp.payload('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-0000000000c3', 'idem-minor',
          '{"details":{"is_minor":true,"phone":"1","address":{},"emergency_contact_1":{}}}'));
    raise exception 'minor signed without guardian';
  exception when sqlstate '22023' then raise notice 'ok: a minor cannot be recorded without a guardian'; end;

  begin perform public.coaching_agreement_record_signature(pg_temp.payload('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000b2', 'idem-mismatch'));
    raise exception 'wrong client accepted';
  exception when sqlstate '42501' then raise notice 'ok: user must own the client row being signed for'; end;

  begin perform public.coaching_agreement_record_signature(pg_temp.payload('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', 'idem-bad', '{"signature_method":"smoke"}'));
    raise exception 'bad method accepted';
  exception when sqlstate '22023' then raise notice 'ok: unknown signature method refused'; end;

  begin perform public.coaching_agreement_record_signature(pg_temp.payload('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', 'idem-noack', '{"acknowledgements":[]}'));
    raise exception 'empty acknowledgements accepted';
  exception when sqlstate '22023' then raise notice 'ok: acknowledgements are required'; end;
  reset role;
end $$;

-- A guardian signing for a minor is accepted ---------------------------------------
do $$
declare r jsonb;
begin
  set local role service_role;
  r := public.coaching_agreement_record_signature(pg_temp.payload('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-0000000000c3', 'idem-cy',
        '{"client_name":"Cy Young","typed_name":"Cy Young","details":{"is_minor":true,"phone":"204-555-0300","date_of_birth":"2012-01-01","address":{"street":"2 Main St","city":"Selkirk","province":"MB","postal_code":"R1A 0A1","country":"Canada"},"emergency_contact_1":{"name":"Dad","phone":"204-555-0301"}},"guardian":{"fullName":"Dad Young","relationship":"Father","phone":"204-555-0301","signatureMethod":"typed","signatureImage":null}}'));
  reset role;
  perform t_assert((select guardian ->> 'fullName' from coaching_agreement_signatures where id = (r ->> 'id')::uuid) = 'Dad Young', 'guardian signature stored with the minor''s record');
end $$;

-- The clients guard: server path passes, the client''s own session does not ------
do $$
begin
  update auth_ctx set uid = '00000000-0000-0000-0000-0000000000b2';
  begin
    update clients set agreement_signed = false where id = '10000000-0000-0000-0000-0000000000b2';
    raise exception 'client edited own agreement flag';
  exception when insufficient_privilege then raise notice 'ok: a client still cannot edit their own agreement flag directly'; end;
  update auth_ctx set uid = null;
end $$;

-- Signatures are permanent evidence -------------------------------------------------
do $$
declare sid uuid;
begin
  select id into sid from coaching_agreement_signatures where client_id = '10000000-0000-0000-0000-0000000000a1' order by signed_at limit 1;
  begin update coaching_agreement_signatures set typed_name = 'Someone Else' where id = sid; raise exception 'typed name edited';
  exception when check_violation then raise notice 'ok: typed name cannot be edited'; end;
  begin update coaching_agreement_signatures set details = '{}' where id = sid; raise exception 'details edited';
  exception when check_violation then raise notice 'ok: details cannot be edited'; end;
  begin update coaching_agreement_signatures set signed_at = now() - interval '1 year' where id = sid; raise exception 'date edited';
  exception when check_violation then raise notice 'ok: signed time cannot be edited'; end;
  begin delete from coaching_agreement_signatures where id = sid; raise exception 'signature deleted';
  exception when check_violation then raise notice 'ok: signatures cannot be deleted'; end;
  update coaching_agreement_signatures set receipt_emailed_at = now() where id = sid;
  perform t_assert((select receipt_emailed_at from coaching_agreement_signatures where id = sid) is not null, 'delivery bookkeeping can still be stamped');
end $$;

-- Removing a client or account keeps the evidence -----------------------------------------
do $$
declare sid uuid; n_before int; n_after int;
begin
  select count(*) into n_before from coaching_agreement_signatures;
  delete from auth.users where id = '00000000-0000-0000-0000-0000000000a1';
  select id into sid from coaching_agreement_signatures where client_name = 'Amy Adams' order by signed_at limit 1;
  perform t_assert((select user_id from coaching_agreement_signatures where id = sid) is null, 'deleting an account nulls user_id (account deletion is not blocked)');
  delete from clients where id = '10000000-0000-0000-0000-0000000000b2';
  select count(*) into n_after from coaching_agreement_signatures;
  perform t_assert(n_after = n_before, 'deleting accounts and clients removes no signature rows');
  perform t_assert((select client_id from coaching_agreement_signatures where client_name = 'Ben Brown' limit 1) is null, 'deleting a client nulls client_id');
  perform t_assert((select count(*) from coaching_agreement_signatures where client_name = 'Ben Brown' and typed_name = 'Ben Brown') = 1, 'name snapshot keeps the record identifiable');
end $$;
