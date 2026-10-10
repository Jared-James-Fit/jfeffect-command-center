-- Cleo's actions: things she offers to do, and requests waiting on the owner.
--
-- Cleo never changes anything on her own. When asked to do something she
-- proposes it (one row here, status 'proposed') and the person taps Confirm.
-- Then it runs with that person's own session, so their own permissions and
-- RLS decide what happens, exactly as if they'd done it in the app.
--
-- When the person isn't allowed to do it themselves (the finance login and
-- anything outside its role permissions), Confirm becomes "Ask <owner>": the
-- row waits as 'awaiting_approval' until the business owner approves, and
-- then runs with the owner's session. Nobody's session ever does more than
-- that person could do in the app.
--
-- Rows are written only by server code (service role) after it has checked
-- the caller, so a status can't be set from the browser. The requester and
-- the business owner can read them.

create table if not exists public.cleo_actions (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null references auth.users (id) on delete cascade,
  -- The Cleo reply that offered it (kept when the chat is cleared, for history).
  message_id uuid references public.summer_messages (id) on delete set null,
  kind text not null,
  params jsonb not null default '{}'::jsonb,
  -- What will happen, in words, shown on the card and to the approver.
  summary text not null,
  -- What doing it takes: a role permission ("tasks.manage") or "admin".
  permission text not null,
  status text not null default 'proposed'
    check (status in ('proposed', 'cancelled', 'awaiting_approval', 'declined', 'running', 'done', 'failed')),
  result text,
  error text,
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  done_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cleo_actions_requested_by_idx on public.cleo_actions (requested_by, created_at desc);
create index if not exists cleo_actions_message_idx on public.cleo_actions (message_id);
create index if not exists cleo_actions_awaiting_idx on public.cleo_actions (created_at) where status = 'awaiting_approval';

alter table public.cleo_actions enable row level security;
grant select on public.cleo_actions to authenticated;
grant all on public.cleo_actions to service_role;

drop policy if exists "cleo actions: requester and owner read" on public.cleo_actions;
create policy "cleo actions: requester and owner read" on public.cleo_actions
  for select to authenticated
  using (requested_by = auth.uid() or public.is_business_owner(auth.uid()));
