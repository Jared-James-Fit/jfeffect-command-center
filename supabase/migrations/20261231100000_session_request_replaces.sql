-- A session request can be "instead of" a session the client already has booked
-- ("Changing Tuesday session for this day"). Approving it then moves that session
-- to the asked-for time (its credit, Google event and reminders move with it, by the
-- pt_sessions triggers) instead of booking a second one that has no credit to hold.
-- Set by requestSession when the client picks the session it replaces, and by
-- answerSessionRequest with whatever the coach approved.

alter table public.session_requests
  add column if not exists replaces_session_id uuid references public.pt_sessions(id) on delete set null;

comment on column public.session_requests.replaces_session_id is
  'The booked session this request moves (approve = move it, the credit follows). Null = an extra session.';

notify pgrst, 'reload schema';
