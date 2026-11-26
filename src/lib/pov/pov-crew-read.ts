import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useClientImpersonation } from "@/lib/client-impersonation";

type CrewRead = "feed" | "ranked" | "profile" | "post" | "follows" | "activity" | "crew_notices";
type Args = Record<string, unknown>;
const db = supabase as any;

/** Only fixed read endpoints; authorization and identity resolution are in SQL.
 * A pending/expired target cannot fall back to the staff user's personal data.
 * Keep POV results out of every ordinary user's query cache and optimistic updates.
 */
export function usePovCrewRead() {
  const { client, isImpersonating } = useClientImpersonation();
  const session = client?.pov?.id ?? null;
  const target = client?.user_id ?? null;
  const ready = !isImpersonating || (!!session && !!target);
  const key = (base: readonly unknown[]) => isImpersonating
    ? ["pov-crew", session, target, client?.id, ...base]
    : base;
  const read = useCallback(async (operation: CrewRead, normalRpc: string, args: Args = {}) => {
    if (!isImpersonating) return db.rpc(normalRpc, args);
    if (!session || !target) throw new Error("Client preview is not ready");
    return db.rpc("admin_pov_crew_read", { _session: session, _read: operation, _args: args });
  }, [isImpersonating, session, target]);
  return { isPov: isImpersonating, ready, key, read };
}
