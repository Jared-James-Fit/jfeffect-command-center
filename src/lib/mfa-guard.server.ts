// The server half of two-step sign-in (mfa-rules.ts): every server function
// runs through this first (src/start.ts). A session from a login that has an
// authenticator, without its code yet, is refused before the function's own
// checks run, so the ~70 admin checks that read user_roles themselves are
// covered without touching each one.
//
// Costs nothing per call for anyone without an authenticator: the list of
// logins that have one is read once a minute per server instance (it's two
// people) and held in memory. If the list can't be read, calls go through
// as before and the database's own checks (caller_mfa_ok) still hold.

import { bearerToken, decodeJwtClaims, MFA_NEEDED_MESSAGE, serverRefusesForMfa } from "@/lib/mfa-rules";

const TTL_MS = 60_000;

let cached: { ids: Set<string>; at: number } | null = null;
let inflight: Promise<Set<string> | null> | null = null;
let warned = false;

async function readEnrolled(): Promise<Set<string> | null> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await (supabaseAdmin as any).rpc("mfa_enforced_logins");
    if (error) throw error;
    const ids = new Set<string>(
      (Array.isArray(data) ? data : [])
        .map((r: any) => (typeof r === "string" ? r : r?.mfa_enforced_logins ?? r?.user_id))
        .filter((v: unknown): v is string => typeof v === "string" && v.length > 0),
    );
    cached = { ids, at: Date.now() };
    return ids;
  } catch (e) {
    if (!warned) {
      warned = true;
      console.warn("[mfa-guard] couldn't read the logins with an authenticator; the database checks still apply", e);
    }
    // keep the last list we had, if any
    return cached?.ids ?? null;
  }
}

async function enrolledLogins(): Promise<Set<string> | null> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.ids;
  if (!inflight) inflight = readEnrolled().finally(() => { inflight = null; });
  return inflight;
}

/** Throws MFA_NEEDED_MESSAGE when this request's session must enter its code first. */
export async function checkStaffMfa(authorization: string | null | undefined): Promise<void> {
  const claims = decodeJwtClaims(bearerToken(authorization));
  if (!claims?.sub || claims.aal === "aal2") return;
  if (serverRefusesForMfa(claims, await enrolledLogins())) {
    throw new Error(MFA_NEEDED_MESSAGE);
  }
}

/** For tests: forget the cached list. */
export function resetMfaGuardCache(): void {
  cached = null;
  inflight = null;
  warned = false;
}
