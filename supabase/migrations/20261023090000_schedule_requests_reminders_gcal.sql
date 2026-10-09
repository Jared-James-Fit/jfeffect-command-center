-- One schedule for clients and coaches.
--
-- 1. pt_sessions remembers when its time was last set (time_set_at) and syncs
--    itself to the coach's Google Calendar through a dirty flag the 5-minute
--    schedule tick drains (/api/public/hooks/appointment-reminders).
-- 2. Clients ask to move or cancel a session with pt_session_change_requests.
--    Writes go through server functions; RLS only lets clients read their own.
-- 3. sms_log gets kind 'session' (evening-before texts and last-minute change
--    texts) so they never count against the unread-message text cooldown.
-- 4. clients.calendar_feed_token powers a private, read-only calendar feed the
--    client subscribes to from Google or Apple Calendar.

-- 1) pt_sessions bookkeeping ---------------------------------------------------
alter table public.pt_sessions
  add column if not exists time_set_at timestamptz,
  add column if not exists google_event_id text,
  add column if not exists google_calendar_id text,
  add column if not exists gcal_dirty boolean not null default false,
  add column if not exists gcal_attempts integer not null default 0,
  add column if not exists gcal_claimed_at timestamptz,
  add column if not exists gcal_synced_at timestamptz,
  add column if not exists gcal_error text;

update public.pt_sessions set time_set_at = created_at where time_set_at is null;
alter table public.pt_sessions alter column time_set_at set default now();
alter table public.pt_sessions alter column time_set_at set not null;

-- Only sessions still ahead need a first push to Google; history stays out.
update public.pt_sessions
   set gcal_dirty = true
 where status = 'Scheduled' and ends_at > now() and google_event_id is null;

create index if not exists pt_sessions_gcal_dirty_idx
  on public.pt_sessions (starts_at) where gcal_dirty;
create index if not exists pt_sessions_reminder_due_idx
  on public.pt_sessions (starts_at)
  where status = 'Scheduled' and reminder_24h_sent_at is null;

-- A new time resets the reminder and marks "arranged just now"; any change the
-- coach would see in Google marks the row for the next sync.
create or replace function public.tg_pt_session_schedule_meta()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.time_set_at := now();
    new.gcal_dirty := true;
    new.gcal_attempts := 0;
    return new;
  end if;

  if new.session_date is distinct from old.session_date
     or new.start_time is distinct from old.start_time
     or new.end_time is distinct from old.end_time
     or new.timezone is distinct from old.timezone then
    new.time_set_at := now();
    new.reminder_24h_sent_at := null;
    new.reminder_1h_sent_at := null;
  end if;

  if new.session_date is distinct from old.session_date
     or new.start_time is distinct from old.start_time
     or new.end_time is distinct from old.end_time
     or new.timezone is distinct from old.timezone
     or new.title is distinct from old.title
     or new.location is distinct from old.location
     or new.notes is distinct from old.notes
     or new.status is distinct from old.status
     or new.client_id is distinct from old.client_id then
    new.gcal_dirty := true;
    new.gcal_attempts := 0;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_pt_sessions_schedule_meta on public.pt_sessions;
create trigger trg_pt_sessions_schedule_meta
  before insert or update on public.pt_sessions
  for each row execute function public.tg_pt_session_schedule_meta();

-- Hard-deleted sessions still have to leave Google.
create table if not exists public.pt_session_gcal_deletes (
  id uuid primary key default gen_random_uuid(),
  google_event_id text not null,
  google_calendar_id text,
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now()
);
alter table public.pt_session_gcal_deletes enable row level security;
-- No policies: only the service role reads or writes this queue.

create or replace function public.tg_pt_session_gcal_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.google_event_id is not null then
    insert into public.pt_session_gcal_deletes (google_event_id, google_calendar_id)
    values (old.google_event_id, old.google_calendar_id);
  end if;
  return old;
end;
$$;

drop trigger if exists trg_pt_sessions_gcal_delete on public.pt_sessions;
create trigger trg_pt_sessions_gcal_delete
  after delete on public.pt_sessions
  for each row execute function public.tg_pt_session_gcal_delete();

-- The sync worker claims rows so the cron tick and an on-save kick never push
-- the same session twice. A claim older than 5 minutes is treated as dead.
create or replace function public.pt_gcal_claim(_limit integer default 25)
returns setof public.pt_sessions
language sql
security definer
set search_path = public
as $$
  update public.pt_sessions s
     set gcal_claimed_at = now()
   where s.id in (
     select p.id
       from public.pt_sessions p
      where p.gcal_dirty
        and p.gcal_attempts < 5
        and (p.gcal_claimed_at is null or p.gcal_claimed_at < now() - interval '5 minutes')
      order by p.starts_at
      limit greatest(1, least(coalesce(_limit, 25), 100))
      for update skip locked
   )
  returning s.*;
