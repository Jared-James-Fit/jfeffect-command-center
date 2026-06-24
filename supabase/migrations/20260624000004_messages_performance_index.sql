-- Messages performance index
-- Ensures the query pattern used by listMessages and listOlderMessages is fast:
--   SELECT * FROM messages
--   WHERE client_id = $1
--   AND delivery_status IN ('sent', 'sending')
--   AND is_internal_note = false
--   ORDER BY created_at DESC
--   LIMIT 25
--
-- The index covers (client_id, created_at DESC) which is the most common
-- access pattern. Postgres will use this for both the initial 25-message
-- fetch and the cursor-based "load older" queries.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_client_created_at
  ON public.messages (client_id, created_at DESC);

-- Partial index for the delivery_status filter (most common case)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_client_delivered
  ON public.messages (client_id, created_at DESC)
  WHERE delivery_status IN ('sent', 'sending');

COMMENT ON INDEX public.idx_messages_client_created_at IS
  'Covers the listMessages() and listOlderMessages() query patterns.
   Added 2026-06-24 as part of messenger performance optimization.';
