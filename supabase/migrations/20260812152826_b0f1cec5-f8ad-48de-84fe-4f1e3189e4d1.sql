ALTER PUBLICATION supabase_realtime ADD TABLE public.support_alerts;
ALTER TABLE public.support_alerts REPLICA IDENTITY FULL;