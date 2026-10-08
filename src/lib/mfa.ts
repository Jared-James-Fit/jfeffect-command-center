/**
 * Supabase TOTP MFA for staff. Admin and finance must use an authenticator
 * app: their session has to be aal2 before the staff areas open, and the
 * database (has_role admin, has_permission) refuses them otherwise.
 */
import { supabase } from "@/integrations/supabase/client";

/** Roles whose sessions must be MFA-verified (aal2). */
export const MFA_REQUIRED_ROLES = new Set(["admin", "finance"]);

export function roleRequiresMfa(role: string | null | undefined): boolean {
  return !!role && MFA_REQUIRED_ROLES.has(role);
}

export type MfaState =
  | { status: "verified" }
  | { status: "needs_verify"; factorId: string }
  | { status: "needs_enroll" };

/** Where this session stands: already aal2, has an authenticator to verify, or needs one. */
export async function getMfaState(): Promise<MfaState> {
  const { data: aal, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) throw error;
  if (aal?.currentLevel === "aal2") return { status: "verified" };
  const { data: factors, error: fErr } = await supabase.auth.mfa.listFactors();
  if (fErr) throw fErr;
  const verified = (factors?.totp ?? []).find((f: any) => f.status === "verified");
  return verified ? { status: "needs_verify", factorId: verified.id } : { status: "needs_enroll" };
}

export type TotpEnrollment = { factorId: string; qrCode: string; secret: string };

/** Start enrolling a new authenticator. Clears half-finished (unverified) ones first. */
export async function startTotpEnrollment(): Promise<TotpEnrollment> {
  const { data: factors } = await supabase.auth.mfa.listFactors();
  for (const f of (factors?.all ?? []) as any[]) {
    if (f.factor_type === "totp" && f.status !== "verified") {
      await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
  }
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `JF Effect ${new Date().toISOString().slice(0, 10)}`,
  });
  if (error) throw error;
  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
}

/** Verify a 6-digit code. On success the session is upgraded to aal2. */
export async function verifyTotp(factorId: string, code: string): Promise<void> {
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
  if (error) throw error;
}
