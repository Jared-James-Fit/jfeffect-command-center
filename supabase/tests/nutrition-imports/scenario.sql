\set ON_ERROR_STOP 1
set client_min_messages = notice;
\set mia  '''00000000-0000-0000-0000-0000000000e1'''
\set dee  '''00000000-0000-0000-0000-0000000000e2'''
\set coach '''00000000-0000-0000-0000-0000000000c1'''
\set rights '''I confirm that I wrote this meal plan or have the right or permission to upload and use it in JF Effect.'''

-- ── The server writes imports (as the service role does) ────────────────────
insert into nutrition_imports (id, user_id, kind, audience, source_kind, source_text, rights_confirmed_at, rights_text, status, method, result)
values ('00000000-0000-0000-0000-00000000a001', :mia, 'import', 'member', 'text', 'Meal 1\n3 eggs', now(), :rights, 'ready', 'parsed', '{"text": "DAILY MENU", "flags": []}');
-- a queued read: the queue trigger must never fail the write without pg_net
insert into nutrition_imports (id, user_id, kind, audience, source_kind, file_paths, rights_confirmed_at, rights_text, status)
values ('00000000-0000-0000-0000-00000000a002', :dee, 'import', 'member', 'pdf', array['00000000-0000-0000-0000-0000000000e2/f/plan.pdf'], now(), :rights, 'pending');
update nutrition_imports set updated_at = now() + interval '1 second' where id = '00000000-0000-0000-0000-00000000a002';
select t_assert(true, 'queueing a read never fails without pg_net (the cron picks it up)');
insert into nutrition_imports (id, user_id, kind, audience, source_kind, answers, status)
values ('00000000-0000-0000-0000-00000000a003', :mia, 'create', 'member', 'answers', '{"answers": {}, "targets": {"calories": 2200}}', 'pending');
insert into nutrition_imports (id, user_id, kind, audience, source_kind, source_text, rights_confirmed_at, rights_text, status)
values ('00000000-0000-0000-0000-00000000a004', :coach, 'import', 'staff', 'xlsx', 'TRAINING DAY MENU', now(), 'I confirm that I wrote this meal plan or have the right or permission to use it for this client in JF Effect.', 'ready');

-- ── What the table refuses ──────────────────────────────────────────────────
do $$ begin
  insert into nutrition_imports (user_id, kind, source_kind, source_text) values ('00000000-0000-0000-0000-0000000000e1', 'import', 'text', 'x');
  raise exception 'ASSERT FAILED: an import with no rights confirmation';
exception when check_violation then raise notice 'ok: an import is never read before its rights were confirmed';
end $$;
do $$ begin
  insert into nutrition_imports (user_id, kind, audience, source_kind, answers) values ('00000000-0000-0000-0000-0000000000c1', 'create', 'staff', 'answers', '{}');
  raise exception 'ASSERT FAILED: a staff draft';
exception when check_violation then raise notice 'ok: a Cleo draft is only ever a member''s';
end $$;
do $$ begin
  insert into nutrition_imports (user_id, kind, source_kind) values ('00000000-0000-0000-0000-0000000000e1', 'create', 'answers');
  raise exception 'ASSERT FAILED: a draft with no answers';
exception when check_violation then raise notice 'ok: a draft is written from answers';
end $$;
do $$ begin
  insert into nutrition_imports (user_id, kind, source_kind, rights_confirmed_at, rights_text, answers)
  values ('00000000-0000-0000-0000-0000000000e1', 'import', 'answers', now(), repeat('x', 30), '{}');
  raise exception 'ASSERT FAILED: an import from answers';
exception when check_violation then raise notice 'ok: answers are only a draft''s source';
end $$;
do $$ begin
  insert into nutrition_imports (user_id, kind, source_kind, rights_confirmed_at, rights_text, file_paths)
  values ('00000000-0000-0000-0000-0000000000e1', 'import', 'image', now(), repeat('x', 30), array['a','b','c','d','e','f','g','h','i']);
  raise exception 'ASSERT FAILED: nine photos';
exception when check_violation then raise notice 'ok: at most 8 photos';
end $$;
do $$ begin
  insert into nutrition_imports (user_id, kind, source_kind, rights_confirmed_at, rights_text, status)
  values ('00000000-0000-0000-0000-0000000000e1', 'import', 'text', now(), repeat('x', 30), 'used');
  raise exception 'ASSERT FAILED: a status that isn''t one';
exception when check_violation then raise notice 'ok: only the statuses the app knows';
end $$;

-- ── Who reads what: their own rows only, and nobody writes ──────────────────
set role authenticated;
select t_as(:mia);
select t_assert((select count(*) = 2 from nutrition_imports), 'a member reads their own imports and drafts');
select t_assert((select count(*) = 0 from nutrition_imports where user_id <> :mia), 'never anyone else''s');
do $$ begin
  insert into nutrition_imports (user_id, kind, source_kind, rights_confirmed_at, rights_text) values ('00000000-0000-0000-0000-0000000000e1', 'import', 'text', now(), repeat('x', 30));
  raise exception 'ASSERT FAILED: a member wrote an import';
