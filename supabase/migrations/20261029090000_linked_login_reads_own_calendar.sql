-- A team member's login that the owner linked to their own client account
-- (community_profiles.same_person_as, set only by the admin-only
-- linkTeamMemberClient server function) can READ that client account's
-- calendar data, the same rows the client login reads. Without this, the
-- staff home's "My calendar" card (Fionna's finance login) came back empty for
-- the person themselves, because every client-read rule checks
-- clients.user_id = auth.uid() and the staff login is a different user.
--
-- Read-only (SELECT policies only), and only the one linked account's rows,
-- mirroring each existing "client reads own" rule's visibility conditions.

create or replace function public.linked_client_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.id
    from public.community_profiles cp
    join public.clients c on c.user_id = cp.same_person_as
   where cp.user_id = auth.uid()
     and cp.same_person_as is not null
   limit 1
$$;
revoke all on function public.linked_client_id() from public, anon;
grant execute on function public.linked_client_id() to authenticated;
comment on function public.linked_client_id() is
  'Client account linked to the signed-in staff login (same person), or null. Used by read-only "Linked login reads own" policies.';

-- clients
drop policy if exists "Linked login reads own client" on public.clients;
create policy "Linked login reads own client" on public.clients
  for select to authenticated using (id = (select public.linked_client_id()));

-- 1:1 sessions and calls
drop policy if exists "Linked login reads own pt_sessions" on public.pt_sessions;
create policy "Linked login reads own pt_sessions" on public.pt_sessions
  for select to authenticated using (visible_to_client and client_id = (select public.linked_client_id()));

drop policy if exists "Linked login reads own appointments" on public.appointments;
create policy "Linked login reads own appointments" on public.appointments
  for select to authenticated using (client_id = (select public.linked_client_id()));

-- key dates and events
drop policy if exists "Linked login reads own important_dates" on public.important_dates;
create policy "Linked login reads own important_dates" on public.important_dates
  for select to authenticated using (visible_to_client and client_id = (select public.linked_client_id()));

drop policy if exists "Linked login reads own event_assignments" on public.event_assignments;
create policy "Linked login reads own event_assignments" on public.event_assignments
  for select to authenticated using (client_id = (select public.linked_client_id()));

drop policy if exists "Linked login reads own events" on public.events;
create policy "Linked login reads own events" on public.events
  for select to authenticated using (
    status = any (array['Active'::event_status, 'Completed'::event_status])
    and (select public.linked_client_id()) is not null
    and (
      exists (
        select 1 from public.event_assignments ea
         where ea.event_id = events.id and ea.client_id = (select public.linked_client_id())
      )
      or (
        audience_scope = 'all_coaching'::event_audience_scope
        and exists (
          select 1 from public.clients c
           where c.id = (select public.linked_client_id()) and c.archived = false and c.status = 'Active'
        )
      )
    )
  );

-- program and workouts
drop policy if exists "Linked login reads own pl_blocks" on public.pl_blocks;
create policy "Linked login reads own pl_blocks" on public.pl_blocks
  for select to authenticated using (client_visible and client_id = (select public.linked_client_id()));

drop policy if exists "Linked login reads own pl_weeks" on public.pl_weeks;
create policy "Linked login reads own pl_weeks" on public.pl_weeks
  for select to authenticated using (
    exists (
      select 1 from public.pl_blocks b
       where b.id = pl_weeks.block_id and b.client_visible and b.client_id = (select public.linked_client_id())
    )
  );

drop policy if exists "Linked login reads own pl_days" on public.pl_days;
create policy "Linked login reads own pl_days" on public.pl_days
  for select to authenticated using (
    exists (
      select 1 from public.pl_weeks w join public.pl_blocks b on b.id = w.block_id
       where w.id = pl_days.week_id and b.client_visible and b.client_id = (select public.linked_client_id())
    )
  );

drop policy if exists "Linked login reads own pl_exercise_rows" on public.pl_exercise_rows;
create policy "Linked login reads own pl_exercise_rows" on public.pl_exercise_rows
  for select to authenticated using (
    exists (
      select 1 from public.pl_days d
        join public.pl_weeks w on w.id = d.week_id
        join public.pl_blocks b on b.id = w.block_id
       where d.id = pl_exercise_rows.day_id and b.client_visible and b.client_id = (select public.linked_client_id())
    )
  );

drop policy if exists "Linked login reads own pl_scheduled_workouts" on public.pl_scheduled_workouts;
create policy "Linked login reads own pl_scheduled_workouts" on public.pl_scheduled_workouts
  for select to authenticated using (client_id = (select public.linked_client_id()));

drop policy if exists "Linked login reads own pl_day_completions" on public.pl_day_completions;
create policy "Linked login reads own pl_day_completions" on public.pl_day_completions
  for select to authenticated using (client_id = (select public.linked_client_id()));

drop policy if exists "Linked login reads own pl_row_results" on public.pl_row_results;
create policy "Linked login reads own pl_row_results" on public.pl_row_results
  for select to authenticated using (client_id = (select public.linked_client_id()));

drop policy if exists "Linked login reads own pl_workout_feedback" on public.pl_workout_feedback;
create policy "Linked login reads own pl_workout_feedback" on public.pl_workout_feedback
  for select to authenticated using (client_id = (select public.linked_client_id()));

-- check-ins, cardio, nutrition days (shown on the calendar)
drop policy if exists "Linked login reads own nf_assignments" on public.nf_assignments;
create policy "Linked login reads own nf_assignments" on public.nf_assignments
  for select to authenticated using (client_id = (select public.linked_client_id()));

drop policy if exists "Linked login reads own cardio_targets" on public.cardio_targets;
create policy "Linked login reads own cardio_targets" on public.cardio_targets
  for select to authenticated using (visible_to_client and client_id = (select public.linked_client_id()));

drop policy if exists "Linked login reads own nutrition_day_overrides" on public.nutrition_day_overrides;
create policy "Linked login reads own nutrition_day_overrides" on public.nutrition_day_overrides
  for select to authenticated using (client_id = (select public.linked_client_id()));
