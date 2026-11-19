-- Forms: who a form is out with, read one way everywhere.
--
-- 1. nf_assignments.client_id had no foreign key to clients, so every read
--    that embedded the client through it (`client:client_id(full_name)`)
--    failed with "Could not find a relationship": the form editor's Responses
--    tab read the error as "Nobody's been sent this form yet", its "Shared
--    with" tab showed nobody ticked (so saving it would have dropped everyone
--    else), the meet board never listed a checklist sent and not opened, and
--    the meet checklist's reminders never found anyone. nf_submissions has had
--    the same key since 20270102090000.
-- 2. nf_form_library_stats() counted "sent" (assignments), "done" (anyone who
--    ever answered) and "waiting" (asked since their last answer) on three
--    different rules, so a form read "Sent to 14 · 8 answered · 7 waiting".
--    Now each person has one state about the latest request (answered / in
--    progress / waiting, form-response-status.ts personState, same rule), and
--    answered + in_progress + waiting = sent. Someone archived or deactivated
--    isn't waiting on anything: they count only if they answered.

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.nf_assignments'::regclass and conname = 'nf_assignments_client_id_fkey'
  ) then
    alter table public.nf_assignments
      add constraint nf_assignments_client_id_fkey
      foreign key (client_id) references public.clients(id) on delete cascade not valid;
  end if;
end
$$;
alter table public.nf_assignments validate constraint nf_assignments_client_id_fkey;
create index if not exists nf_assignments_client_id_idx on public.nf_assignments (client_id);

-- The return type changes (in_progress, responses, to_review, last_response_at
-- added; sent / done / waiting keep their names, so an older app still reads them).
drop function if exists public.nf_form_library_stats();
create function public.nf_form_library_stats()
returns table(
  form_id uuid,
  questions integer,
  sent integer,
  done integer,
  waiting integer,
  in_progress integer,
  responses integer,
  to_review integer,
  last_sent_at timestamptz,
  last_response_at timestamptz
)
language sql
stable security definer
set search_path to 'public'
as $$
  with mine as (
    select x as id from public.nf_staff_form_ids() x
  ),
  cl as (
    select c.id, coalesce(c.archived, false) as inactive
      from public.clients c
     where (select public.has_role((select auth.uid()), 'admin'::app_role))
        or c.id in (select public.coached_client_ids())
  ),
  asg as (
    select a.form_id, a.client_id, coalesce(a.updated_at, a.created_at) as asked_at, a.last_sent_at
      from public.nf_assignments a
     where a.form_id in (select id from mine) and a.client_id in (select id from cl)
  ),
  sub as (
    select s.form_id, s.client_id,
           max(coalesce(s.submitted_at, s.created_at)) filter (where s.status <> 'in_progress') as answered_at,
           max(greatest(s.created_at, coalesce(s.updated_at, s.created_at))) filter (where s.status = 'in_progress') as draft_at,
           count(*) filter (where s.status <> 'in_progress') as responses,
           count(*) filter (
             where s.status <> 'in_progress'
               and s.reviewed_at is null and s.status <> 'reviewed'
               and coalesce(s.submitted_at, s.created_at) > now() - interval '30 days'
           ) as to_review
      from public.nf_submissions s
     where s.form_id in (select id from mine) and s.client_id in (select id from cl)
     group by s.form_id, s.client_id
  ),
  people as (
    select coalesce(asg.form_id, sub.form_id) as form_id,
           cl.inactive,
           asg.asked_at, asg.last_sent_at,
           sub.answered_at, sub.draft_at,
           coalesce(sub.responses, 0) as responses,
           coalesce(sub.to_review, 0) as to_review
      from asg
      full join sub on sub.form_id = asg.form_id and sub.client_id = asg.client_id
      join cl on cl.id = coalesce(asg.client_id, sub.client_id)
  ),
  st as (
    select p.*,
           case
             when p.answered_at is not null and (p.asked_at is null or p.answered_at >= p.asked_at - interval '1 minute') then 'answered'
             when p.draft_at is not null and (p.asked_at is null or p.draft_at >= p.asked_at - interval '1 minute') then 'in_progress'
             when p.asked_at is not null then 'waiting'
           end as state
      from people p
  ),
  -- In the people counts: everyone but an archived client who hadn't answered.
  -- Responses and what's to review count everyone's.
  counted as (
    select * from st where state = 'answered' or (state is not null and not inactive)
  )
  select m.id,
         (select count(*) from public.nf_questions q where q.form_id = m.id and q.archived_at is null and q.question_type <> 'info')::int,
         (select count(*) from counted c where c.form_id = m.id)::int,
         (select count(*) from counted c where c.form_id = m.id and c.state = 'answered')::int,
         (select count(*) from counted c where c.form_id = m.id and c.state = 'waiting')::int,
         (select count(*) from counted c where c.form_id = m.id and c.state = 'in_progress')::int,
         (select coalesce(sum(s.responses), 0) from st s where s.form_id = m.id)::int,
         (select coalesce(sum(s.to_review), 0) from st s where s.form_id = m.id)::int,
         (select max(a.last_sent_at) from asg a where a.form_id = m.id),
         (select max(s.answered_at) from st s where s.form_id = m.id)
    from mine m
$$;
revoke all on function public.nf_form_library_stats() from public, anon;
grant execute on function public.nf_form_library_stats() to authenticated;

notify pgrst, 'reload schema';
