-- The coach's form library (form-library.ts) and forms that can be updated
-- after they're sent (Meet Day checklist):
--
-- * Every form has an owner (owner_id, the login that made it; set on insert).
--   A form with no owner is the organization's (everything made before this),
--   a template (is_template) is the organization's starting point and is never
--   archived for going unused. A coach sees their own forms, the
--   organization's and any a colleague shared (shared); an admin sees all.
--   A coach can make and edit their own forms (never broadcast one to every
--   client: that stays an admin's call); clients see only forms sent to them,
--   exactly as before.
-- * category: the coach's own words, grouped in the library (defaults offered
--   in the app, never a fixed list).
-- * nf_form_favorites: a coach's starred forms, their own rows only.
-- * nf_assignments.last_sent_by / last_sent_at: who sent it last, for
--   "Recently sent" in the chat's form picker; settings holds what the send
--   carried (the meet a checklist is for, reminders on or off).
-- * allow_updates: the athlete can change a sent form (a checklist they keep
--   packing). Every change after it's sent is kept in nf_answer_history (by a
--   trigger, whoever wrote it) and nf_submissions.answers_updated_at says when.
-- * settings: the form's own setup (readiness areas, reminders).

-- ── Columns ───────────────────────────────────────────────────────────────
alter table public.nf_forms
  add column if not exists owner_id uuid,
  add column if not exists shared boolean not null default false,
  add column if not exists is_template boolean not null default false,
  add column if not exists category text,
  add column if not exists allow_updates boolean not null default false,
  add column if not exists settings jsonb not null default '{}'::jsonb;

do $$ begin
  alter table public.nf_forms add constraint nf_forms_category_len check (category is null or char_length(category) <= 60);
exception when duplicate_object then null; end $$;

create index if not exists nf_forms_owner_idx on public.nf_forms (owner_id) where owner_id is not null;

alter table public.nf_assignments
  add column if not exists last_sent_by uuid,
  add column if not exists last_sent_at timestamptz;
create index if not exists nf_assignments_sent_by_idx on public.nf_assignments (last_sent_by, last_sent_at desc) where last_sent_by is not null;

alter table public.nf_submissions
  add column if not exists answers_updated_at timestamptz;

-- The two templates so far.
update public.nf_forms set is_template = true, category = coalesce(category, 'Powerlifting & Competitions')
 where id = 'c0a1e7e0-5a7e-4c0d-9f00-000000000c01';
update public.nf_forms set is_template = true, category = coalesce(category, 'Nutrition')
 where id = 'b7a1f0c2-5d3e-4c8a-9f21-6e0d4a1b2c3d';

-- ── Owner on insert ───────────────────────────────────────────────────────
create or replace function public.tg_nf_forms_owner()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  -- Made in the app: it's the maker's. A seed run by the server (no login)
  -- stays the organization's.
  if new.owner_id is null and auth.uid() is not null then
    new.owner_id := auth.uid();
  end if;
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;
  return new;
end
$$;
drop trigger if exists nf_forms_owner on public.nf_forms;
create trigger nf_forms_owner before insert on public.nf_forms
  for each row execute function public.tg_nf_forms_owner();

-- ── Who sees and edits what (set lookups, once per query) ────────────────
create or replace function public.nf_staff_form_ids()
returns setof uuid
language sql
stable security definer
set search_path to 'public'
as $$
  select f.id
    from public.nf_forms f
   where (select public.has_role(auth.uid(), 'admin'::app_role))
      or (
        (select exists (select 1 from public.coaches co where co.user_id = auth.uid() and co.archived = false))
        and (f.owner_id is null or f.owner_id = auth.uid() or f.shared)
      )
$$;

create or replace function public.nf_editable_form_ids()
returns setof uuid
language sql
stable security definer
set search_path to 'public'
as $$
  select f.id
    from public.nf_forms f
   where (select public.has_role(auth.uid(), 'admin'::app_role))
      or (
        f.owner_id = auth.uid()
        and (select exists (select 1 from public.coaches co where co.user_id = auth.uid() and co.archived = false))
      )
$$;

