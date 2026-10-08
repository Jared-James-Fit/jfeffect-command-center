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
