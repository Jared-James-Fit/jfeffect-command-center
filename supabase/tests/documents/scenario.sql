\set ON_ERROR_STOP 1
set client_min_messages = notice;

-- Ids from schema.sql
\set owner    '''00000000-0000-0000-0000-0000000000a1'''
\set ana      '''00000000-0000-0000-0000-0000000000c1'''
\set ben      '''00000000-0000-0000-0000-0000000000c2'''
\set marc_u   '''00000000-0000-0000-0000-0000000000d1'''
\set nico_u   '''00000000-0000-0000-0000-0000000000d2'''
\set mia_u    '''00000000-0000-0000-0000-0000000000e1'''
\set stranger '''00000000-0000-0000-0000-0000000000f9'''
\set marc     '''00000000-0000-0000-0000-0000000c1e01'''
\set nico     '''00000000-0000-0000-0000-0000000c1e02'''
\set mia      '''00000000-0000-0000-0000-0000000c1e03'''

\set rights '''I created this or have the rights or permission to upload it and use it in JF Effect.'''

-- ── The migration's own pieces ──────────────────────────────────────────────
select t_assert((select public = false and file_size_limit = 26214400 from storage.buckets where id = 'documents'), 'the documents bucket is private, 25 MB');
select t_assert((select 'text/csv' = any(allowed_mime_types) and not ('video/mp4' = any(allowed_mime_types)) from storage.buckets where id = 'documents'), 'the bucket takes the document types only');
select t_assert(not has_table_privilege('authenticated', 'public.documents', 'DELETE'), 'nobody signed in can hard-delete a document');
select t_assert(not has_table_privilege('anon', 'public.documents', 'SELECT'), 'the public can''t read documents');

-- Tags: the same cases as cleanTags in documents.test.ts
select t_assert(documents_clean_tags(array[' Meet  prep ', '#meet prep', 'Comp', '', '  ', 'comp']) = array['Meet prep', 'Comp'], 'tags: trimmed, # dropped, deduped case-insensitively, first spelling kept');
select t_assert(cardinality(documents_clean_tags(array['a','b','c','d','e','f','g','h','i','j','k','l'])) = 10, 'tags: at most 10');
select t_assert(documents_clean_tags(array[repeat('x', 40)]) = array[repeat('x', 30)], 'tags: at most 30 characters');
select t_assert(documents_clean_tags(null) = '{}'::text[], 'tags: none is an empty list');

-- ── Uploading: the file goes in your own folder only ────────────────────────
reset role; select t_as(:marc_u); set role authenticated;
insert into storage.objects (bucket_id, name, metadata) values
  ('documents', '00000000-0000-0000-0000-0000000000d1/11111111-1111-4111-8111-111111111101-meet-plan.pdf', '{"size": 2048, "mimetype": "application/pdf"}'),
  ('documents', '00000000-0000-0000-0000-0000000000d1/11111111-1111-4111-8111-111111111102-diary.txt', '{"size": 12, "mimetype": "text/plain;charset=UTF-8"}'),
  ('documents', '00000000-0000-0000-0000-0000000000d1/11111111-1111-4111-8111-111111111103-leftover.pdf', '{"size": 9, "mimetype": "application/pdf"}');
select t_assert(true, 'a client uploads into their own folder');
do $$ begin
  insert into storage.objects (bucket_id, name, metadata) values
    ('documents', '00000000-0000-0000-0000-0000000000c1/11111111-1111-4111-8111-111111111109-x.pdf', '{"size": 1}');
  raise exception 'ASSERT FAILED: uploaded into someone else''s folder';
exception when insufficient_privilege then raise notice 'ok: nobody uploads into someone else''s folder';
end $$;

-- Filing it: their own record, the rights ticked; size and type come from storage
insert into documents (owner_user_id, client_id, category, title, tags, file_path, mime, bytes, visibility, rights_confirmed_at, rights_text)
values (:marc_u, :marc, 'training_program', '  Meet   plan  ', array['meet', 'Meet', ' #peak '],
        '00000000-0000-0000-0000-0000000000d1/11111111-1111-4111-8111-111111111101-meet-plan.pdf',
        'application/pdf', 1, 'coach', '2000-01-01', :rights);
