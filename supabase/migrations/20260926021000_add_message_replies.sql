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
