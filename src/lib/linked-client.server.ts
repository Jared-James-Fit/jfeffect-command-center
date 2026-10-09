/**
 * A person's own client account, from any of their logins.
 *
 * Staff logins are separate from client accounts (a staff invite always
 * creates a new login). When the owner links a team member's login to their
 * client account, the link is community_profiles.same_person_as, the same
 * "this is the same person" link community_main_account() already follows.
 * Only ever resolves the caller's own link (or, for the owner, a team
 * member's), never an arbitrary client.
 */
async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

export async function ownOrLinkedClient(userId: string): Promise<{ id: string; name: string } | null> {
  const sb = await admin();
  const pick = async (uid: string) => {
    const { data } = await sb.from("clients").select("id, full_name, first_name").eq("user_id", uid).maybeSingle();
    return data ? { id: data.id as string, name: ((data.full_name || data.first_name || "") as string).trim() } : null;
  };
  const own = await pick(userId);
  if (own) return own;
  const { data: link } = await sb.from("community_profiles").select("same_person_as").eq("user_id", userId).maybeSingle();
  return link?.same_person_as ? pick(link.same_person_as as string) : null;
}