insert into documents (owner_user_id, client_id, category, title, file_path, mime, visibility, rights_confirmed_at, rights_text)
values (:marc_u, :marc, 'other', 'Diary', '00000000-0000-0000-0000-0000000000d1/11111111-1111-4111-8111-111111111102-diary.txt',
        'text/plain', 'private', now(), :rights);
select t_assert((select bytes = 2048 and mime = 'application/pdf' and title = 'Meet plan' and tags = array['meet', 'peak'] from documents where title = 'Meet plan'), 'size, type, name and tags are cleaned and read from storage');
select t_assert((select mime = 'text/plain' from documents where title = 'Diary'), 'a charset on the stored type is dropped');
select t_assert((select rights_confirmed_at > now() - interval '1 minute' from documents where title = 'Meet plan'), 'the rights confirmation is stamped with the server''s clock');

do $$ begin
  insert into documents (owner_user_id, client_id, title, file_path, mime, visibility)
  values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000c1e01', 'No rights',
          '00000000-0000-0000-0000-0000000000d1/11111111-1111-4111-8111-111111111103-leftover.pdf', 'application/pdf', 'private');
  raise exception 'ASSERT FAILED: filed without the rights confirmation';
exception when check_violation then raise notice 'ok: an upload needs the rights confirmation';
end $$;
do $$ begin
  insert into documents (owner_user_id, client_id, title, file_path, mime, visibility, rights_confirmed_at, rights_text)
  values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000c1e01', 'Ghost',
          '00000000-0000-0000-0000-0000000000d1/11111111-1111-4111-8111-111111111199-ghost.pdf', 'application/pdf', 'private', now(), 'x');
  raise exception 'ASSERT FAILED: filed a file that was never uploaded';
exception when check_violation then raise notice 'ok: a file has to be uploaded before it''s filed';
end $$;
do $$ begin
  insert into documents (owner_user_id, client_id, title, file_path, mime, visibility, rights_confirmed_at, rights_text)
  values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000c1e01', 'Not mine',
          '00000000-0000-0000-0000-0000000000c1/11111111-1111-4111-8111-111111111109-x.pdf', 'application/pdf', 'private', now(), 'x');
  raise exception 'ASSERT FAILED: filed a file from someone else''s folder';
exception when insufficient_privilege then raise notice 'ok: only a file in your own folder can be filed';
end $$;
do $$ begin
  insert into documents (owner_user_id, client_id, title, file_path, mime, visibility, rights_confirmed_at, rights_text)
  values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000c1e01', 'As Ana',
          '00000000-0000-0000-0000-0000000000d1/11111111-1111-4111-8111-111111111103-leftover.pdf', 'application/pdf', 'private', now(), 'x');
  raise exception 'ASSERT FAILED: filed under someone else';
exception when insufficient_privilege then raise notice 'ok: a document is filed under the person uploading it';
end $$;
do $$ begin
  insert into documents (owner_user_id, client_id, title, file_path, mime, visibility, rights_confirmed_at, rights_text)
  values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000c1e02', 'For Nico',
          '00000000-0000-0000-0000-0000000000d1/11111111-1111-4111-8111-111111111103-leftover.pdf', 'application/pdf', 'private', now(), 'x');
  raise exception 'ASSERT FAILED: a client filed a document on another client''s record';
exception when insufficient_privilege then raise notice 'ok: a client can''t file on another client''s record';
end $$;
do $$ begin
  insert into documents (owner_user_id, client_id, title, file_path, mime, visibility, source, linked_kind, linked_id)
  values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000c1e01', 'Fake import',
          '00000000-0000-0000-0000-0000000000d1/11111111-1111-4111-8111-111111111103-leftover.pdf', 'application/pdf', 'private',
          'import', 'nutrition_import', gen_random_uuid());
  raise exception 'ASSERT FAILED: a client filed an import';
exception when insufficient_privilege then raise notice 'ok: only the server files imports and links them';
end $$;

-- the unfiled leftover can go; a filed file can't be pulled out from under its document
delete from storage.objects where name like '%leftover.pdf';
select t_assert(not exists (select 1 from storage.objects where name like '%leftover.pdf'), 'an uploader removes a file nothing points at');
delete from storage.objects where name like '%meet-plan.pdf';
select t_assert(exists (select 1 from storage.objects where name like '%meet-plan.pdf'), 'a filed file can''t be deleted by its uploader');

