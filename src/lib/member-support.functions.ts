import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { avatarFor } from "@/lib/member-support";

/**
 * JF Effect Support: everyone's one conversation with JF Effect, a chat in
 * their Messages (/portal/messages?chat=support) for JF members and coaching
 * clients alike. The team answers in the coach's Messages, where each chat is
 * a row in 1:1 Chats (staff_support_threads, member-support-pane.tsx). Each
 * side gets a push when the other writes (support_message / support_reply).
 * A member's thread is keyed by their member row, a coaching client's by
 * their client row; writes go through here as the server after the login is
 * checked (20270527106000_support_conversation_for_everyone.sql).
 *
 * A thread exists only once someone writes: opening Support never makes one,
 * so the coach's list never fills with empty chats.
 */

const Body = z.string().trim().min(1).max(4000);

/** The member's own client record (every member has one), for pushes. */
async function clientIdForUser(admin: any, userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const { data } = await admin
    .from("clients")
    .select("id, service_tier")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  const rows = (data ?? []) as { id: string; service_tier: string | null }[];
  return (rows.find((r) => r.service_tier === "self_serve") ?? rows[0])?.id ?? null;
}

/* ---------- Member or client ---------- */

/**
 * Who is writing: their member row (a JF member) and their client row (every
 * athlete has one), read as the server after the login is known. A coaching
 * client may have no member row: their thread is keyed by their client row.
 */
async function myPerson(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const admin = supabaseAdmin as any;
  const [{ data: member }, { data: clients }] = await Promise.all([
    admin.from("app_members").select("id").eq("user_id", userId).maybeSingle(),
    admin.from("clients").select("id, service_tier, archived").eq("user_id", userId).order("created_at", { ascending: true }),
  ]);
  const rows = (clients ?? []) as { id: string; service_tier: string | null; archived: boolean | null }[];
  const client = (member ? rows.find((r) => r.service_tier === "self_serve") : null)
    ?? rows.find((r) => r.service_tier === "coaching" && !r.archived)
    ?? rows[0]
    ?? null;
  return {
    admin,
    memberId: (member?.id ?? null) as string | null,
    clientId: client?.id ?? null,
    clientIds: rows.map((r) => r.id),
    tier: (client?.service_tier ?? (member ? "self_serve" : null)) as string | null,
  };
}

type Person = Awaited<ReturnType<typeof myPerson>>;

/** Their Support thread, by their member row or any client row of theirs (null until the first message). */
async function findMyThread(p: Person): Promise<any | null> {
  const ors: string[] = [];
  if (p.memberId) ors.push(`member_id.eq.${p.memberId}`);
  if (p.clientIds.length) ors.push(`client_id.in.(${p.clientIds.join(",")})`);
  if (!ors.length) return null;
  const { data } = await p.admin
    .from("member_support_threads").select("*").or(ors.join(","))
    .order("created_at", { ascending: true }).limit(1);
  return (data ?? [])[0] ?? null;
}

async function ensureMyThread(p: Person): Promise<any> {
  const found = await findMyThread(p);
  if (found) return found;
  const ins = await p.admin.from("member_support_threads")
    .insert({ member_id: p.memberId, client_id: p.clientId }).select("*").single();
  if (!ins.error) return ins.data;
  // Two sends at once: the other one made it.
  const again = await findMyThread(p);
  if (!again) throw new Error(ins.error.message);
  return again;
}

/** Member or client: their JF Effect Support chat (null until they first write). */
export const getMySupportThread = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const p = await myPerson(context.userId);
    const thread = await findMyThread(p);
    if (!thread) return { thread: null, messages: [] as any[], tier: p.tier };
    const { data: messages } = await p.admin
      .from("member_support_messages")
      .select("id, sender_role, body, created_at, read_at")
      .eq("thread_id", thread.id)
      .order("created_at", { ascending: true });
    return { thread, messages: messages ?? [], tier: p.tier };
  });

