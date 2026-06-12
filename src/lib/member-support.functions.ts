import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Category = z.enum(["question", "bug", "suggestion", "reply"]);

/** Member: get-or-create own thread + list messages. */
export const getMySupportThread = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: me } = await supabase.from("app_members").select("id").eq("user_id", userId).maybeSingle();
    if (!me) throw new Error("Member not found");
    let { data: thread } = await supabase
      .from("member_support_threads").select("*").eq("member_id", me.id).maybeSingle();
    if (!thread) {
      const ins = await supabase.from("member_support_threads")
        .insert({ member_id: me.id }).select("*").single();
      if (ins.error) throw new Error(ins.error.message);
      thread = ins.data;
    }
    const { data: messages } = await supabase
      .from("member_support_messages")
      .select("*")
      .eq("thread_id", thread.id)
      .order("created_at", { ascending: true });
    return { thread, messages: messages ?? [] };
  });

/** Member: send a message. */
export const sendSupportMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      body: z.string().trim().min(1).max(4000),
      category: Category.default("question"),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: me } = await supabase.from("app_members").select("id").eq("user_id", userId).maybeSingle();
    if (!me) throw new Error("Member not found");
    let { data: thread } = await supabase
      .from("member_support_threads").select("id").eq("member_id", me.id).maybeSingle();
    if (!thread) {
      const ins = await supabase.from("member_support_threads")
        .insert({ member_id: me.id }).select("id").single();
      if (ins.error) throw new Error(ins.error.message);
      thread = ins.data;
    }
    const { error } = await supabase.from("member_support_messages").insert({
      thread_id: thread.id,
      member_id: me.id,
      sender_user_id: userId,
      sender_role: "member",
      category: data.category,
      body: data.body,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Member: mark team messages read. */
export const markMyThreadRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: me } = await supabase.from("app_members").select("id").eq("user_id", userId).maybeSingle();
    if (!me) return { ok: true };
    await supabase.from("member_support_threads").update({ unread_for_member: 0 }).eq("member_id", me.id);
    return { ok: true };
  });

/* ---------- Admin / team ---------- */

async function assertTeam(ctx: any) {
  const { data: isAdmin } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
  if (isAdmin) return;
  const { data: coach } = await ctx.supabase
    .from("coaches").select("id").eq("user_id", ctx.userId).eq("archived", false).eq("status", "Active").maybeSingle();
  if (!coach) throw new Error("Team access required");
}

export const listSupportThreads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { status?: string } | undefined) => i ?? {})
  .handler(async ({ data, context }) => {
    await assertTeam(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("member_support_threads")
      .select("*, member:app_members!member_support_threads_member_id_fkey(id, full_name, email, avatar_url, account_type)")
      .order("last_member_message_at", { ascending: false, nullsFirst: false });
    if (data?.status) q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return { threads: rows ?? [] };
  });

export const getSupportThread = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { threadId: string }) => z.object({ threadId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertTeam(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: thread } = await supabaseAdmin
      .from("member_support_threads")
      .select("*, member:app_members!member_support_threads_member_id_fkey(id, full_name, email, avatar_url, account_type, phone)")
      .eq("id", data.threadId).maybeSingle();
    if (!thread) throw new Error("Thread not found");
    const { data: messages } = await supabaseAdmin
      .from("member_support_messages")
      .select("*")
      .eq("thread_id", data.threadId)
      .order("created_at", { ascending: true });
    // Mark read for team.
    await supabaseAdmin.from("member_support_threads").update({ unread_for_team: 0 }).eq("id", data.threadId);
    return { thread, messages: messages ?? [] };
  });

export const replySupportMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      threadId: z.string().uuid(),
      body: z.string().trim().min(1).max(4000),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertTeam(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: thread } = await supabaseAdmin
      .from("member_support_threads").select("member_id").eq("id", data.threadId).maybeSingle();
    if (!thread) throw new Error("Thread not found");
    const { error } = await supabaseAdmin.from("member_support_messages").insert({
      thread_id: data.threadId,
      member_id: thread.member_id,
      sender_user_id: context.userId,
      sender_role: "team",
      category: "reply",
      body: data.body,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setSupportThreadStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      threadId: z.string().uuid(),
      status: z.enum(["open", "answered", "closed"]),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertTeam(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("member_support_threads").update({ status: data.status }).eq("id", data.threadId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });