import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildNotificationPayload, coachLabel, type AttachmentLike } from "@/lib/push/notification-payload";

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
    if (msg.sender_id !== userId && !(await samePerson(supabaseAdmin, msg.sender_id, userId))) return { skipped: "not_sender" };

    // Copy/identity/deep-link all come from the one shared normalizer, which
    // guarantees no message body ever reaches a lockscreen. The title says
    // who it's from; the body says what kind of thing they sent.
    const normalized = (recipientUserId: string, role: "client" | "admin", displayName: string | null) =>
      buildNotificationPayload({
        kind: "message",
        role,
        recipientUserId,
        sourceId: msg.id,
        displayName,
        attachments: Array.isArray(msg.attachments) ? (msg.attachments as AttachmentLike[]) : [],
        ids: { clientId: msg.client_id },
      });

    let results: any[] = [];
    if (msg.sender_role === "admin" || msg.sender_role === "coach") {
      // Notify the client user, as "Coach <first name>" of whoever sent it.
      const [{ data: c }, { data: prof }, { data: coach }] = await Promise.all([
        supabaseAdmin.from("clients").select("user_id").eq("id", msg.client_id).maybeSingle(),
        supabaseAdmin.from("profiles").select("full_name").eq("id", msg.sender_id!).maybeSingle(),
        supabaseAdmin.from("coaches").select("full_name").eq("user_id", msg.sender_id!).maybeSingle(),
      ]);
      if (c?.user_id) {
        const n = normalized(c.user_id, "client", coachLabel((coach as any)?.full_name || (prof as any)?.full_name));
        const r = await sendWebPushToUser(supabaseAdmin, c.user_id,
          { title: n.title, body: n.body, url: n.url, tag: n.tag, data: n.data },
          { category: n.category, eventKey: n.eventKey });
        results.push({ recipient: "client", ...r });
      }
    } else {
      // Client sent → notify admin(s) and assigned coach
      const { data: client } = await supabaseAdmin
        .from("clients").select("assigned_coach_id, full_name, first_name, last_name").eq("id", msg.client_id).maybeSingle();
      // Full name: a coach with two Jennifers needs to know which one.
      const clientName = (client as any)?.full_name
        || [(client as any)?.first_name, (client as any)?.last_name].filter(Boolean).join(" ")
        || null;
      const recipients = new Set<string>();
      if (client?.assigned_coach_id) {
        const { data: coach } = await supabaseAdmin
          .from("coaches").select("user_id").eq("id", client.assigned_coach_id).maybeSingle();
        if (coach?.user_id) recipients.add(coach.user_id);
      }
      const { data: admins } = await supabaseAdmin.from("user_roles").select("user_id").eq("role", "admin");
      (admins ?? []).forEach((a: any) => a.user_id && recipients.add(a.user_id));
      for (const uid of recipients) {
        const n = normalized(uid, "admin", clientName);
        const r = await sendWebPushToUser(supabaseAdmin, uid,
          { title: n.title, body: n.body, url: n.url, tag: n.tag, data: n.data },
          { category: n.category, eventKey: n.eventKey });
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
      (supabaseAdmin.from("chat_groups") as any).select("id, name, kind, direct_status, requested_by").eq("id", msg.group_id).maybeSingle(),
      supabaseAdmin.from("chat_group_members").select("user_id").eq("group_id", msg.group_id),
    ]);
    if (!members || members.length === 0) return { skipped: "no_members" };
    if ((group as any)?.kind === "direct") {
      return notifyDirect(supabaseAdmin, sendWebPushToUser, msg as any, group as any, members as any[], userId);
    }

    // Resolve sender display name — profiles first, then coaches, then clients.
    let senderName = "Someone";
    const [{ data: prof }, { data: coach }, { data: client }] = await Promise.all([
      supabaseAdmin.from("profiles").select("full_name").eq("id", msg.sender_id!).maybeSingle(),
      supabaseAdmin.from("coaches").select("full_name").eq("user_id", msg.sender_id!).maybeSingle(),
      supabaseAdmin.from("clients").select("full_name").eq("user_id", msg.sender_id!).maybeSingle(),
    ]);
    senderName = (prof?.full_name || coach?.full_name || client?.full_name || senderName) as string;

    const groupName = group?.name || "Group Chat";

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
        const n = buildNotificationPayload({
          kind: "group_message",
          role: isStaff ? "admin" : "client",
          recipientUserId: uid,
          sourceId: msg.id,
          displayName: senderName,
          contextLabel: groupName,
          attachments: Array.isArray(msg.attachments) ? (msg.attachments as AttachmentLike[]) : [],
          ids: { groupId: msg.group_id },
        });
        const r = await sendWebPushToUser(supabaseAdmin, uid,
          { title: n.title, body: n.body, url: n.url, tag: n.tag, data: n.data },
          { category: n.category, eventKey: n.eventKey });
        results.push({ recipient: uid, ...r });
      }));

    return { results };
  });