/** Member or client: send a message (makes the chat on the first one) and push the team. */
export const sendSupportMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      body: Body,
      category: z.enum(["question", "bug", "suggestion"]).default("question"),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const p = await myPerson(userId);
    if (!p.memberId && !p.clientId) throw new Error("Support is for JF Effect members and clients.");
    const thread = await ensureMyThread(p);
    const { data: msg, error } = await p.admin.from("member_support_messages").insert({
      thread_id: thread.id,
      member_id: thread.member_id ?? p.memberId,
      sender_user_id: userId,
      sender_role: "member",
      category: data.category,
      body: data.body,
    }).select("id, sender_role, body, created_at").single();
    if (error) throw new Error(error.message);

    // Cleo answers first (a resolved chat that gets a new message goes back to Cleo):
    // inside this send, so the answer is there when it returns; never fails the send.
    const cleoHasIt = thread.status === "closed" || thread.handler === "cleo";
    if (cleoHasIt) {
      try {
        const { runCleoSupportTurn } = await import("@/lib/support-cleo/cleo-support.server");
        const r = await runCleoSupportTurn(p.admin, thread.id, userId);
        return { ok: true, threadId: thread.id as string, message: msg, cleo: r.outcome };
      } catch (e) {
        console.warn("[support] Cleo's turn failed", e);
      }
      return { ok: true, threadId: thread.id as string, message: msg, cleo: "skipped" as const };
    }

    // A person has this chat: tell the team (content-free; never fails the send).
    try {
      const { notifyAppEvent } = await import("@/lib/push/app-events.server");
      const clientId = thread.client_id ?? p.clientId;
      if (clientId) {
        await notifyAppEvent(p.admin, "support_message", {
          clientId, sourceId: msg.id, actorUserId: userId, target: thread.id,
        });
      }
    } catch (e) {
      console.warn("[support] push to team failed", e);
    }
    return { ok: true, threadId: thread.id as string, message: msg, cleo: "team" as const };
  });

/**
 * Member or client: "Talk to a person", always there. Cleo hands the chat to
 * the team at once (it says so once); nothing happens twice if a person has it.
 */
export const askForPerson = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const p = await myPerson(context.userId);
    if (!p.memberId && !p.clientId) throw new Error("Support is for JF Effect members and clients.");
    let thread = await ensureMyThread(p);
    if (thread.handler === "human" && thread.status !== "closed") return { ok: true, already: true };
    if (thread.status === "closed" || thread.handler !== "cleo") {
      const { data } = await p.admin.from("member_support_threads")
        .update({ status: "open", handler: "cleo", escalation: null, escalated_at: null, resolved_by: null, resolved_at: null })
        .eq("id", thread.id).select("*").single();
      thread = data ?? thread;
    }
    const { data: rows } = await p.admin.from("member_support_messages")
      .select("sender_role, body").eq("thread_id", thread.id).order("created_at", { ascending: true }).limit(200);
    const list = (rows ?? []) as { sender_role: string; body: string }[];
    const lastAsk = [...list].reverse().find((m) => m.sender_role === "member")?.body ?? "";
    const { ruleEscalation } = await import("@/lib/support-cleo/rules");
    const { escalateSupportThread } = await import("@/lib/support-cleo/cleo-support.server");
    const { data: c } = thread.client_id
      ? await p.admin.from("clients").select("first_name, preferred_name").eq("id", thread.client_id).maybeSingle()
      : { data: null };
    await escalateSupportThread(p.admin, thread, ruleEscalation({
      category: "human_request", by: "person", lastAsk,
      cleoSaid: list.filter((m) => m.sender_role === "cleo").map((m) => m.body),
      at: new Date().toISOString(),
    }), { firstName: (c as any)?.preferred_name || (c as any)?.first_name || null, actorUserId: context.userId });
    return { ok: true, already: false };
  });

/** Member or client: they've read the team's replies (their read receipt for the team). */
export const markMyThreadRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const p = await myPerson(context.userId);
    const thread = await findMyThread(p);
    if (!thread) return { ok: true };
    const now = new Date().toISOString();
    if ((thread.unread_for_member ?? 0) > 0) {
      await p.admin.from("member_support_threads").update({ unread_for_member: 0 }).eq("id", thread.id);
    }
    await p.admin.from("member_support_messages").update({ read_at: now })
      .eq("thread_id", thread.id).neq("sender_role", "member").is("read_at", null);
    return { ok: true };
  });

/* ---------- Staff (the coach's Messages) ---------- */

type Who = { threadId?: string; clientId?: string };
const WhoSchema = z.object({ threadId: z.string().uuid().optional(), clientId: z.string().uuid().optional() })
  .refine((w) => !!w.threadId || !!w.clientId, "Pick a chat");

/**
 * The person behind a thread or a client record, and whether the signed-in
 * staff member may answer them: an admin always, a coach for the members and
 * clients assigned to them (the tables' own RLS rule).
 */
