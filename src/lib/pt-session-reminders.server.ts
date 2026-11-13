// Server-only: evening-before session texts and last-minute change texts.
// Timing and wording rules live in pt-session-reminders.ts (pure, tested);
// every text goes through the one sender (sms-gateway.server.ts).
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildSessionChangeSms,
  buildSessionReminderSms,
  changeTextDecision,
  reminderDecision,
  type ReminderSession,
} from "@/lib/pt-session-reminders";
import { appOrigin } from "@/lib/pt-session-gcal.server";
import { coachById, resolveCoachName, withAssignedCoach } from "@/lib/sms-identity";
import { normalizePhone } from "@/lib/sms-policy";

type Admin = SupabaseClient<any, any, any>;

const LOOKAHEAD_MS = 36 * 60 * 60 * 1000;

/** "jfeffect.com/portal/calendar": short enough for a text, linkified by phones. */
export function scheduleLinkForSms(): string {
  return `${appOrigin().replace(/^https?:\/\//, "")}/portal/calendar`;
}

async function smsConfig(admin: Admin) {
  const { data } = await admin.from("sms_settings").select("enabled, from_phone, brand_name, default_coach_name").eq("singleton", true).maybeSingle();
  const s = data as any;
  if (!s?.enabled || !s.from_phone) return null;
  return { brand: (s.brand_name as string) || "", coach: (s.default_coach_name as string) || "" };
}

