-- Training roadmap: what each block is for and what each week focuses on.
--
-- Cleo reads a block's structure (exercises, sets, reps, RPE / %, how volume
-- and intensity move week to week, the meet date when the block belongs to a
-- prep) and writes a short phase label + purpose for the block and a label +
-- focus for every week. The athlete sees them in Block View and the program
-- roadmap on their workouts page.
--
-- Rules:
-- - Cleo writes only the ai_* columns, and never the program itself (block
--   names, goals, days, exercises stay exactly as the coach built them).
-- - A coach's own wording (coach_label / coach_summary) always wins and is
--   never touched by a refresh. Clearing it falls back to Cleo's.
-- - hidden keeps a note from the athlete without deleting it.
-- - Staying in sync: any change to a block, its weeks, days or exercise rows,
--   or its prep's meet date, queues the block (pl_roadmap_queue). The
--   training-roadmap-tick job settles each queued block for two minutes (so
--   a coach mid-edit isn't re-read on every keystroke), then rewrites Cleo's
--   notes only when the structure actually changed (source_hash).

create table if not exists public.pl_roadmap_notes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  block_id uuid not null references public.pl_blocks(id) on delete cascade,
  -- null = the block's own note; otherwise one of its weeks
  week_id uuid references public.pl_weeks(id) on delete cascade,
  ai_label text,
  ai_summary text,
  -- block notes only: powerlifting, meet_prep, strength, hypertrophy, bodybuilding, general_fitness
  ai_style text,
  coach_label text,
  coach_summary text,
  hidden boolean not null default false,
  source_hash text,
  generated_at timestamptz,
  edited_by uuid references auth.users(id) on delete set null,
  edited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pl_roadmap_notes_label_len check (char_length(coalesce(coach_label, '')) <= 60 and char_length(coalesce(ai_label, '')) <= 60),
  constraint pl_roadmap_notes_summary_len check (char_length(coalesce(coach_summary, '')) <= 400 and char_length(coalesce(ai_summary, '')) <= 400)
);

create unique index if not exists pl_roadmap_notes_block_uidx on public.pl_roadmap_notes (block_id) where week_id is null;
create unique index if not exists pl_roadmap_notes_week_uidx on public.pl_roadmap_notes (week_id) where week_id is not null;
create index if not exists pl_roadmap_notes_client_idx on public.pl_roadmap_notes (client_id);
create index if not exists pl_roadmap_notes_hash_idx on public.pl_roadmap_notes (source_hash) where week_id is null and ai_summary is not null;

drop trigger if exists pl_roadmap_notes_updated_at on public.pl_roadmap_notes;
create trigger pl_roadmap_notes_updated_at before update on public.pl_roadmap_notes
  for each row execute function public.update_updated_at_column();

alter table public.pl_roadmap_notes enable row level security;

drop policy if exists "Admin manage pl_roadmap_notes" on public.pl_roadmap_notes;
create policy "Admin manage pl_roadmap_notes" on public.pl_roadmap_notes
  for all to authenticated using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists "Coach manage assigned pl_roadmap_notes" on public.pl_roadmap_notes;
create policy "Coach manage assigned pl_roadmap_notes" on public.pl_roadmap_notes
  for all to authenticated using (public.is_assigned_coach(client_id)) with check (public.is_assigned_coach(client_id));

drop policy if exists "Client read own pl_roadmap_notes" on public.pl_roadmap_notes;
create policy "Client read own pl_roadmap_notes" on public.pl_roadmap_notes
  for select to authenticated using (
    not hidden and exists (
      select 1 from public.pl_blocks b join public.clients c on c.id = b.client_id
       where b.id = pl_roadmap_notes.block_id and b.client_visible and c.user_id = auth.uid()
    )
  );

drop policy if exists "Linked login reads own pl_roadmap_notes" on public.pl_roadmap_notes;
create policy "Linked login reads own pl_roadmap_notes" on public.pl_roadmap_notes
  for select to authenticated using (
    not hidden and exists (
      select 1 from public.pl_blocks b
       where b.id = pl_roadmap_notes.block_id and b.client_visible and b.client_id = (select public.linked_client_id())
    )
  );

comment on table public.pl_roadmap_notes is
  'Block purpose + weekly focus shown on the athlete''s training roadmap. Cleo writes ai_*; the coach''s coach_* always wins and is never overwritten.';

-- Blocks waiting for Cleo to re-read them. No foreign key on purpose: it is
-- written from triggers that also fire while a block is being deleted.
create table if not exists public.pl_roadmap_queue (
  block_id uuid primary key,
  queued_at timestamptz not null default now(),
  attempts integer not null default 0,
  last_error text
);
alter table public.pl_roadmap_queue enable row level security;
-- No policies: service role only.

create or replace function public.pl_roadmap_enqueue(_block_ids uuid[])
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.pl_roadmap_queue (block_id, queued_at)
  select distinct b.id, now()
    from public.pl_blocks b
   where b.id = any(_block_ids) and not b.archived
  on conflict (block_id) do update set queued_at = excluded.queued_at, attempts = 0, last_error = null;
$$;
revoke all on function public.pl_roadmap_enqueue(uuid[]) from public, anon, authenticated;

-- Blocks: what the notes read (name, goal, focus, dates, length, prep).
create or replace function public.pl_roadmap_block_changed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.pl_roadmap_enqueue(array[new.id]);
  return null;
