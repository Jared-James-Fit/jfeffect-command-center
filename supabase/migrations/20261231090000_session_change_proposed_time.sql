-- A client's "Change time" request carries the exact time they want, so the
-- coach can approve it in one tap (the session sheet's Approve opens the move
-- pre-filled; moving the session closes the request through
-- tg_pt_session_close_change_requests as before). preferred_times stays for
-- "other times that work", note for why.

alter table public.pt_session_change_requests
  add column if not exists proposed_date date,
  add column if not exists proposed_start time;

alter table public.pt_session_change_requests
  drop constraint if exists pt_session_change_requests_proposed_pair;
alter table public.pt_session_change_requests
  add constraint pt_session_change_requests_proposed_pair
  check ((proposed_date is null) = (proposed_start is null));

comment on column public.pt_session_change_requests.proposed_date is
  'Move requests: the day the client asked for (with proposed_start, in the session''s time zone).';
comment on column public.pt_session_change_requests.proposed_start is
  'Move requests: the start time the client asked for; the session keeps its length.';

notify pgrst, 'reload schema';
