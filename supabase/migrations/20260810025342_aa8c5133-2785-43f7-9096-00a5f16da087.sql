ALTER TABLE public.session_ledger_events
  DROP CONSTRAINT session_ledger_events_event_type_check;

ALTER TABLE public.session_ledger_events
  ADD CONSTRAINT session_ledger_events_event_type_check
  CHECK (event_type = ANY (ARRAY[
    'granted'::text, 'used'::text, 'unused'::text, 'expired'::text,
    'transferred_out'::text, 'transferred_in'::text, 'refunded'::text,
    'adjusted'::text, 'reserved'::text, 'released'::text
  ]));