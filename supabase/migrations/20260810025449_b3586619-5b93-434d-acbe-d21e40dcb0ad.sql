ALTER TABLE public.session_ledger_events
  DROP CONSTRAINT session_ledger_events_source_check;

ALTER TABLE public.session_ledger_events
  ADD CONSTRAINT session_ledger_events_source_check
  CHECK (source = ANY (ARRAY[
    'manual'::text, 'auto_grant_on_payment'::text, 'auto_use_on_complete'::text,
    'auto_expire'::text, 'conversion'::text, 'admin_adjust'::text,
    'auto_use_on_appointment'::text, 'auto_unuse_on_appointment_cancel'::text,
    'package_grant'::text, 'revert_on_uncomplete'::text,
    'reserve_on_book'::text, 'release_reservation'::text, 'convert_on_complete'::text,
    'sell_sessions_dialog'::text, 'upgrade_transfer'::text
  ]));