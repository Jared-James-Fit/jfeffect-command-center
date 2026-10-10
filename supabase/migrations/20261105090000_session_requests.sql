-- Session requests: a client asks for a session / call from their Schedule; it lands in
-- their coach chat as a card, and nothing is booked until the coach approves it.
--   * Clients never write here directly: requestSession / withdrawSessionRequest
--     (schedule-requests.functions.ts) insert and update with the service role.
--   * Approving books a normal pt_sessions row through the coach's booking dialog (so
--     credits, clash checks, Google sync and reminders all behave as usual), then
--     answerSessionRequest links it here and tells the client.

create table if not exists public.session_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  request_type text not null check (request_type in ('training', 'call', 'assessment', 'other')),
  preferred_date date not null,
  -- null = "any time that day"
  preferred_time time,
  duration_minutes integer not null default 60 check (duration_minutes between 15 and 240),
  timezone text,
  alt_times text check (alt_times is null or char_length(alt_times) <= 300),
  note text check (note is null or char_length(note) <= 1000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'withdrawn')),
  pt_session_id uuid references public.pt_sessions(id) on delete set null,
  message_id uuid,
  decline_reason text check (decline_reason is null or char_length(decline_reason) <= 500),
  requested_by uuid,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists session_requests_client_idx on public.session_requests (client_id, created_at desc);
create index if not exists session_requests_pending_idx on public.session_requests (created_at) where status = 'pending';

alter table public.session_requests enable row level security;
grant select on public.session_requests to authenticated;
grant all on public.session_requests to service_role;

drop policy if exists "Admin read session requests" on public.session_requests;
create policy "Admin read session requests" on public.session_requests
  for select to authenticated using (public.has_role(auth.uid(), 'admin'::app_role));

drop policy if exists "Coach read assigned session requests" on public.session_requests;
create policy "Coach read assigned session requests" on public.session_requests
  for select to authenticated using (public.is_assigned_coach(client_id));

drop policy if exists "Client read own session requests" on public.session_requests;
create policy "Client read own session requests" on public.session_requests
  for select to authenticated using (exists (
    select 1 from public.clients c where c.id = session_requests.client_id and c.user_id = auth.uid()
  ));

-- AGENTS.md: the client calendar reads this, so the linked staff login gets the same view.
drop policy if exists "Linked login reads own session_requests" on public.session_requests;
create policy "Linked login reads own session_requests" on public.session_requests
  for select to authenticated using (client_id = (select public.linked_client_id()));

do $$
begin
  alter publication supabase_realtime add table public.session_requests;
exception when duplicate_object then null;
end $$;
