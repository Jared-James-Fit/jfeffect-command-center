/**
 * Lost-phone recovery for two-step sign-in (mfa-recovery.ts, mfa-rules.ts):
 *   makeRecoveryCodes      new codes, shown once (a session that has had its code)
 *   redeemRecoveryCode     password + a code: the old authenticator goes, the
 *                          login is signed out everywhere, they set up the new
 *                          phone (the one server function the MFA guard lets a
 *                          password-only session call, MFA_EXEMPT_FNS)
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

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

function hadItsCode(context: { claims?: Record<string, any> | null }): boolean {
  return context.claims?.aal === "aal2";
}

/** Every authenticator on a login (Supabase signs it out everywhere when a verified one goes). */
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

async function firstNameOf(db: any, userId: string): Promise<string> {
  try {
    const { data } = await db.from("profiles").select("full_name").eq("id", userId).maybeSingle();
    const name = String(data?.full_name || "").trim().split(/\s+/)[0];
    return name || "A team member";
  } catch {
    return "A team member";
  }
}

/** One push to the person and one to the owner (never to whoever did it, never twice to one login). */
async function tell(
  db: any,
  userId: string,
  self: { title: string; body: string },
  owner: { title: string; body: string },
  actorId: string,
) {
  try {
    const { sendWebPushToUser } = await import("@/lib/push/push.server");
    const stamp = Date.now();
    await sendWebPushToUser(db, userId, { ...self, url: "/", tag: "two_step", data: { kind: "two_step" } }, {
      category: "messages", eventKey: `two_step:${userId}:${stamp}`, priority: "urgent",
    });
    const { data: admins } = await db.from("user_roles").select("user_id").eq("role", "admin");
    for (const a of admins ?? []) {
      if (!a?.user_id || a.user_id === userId || a.user_id === actorId) continue;
      await sendWebPushToUser(db, a.user_id, { ...owner, url: "/admin/team", tag: "two_step", data: { kind: "two_step" } }, {
        category: "messages", eventKey: `two_step:${userId}:${stamp}:${a.user_id}`, priority: "urgent",
      });
    }
  } catch (e) {
    console.warn("[mfa-recovery] push failed", e);
  }
}

export const makeRecoveryCodes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    if (!hadItsCode(context)) throw new Error("Enter your authenticator code first, then make recovery codes.");
    const db = await admin();
    const { data, error } = await db.auth.admin.mfa.listFactors({ userId: context.userId });
    if (error) throw new Error(`Couldn't read your authenticators: ${error.message}`);
    const verified = ((data as any)?.factors ?? []).some((f: any) => f.status === "verified");
    if (!verified) throw new Error("Set up an authenticator first.");

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
    const db = await admin();
    const { data: verdict, error } = await db.rpc("staff_mfa_recovery_use", {
      _uid: context.userId,
      _hash: await recoveryCodeHash(normalized),
    });
    if (error) throw new Error(`Couldn't check the code: ${error.message}`);
    if (verdict === "wait") return { ok: false, reason: "wait" };
    if (verdict !== "ok") return { ok: false, reason: "wrong" };

    await removeAuthenticators(db, context.userId);
    const name = await firstNameOf(db, context.userId);
    await tell(
      db,
      context.userId,
      { title: "A recovery code was used on your login", body: "Your authenticator was turned off. If this wasn't you, change your password now." },
      { title: `${name} used a recovery code`, body: "Their two-step sign-in was reset and they're setting up a new phone." },
      context.userId,
    );
    return { ok: true };
  });

export const resetTeammateTwoStep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ userId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const db = await admin();
    const { data: me } = await db.from("user_roles").select("role").eq("user_id", context.userId).eq("role", "admin").maybeSingle();
    if (!me) throw new Error("Only the owner can reset two-step sign-in.");
    if (!hadItsCode(context)) throw new Error("Enter your own authenticator code first.");
    if (data.userId === context.userId) throw new Error("Use one of your own recovery codes instead.");
    const { data: roles } = await db.from("user_roles").select("role").eq("user_id", data.userId);
    const isStaff = (roles ?? []).some((r: any) => r.role && r.role !== "client");
    if (!isStaff) throw new Error("That login isn't on the team.");

    const removed = await removeAuthenticators(db, data.userId);
    const { error } = await db.rpc("staff_mfa_reset_record", { _uid: data.userId, _actor: context.userId });
    if (error) throw new Error(`Couldn't record the reset: ${error.message}`);
    await tell(
      db,
      data.userId,
      { title: "Your two-step sign-in was reset", body: "Sign in with your password and set up your authenticator again." },
      { title: "Two-step sign-in reset", body: "They'll set up a new authenticator the next time they sign in." },
      context.userId,
    );
    return { removed };
  });