$$;

create or replace function public.pt_gcal_pop_deletes(_limit integer default 25)
returns setof public.pt_session_gcal_deletes
language sql
security definer
set search_path = public
as $$
  delete from public.pt_session_gcal_deletes d
   where d.id in (
     select q.id
       from public.pt_session_gcal_deletes q
      where q.attempts < 5
      order by q.created_at
      limit greatest(1, least(coalesce(_limit, 25), 100))
      for update skip locked
   )
  returning d.*;
$$;

revoke all on function public.pt_gcal_claim(integer) from public, anon, authenticated;
revoke all on function public.pt_gcal_pop_deletes(integer) from public, anon, authenticated;
grant execute on function public.pt_gcal_claim(integer) to service_role;
grant execute on function public.pt_gcal_pop_deletes(integer) to service_role;

-- 2) Client change requests ----------------------------------------------------
create table if not exists public.pt_session_change_requests (
  id uuid primary key default gen_random_uuid(),
  pt_session_id uuid not null references public.pt_sessions(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  kind text not null check (kind in ('move', 'cancel')),
  preferred_times text check (preferred_times is null or char_length(preferred_times) <= 300),
  note text check (note is null or char_length(note) <= 1000),
  status text not null default 'pending' check (status in ('pending', 'done', 'declined', 'withdrawn')),
  resolution text,
  requested_by uuid,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists pt_session_change_requests_one_pending
  on public.pt_session_change_requests (pt_session_id) where status = 'pending';
create index if not exists pt_session_change_requests_pending_idx
  on public.pt_session_change_requests (created_at) where status = 'pending';
create index if not exists pt_session_change_requests_client_idx
  on public.pt_session_change_requests (client_id, created_at desc);

alter table public.pt_session_change_requests enable row level security;

drop policy if exists "Admin manage session change requests" on public.pt_session_change_requests;
create policy "Admin manage session change requests"
  on public.pt_session_change_requests for all
  using (public.has_role(auth.uid(), 'admin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role));

drop policy if exists "Coach manage assigned session change requests" on public.pt_session_change_requests;
create policy "Coach manage assigned session change requests"
  on public.pt_session_change_requests for all
  using (public.is_assigned_coach(client_id))
  with check (public.is_assigned_coach(client_id));

drop policy if exists "Client read own session change requests" on public.pt_session_change_requests;
create policy "Client read own session change requests"
  on public.pt_session_change_requests for select
  using (exists (
    select 1 from public.clients c
     where c.id = pt_session_change_requests.client_id
       and c.user_id = auth.uid()
  ));

-- Moving, cancelling, completing or no-showing a session answers any open
-- request for it, whichever screen the coach used.
create or replace function public.tg_pt_session_close_change_requests()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status
     or new.session_date is distinct from old.session_date
     or new.start_time is distinct from old.start_time then
    update public.pt_session_change_requests
       set status = 'done',
           resolved_at = now(),
           resolved_by = auth.uid(),
           resolution = case
             when new.status = 'Scheduled' then 'moved'
             when new.status = 'Missed' then 'late_cancel'
             else lower(new.status)
           end
     where pt_session_id = new.id
       and status = 'pending';
  end if;
  return null;
end;
$$;

drop trigger if exists trg_pt_sessions_close_change_requests on public.pt_sessions;
create trigger trg_pt_sessions_close_change_requests
  after update on public.pt_sessions
  for each row
  when (old.status = 'Scheduled')
  execute function public.tg_pt_session_close_change_requests();

do $$
begin
  begin
    alter publication supabase_realtime add table public.pt_session_change_requests;
  exception when duplicate_object then null;
  end;
exception
  when undefined_object then null;
end
$$;

-- 3) Session texts in the SMS log ------------------------------------------------
alter table public.sms_log
  add column if not exists pt_session_id uuid references public.pt_sessions(id) on delete set null;
alter table public.sms_log drop constraint if exists sms_log_kind_check;
alter table public.sms_log
  add constraint sms_log_kind_check
  check (kind = any (array['manual'::text, 'reminder'::text, 'automation'::text, 'bulk'::text, 'session'::text]));
create index if not exists sms_log_pt_session_idx on public.sms_log (pt_session_id) where pt_session_id is not null;

-- 4) Private calendar feed ------------------------------------------------------
alter table public.clients add column if not exists calendar_feed_token text;
create unique index if not exists clients_calendar_feed_token_key
  on public.clients (calendar_feed_token) where calendar_feed_token is not null;

notify pgrst, 'reload schema';
