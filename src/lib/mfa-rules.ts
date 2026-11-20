// Two-step sign-in (an authenticator app's 6-digit code after the password)
// for the logins that can see everything: the admin and the finance login.
//
// The rule, one way for the app, the server and the database: a login that
// has a verified authenticator uses it. Its session counts only once the code
// is in (Supabase's "aal2"); a password alone (a stolen one included) gets no
// staff rights anywhere: the app shows the code screen, every server function
// refuses (src/start.ts → mfa-guard.server.ts) and the database's role checks
// say no (caller_mfa_ok, 20270424090000_staff_mfa.sql). The admin and finance
// logins are asked to set one up the first time they open the app; nothing
// changes for anyone else.
//
// Pure: no Supabase, no React, so the rules are tested on their own.

/** Account roles that must have an authenticator before the app opens. */
export const MFA_REQUIRED_ROLES: ReadonlySet<string> = new Set(["admin", "finance"]);

export function roleRequiresMfa(role: string | null | undefined): boolean {
  return !!role && MFA_REQUIRED_ROLES.has(role);
}

/** What a server function says to a session that still needs its code. */
export const MFA_NEEDED_MESSAGE = "Enter the code from your authenticator app to continue.";

export type MfaGateStep = "pass" | "verify" | "enroll";

/**
 * What the app shows a signed-in person:
 *   verify: they have an authenticator and this session hasn't had its code;
 *   enroll: their role needs one and they have none yet;
 *   pass:   everything else (every client, every member).
 */
export function mfaGateStep(input: {
  accountRole: string | null | undefined;
  /** The session's assurance level ("aal1" after a password, "aal2" after a code). */
  aal: string | null | undefined;
  /** How many verified authenticators the login has. */
  verifiedFactors: number;
}): MfaGateStep {
  if (input.verifiedFactors > 0) return input.aal === "aal2" ? "pass" : "verify";
  // A login that needs one and has none sets one up, whatever the session's
  // level: a session verified with an authenticator since removed (the
  // finance login's, from before Oct 9 2026) still reads aal2. The gate asks
  // Supabase before showing the setup, so a user object that hasn't caught up
  // with one just added never asks twice.
  return roleRequiresMfa(input.accountRole) ? "enroll" : "pass";
}

/**
 * The claims inside a Supabase access token, read without checking its
 * signature. Only ever used to decide whether to refuse early: a token whose
 * signature is wrong is refused by requireSupabaseAuth anyway, so a forged
 * "aal2" gains nothing, and a forged "aal1" only refuses itself.
 */
export function decodeJwtClaims(token: string | null | undefined): Record<string, any> | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const json =
      typeof atob === "function"
        ? decodeURIComponent(
            Array.from(atob(padded), (c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0")).join(""),
          )
        : Buffer.from(padded, "base64").toString("utf8");
    const claims = JSON.parse(json);
    return claims && typeof claims === "object" ? claims : null;
  } catch {
    return null;
  }
}

export function bearerToken(header: string | null | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1].trim() || null : null;
}

/**
 * Whether a server call must be refused: the token belongs to a login with a
 * verified authenticator (`enrolled`, the server's cached list) and its
 * session hasn't had the code. A call with no token, or an unreadable one, is
 * left to the function's own auth check.
 */
export function serverRefusesForMfa(claims: Record<string, any> | null, enrolled: ReadonlySet<string> | null): boolean {
  if (!claims || typeof claims.sub !== "string" || !claims.sub) return false;
  if (claims.aal === "aal2") return false;
  if (!enrolled) return false;
  return enrolled.has(claims.sub);
}

/** How many verified authenticators a Supabase user object carries. */
export function verifiedFactorCount(user: { factors?: Array<{ status?: string | null }> | null } | null | undefined): number {
  return (user?.factors ?? []).filter((f) => f?.status === "verified").length;
}