async function resolveMember(ctx: any, who: Who) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const admin = supabaseAdmin as any;
  let memberId: string | null = null;
  let clientId: string | null = who.clientId ?? null;
  let thread: any = null;
  if (who.threadId) {
    const { data } = await admin.from("member_support_threads").select("*").eq("id", who.threadId).maybeSingle();
    if (!data) throw new Error("That support chat is gone.");
    thread = data;
    memberId = data.member_id ?? null;
    clientId = data.client_id ?? null;
  } else {
    const { data: c } = await admin.from("clients").select("user_id").eq("id", who.clientId).maybeSingle();
    if (!c?.user_id) throw new Error("This person doesn't have an app account yet.");
    const { data: m } = await admin.from("app_members").select("id").eq("user_id", c.user_id).maybeSingle();
    memberId = m?.id ?? null;
    const ors = [`client_id.eq.${who.clientId}`, ...(memberId ? [`member_id.eq.${memberId}`] : [])];
    const { data: t } = await admin.from("member_support_threads").select("*").or(ors.join(","))
      .order("created_at", { ascending: true }).limit(1);
    thread = (t ?? [])[0] ?? null;
  }
  const { data: member } = memberId
    ? await admin.from("app_members").select("id, user_id, full_name, email, avatar_url").eq("id", memberId).maybeSingle()
    : { data: null };
  if (!clientId) clientId = await clientIdForUser(admin, member?.user_id);
  const [{ data: isAdmin }, coachForMember, coachForClient] = await Promise.all([
    ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" }),
    memberId ? ctx.supabase.rpc("is_assigned_coach_for_member", { _member_id: memberId }) : Promise.resolve({ data: false }),
    clientId ? ctx.supabase.rpc("is_assigned_coach", { _client_id: clientId }) : Promise.resolve({ data: false }),
  ]);
  if (!isAdmin && !coachForMember?.data && !coachForClient?.data) throw new Error("Only an admin or their coach can answer this chat.");
  let client: any = null;
  if (clientId) {
    const { data } = await admin
      .from("clients").select("id, user_id, full_name, email, profile_picture_url, service_tier, last_active_at").eq("id", clientId).maybeSingle();
    client = data;
  }
  return { admin, memberId, clientId, thread, member, client };
}

/** Staff: one member's support chat, by its thread or by their client record. Opening it reads it. */
export const getMemberSupport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => WhoSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { admin, thread, member, client } = await resolveMember(context, data);
    let messages: any[] = [];
    if (thread) {
      const { data: rows } = await admin
        .from("member_support_messages")
        .select("id, sender_role, sender_user_id, category, body, created_at, read_at")
        .eq("thread_id", thread.id)
        .order("created_at", { ascending: true });
      messages = rows ?? [];
      if ((thread.unread_for_team ?? 0) > 0) {
        await admin.from("member_support_threads").update({ unread_for_team: 0 }).eq("id", thread.id);
        thread.unread_for_team = 0;
      }
      // Their read receipt: the person sees "Seen" under their last message.
      if (messages.some((m) => m.sender_role === "member" && !m.read_at)) {
        await admin.from("member_support_messages").update({ read_at: new Date().toISOString() })
          .eq("thread_id", thread.id).eq("sender_role", "member").is("read_at", null);
      }
    }
    return {
      thread,
      messages,
      person: {
        clientId: client?.id ?? null,
        name: client?.full_name?.trim() || member?.full_name?.trim() || member?.email || client?.email || "Member",
        email: member?.email ?? client?.email ?? null,
        avatar: avatarFor(client?.profile_picture_url, member?.avatar_url),
        tier: client?.service_tier ?? null,
        lastActiveAt: client?.last_active_at ?? null,
      },
    };
  });

/** Staff: answer a member (starts their chat if there isn't one) and push them. */
export const replyMemberSupport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({
    threadId: z.string().uuid().optional(),
    clientId: z.string().uuid().optional(),
    body: Body,
  }).refine((w) => !!w.threadId || !!w.clientId, "Pick a chat").parse(i))
  .handler(async ({ data, context }) => {
    const resolved = await resolveMember(context, data);
    const { admin, memberId, clientId: resolvedClientId, member, client } = resolved;
    let thread = resolved.thread;
    if (!thread) {
      const ins = await admin.from("member_support_threads").insert({ member_id: memberId, client_id: resolvedClientId }).select("*").single();
      if (ins.error) {
        const again = await admin.from("member_support_threads").select("*")
          .or([`client_id.eq.${resolvedClientId}`, ...(memberId ? [`member_id.eq.${memberId}`] : [])].join(",")).limit(1).maybeSingle();
        if (!again.data) throw new Error(ins.error.message);
        thread = again.data;
      } else {
        thread = ins.data;
      }
    }
    // As the coach (RLS: admin, or their coach), so the row says who wrote it.
    const { data: msg, error } = await context.supabase.from("member_support_messages").insert({
      thread_id: thread.id,
      member_id: thread.member_id ?? memberId,
      sender_user_id: context.userId,
      sender_role: "team",
      category: "reply",
      body: data.body,
    }).select("id, sender_role, sender_user_id, category, body, created_at").single();
    if (error) throw new Error(error.message);
    // A person answered: the chat is theirs now, and Cleo stays quiet in it.
    if (thread.handler !== "human" || !thread.owner_user_id) {
      await admin.from("member_support_threads")
        .update({ handler: "human", owner_user_id: thread.owner_user_id ?? context.userId })
        .eq("id", thread.id);
    }

    try {
      const { notifyAppEvent } = await import("@/lib/push/app-events.server");
      const clientId = client?.id ?? (await clientIdForUser(admin, member?.user_id));
      if (clientId) {
        await notifyAppEvent(admin, "support_reply", { clientId, sourceId: msg.id, actorUserId: context.userId });
      }
    } catch (e) {
      console.warn("[support] push to member failed", e);
    }
    return { ok: true, threadId: thread.id as string, message: msg };
  });