-- ── A coach files for an assigned client, never another coach's ─────────────
reset role;
insert into storage.objects (bucket_id, name, metadata) values
  ('documents', '00000000-0000-0000-0000-0000000000c1/22222222-2222-4222-8222-222222222201-shared.pdf', '{"size": 300, "mimetype": "application/pdf"}'),
  ('documents', '00000000-0000-0000-0000-0000000000c1/22222222-2222-4222-8222-222222222202-coaches.pdf', '{"size": 300, "mimetype": "application/pdf"}'),
  ('documents', '00000000-0000-0000-0000-0000000000c1/22222222-2222-4222-8222-222222222203-ana-private.pdf', '{"size": 300, "mimetype": "application/pdf"}'),
  ('documents', '00000000-0000-0000-0000-0000000000c1/22222222-2222-4222-8222-222222222204-template.docx', '{"size": 300, "mimetype": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}'),
  ('documents', '00000000-0000-0000-0000-0000000000c1/22222222-2222-4222-8222-222222222205-for-nico.pdf', '{"size": 300, "mimetype": "application/pdf"}'),
  ('documents', '00000000-0000-0000-0000-0000000000c2/33333333-3333-4333-8333-333333333301-nico.pdf', '{"size": 300, "mimetype": "application/pdf"}'),
  ('documents', '00000000-0000-0000-0000-0000000000e1/44444444-4444-4444-8444-444444444401-mia.png', '{"size": 300, "mimetype": "image/png"}');
select t_as(:ana); set role authenticated;
insert into documents (owner_user_id, client_id, category, title, file_path, mime, visibility, rights_confirmed_at, rights_text) values
  (:ana, :marc, 'nutrition_plan', 'Shared with Marc', '00000000-0000-0000-0000-0000000000c1/22222222-2222-4222-8222-222222222201-shared.pdf', 'application/pdf', 'client', now(), :rights),
  (:ana, :marc, 'client_document', 'Coaches only', '00000000-0000-0000-0000-0000000000c1/22222222-2222-4222-8222-222222222202-coaches.pdf', 'application/pdf', 'coach', now(), :rights),
  (:ana, :marc, 'other', 'Ana private', '00000000-0000-0000-0000-0000000000c1/22222222-2222-4222-8222-222222222203-ana-private.pdf', 'application/pdf', 'private', now(), :rights),
  (:ana, null, 'template', 'My template', '00000000-0000-0000-0000-0000000000c1/22222222-2222-4222-8222-222222222204-template.docx', 'application/pdf', 'private', now(), :rights);
select t_assert(true, 'a coach files documents for an assigned client, and their own');
do $$ begin
  insert into documents (owner_user_id, client_id, title, file_path, mime, visibility, rights_confirmed_at, rights_text)
  values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000c1e02', 'For Nico',
          '00000000-0000-0000-0000-0000000000c1/22222222-2222-4222-8222-222222222205-for-nico.pdf', 'application/pdf', 'client', now(), 'x');
  raise exception 'ASSERT FAILED: a coach filed for another coach''s client';
exception when insufficient_privilege then raise notice 'ok: a coach can''t file for another coach''s client';
end $$;
do $$ begin
  insert into documents (owner_user_id, client_id, title, file_path, mime, visibility, rights_confirmed_at, rights_text)
  values ('00000000-0000-0000-0000-0000000000c1', null, 'Shared own',
          '00000000-0000-0000-0000-0000000000c1/22222222-2222-4222-8222-222222222205-for-nico.pdf', 'application/pdf', 'coach', now(), 'x');
  raise exception 'ASSERT FAILED: a staff member''s own document was shared';
exception when check_violation then raise notice 'ok: a document with no client stays private';
end $$;

reset role; select t_as(:ben); set role authenticated;
insert into documents (owner_user_id, client_id, category, title, file_path, mime, visibility, rights_confirmed_at, rights_text) values
  (:ben, :nico, 'training_program', 'Nico program', '00000000-0000-0000-0000-0000000000c2/33333333-3333-4333-8333-333333333301-nico.pdf', 'application/pdf', 'coach', now(), :rights);

