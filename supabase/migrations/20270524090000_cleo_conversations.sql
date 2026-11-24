-- Cleo's conversations, made permanent and organised (Nov 24 2026).
--
-- What changes:
--   * summer_chats      a conversation knows who it's about (client_id, null =
--                       a general conversation), what it's about (category),
--                       whether it's pinned or archived, where its title came
--                       from, and a rolling summary of its older messages so the
--                       model gets recent messages + a summary instead of the
--                       whole lifetime of the conversation.
--   * summer_messages   an answer is written in the background: the assistant
--                       row is saved at once as 'pending', the worker claims it
--                       ('running', with a short progress line) and fills it
--                       ('done', 'failed' or 'stopped'), so leaving the page,
--                       refreshing or closing the app never loses a question or
--                       stops an answer. Edit & resend and Regenerate keep the
--                       replaced messages (superseded_at), never delete them.
--   * summer_profiles   archive_after_days: how long a conversation sits quiet
--                       before it's archived (30 by default, 0 = never).
--   * Archiving never deletes. The year-long retention job that deleted quiet
--                       chats is gone: a conversation goes only when its owner
--                       deletes it (or their account is purged).
--   * cleo_turn_dispatch  hands one answer to the worker through pg_net with the
--                       asker's own session token, so the worker reads with their
--                       login (RLS decides, exactly as in the app) and pg_net,
--                       not the person's phone, holds the request open.

-- 1. Conversations -----------------------------------------------------------

alter table public.summer_chats
  add column if not exists client_id uuid references public.clients (id) on delete set null,
  add column if not exists category text not null default 'general',
  add column if not exists pinned_at timestamptz,
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by text,
  add column if not exists title_source text not null default 'question',
  add column if not exists summary text,
  add column if not exists summary_through timestamptz,
  add column if not exists summary_count integer not null default 0,
  add column if not exists updated_at timestamptz not null default now();

alter table public.summer_chats drop constraint if exists summer_chats_category_check;
alter table public.summer_chats add constraint summer_chats_category_check
  check (category in ('general', 'workout', 'nutrition', 'cardio', 'recovery', 'analytics', 'checkins', 'program'));
alter table public.summer_chats drop constraint if exists summer_chats_archived_by_check;
alter table public.summer_chats add constraint summer_chats_archived_by_check
  check (archived_by is null or archived_by in ('auto', 'person'));
alter table public.summer_chats drop constraint if exists summer_chats_title_source_check;
alter table public.summer_chats add constraint summer_chats_title_source_check
  check (title_source in ('question', 'auto', 'person'));
alter table public.summer_chats drop constraint if exists summer_chats_summary_len;
alter table public.summer_chats add constraint summer_chats_summary_len
  check (summary is null or char_length(summary) <= 8000);

create index if not exists summer_chats_active_idx on public.summer_chats (user_id, last_message_at desc) where archived_at is null;
create index if not exists summer_chats_client_idx on public.summer_chats (user_id, client_id, last_message_at desc);
create index if not exists summer_chats_archived_idx on public.summer_chats (user_id, archived_at desc) where archived_at is not null;

-- 2. Messages ----------------------------------------------------------------

alter table public.summer_messages
  add column if not exists status text not null default 'done',
  add column if not exists progress text,
  add column if not exists error text,
  add column if not exists reply_to uuid references public.summer_messages (id) on delete set null,
  add column if not exists superseded_at timestamptz,
  add column if not exists stop_requested_at timestamptz,
  add column if not exists turn jsonb,
  add column if not exists attempts integer not null default 0,
  add column if not exists started_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

alter table public.summer_messages drop constraint if exists summer_messages_status_check;
alter table public.summer_messages add constraint summer_messages_status_check
  check (status in ('pending', 'running', 'done', 'failed', 'stopped'));

create index if not exists summer_messages_open_turns_idx on public.summer_messages (chat_id) where status in ('pending', 'running');
-- one question per send: a double tap or a retry after a dropped connection is the same question
create unique index if not exists summer_messages_turn_key_idx on public.summer_messages (user_id, ((turn ->> 'key'))) where role = 'user' and turn ? 'key';

create or replace function public.summer_messages_touch_updated()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists summer_messages_touch_updated on public.summer_messages;
create trigger summer_messages_touch_updated
  before update on public.summer_messages
  for each row execute function public.summer_messages_touch_updated();

-- 3. Settings: how long before a quiet conversation is archived -----------------

alter table public.summer_profiles
  add column if not exists archive_after_days integer not null default 30;
alter table public.summer_profiles drop constraint if exists summer_profiles_archive_after_days_check;
alter table public.summer_profiles add constraint summer_profiles_archive_after_days_check
  check (archive_after_days = 0 or archive_after_days between 7 and 365);

