-- Add first-class direct-message replies.
-- The FK keeps the relationship queryable while reply_preview preserves a fast,
-- stable quote even if the original message is later edited or deleted.

alter table public.messages
  add column if not exists reply_to_message_id uuid null references public.messages(id) on delete set null;

alter table public.messages
  add column if not exists reply_preview jsonb null;

create index if not exists idx_messages_reply_to_message_id
  on public.messages(reply_to_message_id)
  where reply_to_message_id is not null;

comment on column public.messages.reply_to_message_id is
  'Optional message this message is replying to.';

comment on column public.messages.reply_preview is
  'Small immutable snapshot used to render the quoted message preview quickly.';


create or replace function public.normalize_message_reply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_message public.messages%rowtype;
  first_attachment jsonb;
begin
  if new.reply_to_message_id is null then
    new.reply_preview := null;
    return new;
  end if;

  select *
  into target_message
  from public.messages
  where id = new.reply_to_message_id;

  if target_message.id is null then
    raise exception 'Reply target does not exist';
  end if;

  if target_message.client_id <> new.client_id then
    raise exception 'Reply target belongs to a different conversation';
  end if;

  if target_message.is_internal_note and not new.is_internal_note then
    raise exception 'Internal notes cannot be quoted into a client-visible message';
  end if;

  if jsonb_typeof(target_message.attachments) = 'array'
     and jsonb_array_length(target_message.attachments) > 0 then
    first_attachment := target_message.attachments -> 0;
  end if;

  new.reply_preview := jsonb_build_object(
    'sender_role', target_message.sender_role,
    'body', left(coalesce(target_message.body, ''), 260),
    'attachment_type', first_attachment ->> 'type',
    'attachment_name', first_attachment ->> 'name',
    'is_internal_note', target_message.is_internal_note
  );

  return new;
end;
$$;

drop trigger if exists trg_normalize_message_reply on public.messages;
create trigger trg_normalize_message_reply
before insert or update of reply_to_message_id, client_id, is_internal_note
on public.messages
for each row
execute function public.normalize_message_reply();