reset role; select t_as(:mia_u); set role authenticated;
insert into documents (owner_user_id, client_id, category, title, file_path, mime, visibility, rights_confirmed_at, rights_text) values
  (:mia_u, :mia, 'recipe', 'Mia recipe', '00000000-0000-0000-0000-0000000000e1/44444444-4444-4444-8444-444444444401-mia.png', 'image/png', 'private', now(), :rights);

-- ── Who reads what ──────────────────────────────────────────────────────────
reset role; select t_as(:marc_u); set role authenticated;
select t_assert((select array_agg(title order by title) = array['Diary', 'Meet plan', 'Shared with Marc'] from documents), 'a client sees their own documents and the ones their coach shared with them');
select t_assert(exists (select 1 from storage.objects where name like '%shared.pdf'), 'the client can read the shared file');
select t_assert(not exists (select 1 from storage.objects where name like '%coaches.pdf' or name like '%ana-private.pdf'), 'but never a file their coach kept to the coaches or to themselves');

reset role; select t_as(:ana); set role authenticated;
select t_assert((select array_agg(title order by title) = array['Ana private', 'Coaches only', 'Meet plan', 'My template', 'Shared with Marc'] from documents), 'a coach sees their own and their client''s shared documents, never the client''s private one');
select t_assert(exists (select 1 from storage.objects where name like '%meet-plan.pdf'), 'the coach can read the client''s shared file');
select t_assert(not exists (select 1 from storage.objects where name like '%diary.txt'), 'but not the client''s private file');
select t_assert(not exists (select 1 from documents where client_id in (:nico, :mia)), 'a coach never sees another coach''s client or a member');
select t_assert(not exists (select 1 from storage.objects where name like '%3301-nico.pdf' or name like '%mia.png'), 'nor their files');

reset role; select t_as(:ben); set role authenticated;
select t_assert((select array_agg(title) = array['Nico program'] from documents), 'the other coach sees only their own client''s');

reset role; select t_as(:mia_u); set role authenticated;
select t_assert((select array_agg(title) = array['Mia recipe'] from documents), 'a member sees only their own');
select t_assert((select count(*) = 1 from storage.objects), 'and only their own file');

reset role; select t_as(:owner); set role authenticated;
select t_assert((select array_agg(title order by title) = array['Coaches only', 'Meet plan', 'Nico program', 'Shared with Marc'] from documents), 'an admin sees what a coach could, never a private document or a staff member''s own');
select t_assert(exists (select 1 from storage.objects where name like '%3301-nico.pdf'), 'an admin can read a coach-visible file');
select t_assert(not exists (select 1 from storage.objects where name like '%mia.png' or name like '%template.docx'), 'but never a private one');

reset role; select t_as(:stranger); set role authenticated;
select t_assert((select count(*) = 0 from documents), 'someone with a login and nothing else sees nothing');
select t_assert((select count(*) = 0 from storage.objects), 'and no files');

-- ── Changing one: the owner, and only its details ───────────────────────────
reset role; select t_as(:marc_u); set role authenticated;
update documents set title = 'Meet plan v2', category = 'other', tags = array['a', 'A'], visibility = 'private' where title = 'Meet plan';
select t_assert((select tags = array['a'] and visibility = 'private' from documents where title = 'Meet plan v2'), 'the owner renames, recategorizes, retags and re-shares');
update documents set visibility = 'coach' where title = 'Meet plan v2';
update documents set title = 'Hijacked' where title = 'Shared with Marc';
select t_assert(exists (select 1 from documents where title = 'Shared with Marc'), 'a client can''t change what their coach shared');
do $$ begin
  update documents set file_path = '00000000-0000-0000-0000-0000000000d1/11111111-1111-4111-8111-111111111102-diary.txt', bytes = 1 where title = 'Meet plan v2';
  raise exception 'ASSERT FAILED: the file behind a document was swapped';
exception when insufficient_privilege then raise notice 'ok: the file, size and type never change';
end $$;
do $$ begin
  update documents set client_id = '00000000-0000-0000-0000-0000000c1e02' where title = 'Meet plan v2';
  raise exception 'ASSERT FAILED: moved to another client';
