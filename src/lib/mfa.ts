/**
 * Two-step sign-in in the browser (rules: mfa-rules.ts). Supabase's TOTP:
 * an authenticator app (Google Authenticator, Microsoft Authenticator, the
 * iPhone's Passwords app, 1Password…) shows a 6-digit code that changes every
 * 30 seconds; once it's entered the session is "aal2" until it ends, so a code
 * is asked for once per sign-in on each device, never on every open.
 */
import { supabase } from "@/integrations/supabase/client";

export type TotpFactor = { id: string; name: string; createdAt: string | null };

export type TotpEnrollment = { factorId: string; qrCode: string; secret: string; uri: string };

/** The login's verified authenticators, oldest first. */
export async function listAuthenticators(): Promise<TotpFactor[]> {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw error;
  return ((data?.totp ?? []) as any[])
    .filter((f) => f.status === "verified")
    .map((f) => ({ id: String(f.id), name: String(f.friendly_name || "Authenticator app"), createdAt: f.created_at ?? null }))
    .sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")));
}

/** The first verified authenticator, to ask its code. */
export async function firstAuthenticatorId(): Promise<string | null> {
  return (await listAuthenticators())[0]?.id ?? null;
}

/**
 * Start adding an authenticator. Half-finished ones (never verified) are
 * cleared first, so backing out and starting again never piles them up.
 */
export async function startTotpEnrollment(label = "Authenticator app"): Promise<TotpEnrollment> {
  const { data: factors } = await supabase.auth.mfa.listFactors();
  for (const f of ((factors as any)?.all ?? []) as any[]) {
    if (f.factor_type === "totp" && f.status !== "verified") {
      await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
  }
  // Names must differ between a login's authenticators.
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    issuer: "JF Effect",
    friendlyName: `${label} · ${stamp}`,
  });
  if (error) throw error;
  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret, uri: data.totp.uri };
}

/** Check a 6-digit code. On success this session is upgraded to aal2. */
export async function verifyTotp(factorId: string, code: string): Promise<void> {
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.replace(/\D/g, "") });
  if (error) throw error;
}

/** Remove an authenticator (Supabase asks for a session that has had its code). */
export async function removeAuthenticator(factorId: string): Promise<void> {
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) throw error;
}

/** Words for a Supabase MFA error a person can act on. */
export function mfaErrorMessage(e: unknown, fallback: string): string {
  const msg = String((e as any)?.message ?? "");
  if (/invalid.*(totp|code)|code.*invalid|expired/i.test(msg)) return "That code didn't work. Type the newest one from the app.";
  if (/too many|rate limit/i.test(msg)) return "Too many tries. Wait a minute and try again.";
  if (/aal2/i.test(msg)) return "Enter a code first, then try again.";
  return msg || fallback;
}