create or replace function public.nf_can_edit_form(_form_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select exists (select 1 from public.nf_editable_form_ids() x where x = _form_id)
$$;

revoke all on function public.nf_staff_form_ids() from public, anon;
revoke all on function public.nf_editable_form_ids() from public, anon;
revoke all on function public.nf_can_edit_form(uuid) from public, anon;
grant execute on function public.nf_staff_form_ids() to authenticated;
grant execute on function public.nf_editable_form_ids() to authenticated;
grant execute on function public.nf_can_edit_form(uuid) to authenticated;

-- nf_forms: admins keep "Admin manage nf_forms"; clients keep their own two.
drop policy if exists "Coach read active nf_forms" on public.nf_forms;
drop policy if exists "Staff read library nf_forms" on public.nf_forms;
create policy "Staff read library nf_forms" on public.nf_forms
  for select to authenticated
  using (id in (select public.nf_staff_form_ids()));

drop policy if exists "Coach create own nf_forms" on public.nf_forms;
create policy "Coach create own nf_forms" on public.nf_forms
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and visibility = 'selected'
    and auto_assign_new_clients = false
    and is_template = false
    and (select exists (select 1 from public.coaches co where co.user_id = (select auth.uid()) and co.archived = false))
  );

drop policy if exists "Coach edit own nf_forms" on public.nf_forms;
create policy "Coach edit own nf_forms" on public.nf_forms
  for update to authenticated
  using (id in (select public.nf_editable_form_ids()))
  with check (
    owner_id = (select auth.uid())
    and visibility = 'selected'
    and auto_assign_new_clients = false
    and is_template = false
  );

drop policy if exists "Coach delete own nf_forms" on public.nf_forms;
create policy "Coach delete own nf_forms" on public.nf_forms
  for delete to authenticated
  using (owner_id = (select auth.uid()) and id in (select public.nf_editable_form_ids()));

-- nf_questions
drop policy if exists "Coach read nf_questions" on public.nf_questions;
drop policy if exists "Staff read library nf_questions" on public.nf_questions;
create policy "Staff read library nf_questions" on public.nf_questions
  for select to authenticated
  using (form_id in (select public.nf_staff_form_ids()));

drop policy if exists "Coach manage own nf_questions" on public.nf_questions;
create policy "Coach manage own nf_questions" on public.nf_questions
  for all to authenticated
  using (form_id in (select public.nf_editable_form_ids()))
  with check (form_id in (select public.nf_editable_form_ids()));

-- nf_form_versions
drop policy if exists "Staff read nf_form_versions" on public.nf_form_versions;
create policy "Staff read nf_form_versions" on public.nf_form_versions
  for select to authenticated
  using (form_id in (select public.nf_staff_form_ids()));

-- Versions: whoever can edit the form can publish and restore one.
create or replace function public.nf_publish_form_version(_form_id uuid, _reason text default null)
returns public.nf_form_versions
language plpgsql security definer set search_path = public
as $$
declare
  v_form jsonb;
  v_questions jsonb;
  v_next int;
  v_row public.nf_form_versions;
begin
  if not public.nf_can_edit_form(_form_id) then
    raise exception 'Only the form''s owner or an admin can publish a version' using errcode = '42501';
  end if;

  select to_jsonb(f.*) into v_form from public.nf_forms f where id = _form_id;
  if v_form is null then
    raise exception 'Form not found';
  end if;

  select coalesce(jsonb_agg(to_jsonb(q.*) order by q.order_index), '[]'::jsonb)
    into v_questions
    from public.nf_questions q
   where q.form_id = _form_id and q.archived_at is null;

  select coalesce(max(version_number), 0) + 1 into v_next
    from public.nf_form_versions where form_id = _form_id;

  insert into public.nf_form_versions
    (form_id, version_number, form_snapshot, questions_snapshot, change_reason, created_by)
  values (_form_id, v_next, v_form, v_questions, nullif(btrim(coalesce(_reason, '')), ''), auth.uid())
  returning * into v_row;

  update public.nf_forms set version = v_next, updated_at = now() where id = _form_id;
  return v_row;
end;
$$;

create or replace function public.nf_restore_form_version(_version_id uuid, _reason text default null)
returns public.nf_form_versions
language plpgsql security definer set search_path = public
as $$
declare
  v_src public.nf_form_versions;
  v_q jsonb;
  v_qid uuid;
  v_keep uuid[];
  v_new public.nf_form_versions;
  v_reason text;
