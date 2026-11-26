import { supabase } from "@/integrations/supabase/client";

/** Record that the authenticated client just performed activity (page view / interaction).
 *  Server-side throttled to once per 60s. Route is updated when it changes. Safe to call often. */
export async function pingClientActivity(route?: string | null): Promise<void> {
  try {
    await supabase.rpc("ping_client_activity", { _route: route ?? undefined });
  } catch {
    // Best-effort; never throw to caller.
  }
}

// One app open fires INITIAL_SESSION, SIGNED_IN and the getSession() restore together; one
// call per login a minute is enough (the database also records a sign-in at most every 2 minutes).
const SIGN_IN_MARK_GAP_MS = 60_000;
const lastSignInMark = new Map<string, number>();

/** Record a successful sign-in / session restore for the authenticated client. */
export async function markClientSignedIn(uid?: string | null): Promise<void> {
  if (uid) {
    const now = Date.now();
    const last = lastSignInMark.get(uid);
    if (last != null && now - last < SIGN_IN_MARK_GAP_MS) return;
    lastSignInMark.set(uid, now);
  }
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