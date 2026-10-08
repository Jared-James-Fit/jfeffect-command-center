/**
 * Read / save the signed-in athlete's own sex answer.
 *
 * Saves run server-side for the caller's own row only: coached clients write
 * clients.sex (DB triggers mirror it to the macro calculator's member field),
 * self-serve members without a client row write app_members.biological_sex.
 * "Prefer not to say" is an answer too; members record it as a seen marker
 * since their column only holds male/female.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { asAthleteSex, type AthleteSex } from "@/lib/athlete-sex";

const MEMBER_UNSPECIFIED_KEY = "sex_unspecified";

// feature_announcement_views isn't in the generated types (same as league-recap.ts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function admin(): Promise<any> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export type MySex = { sex: AthleteSex | null; account: "client" | "member" | "none" };

export const getMySexFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MySex> => {
    const sb = await admin();
    const { data: client } = await sb
      .from("clients")
      .select("sex")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (client) return { sex: asAthleteSex(client.sex), account: "client" };
    const { data: member } = await sb
      .from("app_members")
      .select("biological_sex")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!member) return { sex: null, account: "none" };
    if (member.biological_sex)
      return { sex: asAthleteSex(member.biological_sex), account: "member" };
    const { data: marker } = await sb
      .from("feature_announcement_views")
      .select("feature_key")
      .eq("user_id", context.userId)
      .eq("feature_key", MEMBER_UNSPECIFIED_KEY)
      .maybeSingle();
    return { sex: marker ? "unspecified" : null, account: "member" };
  });

export const saveMySexFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ sex: z.enum(["male", "female", "unspecified"]) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const sb = await admin();
    const { data: client } = await sb
      .from("clients")
      .select("id")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (client) {
      const { error } = await sb.from("clients").update({ sex: data.sex }).eq("id", client.id);
      if (error) throw new Error(error.message);
      return { ok: true };
    }
    const { data: member } = await sb
      .from("app_members")
      .select("id")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!member) throw new Error("No profile to save to");
    const { error } = await sb
      .from("app_members")
      .update({ biological_sex: data.sex === "unspecified" ? null : data.sex })
      .eq("id", member.id);
    if (error) throw new Error(error.message);
    if (data.sex === "unspecified") {
      await sb
        .from("feature_announcement_views")
        .upsert(
          { user_id: context.userId, feature_key: MEMBER_UNSPECIFIED_KEY },
          { onConflict: "user_id,feature_key", ignoreDuplicates: true },
        );
    } else {
      await sb
        .from("feature_announcement_views")
        .delete()
        .eq("user_id", context.userId)
        .eq("feature_key", MEMBER_UNSPECIFIED_KEY);
    }
    return { ok: true };
  });
