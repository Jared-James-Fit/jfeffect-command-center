-- Cleo's chats: separate conversations instead of one endless thread.
--
--   * summer_chats      one row per conversation (title from its first
--                       question, a preview of the last answer, last activity)
--   * summer_messages   now belong to a chat (chat_id)
--
-- "New chat" starts a fresh one and keeps the old one in History (it used to
-- delete everything). Cleo only reads the chat she's in, so old topics don't
-- leak into new answers. Chats with no activity for a year are cleared by a
-- daily job (prune_cleo_chats); each person can also delete any chat.

create table if not exists public.summer_chats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null default 'New chat' check (char_length(title) <= 120),
  preview text,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create index if not exists summer_chats_user_idx on public.summer_chats (user_id, last_message_at desc);
create index if not exists summer_chats_last_idx on public.summer_chats (last_message_at);

alter table public.summer_messages add column if not exists chat_id uuid references public.summer_chats (id) on delete cascade;
create index if not exists summer_messages_chat_idx on public.summer_messages (chat_id, created_at);

alter table public.summer_chats enable row level security;
grant select, insert, update, delete on public.summer_chats to authenticated;
grant all on public.summer_chats to service_role;

-- Same people as summer_messages: an admin, or the view-only (finance) login,
-- each only their own chats.
drop policy if exists "admin own summer chats" on public.summer_chats;
create policy "admin own summer chats" on public.summer_chats
  for all to authenticated
  using (user_id = (select auth.uid()) and (select public.has_role((select auth.uid()), 'admin'::public.app_role)))
  with check (user_id = (select auth.uid()) and (select public.has_role((select auth.uid()), 'admin'::public.app_role)));

drop policy if exists "view-only own summer chats" on public.summer_chats;
create policy "view-only own summer chats" on public.summer_chats
  for all to authenticated
  using (user_id = (select auth.uid()) and (select public.is_admin_viewer()))
  with check (user_id = (select auth.uid()) and (select public.is_admin_viewer()));

-- A new message moves its chat to the top and refreshes the History preview.
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
  update public.summer_chats c
     set last_message_at = greatest(c.last_message_at, new.created_at),
         preview = case when new.role = 'assistant' then left(regexp_replace(new.content, '\s+', ' ', 'g'), 160) else c.preview end
   where c.id = new.chat_id;
  return new;
end;
$$;

drop trigger if exists summer_chat_touch on public.summer_messages;
create trigger summer_chat_touch
  after insert on public.summer_messages
  for each row execute function public.summer_chat_touch();

-- A chat's name from its first question (same rule as chatTitle in
-- src/lib/cleo-chats.ts): no "Hey Cleo,", cut at a word near 60 characters.
create or replace function public.cleo_chat_title(q text)
returns text
language sql
immutable
set search_path = public
as $$
  with t as (
    select btrim(regexp_replace(regexp_replace(coalesce(q, ''), '\s+', ' ', 'g'), '^((hey|hi|hello|yo|ok|okay|so)[\s,!.]+)?(cleo|summer)\M[\s,!.:-]*', '', 'i')) as s
  ), c as (
    select case
      when length(s) <= 60 then s
      else regexp_replace(
             case when position(' ' in reverse(left(s, 60))) between 1 and 29
                  then left(s, 60 - position(' ' in reverse(left(s, 60))))
                  else left(s, 60) end,
             '[\s,.;:!?-]+$', '') || '…'
    end as s
    from t
  )
  select case when s = '' then 'New chat' else upper(left(s, 1)) || substr(s, 2) end from c
$$;

-- Existing messages: split each person's thread into chats wherever there was
-- a gap of more than 6 hours (the same rule the app uses for a fresh chat).
do $$
declare
  g record;
  new_id uuid;
begin
  for g in
    with ordered as (
      select m.id, m.user_id, m.role, m.content, m.created_at,
             case when lag(m.created_at) over (partition by m.user_id order by m.created_at) is null
                    or m.created_at - lag(m.created_at) over (partition by m.user_id order by m.created_at) > interval '6 hours'
                  then 1 else 0 end as starts
        from public.summer_messages m
       where m.chat_id is null
    ), grouped as (
      select o.*, sum(o.starts) over (partition by o.user_id order by o.created_at, o.id) as grp
        from ordered o
    )
    select user_id, grp,
           min(created_at) as first_at,
           max(created_at) as last_at,
           (array_agg(content order by created_at) filter (where role = 'user'))[1] as first_question,
           (array_agg(content order by created_at desc) filter (where role = 'assistant'))[1] as last_answer,
           array_agg(id) as ids
      from grouped
     group by user_id, grp
  loop
    insert into public.summer_chats (user_id, title, preview, created_at, last_message_at)
    values (
      g.user_id,
      public.cleo_chat_title(g.first_question),
      left(regexp_replace(coalesce(g.last_answer, ''), '\s+', ' ', 'g'), 160),
      g.first_at,
      g.last_at
    )
    returning id into new_id;
    update public.summer_messages set chat_id = new_id where id = any (g.ids);
  end loop;
end $$;

-- Keep a year: chats with no activity for 365 days go (their messages with
-- them). Action cards and program history keep their own records.
create or replace function public.prune_cleo_chats()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  delete from public.summer_chats where last_message_at < now() - interval '365 days';
  get diagnostics n = row_count;
  delete from public.summer_messages where chat_id is null and created_at < now() - interval '365 days';
  return n;
end;
$$;

revoke all on function public.prune_cleo_chats() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'cleo-chat-retention';
  perform cron.schedule('cleo-chat-retention', '17 9 * * *', 'select public.prune_cleo_chats();');
exception when undefined_table or invalid_schema_name or undefined_function then
  raise notice 'pg_cron not available; cleo-chat-retention not scheduled';
end $$;

select public.rls_evaluate_once('summer_chats');
