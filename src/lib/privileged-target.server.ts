/**
 * Server only. Shared by every server function that mints or sends a sign-in link for a
 * client (email, copy, text).
 */
// SECURITY: Refuse to operate on any auth user that holds a privileged role
// (admin or coach). Without this guard, a client record that happens to share
// an email with an admin/coach — or whose user_id was auto-linked to one —
// would let setup / reset / password operations silently overwrite the
// admin's credentials.
export async function assertNotPrivilegedTarget(opts: { email?: string | null; userId?: string | null }) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const targetIds = new Set<string>();
  if (opts.userId) targetIds.add(opts.userId);
  if (opts.email) {
    const { data: list } = await supabaseAdmin.auth.admin.listUsers();
    const match = list.users.find(
      (u: any) => (u.email || "").toLowerCase() === opts.email!.toLowerCase(),
    );
    if (match) targetIds.add(match.id);
  }
  if (targetIds.size === 0) return;
  const { data: roles, error } = await supabaseAdmin
    .from("user_roles")
    .select("user_id, role")
    .in("user_id", Array.from(targetIds))
    .in("role", ["admin", "coach"]);
  if (error) throw new Error(error.message);
  if (roles && roles.length > 0) {
    throw new Error(
      "Refusing to send/generate a credential link: the target email is associated with an admin or coach account. Use a different email for this client record.",
    );
  }
}
