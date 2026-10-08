/**
 * payment-reminder-push.server.ts
 *
 * Push notification for the automatic payment setup reminders.
 *
 * The reminders are inserted by the database (run_payment_setup_reminders), so
 * nothing in the app fires the usual "new message" push for them. The
 * scheduled payment-reminder-sms hook calls this on every run: it looks at
 * automated Payment messages from the last couple of hours and pushes each one
 * through the same path as a normal coach message. sendWebPushToUser dedupes on
 * the event key (message id + recipient), so re-scanning never double notifies,
 * and the lockscreen copy never contains the message text.
 */
import { buildNotificationPayload, coachLabel } from "@/lib/push/notification-payload";

type SendPush = (
  admin: any,
  userId: string,
  payload: { title: string; body: string; url: string; tag: string; data: any },
  options: { category: any; eventKey: string },
) => Promise<{ sent: number; removed: number; skipped: string | null }>;

const LOOKBACK_MS = 2 * 60 * 60 * 1000;

export async function pushNewPaymentReminders(
  admin: any,
  deps: { sendWebPushToUser: SendPush },
  nowMs: number = Date.now(),
): Promise<{ pushed: number; skipped: number }> {
  const since = new Date(nowMs - LOOKBACK_MS).toISOString();
  const { data: msgs } = await admin
    .from("messages")
    .select("id, client_id, sender_id, attachments")
    .eq("is_automated", true)
    .eq("message_type", "Payment")
    .eq("sender_role", "admin")
    .eq("is_internal_note", false)
    .is("deleted_at", null)
    .gte("created_at", since)
    .limit(100);

  let pushed = 0;
  let skipped = 0;
  for (const msg of (msgs ?? []) as any[]) {
    const { data: client } = await admin.from("clients").select("user_id").eq("id", msg.client_id).maybeSingle();
    if (!client?.user_id) { skipped++; continue; }

    const [{ data: prof }, { data: coach }] = await Promise.all([
      admin.from("profiles").select("full_name").eq("id", msg.sender_id).maybeSingle(),
      admin.from("coaches").select("full_name").eq("user_id", msg.sender_id).maybeSingle(),
    ]);
    const n = buildNotificationPayload({
      kind: "message",
      role: "client",
      recipientUserId: client.user_id,
      sourceId: msg.id,
      displayName: coachLabel(coach?.full_name || prof?.full_name),
      attachments: Array.isArray(msg.attachments) ? msg.attachments : [],
      ids: { clientId: msg.client_id },
    });
    const r = await deps.sendWebPushToUser(
      admin,
      client.user_id,
      { title: n.title, body: n.body, url: n.url, tag: n.tag, data: n.data },
      { category: n.category, eventKey: n.eventKey },
    );
    if (r.sent > 0) pushed++; else skipped++;
  }
  return { pushed, skipped };
}
