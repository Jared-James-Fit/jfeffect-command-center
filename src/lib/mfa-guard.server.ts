// The server half of two-step sign-in (mfa-rules.ts, two-step.ts): every
// server function runs through this first (src/start.ts). A session from a
// login that has a way to confirm (an authenticator app, a phone number, a
// passkey), not yet confirmed, is refused before the function's own checks
// run, so the ~70 admin checks that read user_roles themselves are covered
// without touching each one.
//
// "Confirmed" is the token's aal2 (an authenticator code) or a session the
// server marked after a text, a passkey, a trusted device or a recovery code
// (two_step_session_live: the mark and a session that still exists).
//
// Costs nothing per call for anyone without two-step: the list of logins that
// have it is read once a minute per server instance and held in memory. A
// confirmed session is remembered for a minute (never an unconfirmed one, so
// a session confirmed a moment ago is let through at once). If the list can't
// be read, calls go through as before and the database's own checks
// (caller_mfa_ok) still hold; if a session can't be checked, it's refused.

import {
  bearerToken,
  decodeJwtClaims,
  MFA_NEEDED_MESSAGE,
  serverRefusesForMfa,
} from "@/lib/mfa-rules";

const TTL_MS = 60_000;
const CONFIRMED_TTL_MS = 60_000;
const CONFIRMED_MAX = 500;

let cached: { ids: Set<string>; at: number } | null = null;
let inflight: Promise<Set<string> | null> | null = null;
let warned = false;
const confirmed = new Map<string, number>();

async function admin(): Promise<any> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

async function readEnrolled(): Promise<Set<string> | null> {
  try {
    const { data, error } = await (await admin()).rpc("mfa_enforced_logins");
    if (error) throw error;
    const ids = new Set<string>(
      (Array.isArray(data) ? data : [])
        .map((r: any) => (typeof r === "string" ? r : (r?.mfa_enforced_logins ?? r?.user_id)))
        .filter((v: unknown): v is string => typeof v === "string" && v.length > 0),
    );
    cached = { ids, at: Date.now() };
    return ids;
  } catch (e) {
    if (!warned) {
      warned = true;
      console.warn(
        "[mfa-guard] couldn't read the logins with two-step; the database checks still apply",
        e,
      );
    }
    // keep the last list we had, if any
    return cached?.ids ?? null;
  }
}

async function enrolledLogins(): Promise<Set<string> | null> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.ids;
  if (!inflight)
    inflight = readEnrolled().finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Whether the server marked this session confirmed (and it's still signed in). */
export async function sessionConfirmedLive(
  userId: string,
  sessionId: string | null | undefined,
): Promise<boolean> {
  if (!sessionId || typeof sessionId !== "string") return false;
  const key = `${userId}:${sessionId}`;
  const until = confirmed.get(key);
  if (until && until > Date.now()) return true;
  const { data, error } = await (
    await admin()
  ).rpc("two_step_session_live", { _uid: userId, _session: sessionId });
  if (error) throw new Error(`Couldn't check this sign-in: ${error.message}`);
  if (data === true) {
    if (confirmed.size >= CONFIRMED_MAX) confirmed.clear();
    confirmed.set(key, Date.now() + CONFIRMED_TTL_MS);
    return true;
  }
  return false;
}

/** Throws MFA_NEEDED_MESSAGE when this request's session must be confirmed first. */
export async function checkStaffMfa(authorization: string | null | undefined): Promise<void> {
  const claims = decodeJwtClaims(bearerToken(authorization));
  if (!claims?.sub || claims.aal === "aal2") return;
  if (!serverRefusesForMfa(claims, await enrolledLogins())) return;
  let ok = false;
  try {
    ok = await sessionConfirmedLive(claims.sub, claims.session_id);
  } catch (e) {
    console.warn("[mfa-guard] couldn't check a session; refusing", e);
  }
  if (!ok) throw new Error(MFA_NEEDED_MESSAGE);
}

/** For tests: forget the cached list and sessions. */
export function resetMfaGuardCache(): void {
  cached = null;
  inflight = null;
  warned = false;
  confirmed.clear();
}
