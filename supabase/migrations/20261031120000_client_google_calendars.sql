-- "Connect Google Calendar" for clients.
--
-- A client (or a staff login linked to their client account) signs in with
-- Google once. The app creates a "JF Effect" calendar in their Google account
-- (scope calendar.app.created: it can only see and change calendars it made,
-- never their other events) and keeps it in step with the same sessions,
-- calls, workouts and events as their private calendar feed.
--
-- Written only by the server (src/lib/client-gcal.server.ts): the OAuth
-- callback on connect, the 5-minute schedule tick for changes, and
-- disconnect. Tokens live here, so there are no client-facing policies; the
-- app reads the status through a server function.

create table if not exists public.client_google_calendars (
  client_id uuid primary key references public.clients(id) on delete cascade,
  connected_by uuid not null references auth.users(id) on delete cascade,
  google_email text,
  refresh_token text not null,
  access_token text,
  token_expires_at timestamptz,
  calendar_id text,
  status text not null default 'connected',
  last_synced_at timestamptz,
  last_checked_at timestamptz,
  last_sync_hash text,
  last_error text,
  event_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_google_calendars_status_check check (status in ('connected', 'error', 'revoked'))
);

create index if not exists client_google_calendars_due_idx
  on public.client_google_calendars (last_checked_at nulls first)
  where status <> 'revoked';

alter table public.client_google_calendars enable row level security;
-- No policies on purpose: holds Google tokens. Service role only.

comment on table public.client_google_calendars is
  'Client Google Calendar connections (Connect Google Calendar). One "JF Effect" calendar per client in their own Google account, kept in step every 5 minutes. Service role only.';

-- Every 5 minutes, a minute after the schedule tick. Its own job (not part of
-- the schedule tick) because Google writes can take longer than pg_net's
-- default 5-second wait. Checks the least recently checked connections first
-- and only talks to Google when something changed.
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'client-google-calendars-tick';
  perform cron.schedule(
    'client-google-calendars-tick',
    '1-59/5 * * * *',
    $cmd$
    select net.http_post(
      url := 'https://project--5f1f340c-5afa-4262-90c8-1f9406568c6c.lovable.app/api/public/hooks/client-calendars-tick',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-hook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_hook_secret' limit 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    ) as request_id;
    $cmd$
  );
exception
  when undefined_table or undefined_function then
    null;
end
$$;
