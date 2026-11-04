-- Coaching leads: every new coaching application gets the coach's read on
-- the person and a text to send them (the first one now, a follow-up if they
-- go quiet), written by the AI in the background (coaching-leads.server.ts)
-- and shown on the Leads screen, Home and the pinned Messages row.
--
-- 1. coaching_lead_replies: one row per application. Written only by the
--    server (the lead-replies-tick hook and the coach's Write again);
--    readable by the admin (and the read-only admin viewer).
-- 2. A new (non-test) application queues its row (coaching_lead_replies_queue).
-- 3. Queuing calls the hook at once through pg_net (coaching_lead_replies_run),
--    and pg_cron every 5 minutes calls it again while one waits, was cut off
--    or failed (up to 3 tries).
-- 4. Applications from the last 7 days get theirs now (Devin Buth's, Nov 3).

create table if not exists public.coaching_lead_replies (
  application_id uuid primary key references public.coaching_applications(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'generating', 'ready', 'error')),
  brief jsonb,
  reply text,
  follow_up text,
  instructions text,
  model text,
  error text,
  attempts integer not null default 0,
  generated_at timestamptz,
  copied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.coaching_lead_replies enable row level security;
revoke all on public.coaching_lead_replies from anon;
revoke insert, update, delete on public.coaching_lead_replies from authenticated;
grant select on public.coaching_lead_replies to authenticated;

drop policy if exists "Admins read lead replies" on public.coaching_lead_replies;
create policy "Admins read lead replies" on public.coaching_lead_replies
  for select to authenticated
  using ((select public.has_role((select auth.uid()), 'admin')) or (select public.is_admin_viewer()));

-- 2. A new application queues its reply.
create or replace function public.coaching_lead_replies_queue()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.is_test, false) = false then
    insert into public.coaching_lead_replies (application_id) values (new.id)
    on conflict (application_id) do nothing;
  end if;
  return new;
exception when others then
  -- Never fail the application itself; the coach can still tap Write.
  return new;
end;
$$;

revoke all on function public.coaching_lead_replies_queue() from public, anon, authenticated;

drop trigger if exists coaching_lead_replies_queue on public.coaching_applications;
create trigger coaching_lead_replies_queue
  after insert on public.coaching_applications
  for each row execute function public.coaching_lead_replies_queue();

-- 3. Queued → the hook writes it now.
create or replace function public.coaching_lead_replies_run()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'pending'
     and (tg_op = 'INSERT' or old.status is distinct from 'pending' or old.updated_at is distinct from new.updated_at) then
    begin
      perform net.http_post(
        url := 'https://project--5f1f340c-5afa-4262-90c8-1f9406568c6c.lovable.app/api/public/hooks/lead-replies-tick',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-hook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_hook_secret' limit 1)
        ),
        body := jsonb_build_object('applicationId', new.application_id),
        timeout_milliseconds := 120000
      );
    exception when others then
      -- Never fail the write that queued it; the 5-minute job picks it up.
      null;
    end;
  end if;
  return new;
end;
$$;

revoke all on function public.coaching_lead_replies_run() from public, anon, authenticated;

drop trigger if exists coaching_lead_replies_run on public.coaching_lead_replies;
create trigger coaching_lead_replies_run
  after insert or update of status, updated_at on public.coaching_lead_replies
  for each row execute function public.coaching_lead_replies_run();

do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'lead-replies-tick';
  perform cron.schedule(
    'lead-replies-tick',
    '*/5 * * * *',
    $cmd$
    select net.http_post(
      url := 'https://project--5f1f340c-5afa-4262-90c8-1f9406568c6c.lovable.app/api/public/hooks/lead-replies-tick',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-hook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_hook_secret' limit 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    ) as request_id
    where exists (
      select 1 from public.coaching_lead_replies
      where updated_at > now() - interval '2 days'
        and (status = 'pending'
          or (status = 'generating' and updated_at < now() - interval '10 minutes')
          or (status = 'error' and attempts < 3 and updated_at < now() - interval '10 minutes'))
    );
    $cmd$
  );
exception
  when undefined_table or undefined_function then
    null;
end
$$;

-- 4. This week's applications get theirs now.
insert into public.coaching_lead_replies (application_id)
select id from public.coaching_applications
where coalesce(is_test, false) = false
  and created_at > now() - interval '7 days'
on conflict (application_id) do nothing;
