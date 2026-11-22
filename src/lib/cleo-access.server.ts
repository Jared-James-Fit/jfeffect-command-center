/**
 * Who may use Cleo, decided on the server before any Cleo function does
 * anything: the database's `cleo_allowed()` (20270505090000_cleo_access.sql),
 * so a switched-off role is refused here even if a screen still shows the way in.
 *
 * - the admin: always, reading with their own login;
 * - the finance login: while the admin has it on, reading through the admin view (view-only);
 * - a coach: while the admin has coaches on, reading with their own login, so RLS
 *   keeps them to what their app already shows them (their own clients), and
 *   never the books;
 * - clients and JF members: never (there is no client-facing Cleo).
 *
 * Server only.
 */
import { assertAdminView, type PermissionContext } from "@/lib/permissions.server";

export type CleoCaller = {
  /** What Cleo reads with. */
  db: any;
  /** The finance login (reads through the admin view). */
  viewOnly: boolean;
  /** A coach on the team (own login, no books). */
  coach: boolean;
};

export const CLEO_OFF_MESSAGE = "Cleo isn't switched on for your account.";

/** The database doesn't have `cleo_allowed()` yet (the app shipped before its migration ran). */
export function isMissingFunction(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "PGRST202" || error.code === "42883" || /could not find the function|function .* does not exist/i.test(error.message ?? "");
}

/**
 * Whether these roles may use Cleo. `allowed` is cleo_allowed()'s answer; when the
 * function isn't there yet, the rule from before it existed: the admin and the finance login.
 */
export function cleoAllowedFor(roles: string[], allowed: boolean | null): boolean {
  if (allowed !== null) return allowed;
  return roles.includes("admin") || roles.includes("finance");
}

async function rolesOf(ctx: PermissionContext): Promise<string[]> {
  const { data: rows, error } = await ctx.supabase.from("user_roles").select("role").eq("user_id", ctx.userId);
  if (error) throw new Error(`Couldn't check Cleo access: ${error.message}`);
  return (rows ?? []).map((r: any) => String(r.role));
}

/** May this caller use Cleo? (No reads chosen yet: see assertCleo.) */
export async function cleoAllowed(ctx: PermissionContext): Promise<{ allowed: boolean; roles: string[] }> {
  const [roles, { data, error }] = await Promise.all([rolesOf(ctx), ctx.supabase.rpc("cleo_allowed")]);
  if (error && !isMissingFunction(error)) throw new Error(`Couldn't check Cleo access: ${error.message}`);
  return { allowed: cleoAllowedFor(roles, error ? null : data === true), roles };
}

export async function assertCleo(ctx: PermissionContext): Promise<CleoCaller> {
  const { allowed, roles } = await cleoAllowed(ctx);
  if (!allowed) throw new Error(CLEO_OFF_MESSAGE);
  if (roles.includes("admin")) return { db: ctx.supabase, viewOnly: false, coach: false };
  // Same order as cleo_allowed(): the finance login before a coach.
  if (roles.includes("finance")) {
    const { db, viewOnly } = await assertAdminView(ctx);
    return { db, viewOnly, coach: false };
  }
  if (roles.includes("coach")) return { db: ctx.supabase, viewOnly: false, coach: true };
  throw new Error(CLEO_OFF_MESSAGE);
}
