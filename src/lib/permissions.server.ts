/**
 * Server-side permission check. New server functions use this instead of
 * copy-pasting a local assertAdmin:
 *
 *   createServerFn(...).middleware([requirePermission("finance.read")])   // permissions.middleware.ts
 *
 * or, inside a handler that already has the requireSupabaseAuth context:
 *
 *   await assertPermission(context, "finance.record");
 *
 * Server-only. Do NOT import from client modules.
 */
import { MFA_REQUIRED, type Permission } from "@/lib/permissions";

export type PermissionContext = { supabase: any; userId: string; claims?: Record<string, any> | null };

export async function assertPermission(ctx: PermissionContext, perm: Permission): Promise<void> {
  // Same rule as has_permission(): a password-only (aal1) session never passes.
  if (ctx.claims?.aal !== "aal2") throw new Error(`${MFA_REQUIRED}: verify with your authenticator app first`);
  const { data, error } = await ctx.supabase.rpc("has_permission", { _uid: ctx.userId, _perm: perm });
  if (error) throw new Error(`Permission check failed: ${error.message}`);
  if (data !== true) throw new Error(`Forbidden: missing ${perm}`);
}
