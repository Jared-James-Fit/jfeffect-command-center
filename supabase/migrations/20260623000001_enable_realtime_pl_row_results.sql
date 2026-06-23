-- Enable Supabase Realtime for pl_row_results so cross-device workout sync works.
-- When a set is saved on one device (iPad), every other device (iPhone) receives
-- a postgres_changes event and immediately invalidates its cached results query.
ALTER PUBLICATION supabase_realtime ADD TABLE public.pl_row_results;
