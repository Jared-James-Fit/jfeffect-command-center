/**
 * Guards for public setup-link redemption (member and staff invites).
 *
 * A setup token sets the password of whatever auth user owns the invite's
 * email. These helpers stop that from ever touching an admin or coach
 * account, and find existing users without missing anyone past the first
 * page of auth users.
 *
 * Server-only. Do NOT import from client modules.
 */

const PAGE_SIZE = 1000;

// Roles a staff invite link may grant. Admin (and any other privileged role)
// is granted only by an existing admin inside the app, never by a link.
const LINK_REDEEMABLE_ROLES = new Set(["media_manager", "finance"]);

// Roles that live on their own staff-only login: a fresh account with its own
// email, no client role, no clients/app_members row, no client portal.
const STAFF_ONLY_ROLES = new Set(["finance"]);

export function isStaffOnlyRole(role: string | null | undefined): boolean {
  return !!role && STAFF_ONLY_ROLES.has(role);
}

export function assertInviteRoleRedeemable(role: string | null | undefined): void {
  if (!role || !LINK_REDEEMABLE_ROLES.has(role)) {
    throw new Error("This invite can't be redeemed. Ask the admin for a new one.");
  }
}

export async function findAuthUserByEmail(supabaseAdmin: any, email: string): Promise<{ id: string } | null> {
  const target = email.trim().toLowerCase();
  for (let page = 1; ; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
    if (error) throw new Error(error.message);
    const users: any[] = data?.users ?? [];
    const match = users.find((u) => (u.email || "").toLowerCase() === target);
    if (match) return { id: match.id };
    if (users.length < PAGE_SIZE) return null;
  }
}

export async function assertNotPrivilegedUser(supabaseAdmin: any, userId: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .in("role", ["admin", "coach"]);
  if (error) throw new Error(error.message);
  if (data && data.length > 0) {
    throw new Error(
      "This email belongs to a staff account, so this link can't set its password. Sign in with your existing password or use Forgot password.",
    );
  }
}

/**
 * A staff-only login must be a brand-new account. Refuse an email that already
 * belongs to an auth user, a client or a member, so a client's own login can
 * never be turned into (or merged with) a staff login.
 */
export async function assertEmailFreeForStaffOnly(supabaseAdmin: any, email: string): Promise<void> {
  const target = email.trim().toLowerCase();
  const taken = "This email already has a JF Effect account. A finance login needs its own email. Ask the admin for an invite to a different address.";
  if (await findAuthUserByEmail(supabaseAdmin, target)) throw new Error(taken);
  for (const table of ["clients", "app_members"]) {
    const { data, error } = await supabaseAdmin.from(table).select("id").ilike("email", target).limit(1);
    if (error) throw new Error(error.message);
    if (data && data.length > 0) throw new Error(taken);
  }
}

/**
 * After creating a staff-only user: leave it holding only its staff role.
 * handle_new_user skips the client role for app_metadata.account_kind =
 * 'staff' (migration 20261015090200); this also covers a database where that
 * migration isn't applied yet.
 */
export async function finalizeStaffOnlyUser(supabaseAdmin: any, userId: string, role: string): Promise<void> {
  const { error: roleErr } = await supabaseAdmin
    .from("user_roles").upsert({ user_id: userId, role }, { onConflict: "user_id,role" });
  if (roleErr) throw new Error(roleErr.message);
  const { error: delErr } = await supabaseAdmin
    .from("user_roles").delete().eq("user_id", userId).neq("role", role);
  if (delErr) throw new Error(delErr.message);
  for (const table of ["clients", "app_members"]) {
    const { data, error } = await supabaseAdmin.from(table).select("id").eq("user_id", userId).limit(1);
    if (error) throw new Error(error.message);
    if (data && data.length > 0) throw new Error(`Staff-only account is linked to a ${table} row; refusing to finish setup.`);
  }
}
