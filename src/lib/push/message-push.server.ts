/**
 * The push for a new coach-thread message, after the caller has been checked
 * as its sender (notifyNewMessage) or the server wrote it as that sender
 * itself (a Cleo card the owner approved, which runs as the coach who asked:
 * cleo-actions.server.ts). Recipients are resolved here from the thread, never
 * picked by a caller. Server-only.
 */
import { buildNotificationPayload, coachLabel, type AttachmentLike } from "@/lib/push/notification-payload";

type Msg = {
  id: string;
  client_id: string;
  sender_id: string | null;
  sender_role: string | null;
  is_internal_note: boolean | null;
  body?: string | null;
  attachments?: unknown;
};

export async function pushNewMessage(supabaseAdmin: any, msg: Msg): Promise<{ results?: any[]; skipped?: string }> {
  const { sendWebPushToUser } = await import("@/lib/push/push.server");
  if (!msg || msg.is_internal_note) return { skipped: "no_msg_or_internal" };
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
}
