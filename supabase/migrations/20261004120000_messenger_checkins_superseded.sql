-- Recurring chat forms: a newer request of the same type supersedes any older
-- unfinished one, so a client can never complete an outdated Weekly Check-In /
-- Nutrition Review. History is preserved (rows, messages, answers untouched);
-- only the workflow status of the stale pending request changes.

alter table public.messenger_checkins
  add column if not exists superseded_at timestamptz,
  add column if not exists superseded_by uuid references public.messenger_checkins(id) on delete set null;

alter table public.messenger_checkins drop constraint if exists messenger_checkins_status_check;
alter table public.messenger_checkins
  add constraint messenger_checkins_status_check
  check (status = any (array['pending'::text, 'completed'::text, 'superseded'::text]));

create or replace function public.tg_messenger_checkin_supersede_older()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.messenger_checkins
     set status = 'superseded',
         superseded_at = now(),
         superseded_by = new.id,
         updated_at = now()
   where client_id = new.client_id
     and task_type = new.task_type
     and status = 'pending'
     and id <> new.id
     and created_at <= new.created_at;
  return null;
end;
$$;

drop trigger if exists messenger_checkin_supersede_older on public.messenger_checkins;
create trigger messenger_checkin_supersede_older
  after insert on public.messenger_checkins
  for each row execute function public.tg_messenger_checkin_supersede_older();

-- Backfill: keep only the newest pending request per client + form type.
with ranked as (
  select id, client_id, task_type,
         first_value(id) over (partition by client_id, task_type order by created_at desc, id desc) as newest_id,
         row_number() over (partition by client_id, task_type order by created_at desc, id desc) as rn
    from public.messenger_checkins
)
update public.messenger_checkins mc
   set status = 'superseded',
       superseded_at = now(),
       superseded_by = r.newest_id,
       updated_at = now()
  from ranked r
 where r.id = mc.id
   and r.rn > 1
   and mc.status = 'pending';
