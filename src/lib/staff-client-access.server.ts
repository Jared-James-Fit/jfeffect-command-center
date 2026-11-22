/**
 * May this signed-in staff member act on this client? The admin, or the
 * client's own coach: a staff role, and the client's row readable through
 * their own login (RLS on clients: the admin sees everyone, a coach only the
 * clients assigned to them). Server functions that check a staff role and then
 * read or write a client's data with the service role ask this first, so a
 * coach's role never reaches another coach's client. Server-only.
 */
export async function staffCanReachClient(supabase: any, userId: string, clientId: string | null | undefined): Promise<boolean> {
  if (!clientId) return false;
  const [{ data: admin }, { data: coach }, { data: row }] = await Promise.all([
    supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
    supabase.rpc("has_role", { _user_id: userId, _role: "coach" }),
    supabase.from("clients").select("id").eq("id", clientId).maybeSingle(),
  ]);
  return (!!admin || !!coach) && !!row;
}

/** The same, for several clients at once: the ones this staff member can't reach. */
export async function staffUnreachableClients(supabase: any, userId: string, clientIds: string[]): Promise<string[]> {
  const ids = [...new Set(clientIds)];
  if (!ids.length) return [];
  const [{ data: admin }, { data: coach }] = await Promise.all([
    supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
    supabase.rpc("has_role", { _user_id: userId, _role: "coach" }),
  ]);
  if (!admin && !coach) return ids;
  const seen = new Set<string>();
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await supabase.from("clients").select("id").in("id", ids.slice(i, i + 150));
    if (error) throw new Error(error.message);
    for (const r of data ?? []) seen.add(r.id);
  }
  return ids.filter((id) => !seen.has(id));
}

/** Throws unless this staff member can act on this client. */
export async function assertStaffReachesClient(supabase: any, userId: string, clientId: string | null | undefined): Promise<void> {
  if (!(await staffCanReachClient(supabase, userId, clientId))) throw new Error("Coach access required");
}
