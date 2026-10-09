/**
 * Guards for account setup links and for the staff / personal account split.
 *
 * Staff accounts are separate from personal accounts:
 *   - anyone with a staff role (admin, coach, media_manager, finance) uses a
 *     staff-only login with its own email;
 *   - a personal client or member account never holds a staff role;
 *   - a staff account never has a clients or app_members row.
 * One person's staff roles share one staff account.
 *
 * These helpers enforce it when staff are invited and accounts are set up,
 * with a clear error for the admin.
 *
 * Server-only. Do NOT import from client modules.
 */

const PAGE_SIZE = 1000;

export const STAFF_ROLES = ["admin", "coach", "media_manager", "finance"] as const;

// Roles a staff invite link may grant. Admin is granted only by an existing
// admin inside the app, never by a link. Coaches have their own invite flow.
const LINK_REDEEMABLE_ROLES = new Set(["media_manager", "finance"]);

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

async function targetUserIds(supabaseAdmin: any, opts: { email?: string | null; userId?: string | null }): Promise<string[]> {
  const ids = new Set<string>();
  if (opts.userId) ids.add(opts.userId);
  if (opts.email) {
    const match = await findAuthUserByEmail(supabaseAdmin, opts.email);
    if (match) ids.add(match.id);
  }
  return Array.from(ids);
}

/**
 * Personal side: refuse when the email or user belongs to a staff account.
 * Used before creating or sending credentials for a client or member, and
 * before a setup link sets a password.
 */
export async function assertNotStaffAccount(
  supabaseAdmin: any,
  opts: { email?: string | null; userId?: string | null },
  message = "This email belongs to a staff account. Use a different email for this client or member.",
): Promise<void> {
  const ids = await targetUserIds(supabaseAdmin, opts);
  if (ids.length === 0) return;
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("user_id, role")
    .in("user_id", ids)
    .in("role", STAFF_ROLES as unknown as string[]);
  if (error) throw new Error(error.message);
  if (data && data.length > 0) throw new Error(message);
}

/** A setup link must never set the password of a staff account. */
export async function assertNotPrivilegedUser(supabaseAdmin: any, userId: string): Promise<void> {
  await assertNotStaffAccount(
    supabaseAdmin,
    { userId },
    "This email belongs to a staff account, so this link can't set its password. Sign in with your existing password or use Forgot password.",
  );
}

/**
 * Staff side: refuse when the email or user is a personal account, meaning it
 * has a clients or app_members row. Used before inviting or granting a staff role.
 */
export async function assertNoPersonalAccount(
  supabaseAdmin: any,
  opts: { email?: string | null; userId?: string | null },
): Promise<void> {
  const personal = "This email belongs to a client or member account. Staff need a separate staff-only email.";
  const ids = await targetUserIds(supabaseAdmin, opts);
  for (const table of ["clients", "app_members"]) {
    if (ids.length) {
      const { data, error } = await supabaseAdmin.from(table).select("id").in("user_id", ids).limit(1);
      if (error) throw new Error(error.message);
      if (data && data.length > 0) throw new Error(personal);
    }
    if (opts.email) {
      const { data, error } = await supabaseAdmin.from(table).select("id").ilike("email", opts.email.trim()).limit(1);
      if (error) throw new Error(error.message);
      if (data && data.length > 0) throw new Error(personal);
    }
  }
}

/**
 * A staff invite link always creates a brand-new staff-only login. Refuse an
 * email that already has any login (personal or staff) or a client/member
 * record. Adding a role to an existing staff account is an in-app grant.
 */
export async function assertEmailFreeForStaffInvite(supabaseAdmin: any, email: string): Promise<void> {
  if (await findAuthUserByEmail(supabaseAdmin, email)) {
    throw new Error("This email already has a JF Effect login. A staff invite needs an email with no account. Ask the admin to add the role to an existing staff login instead.");
  }
  await assertNoPersonalAccount(supabaseAdmin, { email });
}

/**
 * After creating a staff-only user: leave it holding only its staff role.
 * handle_new_user skips the client role for app_metadata.account_kind =
 * 'staff' (migration 20261018100200); this also covers a database where that
 * migration isn't applied yet.
 */
export async function finalizeStaffOnlyUser(supabaseAdmin: any, userId: string, role: string): Promise<void> {
  const { error: roleErr } = await supabaseAdmin
    .from("user_roles").upsert({ user_id: userId, role }, { onConflict: "user_id,role" });
  if (roleErr) throw new Error(roleErr.message);
  const { error: delErr } = await supabaseAdmin
    .from("user_roles").delete().eq("user_id", userId).eq("role", "client");
  if (delErr) throw new Error(delErr.message);
  for (const table of ["clients", "app_members"]) {
    const { data, error } = await supabaseAdmin.from(table).select("id").eq("user_id", userId).limit(1);
    if (error) throw new Error(error.message);
    if (data && data.length > 0) throw new Error(`Staff-only account is linked to a ${table} row; refusing to finish setup.`);
  }
}
