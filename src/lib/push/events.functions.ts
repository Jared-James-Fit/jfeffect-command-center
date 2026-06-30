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