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
import { ADMIN_VIEW_HEADER, MFA_REQUIRED, type Permission } from "@/lib/permissions";

export type PermissionContext = { supabase: any; userId: string; claims?: Record<string, any> | null };

export async function assertPermission(ctx: PermissionContext, perm: Permission): Promise<void> {
  // Same rule as has_permission(): a password-only (aal1) session never passes.
  if (ctx.claims?.aal !== "aal2") throw new Error(`${MFA_REQUIRED}: verify with your authenticator app first`);
  const { data, error } = await ctx.supabase.rpc("has_permission", { _uid: ctx.userId, _perm: perm });
  if (error) throw new Error(`Permission check failed: ${error.message}`);
  if (data !== true) throw new Error(`Forbidden: missing ${perm}`);
}

// Roles that hold named permissions (public.role_permissions). Anyone else
// who isn't the admin gets the usual "Forbidden: admin only".
const PERMISSION_ROLES = new Set(["finance"]);

/** "admin", "permissions" (ask has_permission) or "none". */
async function callerKind(ctx: PermissionContext): Promise<"admin" | "permissions" | "none"> {
  // The caller's own rows: a view-only login is never counted as an admin here.
  const { data, error } = await ctx.supabase.from("user_roles").select("role").eq("user_id", ctx.userId);
  if (error) throw new Error(`Permission check failed: ${error.message}`);
  const roles: string[] = (data ?? []).map((r: any) => r.role as string);
  if (roles.includes("admin")) return "admin";
  return roles.some((r) => PERMISSION_ROLES.has(r)) ? "permissions" : "none";
}

async function assertAdminOrPermission(ctx: PermissionContext, perm: Permission): Promise<boolean> {
  const kind = await callerKind(ctx);
  if (kind === "admin") return false;
  if (kind === "none") throw new Error("Forbidden: admin only");
  await assertPermission(ctx, perm);
  return true;
}

/**
 * For handlers that only read: the admin, or a view-only login (admin.view,
 * MFA-verified). Returns the client to read with. For a view-only login that's
 * its own client plus the admin-view header, which the database honours for
 * reads only, so it gets back what the admin would.
 *
 * Only for handlers that write nothing, send nothing and hand out no
 * credentials (tokens, setup or invite links).
 */
export async function assertAdminView(ctx: PermissionContext): Promise<{ db: any; viewOnly: boolean }> {
  if (!(await assertAdminOrPermission(ctx, "admin.view"))) return { db: ctx.supabase, viewOnly: false };
  return { db: await adminViewClient(), viewOnly: true };
}

/**
 * For the few changes a view-only login may make: the admin, or someone with
 * `perm` (MFA-verified). `viewOnly` is true when it wasn't the admin.
 */
export async function assertAdminOr(ctx: PermissionContext, perm: Permission): Promise<{ viewOnly: boolean }> {
  return { viewOnly: await assertAdminOrPermission(ctx, perm) };
}

/**
 * For read-only handlers with no admin check of their own, where RLS or the
 * database function decides what comes back: a view-only login reads through
 * its admin view, everyone else keeps their own client. Never use it where a
 * read decides whether something may be changed.
 */
export async function readClientFor(ctx: PermissionContext): Promise<{ db: any; viewOnly: boolean }> {
  const own = { db: ctx.supabase, viewOnly: false };
  if (ctx.claims?.aal !== "aal2") return own; // every view-only session is MFA-verified
  if ((await callerKind(ctx)) !== "permissions") return own;
  try {
    await assertPermission(ctx, "admin.view");
  } catch {
    return own;
  }
  return { db: await adminViewClient(), viewOnly: true };
}

/**
 * Calls a read-only (STABLE) database function as a read, so the admin view
 * applies. Null arguments are left out, so the function's defaults apply.
 */
export function rpcRead(db: any, fn: string, args: Record<string, unknown>) {
  const given = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== null && v !== undefined));
  return db.rpc(fn, given, { get: true });
}

/** The caller's own client plus the admin-view header (reads only; see assertAdminView). */
export async function adminViewClient(): Promise<any> {
  const { getRequest } = await import("@tanstack/react-start/server");
  const { createClient } = await import("@supabase/supabase-js");
  const auth = getRequest()?.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) throw new Error("Unauthorized: No authorization header provided");
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: auth, [ADMIN_VIEW_HEADER]: "1" } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

/** A copy of `row` without credential fields, for a view-only caller. */
export function withoutCredentials<T extends Record<string, any>>(row: T): T {
  if (!row || typeof row !== "object") return row;
  const { setup_token, setup_token_expires_at, ...rest } = row as any;
  return rest as T;
}
