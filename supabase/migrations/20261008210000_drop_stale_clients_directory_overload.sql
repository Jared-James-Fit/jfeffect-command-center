-- Drop the original 7-argument admin_clients_directory.
--
-- 20261006180000 dropped the 8-argument version, but this older one was still in production next to the
-- current 9-argument function. It helps nobody: the app always passes p_lifecycle and p_flags, so it never
-- reaches it, and a call with only the first 7 arguments matches BOTH versions, so Postgres refuses it
-- ("function ... is not unique"). Dropping it makes such a call land on the current function instead.
-- Nothing else calls it. Safe to re-run.
drop function if exists public.admin_clients_directory(text, text, text, uuid, text, integer, integer);
