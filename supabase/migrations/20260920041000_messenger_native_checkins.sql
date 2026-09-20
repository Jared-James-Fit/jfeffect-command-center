-- Messenger-native coaching check-ins.
-- Replaces client-facing form navigation for the recurring Weekly Check-In /
-- Nutrition Review with compact in-thread requests and structured coach recaps.

create table if not exists public.messenger_checkins (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  occurrence_id uuid null references public.client_task_occurrences(id) on delete set null,
  request_message_id uuid null references public.messages(id) on delete set null,
  task_type text not null check (task_type in ('weekly_checkin','nutrition_review')),
  status text not null default 'pending' check (status in ('pending','completed')),
  answers jsonb not null default '{}'::jsonb,
  context_snapshot jsonb not null default '{}'::jsonb,
  ai_analysis jsonb null,
  ai_status text not null default 'pending' check (ai_status in ('pending','ready','failed')),
  ai_error text null,
  submitted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists messenger_checkins_occurrence_unique
  on public.messenger_checkins(occurrence_id)
  where occurrence_id is not null;

create index if not exists messenger_checkins_client_created_idx
  on public.messenger_checkins(client_id, created_at desc);

alter table public.messenger_checkins enable row level security;

drop policy if exists "Admin manage messenger_checkins" on public.messenger_checkins;
create policy "Admin manage messenger_checkins"
  on public.messenger_checkins for all
  using (public.has_role(auth.uid(), 'admin'::public.app_role))
  with check (public.has_role(auth.uid(), 'admin'::public.app_role));

drop policy if exists "Coach manage assigned messenger_checkins" on public.messenger_checkins;
create policy "Coach manage assigned messenger_checkins"
  on public.messenger_checkins for all
  using (public.is_assigned_coach(client_id))
  with check (public.is_assigned_coach(client_id));

drop policy if exists "Client read own messenger_checkins" on public.messenger_checkins;
create policy "Client read own messenger_checkins"
  on public.messenger_checkins for select
  using (
    exists (
      select 1 from public.clients c
      where c.id = messenger_checkins.client_id
        and c.user_id = auth.uid()
    )
  );

-- Client writes go through authenticated server functions so a client cannot
-- alter AI analysis, another client's answers, or task linkage directly.

comment on table public.messenger_checkins is
  'Messenger-native recurring coaching check-ins, answers, app context and coach-facing AI recap.';
