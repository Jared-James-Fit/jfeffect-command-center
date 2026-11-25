/**
 * Premium (premium.ts): whether the signed-in person has it, the admin's
 * complimentary grant, and the Cleo inbox. No purchase path: Premium is sold
 * only once the App Store decision is made.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { CLEO_WELCOME, PREMIUM_KEY, type CleoInboxItem } from "./premium";

async function assertAdmin(supabase: any, userId: string) {
  const { data } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (!data) throw new Error("Only the owner can grant Premium.");
}

/** The signed-in person's own Premium (my_premium(): never anyone else's). */
export const getMyPremium = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ premium: boolean }> => {
    const { supabase } = context as any;
    const { data, error } = await supabase.rpc("my_premium");
    if (error) return { premium: false };
    return { premium: data === true };
  });

/** Admin only: Premium on or off for a member, as complimentary (there's nothing to buy yet). */
export const setComplimentaryPremium = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ memberId: z.string().uuid(), on: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: member } = await db.from("app_members").select("id, user_id").eq("id", data.memberId).maybeSingle();
    if (!member) throw new Error("That member isn't there any more.");
    const { data: existing } = await db
      .from("member_access")
      .select("id")
      .eq("member_id", member.id)
      .eq("access_level_key", PREMIUM_KEY)
      .maybeSingle();
    if (existing) {
      const { error } = await db.from("member_access").update({ active: data.on, expires_at: null, notes: data.on ? "Complimentary Premium" : "Premium removed" }).eq("id", existing.id);
      if (error) throw new Error(error.message);
    } else if (data.on) {
      const { error } = await db.from("member_access").insert({ member_id: member.id, access_level_key: PREMIUM_KEY, source: "admin_grant", active: true, notes: "Complimentary Premium" });
      if (error) throw new Error(error.message);
    }
    if (data.on && member.user_id) {
      // Cleo says hello once (the inbox keeps one welcome per person)
      await db
        .from("cleo_inbox_messages")
        .upsert({ user_id: member.user_id, kind: "welcome", period_key: "", title: CLEO_WELCOME.title, body: CLEO_WELCOME.body, cards: [] }, { onConflict: "user_id,kind,period_key", ignoreDuplicates: true });
    }
    return { ok: true, premium: data.on };
  });

/** The Premium member's own Cleo inbox, newest first (RLS: their own rows). */
export const listMyCleoInbox = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ premium: boolean; items: CleoInboxItem[] }> => {
    const { supabase, userId } = context as any;
    const { data: premium } = await supabase.rpc("my_premium");
    if (premium !== true) return { premium: false, items: [] };
    const { data, error } = await supabase
      .from("cleo_inbox_messages")
      .select("id, kind, title, body, cards, created_at, read_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) throw new Error(error.message);
    return { premium: true, items: (data ?? []) as CleoInboxItem[] };
  });

export const markCleoInboxRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ ids: z.array(z.string().uuid()).max(50) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    if (!data.ids.length) return { ok: true };
    const { error } = await supabase.from("cleo_inbox_messages").update({ read_at: new Date().toISOString() }).in("id", data.ids).eq("user_id", userId).is("read_at", null);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
