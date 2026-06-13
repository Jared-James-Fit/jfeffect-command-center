-- RPC: batch lookup of last staff contact per client.
-- Aggregates from messages (non-internal staff messages) and communication_log.
CREATE OR REPLACE FUNCTION public.crm_last_contacted_map(_ids uuid[])
RETURNS TABLE(client_id uuid, last_contacted_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH msg AS (
    SELECT m.client_id, max(m.created_at) AS ts
      FROM public.messages m
     WHERE m.client_id = ANY(_ids)
       AND COALESCE(m.is_internal_note, false) = false
       AND m.sender_role IN ('admin','coach')
     GROUP BY m.client_id
  ),
  comm AS (
    SELECT c.client_id, max((c.date::timestamptz)) AS ts
      FROM public.communication_log c
     WHERE c.client_id = ANY(_ids)
     GROUP BY c.client_id
  )
  SELECT id AS client_id,
         GREATEST(
           COALESCE((SELECT ts FROM msg  WHERE msg.client_id  = ids.id), 'epoch'::timestamptz),
           COALESCE((SELECT ts FROM comm WHERE comm.client_id = ids.id), 'epoch'::timestamptz)
         ) AS last_contacted_at
    FROM unnest(_ids) AS ids(id)
   WHERE GREATEST(
           COALESCE((SELECT ts FROM msg  WHERE msg.client_id  = ids.id), 'epoch'::timestamptz),
           COALESCE((SELECT ts FROM comm WHERE comm.client_id = ids.id), 'epoch'::timestamptz)
         ) > 'epoch'::timestamptz;
$$;

REVOKE ALL ON FUNCTION public.crm_last_contacted_map(uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.crm_last_contacted_map(uuid[]) TO authenticated, service_role;

-- Helpful index for the messages aggregation path.
CREATE INDEX IF NOT EXISTS idx_messages_client_created_staff
  ON public.messages (client_id, created_at DESC)
  WHERE COALESCE(is_internal_note, false) = false AND sender_role IN ('admin','coach');

-- Helpful index for communication_log lookups by client.
CREATE INDEX IF NOT EXISTS idx_communication_log_client_date
  ON public.communication_log (client_id, date DESC);