/** Whether a push to this client's login would reach a phone (an enabled, healthy subscription). */
export async function clientPushReachable(admin: Admin, clientId: string): Promise<boolean> {
  const { data: c } = await admin.from("clients").select("user_id").eq("id", clientId).maybeSingle();
  const userId = (c as any)?.user_id;
  if (!userId) return false;
  const { data: prefs } = await admin.from("push_notification_preferences").select("master_enabled, messages").eq("user_id", userId).maybeSingle();
  if ((prefs as any)?.master_enabled === false || (prefs as any)?.messages === false) return false;
  const { count } = await admin
    .from("push_subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("enabled", true)
    .lt("failure_count", 3);
  return (count ?? 0) > 0;
}

export type ReminderRunResult = { considered: number; sent: number; skipped: number; failed: number; reason?: string };

export async function runPtSessionReminders(admin: Admin, now: Date = new Date()): Promise<ReminderRunResult> {
  const result: ReminderRunResult = { considered: 0, sent: 0, skipped: 0, failed: 0 };
  const cfg = await smsConfig(admin);
  // Texts off: claim nothing, so turning them back on still sends what's due.
  if (!cfg) return { ...result, reason: "sms_disabled" };

  const { data: rows, error } = await admin
    .from("pt_sessions")
    .select("id, client_id, title, status, reminders_enabled, visible_to_client, reminder_24h_sent_at, starts_at, session_date, timezone, time_set_at, location")
    .eq("status", "Scheduled")
    .is("reminder_24h_sent_at", null)
    .gt("starts_at", now.toISOString())
    .lt("starts_at", new Date(now.getTime() + LOOKAHEAD_MS).toISOString())
    .order("starts_at", { ascending: true })
    .limit(200);
  if (error) throw new Error(error.message);

  const due = ((rows ?? []) as any[]).filter((r) => reminderDecision(r as ReminderSession, now).action === "send");
  result.considered = (rows ?? []).length;
  if (!due.length) return result;

  // A failed read stops the run before anything is claimed: claiming and then
  // skipping as "no_client" would lose those evening-before texts for good.
  const { data: clientRows, error: clientsErr } = await admin
    .from("clients")
    .select("id, first_name, full_name, phone, sms_opt_out, assigned_coach_id")
    .in("id", Array.from(new Set(due.map((r) => r.client_id).filter(Boolean))));
  if (clientsErr) throw new Error(clientsErr.message);
  const clients = await withAssignedCoach(admin, (clientRows ?? []) as any[]);
  const clientById = new Map(clients.map((c) => [c.id, c]));
  const { sendSms } = await import("@/lib/sms-gateway.server");
  const link = scheduleLinkForSms();

  for (const candidate of due) {
    // No client (a block of time, not someone's session): nothing to send, and
    // nothing to claim or log every tick.
    const c = candidate.client_id ? clientById.get(candidate.client_id) : null;
    if (!c) {
      await admin.from("pt_sessions").update({ reminder_24h_sent_at: now.toISOString() } as any).eq("id", candidate.id).is("reminder_24h_sent_at", null);
      result.skipped++;
      continue;
    }
    // Claim first: two overlapping runs can never text the same session twice.
    // The claim returns the row as it is now, so a move made since the read
    // above is what goes in the text (and a just-cancelled session is skipped).
    const { data: claimed } = await admin
      .from("pt_sessions")
      .update({ reminder_24h_sent_at: now.toISOString() } as any)
      .eq("id", candidate.id)
      .eq("status", "Scheduled")
      .is("reminder_24h_sent_at", null)
      .select("id, client_id, title, starts_at, timezone, location");
    const s = (claimed as any[] | null)?.[0];
    if (!s) continue;
    if (new Date(s.starts_at).getTime() !== new Date(candidate.starts_at).getTime()) {
      // Moved between the read and the claim: let the next tick decide afresh.
      await admin.from("pt_sessions").update({ reminder_24h_sent_at: null } as any).eq("id", s.id);
      continue;
    }

    const body = buildSessionReminderSms({
      firstName: c.first_name ?? c.full_name?.split(" ")[0],
      brand: cfg.brand,
      coach: resolveCoachName(c.coach, cfg.coach),
      title: s.title,
      startsAt: new Date(s.starts_at),
      tz: s.timezone,
      location: s.location,
      link,
      now,
    });
    // The key names the time: a session moved after its text gets one for the new time.
    const r = await sendSms(admin, {
      category: "session",
      to: c.phone,
      body,
      key: `session_reminder:${s.id}:${new Date(s.starts_at).toISOString()}`,
      maxAttempts: 3,
      clientId: s.client_id,
      ptSessionId: s.id,
    });
    if (r.status === "sent") result.sent++;
    else if (r.status === "skipped") result.skipped++;
    else {
      result.failed++;
      // A flaky Twilio call gets another go on the next tick; the sender stops
      // it after 3 failed tries (it then comes back "skipped: retry_limit").
      await admin.from("pt_sessions").update({ reminder_24h_sent_at: null } as any).eq("id", s.id);
    }
  }
  return result;
}

export type ChangeTextResult = {
  texted: boolean;
  reason?: "not_last_minute" | "push_reaches_them" | "sms_disabled" | "opted_out" | "no_phone" | "failed" | "blocked";
};

/**
 * Text the client that a session moved or was cancelled, when the chat message
 * (which pushes) may not reach them in time: see changeTextDecision.
 */
export async function textSessionChange(
  admin: Admin,
  sessionId: string,
  kind: "moved" | "cancelled",
  now: Date = new Date(),
  /** For moves: where it was. Moving tomorrow's session to next week is still urgent news. */
  previousStartsAt?: string | null,
  opts: { clientAsked?: boolean } = {},
): Promise<ChangeTextResult> {
  const { data: s } = await admin
    .from("pt_sessions")
    .select("id, client_id, title, starts_at, timezone, location, visible_to_client")
    .eq("id", sessionId)
    .maybeSingle();
  if (!s) throw new Error("Session not found.");
  const clientId = (s as any).client_id as string | null;
  if (!clientId) return { texted: false, reason: "no_phone" };
  const pushReachable = await clientPushReachable(admin, clientId);
  const decision = changeTextDecision({
    startsAt: new Date((s as any).starts_at),
    previousStartsAt: previousStartsAt ? new Date(previousStartsAt) : null,
    now,
    pushReachable,
    clientAsked: opts.clientAsked,
  });
  if (!decision.text) return { texted: false, reason: decision.reason };
  const cfg = await smsConfig(admin);
  if (!cfg) return { texted: false, reason: "sms_disabled" };
  const { data: c } = await admin
    .from("clients")
    .select("id, first_name, full_name, phone, sms_opt_out, assigned_coach_id")
    .eq("id", clientId)
    .maybeSingle();
  if ((c as any)?.sms_opt_out) return { texted: false, reason: "opted_out" };
  if (!normalizePhone((c as any)?.phone)) return { texted: false, reason: "no_phone" };
  const coach = await coachById(admin, (c as any)?.assigned_coach_id);
  const body = buildSessionChangeSms({
    kind,
    firstName: (c as any).first_name ?? (c as any).full_name?.split(" ")[0],
    brand: cfg.brand,
    coach: resolveCoachName(coach, cfg.coach),
    title: (s as any).title,
    tz: (s as any).timezone,
    startsAt: new Date((s as any).starts_at),
    location: (s as any).location,
    link: scheduleLinkForSms(),
  });
  const { sendSms } = await import("@/lib/sms-gateway.server");
  // One text per change: the same session, kind and time never texts twice
  // (a double tap, or Undo then the same move again).
  const r = await sendSms(admin, {
    category: "session",
    to: (c as any).phone,
    body,
    key: `session_change:${sessionId}:${kind}:${new Date((s as any).starts_at).toISOString()}`,
    maxAttempts: 1,
    clientId,
    ptSessionId: sessionId,
  });
  if (r.status === "sent") return { texted: true };
  if (r.status === "failed") return { texted: false, reason: "failed" };
  return { texted: false, reason: r.reason === "opted_out" ? "opted_out" : r.reason === "no_phone" ? "no_phone" : "blocked" };
}