exception when insufficient_privilege then raise notice 'ok: a document never moves to another client';
end $$;
do $$ begin
  delete from documents where title = 'Diary';
  raise exception 'ASSERT FAILED: hard-deleted';
exception when insufficient_privilege then raise notice 'ok: a delete is never a hard delete';
end $$;

reset role; select t_as(:ana); set role authenticated;
update documents set title = 'Taken' where title = 'Meet plan v2';
select t_assert(not exists (select 1 from documents where title = 'Taken'), 'a coach can''t change a client''s own document');

-- ── Deleting: 30 days in Recently deleted, then gone ────────────────────────
reset role; select t_as(:marc_u); set role authenticated;
update documents set deleted_at = '1999-01-01' where title = 'Meet plan v2';
select t_assert((select deleted_at > now() - interval '1 minute' from documents where title = 'Meet plan v2'), 'deleting stamps the server''s clock');
reset role; select t_as(:ana); set role authenticated;
select t_assert(not exists (select 1 from documents where title = 'Meet plan v2'), 'a deleted document is gone for the coach');
select t_assert(not exists (select 1 from storage.objects where name like '%meet-plan.pdf'), 'and so is its file');
reset role; select t_as(:marc_u); set role authenticated;
select t_assert(exists (select 1 from documents where title = 'Meet plan v2' and deleted_at is not null), 'the owner still has it in Recently deleted');
update documents set deleted_at = null where title = 'Meet plan v2';
select t_assert((select deleted_at is null from documents where title = 'Meet plan v2'), 'the owner restores it');

-- the server set it back 31 days: past the bin, no restore
update documents set deleted_at = now() where title = 'Diary';
reset role; select t_as_service();
update documents set deleted_at = now() - interval '31 days' where title = 'Diary';
reset role; select t_as(:marc_u); set role authenticated;
do $$ begin
  update documents set deleted_at = null where title = 'Diary';
  raise exception 'ASSERT FAILED: restored after 30 days';
exception when insufficient_privilege then raise notice 'ok: nothing comes back after 30 days';
end $$;

-- a coach deletes what they shared: the client no longer sees it or its file
reset role; select t_as(:ana); set role authenticated;
update documents set deleted_at = now() where title = 'Shared with Marc';
reset role; select t_as(:marc_u); set role authenticated;
select t_assert(not exists (select 1 from documents where title = 'Shared with Marc'), 'a deleted share is gone for the client');
select t_assert(not exists (select 1 from storage.objects where name like '%shared.pdf'), 'and its file');

-- ── The server files an original for a client (recordDocument) ──────────────
reset role; select t_as_service();
insert into storage.objects (bucket_id, name, metadata) values
  ('documents', '00000000-0000-0000-0000-0000000000d1/55555555-5555-4555-8555-555555555501-imported.xlsx',
   '{"size": 4096, "mimetype": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}');
insert into documents (owner_user_id, client_id, category, title, file_path, mime, visibility, source, linked_kind, linked_id)
values (:marc_u, :marc, 'nutrition_plan', 'Imported plan',
        '00000000-0000-0000-0000-0000000000d1/55555555-5555-4555-8555-555555555501-imported.xlsx',
        'application/octet-stream', 'coach', 'import', 'nutrition_import', gen_random_uuid());
select t_assert((select bytes = 4096 and mime like '%spreadsheetml.sheet' and rights_confirmed_at is null from documents where title = 'Imported plan'), 'the server files an import with its link and no rights tick');
do $$ begin
  insert into documents (owner_user_id, client_id, title, file_path, mime, visibility, source)
  values ('00000000-0000-0000-0000-0000000000d1', null, 'Wrong folder',
          '00000000-0000-0000-0000-0000000000c1/22222222-2222-4222-8222-222222222205-for-nico.pdf', 'application/pdf', 'private', 'export');
  raise exception 'ASSERT FAILED: the server filed a file outside the owner''s folder';
exception when insufficient_privilege then raise notice 'ok: even the server files only from the owner''s folder';
end $$;
reset role; select t_as(:ana); set role authenticated;
select t_assert(exists (select 1 from documents where title = 'Imported plan'), 'the coach sees the client''s imported original');

reset role;
select 'documents: all assertions passed' as result;