begin
  select * into v_src from public.nf_form_versions where id = _version_id;
  if v_src is null then raise exception 'Version not found'; end if;
  if not public.nf_can_edit_form(v_src.form_id) then
    raise exception 'Only the form''s owner or an admin can restore a version' using errcode = '42501';
  end if;

  update public.nf_forms set
    title = coalesce(v_src.form_snapshot->>'title', title),
    description = v_src.form_snapshot->>'description',
    form_type = coalesce(v_src.form_snapshot->>'form_type', form_type),
    recurrence = coalesce(v_src.form_snapshot->>'recurrence', recurrence),
    recurrence_day = v_src.form_snapshot->>'recurrence_day',
    kind = coalesce(v_src.form_snapshot->>'kind', kind),
    external_url = v_src.form_snapshot->>'external_url',
    button_label = v_src.form_snapshot->>'button_label',
    open_style = coalesce(v_src.form_snapshot->>'open_style', open_style),
    visibility = coalesce(v_src.form_snapshot->>'visibility', visibility),
    requires_client_identity = coalesce((v_src.form_snapshot->>'requires_client_identity')::boolean, requires_client_identity),
    category = coalesce(v_src.form_snapshot->>'category', category),
    allow_updates = coalesce((v_src.form_snapshot->>'allow_updates')::boolean, allow_updates),
    settings = coalesce(v_src.form_snapshot->'settings', settings),
    updated_at = now()
  where id = v_src.form_id;

  v_keep := array[]::uuid[];
  for v_q in select * from jsonb_array_elements(v_src.questions_snapshot)
  loop
    v_qid := nullif(v_q->>'id', '')::uuid;
    if v_qid is null then v_qid := gen_random_uuid(); end if;
    v_keep := array_append(v_keep, v_qid);

    insert into public.nf_questions
      (id, form_id, order_index, question_type, label, help_text, required, options, validation, conditional_logic, archived_at)
    values (
      v_qid, v_src.form_id,
      coalesce((v_q->>'order_index')::int, 0),
      v_q->>'question_type',
      coalesce(v_q->>'label', 'Question'),
      v_q->>'help_text',
      coalesce((v_q->>'required')::boolean, false),
      coalesce(v_q->'options', '[]'::jsonb),
      coalesce(v_q->'validation', '{}'::jsonb),
      coalesce(v_q->'conditional_logic', '{}'::jsonb),
      null
    )
    on conflict (id) do update set
      order_index = excluded.order_index,
      question_type = excluded.question_type,
      label = excluded.label,
      help_text = excluded.help_text,
      required = excluded.required,
      options = excluded.options,
      validation = excluded.validation,
      conditional_logic = excluded.conditional_logic,
      archived_at = null,
      updated_at = now();
  end loop;

  update public.nf_questions
     set archived_at = now(), updated_at = now()
   where form_id = v_src.form_id
     and archived_at is null
     and id <> all(v_keep);

  v_reason := 'Restored from v' || v_src.version_number::text
    || case when _reason is not null and length(btrim(_reason)) > 0
            then ': ' || btrim(_reason) else '' end;

  select * into v_new from public.nf_publish_form_version(v_src.form_id, v_reason);
  return v_new;
end;
$$;

grant execute on function public.nf_publish_form_version(uuid, text) to authenticated;
grant execute on function public.nf_restore_form_version(uuid, text) to authenticated;

-- ── Favorites ─────────────────────────────────────────────────────────────
create table if not exists public.nf_form_favorites (
  user_id uuid not null default auth.uid(),
  form_id uuid not null references public.nf_forms(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, form_id)
);
alter table public.nf_form_favorites enable row level security;
drop policy if exists "Own nf_form_favorites" on public.nf_form_favorites;
create policy "Own nf_form_favorites" on public.nf_form_favorites
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and form_id in (select public.nf_staff_form_ids()));
grant select, insert, delete on public.nf_form_favorites to authenticated;

-- ── Changes after a form is sent ──────────────────────────────────────────
create table if not exists public.nf_answer_history (
  id bigint generated always as identity primary key,
  submission_id uuid not null references public.nf_submissions(id) on delete cascade,
  client_id uuid not null,
  question_id uuid not null,
  old_value jsonb,
  new_value jsonb,
  changed_by uuid,
  changed_at timestamptz not null default now()
);
comment on table public.nf_answer_history is
  'Every change to an answer after its form was sent (a checklist updated as the athlete packs). Written only by the tg_nf_answers_history trigger; staff read.';
create index if not exists nf_answer_history_submission_idx on public.nf_answer_history (submission_id, changed_at desc);

alter table public.nf_answer_history enable row level security;
drop policy if exists "Staff read nf_answer_history" on public.nf_answer_history;
create policy "Staff read nf_answer_history" on public.nf_answer_history
  for select to authenticated
  using (
    (select public.has_role((select auth.uid()), 'admin'::app_role))
    or client_id in (select public.coached_client_ids())
  );
