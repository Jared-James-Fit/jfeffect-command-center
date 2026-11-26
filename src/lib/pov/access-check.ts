import { supabase } from "@/integrations/supabase/client";

const noted = new Set<string>();

/**
 * A staff screen asked for a client it couldn't read (a direct link, a stale star, a quick view
 * of someone reassigned): ask the database, which notes the refusal on the access record when
 * the signed-in person really can't reach that account (account_access_check; never for an
 * admin, the client themselves or their coach). Once per account and screen a visit; never in
 * the way of the screen.
 */
export function noteAccessAttempt(clientId: string | null | undefined, source: string): void {
  if (!clientId) return;
  const key = `${source}:${clientId}`;
  if (noted.has(key)) return;
  noted.add(key);
  void (supabase as any)
    .rpc("account_access_check", { _client_id: clientId, _source: source.slice(0, 60) })
    .then(() => undefined, () => undefined);
}
