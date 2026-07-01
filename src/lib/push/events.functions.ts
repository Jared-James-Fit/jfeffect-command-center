import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Fire a push notification for a newly inserted message. The middleware
 * authenticates the caller; we resolve the recipient server-side based on
 * who is participating in the conversation, so the client never picks the
 * target user.
 */
export const notifyNewMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ messageId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendWebPushToUser } = await import("@/lib/push/push.server");

    const { data: msg } = await supabaseAdmin
      .from("messages")
      .select("id, client_id, sender_id, sender_role, is_internal_note, body, attachments")
      .eq("id", data.messageId).maybeSingle();
    if (!msg || msg.is_internal_note) return { skipped: "no_msg_or_internal" };
    if (msg.sender_id !== userId) return { skipped: "not_sender" };

    // Lock notification copy to a generic line — never leak message body to lockscreen.
    const payloadFor = (url: string, who: "client" | "staff") => ({
      title: who === "client" ? "New Coach Message" : "New Client Message",
      body: who === "client" ? "You have a new message in JF Effect." : "A client sent you a new message.",
      url,
      tag: `msg:${msg.client_id}`,
      data: { messageId: msg.id, clientId: msg.client_id },
    });

    let results: any[] = [];
    if (msg.sender_role === "admin" || msg.sender_role === "coach") {
      // Notify the client user
      const { data: c } = await supabaseAdmin.from("clients").select("user_id").eq("id", msg.client_id).maybeSingle();
      if (c?.user_id) {
        const r = await sendWebPushToUser(supabaseAdmin, c.user_id, payloadFor("/portal/messages", "client"),
          { category: "messages", eventKey: `msg:${msg.id}:client` });
        results.push({ recipient: "client", ...r });
      }
    } else {
      // Client sent → notify admin(s) and assigned coach
      const { data: client } = await supabaseAdmin
        .from("clients").select("assigned_coach_id").eq("id", msg.client_id).maybeSingle();
      const recipients = new Set<string>();
      if (client?.assigned_coach_id) {
        const { data: coach } = await supabaseAdmin
          .from("coaches").select("user_id").eq("id", client.assigned_coach_id).maybeSingle();
        if (coach?.user_id) recipients.add(coach.user_id);
      }
      const { data: admins } = await supabaseAdmin.from("user_roles").select("user_id").eq("role", "admin");
      (admins ?? []).forEach((a: any) => a.user_id && recipients.add(a.user_id));
      for (const uid of recipients) {
        const r = await sendWebPushToUser(supabaseAdmin, uid,
          payloadFor(`/admin/messages?client=${msg.client_id}`, "staff"),
          { category: "messages", eventKey: `msg:${msg.id}:${uid}` });
        results.push({ recipient: uid, ...r });
      }
    }
    return { results };
  });

/**
 * Fire push notifications for a newly inserted group chat message. Recipients
 * are resolved server-side from chat_group_members; the caller (verified as
 * the sender by userId match) is excluded. Group name + sender display name
 * are safe to show on lockscreen (no per-client PII).
 */
export const notifyNewGroupMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ messageId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendWebPushToUser } = await import("@/lib/push/push.server");

    const { data: msg } = await supabaseAdmin
      .from("group_messages")
      .select("id, group_id, sender_id, sender_role, body, attachments, deleted_at")
      .eq("id", data.messageId).maybeSingle();
    if (!msg || msg.deleted_at) return { skipped: "no_msg_or_deleted" };
    if (msg.sender_id !== userId) return { skipped: "not_sender" };

    const [{ data: group }, { data: members }] = await Promise.all([
      supabaseAdmin.from("chat_groups").select("id, name").eq("id", msg.group_id).maybeSingle(),
      supabaseAdmin.from("chat_group_members").select("user_id").eq("group_id", msg.group_id),
    ]);
    if (!members || members.length === 0) return { skipped: "no_members" };

    // Resolve sender display name — profiles first, then coaches, then clients.
    let senderName = "Someone";
    const [{ data: prof }, { data: coach }, { data: client }] = await Promise.all([
      supabaseAdmin.from("profiles").select("full_name").eq("id", msg.sender_id!).maybeSingle(),
      supabaseAdmin.from("coaches").select("full_name").eq("user_id", msg.sender_id!).maybeSingle(),
      supabaseAdmin.from("clients").select("full_name").eq("user_id", msg.sender_id!).maybeSingle(),
    ]);
    senderName = (prof?.full_name || coach?.full_name || client?.full_name || senderName) as string;

    const groupName = group?.name || "Group Chat";
    const rawBody = typeof msg.body === "string" ? msg.body.trim() : "";
    const preview = rawBody
      ? (rawBody.length > 90 ? rawBody.slice(0, 87) + "…" : rawBody)
      : (Array.isArray(msg.attachments) && msg.attachments.length ? "📎 Attachment" : "New message");

    // Deep-link per role. Clients land on their messages page; staff on the
    // admin communication workspace's groups tab. Hash carries group id so
    // the pane auto-selects the right conversation.
    const results: any[] = [];
    await Promise.all((members as any[])
      .filter((m) => m.user_id && m.user_id !== userId)
      .map(async (m) => {
        const uid = m.user_id as string;
        const { data: roleRow } = await supabaseAdmin
          .from("user_roles").select("role").eq("user_id", uid).maybeSingle();
        const isStaff = roleRow?.role === "admin" || roleRow?.role === "coach";
        const url = isStaff
          ? `/admin/communication?tab=groups#group=${msg.group_id}`
          : `/portal/messages?tab=groups#group=${msg.group_id}`;
        const r = await sendWebPushToUser(supabaseAdmin, uid, {
          title: `${senderName} · ${groupName}`,
          body: preview,
          url,
          tag: `group:${msg.group_id}`,
          data: { groupId: msg.group_id, messageId: msg.id, kind: "group" },
        }, {
          category: "messages",
          eventKey: `gmsg:${msg.id}:${uid}`,
        });
        results.push({ recipient: uid, ...r });
      }));

    return { results };
  });