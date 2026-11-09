-- A program's workouts follow the client's training days, whatever changed them.
--
-- The screens that start, move or assign a program, or change someone's training
-- days, already put the upcoming workouts on those days (realignClientToCommittedDays).
-- Anything else that changes them (the builder adding a week or a workout, Cleo, a
-- member's own app, a coach's SQL fix) left them undated or on the old days: Devin's
-- 12-week program was dated Nov 9 by a dialog that never placed its 72 workouts.
--
-- Now the database queues the client whenever their training days, a dated block's
-- dates / visibility, or a dated program's weeks / workouts change, and the
-- schedule-sync hook (pg_cron every minute, only while something waits, 20 s after
-- the last change so a save's writes have all landed) runs the same realign: done,
-- started and past workouts and ones placed by hand never move. It's idempotent, so a
-- client a screen already placed is a no-op.

create table if not exists public.pl_schedule_sync_queue (
  client_id uuid primary key references public.clients(id) on delete cascade,
  queued_at timestamptz not null default now(),
  -- who made the change (null for the server / SQL); stamped on the schedule history
  queued_by uuid,
  reason text,
  attempts integer not null default 0,
  last_error text
);

alter table public.pl_schedule_sync_queue enable row level security;
revoke all on public.pl_schedule_sync_queue from anon, authenticated;

create or replace function public.pl_schedule_sync_enqueue(p_clients uuid[], p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_clients is null or cardinality(p_clients) = 0 then
    return;
  end if;
  insert into public.pl_schedule_sync_queue (client_id, queued_at, queued_by, reason, attempts)
  select distinct c, now(), auth.uid(), p_reason, 0
    from unnest(p_clients) as c
   where c is not null
     and exists (select 1 from public.clients where id = c)
  on conflict (client_id) do update
     set queued_at = now(),
         queued_by = coalesce(excluded.queued_by, pl_schedule_sync_queue.queued_by),
         reason = excluded.reason,
         attempts = 0,
         last_error = null;
exception when others then
  -- never fail the write that changed the program; the screens place workouts themselves
  null;
end;
$$;

revoke all on function public.pl_schedule_sync_enqueue(uuid[], text) from public, anon, authenticated;

-- Training days changed (any path).
create or replace function public.tg_clients_schedule_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.pl_schedule_sync_enqueue(array[new.id], 'training_days');
  return null;
end;
$$;

drop trigger if exists clients_schedule_sync on public.clients;
create trigger clients_schedule_sync
  after update of committed_training_days on public.clients
  for each row
  when (old.committed_training_days is distinct from new.committed_training_days)
  execute function public.tg_clients_schedule_sync();

-- A client's block got dates, new dates, a new week length, or was shown / hidden / restored.
create or replace function public.tg_pl_blocks_schedule_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.client_id is null or new.start_date is null then
    return null;
  end if;
  if tg_op = 'UPDATE'
     and old.start_date is not distinct from new.start_date
     and old.week_duration_days is not distinct from new.week_duration_days
     and old.client_visible is not distinct from new.client_visible
     and old.archived is not distinct from new.archived then
    return null;
  end if;
  perform public.pl_schedule_sync_enqueue(array[new.client_id], 'block');
  return null;
end;
$$;

drop trigger if exists pl_blocks_schedule_sync on public.pl_blocks;
create trigger pl_blocks_schedule_sync
  after insert or update of start_date, week_duration_days, client_visible, archived on public.pl_blocks
  for each row
  execute function public.tg_pl_blocks_schedule_sync();

-- Weeks added, removed or reordered in a dated program.
create or replace function public.tg_pl_weeks_schedule_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clients uuid[];
begin
  if tg_op = 'INSERT' then
    select array_agg(distinct b.client_id) into v_clients
      from new_rows w join public.pl_blocks b on b.id = w.block_id
     where b.client_id is not null and b.start_date is not null;
  else
    select array_agg(distinct b.client_id) into v_clients
      from new_rows w
      join old_rows o on o.id = w.id
      join public.pl_blocks b on b.id = w.block_id
     where b.client_id is not null and b.start_date is not null
       and (o.week_index is distinct from w.week_index
            or o.deleted_at is distinct from w.deleted_at
            or o.archived is distinct from w.archived
            or o.block_id is distinct from w.block_id);
  end if;
  perform public.pl_schedule_sync_enqueue(v_clients, 'weeks');
  return null;
end;
$$;

drop trigger if exists pl_weeks_schedule_sync_ins on public.pl_weeks;
create trigger pl_weeks_schedule_sync_ins
  after insert on public.pl_weeks
  referencing new table as new_rows
  for each statement execute function public.tg_pl_weeks_schedule_sync();
drop trigger if exists pl_weeks_schedule_sync_upd on public.pl_weeks;
create trigger pl_weeks_schedule_sync_upd
  after update on public.pl_weeks
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.tg_pl_weeks_schedule_sync();

-- Workouts added, removed or reordered in a dated program. A date change alone never
-- queues (that's the realign itself, or someone moving a workout by hand).
create or replace function public.tg_pl_days_schedule_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clients uuid[];
begin
  if tg_op = 'INSERT' then
    select array_agg(distinct b.client_id) into v_clients
      from new_rows d
      join public.pl_weeks w on w.id = d.week_id
      join public.pl_blocks b on b.id = w.block_id
     where b.client_id is not null and b.start_date is not null;
  else
    select array_agg(distinct b.client_id) into v_clients
      from new_rows d
      join old_rows o on o.id = d.id
      join public.pl_weeks w on w.id = d.week_id
      join public.pl_blocks b on b.id = w.block_id
     where b.client_id is not null and b.start_date is not null
       and (o.day_index is distinct from d.day_index
            or o.week_id is distinct from d.week_id
            or o.archived is distinct from d.archived
            or o.deleted_at is distinct from d.deleted_at);
  end if;
  perform public.pl_schedule_sync_enqueue(v_clients, 'workouts');
  return null;
end;
$$;

drop trigger if exists pl_days_schedule_sync_ins on public.pl_days;
create trigger pl_days_schedule_sync_ins
  after insert on public.pl_days
  referencing new table as new_rows
  for each statement execute function public.tg_pl_days_schedule_sync();
drop trigger if exists pl_days_schedule_sync_upd on public.pl_days;
create trigger pl_days_schedule_sync_upd
  after update on public.pl_days
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.tg_pl_days_schedule_sync();

revoke all on function public.tg_clients_schedule_sync(), public.tg_pl_blocks_schedule_sync(),
  public.tg_pl_weeks_schedule_sync(), public.tg_pl_days_schedule_sync() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'pl-schedule-sync';
  perform cron.schedule(
    'pl-schedule-sync',
    '* * * * *',
    $cmd$
    select net.http_post(
      url := 'https://project--5f1f340c-5afa-4262-90c8-1f9406568c6c.lovable.app/api/public/hooks/schedule-sync',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-hook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_hook_secret' limit 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    ) as request_id
    where exists (
      select 1 from public.pl_schedule_sync_queue where queued_at < now() - interval '20 seconds'
    );
    $cmd$
  );
exception
  when undefined_table or undefined_function then
    null;
end
$$;
