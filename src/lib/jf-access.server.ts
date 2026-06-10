// Server-side gate for member-facing data. Throws when the caller is a
// JF Member without a verified Active/Trialing Stripe subscription.
// Coaches, admins, and non-JF account types pass through unchanged.
export async function assertMemberCanReadProtected(supabase: any, userId: string) {
  // Admins/coaches always allowed
  const { data: roleRow } = await supabase
    .from("user_roles").select("role").eq("user_id", userId).maybeSingle();
  if (roleRow?.role === "admin") return;
  const { data: coach } = await supabase
    .from("coaches").select("id").eq("user_id", userId).eq("archived", false).maybeSingle();
  if (coach) return;

  // Member?
  const { data: m } = await supabase
    .from("app_members").select("account_type,subscription_status,status").eq("user_id", userId).maybeSingle();
  if (!m) {
    // Not a member at all — let other queries return their own empty/auth errors
    return;
  }
  if (m.account_type === "jf_member") {
    const ok = ["Trialing", "Active"].includes(m.subscription_status ?? "") && m.status === "Active";
    if (!ok) throw new Error("Your JF Membership isn't active. Please update billing.");
  }
}