-- 4. A message keeps its conversation current ----------------------------------
--    A question moves the conversation to the top (and brings it back from the
--    archive: a resumed conversation is an active one); an answer that finishes
--    refreshes the preview. A pending placeholder never blanks the preview.

create or replace function public.summer_chat_touch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.chat_id is null then
    return new;
  end if;
  if tg_op = 'INSERT' and new.role = 'user' then
    update public.summer_chats c
       set last_message_at = greatest(c.last_message_at, new.created_at),
           archived_at = null,
           archived_by = null,
           updated_at = now()
     where c.id = new.chat_id;
  elsif new.role = 'assistant' and new.status = 'done' and new.superseded_at is null
        and (tg_op = 'INSERT' or old.status is distinct from 'done') then
    update public.summer_chats c
       set last_message_at = greatest(c.last_message_at, new.updated_at),
           preview = left(regexp_replace(new.content, '\s+', ' ', 'g'), 160),
           updated_at = now()
     where c.id = new.chat_id;
  end if;
  return new;
end;
$$;

-- create or replace: no drop, so it never waits on an exclusive lock of a busy table
create or replace trigger summer_chat_touch
  after insert or update of status on public.summer_messages
  for each row execute function public.summer_chat_touch();

-- 5. Archiving never deletes ----------------------------------------------------
--    The daily job that deleted chats quiet for a year is retired: archived
--    conversations stay readable, searchable and resumable until their owner
--    deletes them. The function stays (callers still exist) and deletes nothing.

create or replace function public.prune_cleo_chats()
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  return 0;
end;
$$;
revoke all on function public.prune_cleo_chats() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'cleo-chat-retention';
exception when undefined_table or invalid_schema_name or undefined_function then
  raise notice 'pg_cron not available';
end $$;

-- 6. Auto-archive -------------------------------------------------------------
--    A conversation with no activity for the owner's archive_after_days (30
--    unless they changed it; 0 = never) is archived, except one that's pinned,
--    has an answer still being written, or has a card waiting (a proposal from
--    the last day, a request waiting on the owner's approval, or one running).
--    Turns cut off for over an hour are settled as failed first, so a lost
--    worker never holds a conversation open forever.

create or replace function public.cleo_chats_auto_archive()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  update public.summer_messages
     set status = 'failed',
         error = coalesce(error, 'Cleo was cut off before answering. Tap Retry.'),
         progress = null
   where status in ('pending', 'running')
     and updated_at < now() - interval '1 hour';

  update public.summer_chats c
     set archived_at = now(),
         archived_by = 'auto',
         updated_at = now()
   where c.archived_at is null
     and c.pinned_at is null
     and coalesce((select p.archive_after_days from public.summer_profiles p where p.user_id = c.user_id), 30) > 0
     and c.last_message_at < now() - make_interval(days => coalesce((select p.archive_after_days from public.summer_profiles p where p.user_id = c.user_id), 30))
     and not exists (
       select 1 from public.summer_messages m
        where m.chat_id = c.id and m.status in ('pending', 'running')
     )
     and not exists (
       select 1
         from public.cleo_actions a
         join public.summer_messages m on m.id = a.message_id
        where m.chat_id = c.id
          and (a.status in ('awaiting_approval', 'running')
               or (a.status = 'proposed' and a.created_at > now() - interval '1 day'))
     );
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.cleo_chats_auto_archive() from public, anon, authenticated;
grant execute on function public.cleo_chats_auto_archive() to service_role;

do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'cleo-chat-archive';
  perform cron.schedule('cleo-chat-archive', '23 9 * * *', 'select public.cleo_chats_auto_archive();');
exception when undefined_table or invalid_schema_name or undefined_function then
  raise notice 'pg_cron not available; cleo-chat-archive not scheduled';
end $$;

-- 7. Handing an answer to the worker --------------------------------------------
--    Called by the server (service role only) right after the question and its
--    pending answer are saved. The asker's session token rides in a header to
--    the cleo-turn hook, which checks it, refuses a token that isn't the
--    message's owner, and answers with that login. pg_net keeps the token only
--    in its queue until the request goes out (a second or two); nothing else
--    stores it, and it expires within the hour like any session token.

create or replace function public.cleo_turn_dispatch(_message_id uuid, _token text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if _message_id is null or coalesce(_token, '') = '' then
    return false;
  end if;
  perform net.http_post(
    url := 'https://project--5f1f340c-5afa-4262-90c8-1f9406568c6c.lovable.app/api/public/hooks/cleo-turn',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-hook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_hook_secret' limit 1),
      'x-cleo-session', _token
    ),
    body := jsonb_build_object('messageId', _message_id),
    timeout_milliseconds := 300000
  );
  return true;
end;
$$;

revoke all on function public.cleo_turn_dispatch(uuid, text) from public, anon, authenticated;
grant execute on function public.cleo_turn_dispatch(uuid, text) to service_role;

select public.rls_evaluate_once('summer_chats');