/** Two accounts that are the same person in the community (a coach's linked athlete account). */
async function samePerson(admin: any, a: string | null, b: string) {
  if (!a) return false;
  const [{ data: x }, { data: y }] = await Promise.all([
    admin.rpc("community_main_account", { _user_id: a }),
    admin.rpc("community_main_account", { _user_id: b }),
  ]);
  return !!x && x === y;
}

/**
 * Member-to-member chats (20261015090000_direct_message_requests.sql).
 * A request pushes once ("Message request · Dwayne replied to your post."),
 * not for every extra line; nobody is pushed for a chat they deleted or
 * blocked. Names are the community's (first name), never the message.
 */
async function notifyDirect(
  admin: any,
  sendWebPushToUser: (typeof import("@/lib/push/push.server"))["sendWebPushToUser"],
  msg: { id: string; group_id: string; sender_id: string; attachments: unknown },
  group: { id: string; direct_status: string; requested_by: string | null },
  members: { user_id: string }[],
  senderId: string,
) {
  const { data: closed } = await admin.from("chat_direct_closed").select("user_id").eq("group_id", group.id);
  const shut = new Set(((closed ?? []) as any[]).map((c) => c.user_id));
  const { data: author } = await admin.rpc("community_author", { _user_id: senderId });
  const request = group.direct_status === "request";
  const results: any[] = [];
  for (const m of members) {
    const uid = m.user_id;
    if (!uid || uid === senderId || shut.has(uid)) continue;
    const n = buildNotificationPayload({
      kind: "direct_message",
      role: "client",
      recipientUserId: uid,
      sourceId: msg.id,
      displayName: (author as any)?.name ?? null,
      attachments: Array.isArray(msg.attachments) ? (msg.attachments as AttachmentLike[]) : [],
      ids: { groupId: group.id },
      request,
    });
    const r = await sendWebPushToUser(admin, uid,
      { title: n.title, body: n.body, url: n.url, tag: n.tag, data: n.data },
      // One push per request, however many lines it gets before they answer.
      { category: n.category, eventKey: request ? `direct_request:${group.id}:${uid}` : n.eventKey });
    results.push({ recipient: uid, ...r });
  }
  return { results };
}

/**
 * A client reported a direct chat: tell their coach (the chat itself is in
 * their coach chat as an internal note). Only the reporter can fire this,
 * and only once per report.
 */
export const notifyChatReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ reportId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rep } = await (supabaseAdmin as any).from("chat_reports")
      .select("id, reporter_id, reporter_client_id, pushed_at").eq("id", data.reportId).maybeSingle();
    if (!rep || rep.reporter_id !== userId) return { skipped: "not_reporter" };
    if (rep.pushed_at || !rep.reporter_client_id) return { skipped: "done_or_no_client" };
    await (supabaseAdmin as any).from("chat_reports").update({ pushed_at: new Date().toISOString() }).eq("id", rep.id);
    const { notifyAppEvent } = await import("@/lib/push/app-events.server");
    return notifyAppEvent(supabaseAdmin as any, "chat_reported", { clientId: rep.reporter_client_id, sourceId: rep.id, actorUserId: userId });
  });