grant select on public.nf_answer_history to authenticated;

create or replace function public.tg_nf_answers_history()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_sub record;
  v_old jsonb;
  v_new jsonb;
begin
  select s.id, s.client_id, s.submitted_at into v_sub
    from public.nf_submissions s
   where s.id = coalesce(new.submission_id, old.submission_id);
  -- Only once it's been sent: drafting answers isn't history.
  if v_sub.id is null or v_sub.submitted_at is null then
    return null;
  end if;
  if tg_op <> 'INSERT' then
    v_old := jsonb_build_object('text', old.value_text, 'number', old.value_number, 'json', old.value_json);
  end if;
  if tg_op <> 'DELETE' then
    v_new := jsonb_build_object('text', new.value_text, 'number', new.value_number, 'json', new.value_json);
  end if;
  if v_old is not distinct from v_new then
    return null;
  end if;
  insert into public.nf_answer_history (submission_id, client_id, question_id, old_value, new_value, changed_by)
  values (v_sub.id, v_sub.client_id, coalesce(new.question_id, old.question_id), v_old, v_new, auth.uid());
  update public.nf_submissions set answers_updated_at = now() where id = v_sub.id;
  return null;
end
$$;
drop trigger if exists nf_answers_history on public.nf_answers;
create trigger nf_answers_history after insert or update or delete on public.nf_answers
  for each row execute function public.tg_nf_answers_history();

-- ── A template is never archived for going unused ─────────────────────────
create or replace function public.archive_unused_forms(_days integer default 60)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
     and not f.is_template
     and f.id <> 'b7a1f0c2-5d3e-4c8a-9f21-6e0d4a1b2c3d'::uuid
     and f.id <> 'c0a1e7e0-5a7e-4c0d-9f00-000000000c01'::uuid
     and not exists (select 1 from public.nf_form_favorites ff where ff.form_id = f.id)
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
$function$;

-- ── The library's numbers, one call ───────────────────────────────────────
-- Per form the caller can see: questions, who it's been sent to (their own
-- clients; an admin's, everyone's), how many answered and how many are still
-- waiting (sent and nothing answered since it was last asked for), and when it
-- was last sent. One read instead of two per row.
create or replace function public.nf_form_library_stats()
returns table(form_id uuid, questions integer, sent integer, done integer, waiting integer, last_sent_at timestamptz)
language sql
stable security definer
set search_path to 'public'
as $$
  with mine as (
    select x as id from public.nf_staff_form_ids() x
  ),
  cl as (
    select c.id from public.clients c where (select public.has_role(auth.uid(), 'admin'::app_role))
    union
    select x from public.coached_client_ids() x
  ),
  asg as (
    select a.form_id, a.client_id, coalesce(a.updated_at, a.created_at) as asked_at, a.last_sent_at
      from public.nf_assignments a
     where a.form_id in (select id from mine) and a.client_id in (select id from cl)
  ),
  subs as (
    select s.form_id, s.client_id, max(coalesce(s.submitted_at, s.created_at)) as at
      from public.nf_submissions s
     where s.form_id in (select id from mine) and s.client_id in (select id from cl) and s.status <> 'in_progress'
     group by s.form_id, s.client_id
  )
  select m.id,
         (select count(*) from public.nf_questions q where q.form_id = m.id and q.archived_at is null and q.question_type <> 'info')::int,
         (select count(*) from asg where asg.form_id = m.id)::int,
         (select count(*) from subs where subs.form_id = m.id)::int,
         (select count(*) from asg
           where asg.form_id = m.id
             and not exists (select 1 from subs where subs.form_id = asg.form_id and subs.client_id = asg.client_id and subs.at >= asg.asked_at - interval '1 minute'))::int,
         (select max(asg.last_sent_at) from asg where asg.form_id = m.id)
    from mine m
$$;
revoke all on function public.nf_form_library_stats() from public, anon;
grant execute on function public.nf_form_library_stats() to authenticated;

-- Form cards in the chat refresh when a submission changes (the thread and
-- the coach's inbox already listen; nf_submissions was never published).
do $$
begin
  alter publication supabase_realtime add table public.nf_submissions;
exception
  when duplicate_object or undefined_object then null;
end
$$;

select public.rls_evaluate_once('nf_forms');
select public.rls_evaluate_once('nf_questions');
select public.rls_evaluate_once('nf_form_versions');
select public.rls_evaluate_once('nf_form_favorites');
select public.rls_evaluate_once('nf_answer_history');
