// Two-step sign-in for team logins: after the password, Face ID / Touch ID (a
// passkey), a texted code or an authenticator app's code (two-step.ts).
//
// The rule, one way for the app, the server and the database: a login that
// has a way to confirm uses it. Its session counts only once it's confirmed
// (Supabase's "aal2" after an authenticator code, or a session the server
// marked after a text, a passkey or a trusted device); a
// password alone (a stolen one included) gets no staff rights anywhere: the
// app shows the confirm screen, every server function refuses (src/start.ts →
// mfa-guard.server.ts) and the database's role checks say no (caller_mfa_ok,
// 20270512090000_two_step_sms_passkeys.sql). The admin, finance and coach
// logins are asked to set one up the first time they open the app; nothing
// changes for anyone else.
//
// Pure: no Supabase, no React, so the rules are tested on their own.

/**
 * Account roles that must have a way to confirm before the app opens: the
 * ones that see client records or the business's money.
 */
export const MFA_REQUIRED_ROLES: ReadonlySet<string> = new Set(["admin", "finance", "coach"]);

export function roleRequiresMfa(role: string | null | undefined): boolean {
  return !!role && MFA_REQUIRED_ROLES.has(role);
}

/**
 * Server functions a session may call before it's confirmed: the ones that
 * confirm it (two-step.functions.ts: the status, a texted code, a passkey, a
 * trusted device). Each is limited in
 * the database and does nothing else for an unconfirmed session. Their names
 * are unique in the app (two-step tests check), since the guard goes by name.
 */
export const MFA_EXEMPT_FNS: ReadonlySet<string> = new Set([
  "getTwoStepStatus",
  "sendTwoStepCode",
  "verifyTwoStepCode",
  "startTwoStepPasskey",
  "finishTwoStepPasskey",
  "confirmWithTrustedDevice",
]);

export function mfaExemptFn(name: string | null | undefined): boolean {
  return !!name && MFA_EXEMPT_FNS.has(name);
}

/** What a server function says to a session that still needs its code. */
export const MFA_NEEDED_MESSAGE = "Confirm it's you to continue: Face ID, a texted code or your authenticator app.";

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
 * Whether a server call needs its session checked: the token belongs to a
 * login with a way to confirm (`enrolled`, the server's cached list) and
 * isn't aal2. The guard then asks whether the server marked the session
 * confirmed. A call with no token, or an unreadable one, is left to the
 * function's own auth check.
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