end $$;

drop trigger if exists pl_roadmap_block_changed on public.pl_blocks;
create trigger pl_roadmap_block_changed
  after insert or update of name, goal, training_focus, start_date, end_date, weeks, prep_id, client_visible, archived
  on public.pl_blocks
  for each row execute function public.pl_roadmap_block_changed();

-- Weeks, days and exercise rows: statement-level, so assigning a whole
-- template (hundreds of rows) queues each block once.
create or replace function public.pl_roadmap_weeks_changed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.pl_roadmap_enqueue(array(select distinct block_id from new_rows));
  end if;
  if tg_op in ('DELETE', 'UPDATE') then
    perform public.pl_roadmap_enqueue(array(select distinct block_id from old_rows));
  end if;
  return null;
end $$;

create or replace function public.pl_roadmap_days_changed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.pl_roadmap_enqueue(array(
      select distinct w.block_id from new_rows d join public.pl_weeks w on w.id = d.week_id));
  end if;
  if tg_op in ('DELETE', 'UPDATE') then
    perform public.pl_roadmap_enqueue(array(
      select distinct w.block_id from old_rows d join public.pl_weeks w on w.id = d.week_id));
  end if;
  return null;
end $$;

create or replace function public.pl_roadmap_rows_changed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.pl_roadmap_enqueue(array(
      select distinct w.block_id from new_rows r
        join public.pl_days d on d.id = r.day_id
        join public.pl_weeks w on w.id = d.week_id));
  end if;
  if tg_op in ('DELETE', 'UPDATE') then
    perform public.pl_roadmap_enqueue(array(
      select distinct w.block_id from old_rows r
        join public.pl_days d on d.id = r.day_id
        join public.pl_weeks w on w.id = d.week_id));
  end if;
  return null;
end $$;

drop trigger if exists pl_roadmap_weeks_ins on public.pl_weeks;
drop trigger if exists pl_roadmap_weeks_upd on public.pl_weeks;
drop trigger if exists pl_roadmap_weeks_del on public.pl_weeks;
create trigger pl_roadmap_weeks_ins after insert on public.pl_weeks
  referencing new table as new_rows for each statement execute function public.pl_roadmap_weeks_changed();
create trigger pl_roadmap_weeks_upd after update on public.pl_weeks
  referencing old table as old_rows new table as new_rows for each statement execute function public.pl_roadmap_weeks_changed();
create trigger pl_roadmap_weeks_del after delete on public.pl_weeks
  referencing old table as old_rows for each statement execute function public.pl_roadmap_weeks_changed();

drop trigger if exists pl_roadmap_days_ins on public.pl_days;
drop trigger if exists pl_roadmap_days_upd on public.pl_days;
drop trigger if exists pl_roadmap_days_del on public.pl_days;
create trigger pl_roadmap_days_ins after insert on public.pl_days
  referencing new table as new_rows for each statement execute function public.pl_roadmap_days_changed();
create trigger pl_roadmap_days_upd after update on public.pl_days
  referencing old table as old_rows new table as new_rows for each statement execute function public.pl_roadmap_days_changed();
create trigger pl_roadmap_days_del after delete on public.pl_days
  referencing old table as old_rows for each statement execute function public.pl_roadmap_days_changed();

drop trigger if exists pl_roadmap_rows_ins on public.pl_exercise_rows;
drop trigger if exists pl_roadmap_rows_upd on public.pl_exercise_rows;
drop trigger if exists pl_roadmap_rows_del on public.pl_exercise_rows;
create trigger pl_roadmap_rows_ins after insert on public.pl_exercise_rows
  referencing new table as new_rows for each statement execute function public.pl_roadmap_rows_changed();
create trigger pl_roadmap_rows_upd after update on public.pl_exercise_rows
  referencing old table as old_rows new table as new_rows for each statement execute function public.pl_roadmap_rows_changed();
create trigger pl_roadmap_rows_del after delete on public.pl_exercise_rows
  referencing old table as old_rows for each statement execute function public.pl_roadmap_rows_changed();

-- A meet date moving changes where every block in the prep sits (taper, peak).
create or replace function public.pl_roadmap_prep_changed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.pl_roadmap_enqueue(array(select id from public.pl_blocks where prep_id = new.id));
  return null;
end $$;

drop trigger if exists pl_roadmap_prep_changed on public.pl_preps;
create trigger pl_roadmap_prep_changed
  after update of event_date, event_name, goal_type on public.pl_preps
  for each row execute function public.pl_roadmap_prep_changed();

-- First run: every live block (current, upcoming, or finished in the last 4 weeks).
insert into public.pl_roadmap_queue (block_id, queued_at)
select b.id, now() - interval '10 minutes'
  from public.pl_blocks b
 where not b.archived
   and b.status <> 'Archived'
   and (b.end_date is null or b.end_date >= current_date - 28)
on conflict (block_id) do nothing;

-- Every 5 minutes, offset from the other ticks.
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'training-roadmap-tick';
  perform cron.schedule(
    'training-roadmap-tick',
    '3-59/5 * * * *',
    $cmd$
    select net.http_post(
      url := 'https://project--5f1f340c-5afa-4262-90c8-1f9406568c6c.lovable.app/api/public/hooks/training-roadmap-tick',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-hook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_hook_secret' limit 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    ) as request_id;
    $cmd$
  );
exception
  when undefined_table or undefined_function then
    null;
end
$$;