/**
 * Staff: Done / Resolved (closed, under Resolved until they write again, which
 * goes back to Cleo first), reopen, read / unread, Take over (a person has it:
 * Cleo never writes in it) or Return to Cleo (the card is cleared).
 */
export const updateMemberSupport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({
    threadId: z.string().uuid(),
    status: z.enum(["open", "answered", "closed"]).optional(),
    read: z.boolean().optional(),
    handler: z.enum(["cleo", "human"]).optional(),
  }).parse(i))
  .handler(async ({ data, context }) => {
    const { admin, thread } = await resolveMember(context, { threadId: data.threadId });
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { updated_at: now };
    if (data.status) patch.status = data.status;
    if (data.status === "closed") Object.assign(patch, { resolved_by: "team", resolved_at: now, unread_for_team: 0 });
    if (data.status === "open") Object.assign(patch, { resolved_by: null, resolved_at: null });
    if (data.handler === "human") Object.assign(patch, { handler: "human", owner_user_id: context.userId });
    if (data.handler === "cleo") {
      Object.assign(patch, { handler: "cleo", owner_user_id: null, escalation: null, escalated_at: null, cleo_turns: 0, unread_for_team: 0 });
    }
    if (data.read === true) patch.unread_for_team = 0;
    if (data.read === false) patch.unread_for_team = Math.max(1, thread?.unread_for_team ?? 0);
    const { error } = await admin.from("member_support_threads").update(patch).eq("id", data.threadId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Staff: a reply drafted in the coach's saved voice (My Voice) for a Support
 * chat, from the conversation, the hand-off card and the help answers. Only
 * ever put in the coach's reply box: never sent, and never as him by itself.
 * "Re-create" asks again.
 */
export const draftSupportReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ threadId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { admin, thread, client } = await resolveMember(context, { threadId: data.threadId });
    if (!thread) throw new Error("That support chat is gone.");
    const { data: rows } = await admin.from("member_support_messages")
      .select("sender_role, body").eq("thread_id", thread.id).order("created_at", { ascending: true }).limit(200);
    const { voicePromptForClient } = await import("@/lib/coach-voice.functions");
    const { kbForPrompt } = await import("@/lib/support-cleo/rules");
    const { askRoute } = await import("@/lib/ai/route-call.server");
    const { casualize } = await import("@/lib/coach-voice");
    const voice = await voicePromptForClient(admin, client?.id ?? null);
    const tier = client?.service_tier === "coaching" ? "coaching" : "self_serve";
    const convo = ((rows ?? []) as { sender_role: string; body: string }[]).slice(-14)
      .map((m) => `${m.sender_role === "member" ? "THEM" : m.sender_role === "cleo" ? "CLEO (the app's assistant)" : "TEAM"}: ${m.body.slice(0, 1200)}`).join("\n");
    const esc = thread.escalation as any;
    const system = [
      "You draft a reply for the JF Effect team to send in a JF Effect Support chat. The coach reads and edits it before anything is sent.",
      "Write as the coach would, in his voice below. Short (2-4 sentences), answer first, one clear next step.",
      "Never promise a refund, a credit, a price, an exception or a change to their plan or access: if that's what they asked, say you're looking into it and what you need from them.",
      "Never invent a feature: app facts only from the HELP ANSWERS. No medical advice.",
      "Reply with the message text only.",
      voice,
    ].join("\n\n");
    const prompt = [
      esc ? `WHY IT CAME TO YOU: ${esc.reason ?? ""}. ${esc.summary ?? ""}. Suggested: ${esc.next_action ?? ""}` : "",
      `HELP ANSWERS:\n${kbForPrompt(tier)}`,
      `CHAT (newest last):\n${convo}`,
    ].filter(Boolean).join("\n\n");
    const r = await askRoute("coach_write", { system, prompt, tag: "coach_write:support" }, { sb: admin, openaiOnly: true });
    return { draft: casualize(r.text.trim()) };
  });
