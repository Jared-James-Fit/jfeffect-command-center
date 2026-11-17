-- Competition Calendar + Strategy (competition-plan.ts, form-fields.ts):
-- the first full template on the native form engine, and the structured plan
-- each submission becomes for the coach to approve. Approved plans are what
-- the program AI reads (program-intel brief); a plan never changes a program
-- by itself.

-- ── The plan ──────────────────────────────────────────────────────────────
create table if not exists public.athlete_competition_plans (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  submission_id uuid references public.nf_submissions(id) on delete set null,
  plan jsonb not null,
  -- What changed since their previous plan, a line each (planChanges).
  changes jsonb not null default '[]'::jsonb,
  status text not null default 'submitted' check (status in ('submitted', 'approved', 'dismissed')),
  reviewed_at timestamptz,
  reviewed_by uuid,
  -- The coach also set the primary meet as the program's dated goal.
  goal_set boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.athlete_competition_plans is
  'A Competition Calendar + Strategy submission as a structured plan (competition-plan.ts). Written by the server on submit; the coach approves or dismisses it. Only approved plans reach the program AI.';
create unique index if not exists athlete_competition_plans_submission_key
  on public.athlete_competition_plans (submission_id) where submission_id is not null;
create index if not exists athlete_competition_plans_client_idx
  on public.athlete_competition_plans (client_id, created_at desc);

alter table public.athlete_competition_plans enable row level security;
drop policy if exists "Coaches read their clients' competition plans" on public.athlete_competition_plans;
create policy "Coaches read their clients' competition plans" on public.athlete_competition_plans
  for select using (
    (select public.has_role((select auth.uid()), 'admin'))
    or client_id in (select public.coached_client_ids())
  );
drop policy if exists "Coaches review their clients' competition plans" on public.athlete_competition_plans;
create policy "Coaches review their clients' competition plans" on public.athlete_competition_plans
  for update using (
    (select public.has_role((select auth.uid()), 'admin'))
    or client_id in (select public.coached_client_ids())
  ) with check (
    (select public.has_role((select auth.uid()), 'admin'))
    or client_id in (select public.coached_client_ids())
  );
-- Inserts come from the server only (service role) when the athlete submits.

create or replace function public.tg_athlete_competition_plans_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists athlete_competition_plans_touch on public.athlete_competition_plans;
create trigger athlete_competition_plans_touch before update on public.athlete_competition_plans
  for each row execute function public.tg_athlete_competition_plans_touch();

-- ── The form ──────────────────────────────────────────────────────────────
insert into public.nf_forms (id, title, description, form_type, recurrence, active, archived, kind, visibility, button_label, requires_client_identity)
values (
  'c0a1e7e0-5a7e-4c0d-9f00-000000000c01',
  'Competition Calendar + Strategy',
  'Let''s plan out your year of competitions.',
  'competition_strategy',
  'none',
  true,
  false,
  'native',
  'selected',
  'Send my plan',
  true
)
on conflict (id) do nothing;

insert into public.nf_questions (id, form_id, order_index, question_type, label, help_text, required, options, validation, conditional_logic)
values
  ('c0a1e7e0-5a7e-4c0d-9f00-000000000101', 'c0a1e7e0-5a7e-4c0d-9f00-000000000c01', 0, 'info', 'About you', null, false, '[]'::jsonb, '{}'::jsonb, '{}'::jsonb),
  ('c0a1e7e0-5a7e-4c0d-9f00-000000000102', 'c0a1e7e0-5a7e-4c0d-9f00-000000000c01', 1, 'short_text', 'First and last name', null, true, '[]'::jsonb, '{"prefill": "full_name", "remember": true, "plan_key": "name"}'::jsonb, '{}'::jsonb),
  ('c0a1e7e0-5a7e-4c0d-9f00-000000000103', 'c0a1e7e0-5a7e-4c0d-9f00-000000000c01', 2, 'multi_choice', 'Age class', 'Pick every class you''ll enter. Junior and master lifters can lift Open too.', true, '["SUB-JUNIOR (14–18)", "JUNIOR (19–23)", "OPEN (19–59)", "MASTER 1 (40–49)", "MASTER 2 (50–59)", "MASTER 3 (60–69)", "MASTER 4 (70+)"]'::jsonb, '{"prefill": "age_class", "remember": true, "plan_key": "age_classes"}'::jsonb, '{}'::jsonb),
  ('c0a1e7e0-5a7e-4c0d-9f00-000000000104', 'c0a1e7e0-5a7e-4c0d-9f00-000000000c01', 3, 'single_choice', 'Weight class', 'The class you plan to compete in. Moving classes? Pick the one you''re aiming for.', true, '["Men''s 53 kg (sub-junior & junior only)", "Men''s 59 kg", "Men''s 66 kg", "Men''s 74 kg", "Men''s 83 kg", "Men''s 93 kg", "Men''s 105 kg", "Men''s 120 kg", "Men''s 120 kg+", "Women''s 43 kg (sub-junior & junior only)", "Women''s 47 kg", "Women''s 52 kg", "Women''s 57 kg", "Women''s 63 kg", "Women''s 69 kg", "Women''s 76 kg", "Women''s 84 kg", "Women''s 84 kg+"]'::jsonb, '{"prefill": "weight_class", "group_prefixes": ["Men''s ", "Women''s "], "remember": true, "plan_key": "weight_class"}'::jsonb, '{}'::jsonb),
  ('c0a1e7e0-5a7e-4c0d-9f00-000000000105', 'c0a1e7e0-5a7e-4c0d-9f00-000000000c01', 4, 'info', 'Your season', 'Let''s plan your competition year around the meets that matter most.', false, '[]'::jsonb, '{}'::jsonb, '{}'::jsonb),
  ('c0a1e7e0-5a7e-4c0d-9f00-000000000106', 'c0a1e7e0-5a7e-4c0d-9f00-000000000c01', 5, 'competitions', 'Which meets are you actually considering?', 'Tap each one. Add the meet''s name, date and place if you know them, all optional.', true, '["Local Meet", "Provincial Championships", "Western Championships", "Eastern Championships", "Central Championships", "National Championships", "World Championships (IPF)", "Commonwealth Championships (CPF)", "North American Championships (NAPF)", "World Games (IWGA)", "Other", "None — I don''t plan on competing"]'::jsonb, '{"none_option": "None — I don''t plan on competing", "remember": true, "plan_key": "meets"}'::jsonb, '{}'::jsonb),
  ('c0a1e7e0-5a7e-4c0d-9f00-000000000107', 'c0a1e7e0-5a7e-4c0d-9f00-000000000c01', 6, 'ranking', 'Put them in order of importance', 'Most important first. Use the arrows.', true, '[]'::jsonb, '{"options_from": "c0a1e7e0-5a7e-4c0d-9f00-000000000106", "remember": true, "plan_key": "ranking"}'::jsonb, '{"show_if": [{"question_id": "c0a1e7e0-5a7e-4c0d-9f00-000000000106", "op": "not_contains", "value": "None"}], "match": "all"}'::jsonb),
  ('c0a1e7e0-5a7e-4c0d-9f00-000000000108', 'c0a1e7e0-5a7e-4c0d-9f00-000000000c01', 7, 'single_choice', 'If you had to pick ONE meet to perform your best at, which is it?', 'This is the meet we peak for.', true, '[]'::jsonb, '{"options_from": "c0a1e7e0-5a7e-4c0d-9f00-000000000106", "remember": true, "plan_key": "primary"}'::jsonb, '{"show_if": [{"question_id": "c0a1e7e0-5a7e-4c0d-9f00-000000000106", "op": "not_contains", "value": "None"}], "match": "all"}'::jsonb),
  ('c0a1e7e0-5a7e-4c0d-9f00-000000000109', 'c0a1e7e0-5a7e-4c0d-9f00-000000000c01', 8, 'single_choice', 'Your main goal at that meet', null, false, '["Qualify for a bigger meet", "Hit a total or a PR", "Place or win", "Get experience"]'::jsonb, '{"remember": true, "plan_key": "goal"}'::jsonb, '{"show_if": [{"question_id": "c0a1e7e0-5a7e-4c0d-9f00-000000000106", "op": "not_contains", "value": "None"}], "match": "all"}'::jsonb),
  ('c0a1e7e0-5a7e-4c0d-9f00-000000000110', 'c0a1e7e0-5a7e-4c0d-9f00-000000000c01', 9, 'single_choice', 'How many meets would you realistically fully prep (peak) for this year?', 'A full peak is a dedicated prep block, usually 8 to 12 weeks, that ends with your best lifts on the day.', true, '["None", "1", "2", "3+"]'::jsonb, '{"remember": true, "plan_key": "full_peaks"}'::jsonb, '{"show_if": [{"question_id": "c0a1e7e0-5a7e-4c0d-9f00-000000000106", "op": "not_contains", "value": "None"}], "match": "all"}'::jsonb),
  ('c0a1e7e0-5a7e-4c0d-9f00-000000000111', 'c0a1e7e0-5a7e-4c0d-9f00-000000000c01', 10, 'single_choice', 'Are you open to meets that AREN''T a full peak?', 'Used for practice, experience or data, not max performance.', true, '["Yes", "No", "I''m not competing"]'::jsonb, '{"remember": true, "plan_key": "non_peak"}'::jsonb, '{"show_if": [{"question_id": "c0a1e7e0-5a7e-4c0d-9f00-000000000106", "op": "not_contains", "value": "None"}], "match": "all"}'::jsonb),
  ('c0a1e7e0-5a7e-4c0d-9f00-000000000112', 'c0a1e7e0-5a7e-4c0d-9f00-000000000c01', 11, 'single_choice', 'Your bodyweight plan for this season', null, false, '["Stay where I am", "Cut to a lighter class", "Gain into a heavier class", "Not sure yet"]'::jsonb, '{"remember": true, "plan_key": "bodyweight_plan"}'::jsonb, '{"show_if": [{"question_id": "c0a1e7e0-5a7e-4c0d-9f00-000000000106", "op": "not_contains", "value": "None"}], "match": "all"}'::jsonb),
  ('c0a1e7e0-5a7e-4c0d-9f00-000000000113', 'c0a1e7e0-5a7e-4c0d-9f00-000000000c01', 12, 'long_text', 'Anything else I need to know?', 'Travel, scheduling conflicts, injuries, budget, qualification concerns, or anything that could affect your competition plans.', false, '[]'::jsonb, '{"plan_key": "notes"}'::jsonb, '{}'::jsonb)

on conflict (id) do nothing;

-- A template stays put: never archived for going unused (archive_unused_forms).
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
     and f.id <> 'b7a1f0c2-5d3e-4c8a-9f21-6e0d4a1b2c3d'::uuid
     and f.id <> 'c0a1e7e0-5a7e-4c0d-9f00-000000000c01'::uuid
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

select public.rls_evaluate_once('athlete_competition_plans');
