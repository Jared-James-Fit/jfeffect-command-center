DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.session_ledger_events;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pt_sessions;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.session_credit_packages;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

ALTER TABLE public.session_ledger_events REPLICA IDENTITY FULL;
ALTER TABLE public.pt_sessions REPLICA IDENTITY FULL;
ALTER TABLE public.session_credit_packages REPLICA IDENTITY FULL;