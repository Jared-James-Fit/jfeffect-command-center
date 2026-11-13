/**
 * Server-only: the "you have an unread message" nudge (every 10 minutes,
 * hooks/sms-reminders).
 *
 * Push first, text only as the fallback. A coach message unread for a step's
 * delay (24 hours by default) gets a push, which is free; only someone the push
 * didn't reach (no app installed, notifications off) gets the text, and only for
 * a message the coach wrote (automated check-in / form prompts have their own
 * push and the inbox's overdue flow). Why: in the 60 days to Nov 13 2026, 64%
 * of these texts went to people who had push, and the texts didn't get messages
 * read (read on average 42-95 hours after the text).
 *
 * Guard rails (sms-reminder-rules.ts): only messages from the last (longest
 * step + 1 day), one anchor message per client, one nudge per client per 24
 * hours, and only between 9am and 8pm in the client's timezone. Payment
 * requests have their own timed text and are left out.
 */
import {
  inSmsSendWindow,
  pickAnchorMessages,
  reminderLookbackMs,
  SMS_CLIENT_COOLDOWN_MS,
} from "@/lib/sms-reminder-rules";
import { coachById, renderSmsTemplate, resolveCoachName } from "@/lib/sms-identity";
import type { SmsRequest, SmsResult } from "@/lib/sms-gateway.server";
import type { PushPayload } from "@/lib/push/push.server";

type Db = any;

export type UnreadNudgeDeps = {
  sendSms: (admin: Db, req: SmsRequest) => Promise<SmsResult>;
  sendPush: (admin: Db, userId: string, payload: PushPayload, opts: Record<string, unknown>) => Promise<{ sent: number; skipped: string | null }>;
};

async function defaultDeps(): Promise<UnreadNudgeDeps> {
  const [{ sendSms }, { sendWebPushToUser }] = await Promise.all([
    import("@/lib/sms-gateway.server"),
    import("@/lib/push/push.server"),
  ]);
  return { sendSms, sendPush: sendWebPushToUser as any };
}

export type UnreadSweepResult = { processed: number; pushed: number; texted: number; reason?: string };