exception when insufficient_privilege then raise notice 'ok: only the server writes an import';
end $$;
do $$ begin
  update nutrition_imports set status = 'ready', result = '{"text": "x"}' where id = '00000000-0000-0000-0000-00000000a003';
  raise exception 'ASSERT FAILED: a member changed their draft';
exception when insufficient_privilege then raise notice 'ok: nor changes one (a free "ready" read can''t be faked)';
end $$;
do $$ begin
  delete from nutrition_imports where id = '00000000-0000-0000-0000-00000000a001';
  raise exception 'ASSERT FAILED: a member deleted an import record';
exception when insufficient_privilege then raise notice 'ok: nor deletes its record (its rights confirmation)';
end $$;
select t_as(:coach);
select t_assert((select count(*) = 1 from nutrition_imports), 'a coach reads only their own imports, never a member''s');
reset role;
set role anon;
do $$ begin
  perform 1 from nutrition_imports;
  raise exception 'ASSERT FAILED: anon read imports';
exception when insufficient_privilege then raise notice 'ok: signed out reads nothing';
end $$;
reset role;

-- ── The queue trigger is the server's ───────────────────────────────────────
select t_assert(not has_function_privilege('authenticated', 'public.nutrition_imports_queue_run()', 'EXECUTE'), 'the queue function isn''t callable by a login');
select t_assert(not has_function_privilege('anon', 'public.nutrition_imports_queue_run()', 'EXECUTE'), 'nor signed out');

-- ── AI credits: what each costs, the old ones unchanged ─────────────────────
select t_assert(ai_credit_cost('nutrition_import') = 5 and ai_credit_cost('nutrition_create') = 10, 'a meal plan read costs 5, a draft 10');
select t_assert(ai_credit_cost('meal_estimate') = 1 and ai_credit_cost('program_import') = 10 and ai_credit_cost('nope') is null, 'the other costs are unchanged');
select t_assert((select (ai_credit_state(:mia) -> 'costs' ->> 'nutrition_create')::int = 10 and (ai_credit_state(:mia) -> 'costs' ->> 'nutrition_import')::int = 5), 'the credit state lists them');

-- ── The files: private, each person's own folder ────────────────────────────
select t_assert((select not public and file_size_limit = 26214400 and 'application/pdf' = any(allowed_mime_types) and 'text/csv' = any(allowed_mime_types)
                   and not ('video/mp4' = any(allowed_mime_types)) from storage.buckets where id = 'nutrition-imports'), 'a private bucket for plans: PDFs, photos, spreadsheets, documents, text');
set role authenticated;
select t_as(:mia);
insert into storage.objects (bucket_id, name) values ('nutrition-imports', '00000000-0000-0000-0000-0000000000e1/abc/plan.pdf');
do $$ begin
  insert into storage.objects (bucket_id, name) values ('nutrition-imports', '00000000-0000-0000-0000-0000000000e2/abc/plan.pdf');
  raise exception 'ASSERT FAILED: uploaded into someone else''s folder';
exception when insufficient_privilege then raise notice 'ok: uploads only into your own folder';
end $$;
reset role;
insert into storage.objects (bucket_id, name) values ('nutrition-imports', '00000000-0000-0000-0000-0000000000e2/def/plan.pdf');
set role authenticated;
select t_as(:mia);
select t_assert((select count(*) = 1 from storage.objects where bucket_id = 'nutrition-imports'), 'a member reads only their own files');
delete from storage.objects where bucket_id = 'nutrition-imports' and name like '00000000-0000-0000-0000-0000000000e2/%';
reset role;
select t_assert((select count(*) = 1 from storage.objects where name like '00000000-0000-0000-0000-0000000000e2/%'), 'and never deletes anyone else''s');
set role authenticated;
select t_as(:mia);
delete from storage.objects where name = '00000000-0000-0000-0000-0000000000e1/abc/plan.pdf';
reset role;
select t_assert((select count(*) = 0 from storage.objects where name like '00000000-0000-0000-0000-0000000000e1/%'), 'deletes their own');

-- ── A saved import keeps its link to the plan, which may go ─────────────────
insert into nutrition_targets (id) values ('00000000-0000-0000-0000-00000000bb01');
update nutrition_imports set status = 'saved', saved_target_id = '00000000-0000-0000-0000-00000000bb01' where id = '00000000-0000-0000-0000-00000000a001';
delete from nutrition_targets where id = '00000000-0000-0000-0000-00000000bb01';
select t_assert((select saved_target_id is null and status = 'saved' and rights_text is not null from nutrition_imports where id = '00000000-0000-0000-0000-00000000a001'), 'a deleted plan leaves the import''s rights record');

-- ── Run twice: the migration is safe to apply again ─────────────────────────
select 'nutrition-imports: all assertions passed';
