-- Forms they keep updating (a meet checklist, allow_updates) are one copy: once
-- they've sent it, sending it again is a nudge, not a new request, so it never
-- turns someone who answered back into "waiting". Only a fresh copy, sent for
-- something new (another meet, settings.new_copy_since), asks again
-- (form-response-status.ts effectiveAsk, the same rule). And a draft counts as
-- touched when any answer on it changes (draftAt's answers_touched_at), so a
-- client typing into a draft started before the latest request reads "in
-- progress", not "waiting". Same signature and columns as 20270415090000.
create or replace function public.nf_form_library_stats()
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
    select a.form_id, a.client_id, coalesce(a.updated_at, a.created_at) as asked_at, a.last_sent_at,
           coalesce(f.allow_updates, false) as keeps_updating,
           case when a.settings ->> 'new_copy_since' ~ '^\d{4}-\d{2}-\d{2}'
                then (a.settings ->> 'new_copy_since')::timestamptz end as fresh_at
      from public.nf_assignments a
      join public.nf_forms f on f.id = a.form_id
     where a.form_id in (select id from mine) and a.client_id in (select id from cl)
  ),
  -- a draft is touched when an answer on it changes: saving one never moves the
  -- submission's own row (nf_answers.updated_at does, tg_set_updated_at)
  ans as (
    select a.submission_id, max(greatest(a.created_at, coalesce(a.updated_at, a.created_at))) as at
      from public.nf_answers a
      join public.nf_submissions d on d.id = a.submission_id
     where d.status = 'in_progress'
       and d.form_id in (select id from mine) and d.client_id in (select id from cl)
     group by a.submission_id
  ),
  sub as (
    select s.form_id, s.client_id,
           max(coalesce(s.submitted_at, s.created_at)) filter (where s.status <> 'in_progress') as answered_at,
           max(greatest(s.created_at, coalesce(s.updated_at, s.created_at), coalesce(ans.at, s.created_at))) filter (where s.status = 'in_progress') as draft_at,
           count(*) filter (where s.status <> 'in_progress') as responses,
           count(*) filter (
             where s.status <> 'in_progress'
               and s.reviewed_at is null and s.status <> 'reviewed'
               and coalesce(s.submitted_at, s.created_at) > now() - interval '30 days'
           ) as to_review
      from public.nf_submissions s
      left join ans on ans.submission_id = s.id
     where s.form_id in (select id from mine) and s.client_id in (select id from cl)
     group by s.form_id, s.client_id
  ),
  people as (
    select coalesce(asg.form_id, sub.form_id) as form_id,
           cl.inactive,
           -- a form they keep updating that they've sent is asked again only by a fresh copy
           case when asg.keeps_updating and sub.answered_at is not null then asg.fresh_at else asg.asked_at end as asked_at,
           asg.last_sent_at,
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