export async function runReminderSweep(admin: Db, deps?: UnreadNudgeDeps): Promise<UnreadSweepResult> {
  const { data: settings } = await admin.from("sms_settings").select("*").eq("singleton", true).maybeSingle();
  const steps: Array<{ delay_minutes: number; enabled: boolean; template: string }> = Array.isArray(settings?.reminder_steps)
    ? settings.reminder_steps
    : [];
  const enabledSteps = steps.map((s, i) => ({ ...s, index: i })).filter((s) => s.enabled);
  if (!settings || enabledSteps.length === 0) return { processed: 0, pushed: 0, texted: 0, reason: "no_steps" };
  const d = deps ?? (await defaultDeps());

  const now = Date.now();
  const lookback = new Date(now - reminderLookbackMs(enabledSteps)).toISOString();

  const { data: candidates, error } = await admin
    .from("messages")
    .select("id, client_id, created_at, sender_role, is_internal_note, read_by_client_at, body, message_type, is_automated")
    .eq("sender_role", "admin")
    .eq("is_internal_note", false)
    .is("read_by_client_at", null)
    .is("deleted_at", null)
    // Payment requests and their reminders have their own single, better timed
    // text (payment-reminder-sms), so the generic unread sweep skips them.
    .or("message_type.is.null,message_type.neq.Payment")
    .gte("created_at", lookback)
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) throw new Error(error.message);

  const result: UnreadSweepResult = { processed: 0, pushed: 0, texted: 0 };
  // Automatic schedule notes ("Moved your session to ...") ride on their own
  // texts (evening-before reminder, last-minute change text), so they never
  // earn a nudge.
  const nudgeable = ((candidates ?? []) as any[]).filter((m) => !(m.is_automated && m.message_type === "Scheduling"));
  const sorted = [...enabledSteps].sort((a, b) => a.delay_minutes - b.delay_minutes);

  for (const msg of pickAnchorMessages(nudgeable)) {
    const ageMin = (now - new Date(msg.created_at).getTime()) / 60000;
    const due = sorted.filter((s) => ageMin >= s.delay_minutes);
    if (due.length === 0) continue;

    const { data: priorLogs } = await admin
      .from("sms_log")
      .select("reminder_step, status")
      .eq("message_id", msg.id)
      .eq("kind", "reminder");
    const doneSteps = new Set(
      ((priorLogs ?? []) as any[]).filter((l) => l.status === "sent" || l.status === "skipped").map((l) => l.reminder_step),
    );
    const next = due.find((s) => !doneSteps.has(s.index));
    if (!next) continue;

    const { data: clientRow } = await admin
      .from("clients")
      .select("id, user_id, phone, sms_opt_out, first_name, full_name, timezone, assigned_coach_id")
      .eq("id", msg.client_id)
      .maybeSingle();
    if (!clientRow) continue;

    // A sane hour for the client; the next run (10 min later) tries again.
    if (!inSmsSendWindow(clientRow.timezone, new Date(now))) continue;

    // One nudge (push or text) per client per 24 hours, however many messages are unread.
    const { count: recent } = await admin
      .from("sms_log")
      .select("id", { count: "exact", head: true })
      .eq("client_id", msg.client_id)
      .eq("kind", "reminder")
      .or("status.eq.sent,blocked_reason.eq.push_delivered")
      .gte("created_at", new Date(now - SMS_CLIENT_COOLDOWN_MS).toISOString());
    if ((recent ?? 0) > 0) continue;

    const coach = await coachById(admin, clientRow.assigned_coach_id);
    const coachName = resolveCoachName(coach, settings.default_coach_name);
    const key = `unread:${msg.id}:${next.index}`;

    // 1. Push (free). Delivered = done, recorded so the step isn't repeated.
    if (clientRow.user_id) {
      const push = await d.sendPush(
        admin,
        clientRow.user_id,
        {
          title: coachName ? `Message from ${coachName}` : "New message",
          body: "You have an unread message from your coach. Tap to read it.",
          url: "/portal/messages",
          tag: "unread-nudge",
        },
        { category: "messages", eventKey: key },
      );
      if (push.sent > 0) {
        await admin.from("sms_log").insert({
          client_id: msg.client_id,
          message_id: msg.id,
          reminder_step: next.index,
          to_phone: "",
          body: "",
          kind: "reminder",
          category: "reminder",
          status: "skipped",
          error: "push_delivered",
          blocked_reason: "push_delivered",
          idempotency_key: `${key}:push`,
          idempotency_base: key,
        });
        result.pushed++;
        result.processed++;
        continue;
      }
    }

    // 2. Text, only for the coach's own words. Automated prompts stop at the
    // push: settle the step so it isn't tried every 10 minutes.
    if (msg.is_automated) {
      await admin.from("sms_log").insert({
        client_id: msg.client_id,
        message_id: msg.id,
        reminder_step: next.index,
        to_phone: "",
        body: "",
        kind: "reminder",
        category: "reminder",
        status: "skipped",
        error: "automated_no_push",
        blocked_reason: "automated_no_push",
        idempotency_key: `${key}:push`,
        idempotency_base: key,
      });
      continue;
    }

    const body = renderSmsTemplate(next.template, {
      first_name: clientRow.first_name ?? clientRow.full_name?.split(" ")[0] ?? "there",
      full_name: clientRow.full_name ?? "",
      coach: coachName,
      brand: settings.brand_name,
    });
    const sms = await d.sendSms(admin, {
      category: "reminder",
      to: clientRow.phone,
      body,
      key,
      clientId: msg.client_id,
      messageId: msg.id,
      reminderStep: next.index,
    });
    if (sms.status === "sent") {
      result.texted++;
      result.processed++;
    }
  }
  return result;
}
