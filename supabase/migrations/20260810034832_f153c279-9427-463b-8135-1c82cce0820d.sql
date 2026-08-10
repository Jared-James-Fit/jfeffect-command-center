create or replace function public.tg_sle_immutable()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  -- Allow referential-maintenance updates only: FK ON DELETE SET NULL clears
  -- pt_session_id / appointment_id when the referenced session is removed.
  -- Every financial column must remain identical, and exactly one FK column
  -- must transition from a value to NULL.
  if tg_op = 'UPDATE'
     and new.id = old.id
     and new.client_id is not distinct from old.client_id
     and new.purchase_id is not distinct from old.purchase_id
     and new.event_type is not distinct from old.event_type
     and new.session_count is not distinct from old.session_count
     and new.unit_value_minor is not distinct from old.unit_value_minor
     and new.currency is not distinct from old.currency
     and new.effective_date is not distinct from old.effective_date
     and new.expires_at is not distinct from old.expires_at
     and new.note is not distinct from old.note
     and new.related_event_id is not distinct from old.related_event_id
     and new.source is not distinct from old.source
     and new.created_by is not distinct from old.created_by
     and new.created_at is not distinct from old.created_at
     and (
       (old.pt_session_id is not null and new.pt_session_id is null
        and new.appointment_id is not distinct from old.appointment_id)
       or
       (old.appointment_id is not null and new.appointment_id is null
        and new.pt_session_id is not distinct from old.pt_session_id)
     )
  then
    return new;
  end if;
  raise exception 'session_ledger_events is append-only';
end
$function$;