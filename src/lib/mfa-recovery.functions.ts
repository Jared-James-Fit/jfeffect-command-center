/**
 * Lost-phone recovery for two-step sign-in (mfa-recovery.ts, mfa-rules.ts, two-step.ts):
 *   makeRecoveryCodes      new codes, shown once (a confirmed session)
 *   redeemRecoveryCode     password + a code: this session is confirmed, every
 *                          other device is signed out and no device stays
 *                          trusted, then they remove what was on the lost phone
 *                          and add the new one (the gate's "You're back in").
 *                          A password-only session may call it (MFA_EXEMPT_FNS).
 *   resetTeammateTwoStep   the owner turns a teammate's two-step off
 * Codes and hashes never leave the server after they're shown; every use and
 * reset pushes the person and the owner.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  RECOVERY_CODE_COUNT,
  normalizeRecoveryCode,
  recoveryCodeFrom,
  recoveryCodeHash,
} from "@/lib/mfa-recovery";

async function h() {
  return import("@/lib/two-step.server");
}

/** Every authenticator app on a login (Supabase drops its sessions back to aal1). */
async function removeAuthenticators(db: any, userId: string): Promise<number> {
  const { data, error } = await db.auth.admin.mfa.listFactors({ userId });
  if (error) throw new Error(`Couldn't read the authenticators: ${error.message}`);
  const factors: Array<{ id: string }> = (data as any)?.factors ?? [];
  for (const f of factors) {
    const { error: delErr } = await db.auth.admin.mfa.deleteFactor({ id: f.id, userId });
    if (delErr) throw new Error(`Couldn't turn an authenticator off: ${delErr.message}`);
  }
  return factors.length;
}

export const makeRecoveryCodes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const s = await h();
    const db = await s.admin();
    if (!(await s.sessionConfirmed(db, context.userId, context.claims as any))) {
      throw new Error("Confirm it's you first, then make recovery codes.");
    }
    if (!(await s.methodsFor(db, context.userId)).length) throw new Error("Set up two-step sign-in first.");

    const codes: string[] = [];
    const seen = new Set<string>();
    while (codes.length < RECOVERY_CODE_COUNT) {
      const code = recoveryCodeFrom(crypto.getRandomValues(new Uint8Array(10)));
      if (!seen.has(code)) { seen.add(code); codes.push(code); }
    }
    const hashes = await Promise.all(codes.map((c) => recoveryCodeHash(normalizeRecoveryCode(c)!)));
    const { error: saveErr } = await db.rpc("staff_mfa_recovery_replace", { _uid: context.userId, _hashes: hashes });
    if (saveErr) throw new Error(`Couldn't save the recovery codes: ${saveErr.message}`);
    return { codes, madeAt: new Date().toISOString() };
  });

export type RedeemResult =
  | { ok: true }
  | { ok: false; reason: "format" | "wrong" | "wait" };

export const redeemRecoveryCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ code: z.string().max(64) }).parse(i))
  .handler(async ({ data, context }): Promise<RedeemResult> => {
    const normalized = normalizeRecoveryCode(data.code);
    if (!normalized) return { ok: false, reason: "format" };
    const s = await h();
    const db = await s.admin();
    const sid = s.sessionIdOf(context.claims as any);
    const { data: verdict, error } = await db.rpc("staff_mfa_recovery_use", {
      _uid: context.userId,
      _hash: await recoveryCodeHash(normalized),
    });
    if (error) throw new Error(`Couldn't check the code: ${error.message}`);
    if (verdict === "wait") return { ok: false, reason: "wait" };
    if (verdict !== "ok") return { ok: false, reason: "wrong" };

    // This session is them: confirm it, then shut every other door the lost
    // phone might hold open (other sessions, trusted devices). What was on the
    // phone itself they remove on the next screen.
    await s.markSession(db, context.userId, sid, "recovery_code");
    await db.rpc("two_step_trust_forget", { _uid: context.userId, _id: null });
    try {
      const { getRequest } = await import("@tanstack/react-start/server");
      const jwt = (getRequest()?.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
      if (jwt) {
        const { error: outErr } = await db.auth.admin.signOut(jwt, "others");
        if (outErr) console.warn("[mfa-recovery] couldn't sign out the other devices", outErr.message);
      }
    } catch (e) {
      console.warn("[mfa-recovery] couldn't sign out the other devices", e);
    }
    await s.recordEvent(db, context.userId, "recovered");
    const name = await s.firstNameOf(db, context.userId);
    await s.tellTwoStep(
      db,
      context.userId,
      { title: "A recovery code was used on your login", body: "Every other device was signed out. If this wasn't you, change your password now." },
      { title: `${name} used a recovery code`, body: "Their other devices were signed out and they're setting up their new phone." },
      context.userId,
    );
    return { ok: true };
  });

export const resetTeammateTwoStep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ userId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const s = await h();
    const db = await s.admin();
    const { data: me } = await db.from("user_roles").select("role").eq("user_id", context.userId).eq("role", "admin").maybeSingle();
    if (!me) throw new Error("Only the owner can reset two-step sign-in.");
    if (!(await s.sessionConfirmed(db, context.userId, context.claims as any))) throw new Error("Confirm it's you first.");
    if (data.userId === context.userId) throw new Error("Use one of your own recovery codes instead.");
    const { data: roles } = await db.from("user_roles").select("role").eq("user_id", data.userId);
    const isStaff = (roles ?? []).some((r: any) => r.role && r.role !== "client" && r.role !== "member");
    if (!isStaff) throw new Error("That login isn't on the team.");

    const removed = await removeAuthenticators(db, data.userId);
    // Phone numbers, passkeys, trusted devices and confirmed sessions go too.
    const { error } = await db.rpc("staff_mfa_reset_record", { _uid: data.userId, _actor: context.userId });
    if (error) throw new Error(`Couldn't record the reset: ${error.message}`);
    await s.tellTwoStep(
      db,
      data.userId,
      { title: "Your two-step sign-in was reset", body: "Open the app and set it up again: a text, Face ID or an authenticator app." },
      { title: "Two-step sign-in reset", body: "They'll set it up again the next time they open the app." },
      context.userId,
    );
    return { removed };
  });
