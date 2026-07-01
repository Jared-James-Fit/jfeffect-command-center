ALTER PUBLICATION supabase_realtime ADD TABLE public.session_ledger_events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.pt_sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.session_credit_packages;
ALTER TABLE public.session_ledger_events REPLICA IDENTITY FULL;
ALTER TABLE public.pt_sessions REPLICA IDENTITY FULL;
ALTER TABLE public.session_credit_packages REPLICA IDENTITY FULL;