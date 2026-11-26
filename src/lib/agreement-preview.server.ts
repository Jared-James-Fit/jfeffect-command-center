/** Read-only agreement access uses the same staff/client authorization as setup preview. */
export async function agreementReadContext(context: { supabase: any; userId: string }, clientId: string) {
  const { assertStaffReachesClient } = await import("@/lib/staff-client-access.server");
  await assertStaffReachesClient(context.supabase, context.userId, clientId);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.from("clients").select("user_id").eq("id", clientId).maybeSingle();
  if (error || !data?.user_id) throw new Error("Account not linked");
  return { supabase: supabaseAdmin, userId: data.user_id };
}
