// Server-only: evening-before session texts and last-minute change texts.
// Timing and wording rules live in pt-session-reminders.ts (pure, tested).
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildSessionChangeSms,
  buildSessionReminderSms,
  isLastMinute,
  reminderDecision,
  type ReminderSession,
} from "@/lib/pt-session-reminders";
import { appOrigin } from "@/lib/pt-session-gcal.server";

type Admin = SupabaseClient<any, any, any>;

const MAX_SEND_FAILURES = 3;
const LOOKAHEAD_MS = 36 * 60 * 60 * 1000;

/** "jfeffect.com/portal/calendar": short enough for a text, linkified by phones. */
export function scheduleLinkForSms(): string {
  return `${appOrigin().replace(/^https?:\/\//, "")}/portal/calendar`;
}

async function smsConfig(admin: Admin) {
  const { data } = await admin.from("sms_settings").select("enabled, from_phone, brand_name").eq("singleton", true).maybeSingle();
  const s = data as any;
  if (!s?.enabled || !s.from_phone) return null;
  return { from: s.from_phone as string, brand: (s.brand_name as string) || "your coach" };
}

async function logSms(admin: Admin, row: Record<string, unknown>) {
  await admin.from("sms_log").insert({ kind: "session", ...row } as any);
}

export type ReminderRunResult = { considered: number; sent: number; skipped: number; failed: number; reason?: string };

export async function runPtSessionReminders(admin: Admin, now: Date = new Date()): Promise<ReminderRunResult> {
  const result: ReminderRunResult = { considered: 0, sent: 0, skipped: 0, failed: 0 };
  const cfg = await smsConfig(admin);
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

  const { data: clients } = await admin
    .from("clients")
    .select("id, first_name, full_name, phone, sms_opt_out")
    .in("id", Array.from(new Set(due.map((r) => r.client_id))));
  const clientById = new Map(((clients ?? []) as any[]).map((c) => [c.id, c]));
  const { normalizePhone, sendViaTwilio } = await import("@/lib/sms.functions");
  const link = scheduleLinkForSms();

  for (const candidate of due) {
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

    const c = clientById.get(s.client_id);
    const to = normalizePhone(c?.phone);
    if (!c || c.sms_opt_out || !to) {
      result.skipped++;
      await logSms(admin, {
        client_id: s.client_id, pt_session_id: s.id, to_phone: to ?? "", body: "", status: "skipped",
        error: !c ? "no_client" : c.sms_opt_out ? "client_opted_out" : "no_phone",
      });
      continue;
    }
    const body = buildSessionReminderSms({
      firstName: c.first_name ?? c.full_name?.split(" ")[0],
      brand: cfg.brand,
      title: s.title,
      startsAt: new Date(s.starts_at),
      tz: s.timezone,
      location: s.location,
      link,
      now,
    });
    try {
      const { sid } = await sendViaTwilio(to, cfg.from, body);
      await logSms(admin, { client_id: s.client_id, pt_session_id: s.id, to_phone: to, body, status: "sent", twilio_sid: sid });
      result.sent++;
    } catch (e: any) {
      result.failed++;
      await logSms(admin, { client_id: s.client_id, pt_session_id: s.id, to_phone: to, body, status: "failed", error: String(e?.message ?? e).slice(0, 500) });
      const { count } = await admin
        .from("sms_log")
        .select("id", { count: "exact", head: true })
        .eq("pt_session_id", s.id)
        .eq("kind", "session")
        .eq("status", "failed");
      // Give a flaky Twilio call another go on the next tick, a few times at most.
      if ((count ?? 0) < MAX_SEND_FAILURES) {
        await admin.from("pt_sessions").update({ reminder_24h_sent_at: null } as any).eq("id", s.id);
      }
    }
  }
  return result;
}

export type ChangeTextResult = { texted: boolean; reason?: "not_last_minute" | "sms_disabled" | "opted_out" | "no_phone" | "failed" };

/** Text the client that a session within 48 hours moved or was cancelled. */
export async function textSessionChange(
  admin: Admin,
  sessionId: string,
  kind: "moved" | "cancelled",
  now: Date = new Date(),
  /** For moves: where it was. Moving tomorrow's session to next week is still urgent news. */
  previousStartsAt?: string | null,
): Promise<ChangeTextResult> {
  const { data: s } = await admin
    .from("pt_sessions")
    .select("id, client_id, title, starts_at, timezone, location, visible_to_client")
    .eq("id", sessionId)
    .maybeSingle();
  if (!s) throw new Error("Session not found.");
  const urgent =
    isLastMinute(new Date((s as any).starts_at), now) ||
    (!!previousStartsAt && isLastMinute(new Date(previousStartsAt), now));
  if (!urgent) return { texted: false, reason: "not_last_minute" };
  const cfg = await smsConfig(admin);
  if (!cfg) return { texted: false, reason: "sms_disabled" };
  const { data: c } = await admin
    .from("clients")
    .select("id, first_name, full_name, phone, sms_opt_out")
    .eq("id", (s as any).client_id)
    .maybeSingle();
  const { normalizePhone, sendViaTwilio } = await import("@/lib/sms.functions");
  const to = normalizePhone((c as any)?.phone);
  if ((c as any)?.sms_opt_out) return { texted: false, reason: "opted_out" };
  if (!to) return { texted: false, reason: "no_phone" };
  const body = buildSessionChangeSms({
    kind,
    firstName: (c as any).first_name ?? (c as any).full_name?.split(" ")[0],
    brand: cfg.brand,
    title: (s as any).title,
    tz: (s as any).timezone,
    startsAt: new Date((s as any).starts_at),
    location: (s as any).location,
    link: scheduleLinkForSms(),
  });
  try {
    const { sid } = await sendViaTwilio(to, cfg.from, body);
    await logSms(admin, { client_id: (s as any).client_id, pt_session_id: sessionId, to_phone: to, body, status: "sent", twilio_sid: sid });
    return { texted: true };
  } catch (e: any) {
    await logSms(admin, { client_id: (s as any).client_id, pt_session_id: sessionId, to_phone: to, body, status: "failed", error: String(e?.message ?? e).slice(0, 500) });
    return { texted: false, reason: "failed" };
  }
}
