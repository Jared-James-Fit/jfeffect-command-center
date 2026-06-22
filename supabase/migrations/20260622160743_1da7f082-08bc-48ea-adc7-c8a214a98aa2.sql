-- Lock down realtime.messages (Broadcast/Presence) with explicit deny-by-default
-- plus restrictive allowlist of known topic patterns. Postgres-changes channels
-- are unaffected (they are not private and do not flow through realtime.messages);
-- their authorization remains enforced by RLS on the source tables.

-- Restrictive policy: authenticated reads only allowed for known topic patterns.
DROP POLICY IF EXISTS "authenticated topic allowlist read" ON realtime.messages;
CREATE POLICY "authenticated topic allowlist read"
ON realtime.messages
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (
  realtime.topic() LIKE 'chat-presence:%'
  OR realtime.topic() LIKE 'group-presence:%'
);

-- Restrictive policy: authenticated writes (Broadcast send / Presence track)
-- only allowed for the same known topic patterns.
DROP POLICY IF EXISTS "authenticated topic allowlist write" ON realtime.messages;
CREATE POLICY "authenticated topic allowlist write"
ON realtime.messages
AS RESTRICTIVE
FOR INSERT
TO authenticated
WITH CHECK (
  realtime.topic() LIKE 'chat-presence:%'
  OR realtime.topic() LIKE 'group-presence:%'
);

-- Explicit deny-by-default for anon on every topic (defense in depth alongside
-- the existing deny_anon_realtime policies).
DROP POLICY IF EXISTS "anon deny all realtime read" ON realtime.messages;
CREATE POLICY "anon deny all realtime read"
ON realtime.messages
AS RESTRICTIVE
FOR SELECT
TO anon
USING (false);

DROP POLICY IF EXISTS "anon deny all realtime write" ON realtime.messages;
CREATE POLICY "anon deny all realtime write"
ON realtime.messages
AS RESTRICTIVE
FOR INSERT
TO anon
WITH CHECK (false);