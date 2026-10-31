-- Forms not used in 2+ months archive themselves.
--
-- "Used" = a submission (native or Fillout), a send in a client's chat, an
-- assignment (created, changed or with a send still due) or an edit, in the
-- last 60 days. The Nutrition Update Request (the monthly loop's form) never
-- archives. Archived forms stay restorable (Unarchive in Forms → App forms;
-- Restore for document links) and keep every submission; clients just stop
-- seeing them. Document links (`forms`) archive on the same rule when they're
-- assigned per client; one shown to every client is left alone (no usage
-- signal exists for it).
--
-- The Forms page shows each form's last use from nf_form_last_used().

alter table public.nf_forms add column if not exists archived_reason text;
alter table public.forms add column if not exists archived_reason text;

-- When each native / external form was last used (staff only).
create or replace function public.nf_form_last_used()
returns table (form_id uuid, last_used_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  with sends as (
    select (a->>'form_id') as form_id, max(m.created_at) as at
    from public.messages m
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(m.attachments) = 'array' then m.attachments else '[]'::jsonb end
    ) a
    where m.attachments @> '[{"kind":"form_request"}]'::jsonb
      and a->>'kind' = 'form_request'
    group by 1
  )
  select f.id,
         greatest(
           (select max(coalesce(s.submitted_at, s.created_at)) from public.nf_submissions s where s.form_id = f.id),
           (select max(greatest(na.created_at, na.updated_at)) from public.nf_assignments na where na.form_id = f.id),
           (select max(coalesce(fs.submitted_at, fs.created_at)) from public.fillout_submissions fs where fs.form_id = f.id),
           (select sd.at from sends sd where sd.form_id = f.id::text)
         )
  from public.nf_forms f
  where (select public.has_role((select auth.uid()), 'admin'::public.app_role))
     or (select public.has_role((select auth.uid()), 'coach'::public.app_role))
     or (select auth.role()) = 'service_role'
$$;

revoke all on function public.nf_form_last_used() from public, anon;
grant execute on function public.nf_form_last_used() to authenticated, service_role;

-- The archiver: returns how many forms it archived.
create or replace function public.archive_unused_forms(_days int default 60)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  cutoff timestamptz := now() - make_interval(days => greatest(_days, 30));
  n_native int := 0;
  n_docs int := 0;
begin
  with usage as (
    select f.id,
           greatest(
             (select max(coalesce(s.submitted_at, s.created_at)) from public.nf_submissions s where s.form_id = f.id),
             (select max(greatest(na.created_at, na.updated_at)) from public.nf_assignments na where na.form_id = f.id),
             (select max(coalesce(fs.submitted_at, fs.created_at)) from public.fillout_submissions fs where fs.form_id = f.id),
             (select max(m.created_at) from public.messages m
               where m.attachments @> jsonb_build_array(jsonb_build_object('kind', 'form_request', 'form_id', f.id::text)))
           ) as last_used_at
    from public.nf_forms f
    where not f.archived
  )
  update public.nf_forms f
     set archived = true,
         active = false,
         archived_at = now(),
         archived_by = null,
         archived_reason = 'unused'
    from usage u
   where u.id = f.id
     and not f.archived
     and f.id <> 'b7a1f0c2-5d3e-4c8a-9f21-6e0d4a1b2c3d'::uuid  -- Nutrition Update Request
     and coalesce(u.last_used_at, '-infinity'::timestamptz) < cutoff
     and greatest(f.created_at, f.updated_at) < cutoff
     and not exists (
       select 1 from public.nf_assignments na
        where na.form_id = f.id and na.next_due_at is not null and na.next_due_at > now()
     );
  get diagnostics n_native = row_count;

  update public.forms d
     set archived = true,
         archived_at = now(),
         archived_reason = 'unused'
   where not coalesce(d.archived, false)
     and not coalesce(d.visible_to_client, false)
     and greatest(d.created_at, d.updated_at) < cutoff
     and not exists (
       select 1 from public.form_client_assignments a
        where a.form_id = d.id and a.created_at >= cutoff
     );
  get diagnostics n_docs = row_count;

  return n_native + n_docs;
end
$$;

revoke all on function public.archive_unused_forms(int) from public, anon, authenticated;
grant execute on function public.archive_unused_forms(int) to service_role;

-- Every day, 4:23am Winnipeg-ish (09:23 UTC).
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'forms-archive-unused';
  perform cron.schedule('forms-archive-unused', '23 9 * * *', 'select public.archive_unused_forms(60)');
exception
  when undefined_table or undefined_function then null;
end $$;

-- And once now.
select public.archive_unused_forms(60);
