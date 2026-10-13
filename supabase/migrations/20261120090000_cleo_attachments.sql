-- Cleo attachments: photos, videos, PDFs and text files people send Cleo to
-- look at.
--
--   * cleo-attachments          private bucket, one folder per person
--                               (<user id>/<yyyy-mm>/<file>), owner-only
--   * summer_messages.attachments  what was attached to a message (paths,
--                               video stills, and what Cleo read from them)
--   * summer_attachments        every uploaded file, tied to its message once
--                               sent. When the message goes (chat deleted, or
--                               a year old), message_id turns null and the
--                               daily sweep (cleo-attachments-sweep hook)
--                               removes the file. Uploads never sent go too.
--
-- Storage objects can't be deleted from SQL, so the sweep runs in the app
-- with the service key.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cleo-attachments', 'cleo-attachments', false, 104857600,
        array['image/*', 'video/*', 'application/pdf', 'text/plain', 'text/csv', 'text/markdown', 'application/json'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Own folder only, for the people who have Cleo (an admin, or the view-only login).
drop policy if exists "cleo attachments own read" on storage.objects;
create policy "cleo attachments own read" on storage.objects for select to authenticated
  using (bucket_id = 'cleo-attachments'
         and (storage.foldername(name))[1] = (select auth.uid())::text
         and ((select public.has_role((select auth.uid()), 'admin'::public.app_role)) or (select public.is_admin_viewer())));

drop policy if exists "cleo attachments own insert" on storage.objects;
create policy "cleo attachments own insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'cleo-attachments'
              and (storage.foldername(name))[1] = (select auth.uid())::text
              and ((select public.has_role((select auth.uid()), 'admin'::public.app_role)) or (select public.is_admin_viewer())));

drop policy if exists "cleo attachments own delete" on storage.objects;
create policy "cleo attachments own delete" on storage.objects for delete to authenticated
  using (bucket_id = 'cleo-attachments'
         and (storage.foldername(name))[1] = (select auth.uid())::text
         and ((select public.has_role((select auth.uid()), 'admin'::public.app_role)) or (select public.is_admin_viewer())));

alter table public.summer_messages add column if not exists attachments jsonb;

create table if not exists public.summer_attachments (
  path text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  message_id uuid references public.summer_messages (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists summer_attachments_orphans_idx on public.summer_attachments (created_at) where message_id is null;
create index if not exists summer_attachments_message_idx on public.summer_attachments (message_id);

alter table public.summer_attachments enable row level security;
grant select, insert, update, delete on public.summer_attachments to authenticated;
grant all on public.summer_attachments to service_role;

drop policy if exists "own summer attachments" on public.summer_attachments;
create policy "own summer attachments" on public.summer_attachments
  for all to authenticated
  using (user_id = (select auth.uid())
         and ((select public.has_role((select auth.uid()), 'admin'::public.app_role)) or (select public.is_admin_viewer())))
  with check (user_id = (select auth.uid())
              and split_part(path, '/', 1) = (select auth.uid())::text
              and ((select public.has_role((select auth.uid()), 'admin'::public.app_role)) or (select public.is_admin_viewer())));

select public.rls_evaluate_once('summer_attachments');

-- Daily sweep of files whose message is gone (or that were never sent).
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'cleo-attachments-sweep';
  perform cron.schedule('cleo-attachments-sweep', '41 9 * * *', $cmd$
    select net.http_post(
      url := 'https://project--5f1f340c-5afa-4262-90c8-1f9406568c6c.lovable.app/api/public/hooks/cleo-attachments-sweep',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-hook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_hook_secret' limit 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    ) as request_id;
  $cmd$);
exception when undefined_table or invalid_schema_name or undefined_function then
  raise notice 'pg_cron not available; cleo-attachments-sweep not scheduled';
end $$;
