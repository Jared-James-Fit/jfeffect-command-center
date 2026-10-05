-- Admin "silent delete": an admin can remove any message in any chat (1:1 or
-- group). The message is removed outright, so clients and coaches see no
-- "This message was deleted" placeholder and no timestamp. A copy goes to
-- message_deletions, which only admins can read (who deleted it, when, and
-- what it said).

create table if not exists public.message_deletions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null,
  chat text not null check (chat in ('dm', 'group')),
  client_id uuid,
  group_id uuid,
  sender_id uuid,
  sender_role text,
  body text,
  attachments jsonb,
  original_created_at timestamptz,
  deleted_by uuid,
  deleted_at timestamptz not null default now()
);

create index if not exists message_deletions_client_idx on public.message_deletions (client_id, deleted_at desc);
create index if not exists message_deletions_group_idx on public.message_deletions (group_id, deleted_at desc);

alter table public.message_deletions enable row level security;

drop policy if exists "Admins read message deletions" on public.message_deletions;
create policy "Admins read message deletions" on public.message_deletions
  for select using (public.has_role(auth.uid(), 'admin'::public.app_role));

-- 1:1 chats -----------------------------------------------------------------
create or replace function public.admin_delete_messages(_ids uuid[])
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  n integer;
  affected uuid[];
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'Only admins can delete messages this way' using errcode = '42501';
  end if;

  select array_agg(distinct client_id) into affected from public.messages where id = any(_ids);

  insert into public.message_deletions
    (message_id, chat, client_id, sender_id, sender_role, body, attachments, original_created_at, deleted_by)
  select id, 'dm', client_id, sender_id, sender_role, body, attachments, created_at, auth.uid()
    from public.messages where id = any(_ids);

  -- Replies quoting a removed message lose the quote (FK is ON DELETE SET
  -- NULL and normalize_message_reply clears reply_preview).
  delete from public.messages where id = any(_ids);
  get diagnostics n = row_count;

  -- Inbox ordering follows what's actually left in the thread.
  update public.conversation_state cs
     set last_message_at = coalesce(
           (select max(m.created_at) from public.messages m
             where m.client_id = cs.client_id and not m.is_internal_note),
           cs.last_message_at),
         updated_at = now()
   where cs.client_id = any(coalesce(affected, '{}'));

  return n;
end;
$$;

revoke all on function public.admin_delete_messages(uuid[]) from public, anon;
grant execute on function public.admin_delete_messages(uuid[]) to authenticated;

-- Group chats ---------------------------------------------------------------
create or replace function public.admin_delete_group_messages(_ids uuid[])
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  n integer;
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'Only admins can delete messages this way' using errcode = '42501';
  end if;

  insert into public.message_deletions
    (message_id, chat, group_id, sender_id, sender_role, body, attachments, original_created_at, deleted_by)
  select id, 'group', group_id, sender_id, sender_role, body, attachments, created_at, auth.uid()
    from public.group_messages where id = any(_ids);

  delete from public.group_messages where id = any(_ids);
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.admin_delete_group_messages(uuid[]) from public, anon;
grant execute on function public.admin_delete_group_messages(uuid[]) to authenticated;
