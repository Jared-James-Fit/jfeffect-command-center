-- Deleted messages are for admins only. An October policy also let a client's
-- coach (and any coach, for groups) read message_deletions; policies add up,
-- so with deleted-for-everyone words now kept there (20270106090000), coaches
-- could have read what clients deleted. The coach asked that only the admin
-- can see what was deleted, so the one remaining rule is
-- "Admins read message deletions".
DROP POLICY IF EXISTS "Staff read message deletions" ON public.message_deletions;
