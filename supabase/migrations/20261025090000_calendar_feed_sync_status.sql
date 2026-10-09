-- Calendar sync status for the client's Setup step.
--
-- The private calendar feed (/api/public/calendar-feed) records when a
-- calendar app (Google, Apple, Outlook) last pulled it. That's what turns the
-- Setup card green: proof the client's phone calendar is actually subscribed,
-- not just that a button was tapped. Browser opens of the link don't count.
--
-- Kept off `clients` on purpose: calendar apps poll every few hours, and
-- writing there would bump clients.updated_at and run its guard triggers.
create table if not exists public.client_calendar_sync (
  client_id uuid primary key references public.clients(id) on delete cascade,
  last_fetch_at timestamptz not null,
  app text not null,
  first_fetch_at timestamptz not null default now(),
  fetch_count integer not null default 1
);

alter table public.client_calendar_sync enable row level security;

drop policy if exists "Admin read calendar sync" on public.client_calendar_sync;
create policy "Admin read calendar sync"
  on public.client_calendar_sync for select
  using (public.has_role(auth.uid(), 'admin'::app_role));

drop policy if exists "Coach read assigned calendar sync" on public.client_calendar_sync;
create policy "Coach read assigned calendar sync"
  on public.client_calendar_sync for select
  using (public.is_assigned_coach(client_id));

drop policy if exists "Client read own calendar sync" on public.client_calendar_sync;
create policy "Client read own calendar sync"
  on public.client_calendar_sync for select
  using (exists (
    select 1 from public.clients c
     where c.id = client_calendar_sync.client_id
       and c.user_id = auth.uid()
  ));
-- Writes: service role only (the feed route).

-- Resetting the feed link starts over: the old subscription stops working.
create or replace function public.tg_clients_feed_token_reset_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.calendar_feed_token is distinct from old.calendar_feed_token and old.calendar_feed_token is not null then
    delete from public.client_calendar_sync where client_id = new.id;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_clients_feed_token_reset_sync on public.clients;
create trigger trg_clients_feed_token_reset_sync
  after update of calendar_feed_token on public.clients
  for each row execute function public.tg_clients_feed_token_reset_sync();

notify pgrst, 'reload schema';
