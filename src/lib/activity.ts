import { supabase } from "@/integrations/supabase/client";

/** Record that the authenticated client just performed activity (page view / interaction).
 *  Server-side throttled to once per 60s. Route is updated when it changes. Safe to call often. */
export async function pingClientActivity(route?: string | null): Promise<void> {
  try {
    await supabase.rpc("ping_client_activity", { _route: route ?? null });
  } catch {
    // Best-effort; never throw to caller.
  }
}

/** Record a successful sign-in / session restore for the authenticated client. */
export async function markClientSignedIn(): Promise<void> {
  try {
    await supabase.rpc("mark_client_signed_in");
  } catch {
    // Best-effort.
  }
}

/** Log a freeform activity row (best-effort). Used for client-side events
 *  not already covered by server-side action handlers. */
export async function logClientActivity(args: {
  clientId: string;
  userId: string | null;
  action: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  try {
    await supabase.from("client_activity_log").insert({
      client_id: args.clientId,
      actor_user_id: args.userId,
      actor_role: "client",
      action: args.action,
      details: (args.details ?? {}) as any,
    });
  } catch {
    // Best-effort.
  }
}