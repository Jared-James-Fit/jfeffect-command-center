/**
 * The owner's reset of a teammate's two-step sign-in (mfa-rules.ts, two-step.ts),
 * for a lost phone with no other way left. There are no recovery codes: a lost
 * phone is another way on another device (Face ID syncs with their Apple
 * account, a trusted computer), the same number on a new phone, or this.
 * Every reset pushes the person and the owner.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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

export const resetTeammateTwoStep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ userId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const s = await h();
    const db = await s.admin();
    const { data: me } = await db
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (!me) throw new Error("Only the owner can reset two-step sign-in.");
    if (!(await s.sessionConfirmed(db, context.userId, context.claims as any)))
      throw new Error("Confirm it's you first.");
    if (data.userId === context.userId)
      throw new Error("You can't reset your own two-step sign-in.");
    const { data: roles } = await db.from("user_roles").select("role").eq("user_id", data.userId);
    const isStaff = (roles ?? []).some(
      (r: any) => r.role && r.role !== "client" && r.role !== "member",
    );
    if (!isStaff) throw new Error("That login isn't on the team.");

    const removed = await removeAuthenticators(db, data.userId);
    // Phone numbers, passkeys, trusted devices and confirmed sessions go too.
    const { error } = await db.rpc("staff_mfa_reset_record", {
      _uid: data.userId,
      _actor: context.userId,
    });
    if (error) throw new Error(`Couldn't record the reset: ${error.message}`);
    await s.tellTwoStep(
      db,
      data.userId,
      {
        title: "Your two-step sign-in was reset",
        body: "Open the app and set it up again: a text, Face ID or an authenticator app.",
      },
      {
        title: "Two-step sign-in reset",
        body: "They'll set it up again the next time they open the app.",
      },
      context.userId,
    );
    return { removed };
  });
