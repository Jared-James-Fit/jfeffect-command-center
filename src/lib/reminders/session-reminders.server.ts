// Server-only: push reminders for calls and training sessions, and the
// coach's evening "tomorrow" summary. Rules in session-reminders.ts (pure,
// tested); run from the 5-minute schedule tick (hooks/appointment-reminders.ts)
// beside the evening-before texts; sent through sendWebPushToUser, whose
// per-user event key makes every reminder go at most once.
import type { SupabaseClient } from "@supabase/supabase-js";
import { isTrainingSessionType } from "@/lib/booking-types";
import { fmtClock, fmtDayLabel, localDateISO, localHour } from "@/lib/schedule-time";
import { relativeDayWord } from "@/lib/pt-session-reminders";
import {
  daySummary,
  dueReminder,
  readSlotPrefs,
  reminderCopy,
  type ReminderAudience,
  type ReminderEvent,
  type SummaryItem,
} from "./session-reminders";

type Admin = SupabaseClient<any, any, any>;
const DEFAULT_TZ = "America/Winnipeg";
const LOOKAHEAD_MS = 25 * 60 * 60 * 1000;
/** The coach's "tomorrow" summary, local time. */
export const COACH_SUMMARY_HOUR = 18;

type Recipient = { userId: string; audience: ReminderAudience; url: string; otherName: string | null; tz: string };
type Row = ReminderEvent & { tz: string; title: string | null; location: string | null; joinUrl: string | null; clientId: string | null; recipients: Recipient[] };

export type SessionReminderResult = { considered: number; sent: number; summaries: number };

export async function runSessionReminders(admin: Admin, now: Date = new Date()): Promise<SessionReminderResult> {
  const db = admin as any;
  const from = now.toISOString();
  const to = new Date(now.getTime() + LOOKAHEAD_MS).toISOString();
  const [{ data: sessions, error: sErr }, { data: appts, error: aErr }] = await Promise.all([
    db
      .from("pt_sessions")
      .select("id, client_id, title, status, starts_at, timezone, time_set_at, created_at, location, meet_link, session_type, reminder_24h_sent_at, visible_to_client, reminders_enabled")
      .eq("status", "Scheduled")
      .gt("starts_at", from)
      .lt("starts_at", to)
      .limit(400),
    db
      .from("appointments")
      .select("id, host_coach_id, client_id, external_name, title, appointment_type, status, starts_at, timezone, created_at, meet_link, location")
      .eq("status", "Scheduled")
      .gt("starts_at", from)
      .lt("starts_at", to)
      .limit(200),
  ]);
  if (sErr) throw new Error(sErr.message);
  if (aErr) throw new Error(aErr.message);

  const clientIds = [...new Set([...(sessions ?? []), ...(appts ?? [])].map((r: any) => r.client_id).filter(Boolean))] as string[];
  const { data: clients } = clientIds.length
    ? await db.from("clients").select("id, user_id, first_name, full_name, assigned_coach_id, archived").in("id", clientIds)
    : { data: [] };
  const clientById = new Map(((clients ?? []) as any[]).filter((c) => !c.archived).map((c) => [c.id, c]));
  const coachIds = [
    ...new Set([...((clients ?? []) as any[]).map((c) => c.assigned_coach_id), ...((appts ?? []) as any[]).map((a) => a.host_coach_id)].filter(Boolean)),
  ] as string[];
  const { data: coaches } = coachIds.length ? await db.from("coaches").select("id, user_id, full_name").in("id", coachIds) : { data: [] };
  const coachById = new Map(((coaches ?? []) as any[]).map((c) => [c.id, c]));

  const rows: Row[] = [];
  for (const s of (sessions ?? []) as any[]) {
    const c = clientById.get(s.client_id);
    if (!c) continue;
    const kind = isTrainingSessionType(s.session_type) ? "pt" : "call";
    const tz = s.timezone || DEFAULT_TZ;
    const coach = c.assigned_coach_id ? coachById.get(c.assigned_coach_id) : null;
    const recipients: Recipient[] = [];
    if (c.user_id && s.visible_to_client !== false && s.reminders_enabled !== false) {
      recipients.push({ userId: c.user_id, audience: "client", url: "/portal/calendar", otherName: coach?.full_name?.split(" ")[0] ?? null, tz });
    }
    if (coach?.user_id) {
      recipients.push({ userId: coach.user_id, audience: "coach", url: `/admin/clients/${c.id}`, otherName: c.full_name ?? c.first_name ?? null, tz });
    }
    rows.push({
      source: "pt_session",
      id: s.id,
      kind,
      status: s.status,
      startsAt: s.starts_at,
      arrangedAt: s.time_set_at ?? s.created_at ?? null,
      textSent: !!s.reminder_24h_sent_at,
      tz,
      title: s.title ?? null,
      location: s.location ?? null,
      joinUrl: s.meet_link ?? null,
      clientId: c.id,
      recipients,
    });
  }
  for (const a of (appts ?? []) as any[]) {
    const tz = a.timezone || DEFAULT_TZ;
    const c = a.client_id ? clientById.get(a.client_id) : null;
    const host = a.host_coach_id ? coachById.get(a.host_coach_id) : null;
    const recipients: Recipient[] = [];
    if (c?.user_id) recipients.push({ userId: c.user_id, audience: "client", url: "/portal/calendar", otherName: host?.full_name?.split(" ")[0] ?? null, tz });
    if (host?.user_id) {
      recipients.push({
        userId: host.user_id,
        audience: "coach",
        url: c ? `/admin/clients/${c.id}` : "/admin/calendar?tab=upcoming",
        otherName: c?.full_name ?? a.external_name ?? null,
        tz,
      });
    }
    rows.push({
      source: "appointment",
      id: a.id,
      kind: "call",
      status: a.status,
      startsAt: a.starts_at,
      arrangedAt: a.created_at ?? null,
      tz,
      title: a.title ? String(a.title).split(" · ")[0] : a.appointment_type ?? null,
      location: a.location ?? null,
      joinUrl: a.meet_link ?? null,
      clientId: c?.id ?? null,
      recipients,
    });
  }

  const userIds = [...new Set(rows.flatMap((r) => r.recipients.map((x) => x.userId)))];
  const { data: prefs } = userIds.length
    ? await db.from("push_notification_preferences").select("user_id, session_reminders, quiet_hours_enabled, quiet_start, quiet_end, timezone").in("user_id", userIds)
    : { data: [] };
  const prefBy = new Map(((prefs ?? []) as any[]).map((p) => [p.user_id, p]));

  const { sendWebPushToUser } = await import("@/lib/push/push.server");
  let sent = 0;
  for (const r of rows) {
    for (const rec of r.recipients) {
      const p = prefBy.get(rec.userId);
      const tz = p?.timezone || rec.tz;
      const due = dueReminder(r, rec.audience, now, {
        prefs: readSlotPrefs(p?.session_reminders),
        quiet: { on: p?.quiet_hours_enabled ?? true, start: p?.quiet_start ?? 22, end: p?.quiet_end ?? 7 },
        localHour: localHour(now, tz),
      });
      if (!due) continue;
      const start = new Date(r.startsAt);
      const word = relativeDayWord(start, now, tz);
      const copy = reminderCopy({
        kind: r.kind,
        audience: rec.audience,
        slot: due.slot,
        when: fmtClock(start, tz),
        day: word ?? `on ${fmtDayLabel(start, tz)}`,
        title: r.title,
        otherName: rec.otherName,
        location: r.location,
        joinUrl: r.joinUrl,
      });
      // the client's last one opens the call itself; everything else opens the app
      const url = rec.audience === "client" && r.kind === "call" && due.slot === "10m" && r.joinUrl ? r.joinUrl : rec.url;
      const res = await sendWebPushToUser(
        admin,
        rec.userId,
        { title: copy.title, body: copy.body, url, tag: `rem:${r.source}:${r.id}`, data: { kind: "session_reminder", slot: due.slot, joinUrl: r.joinUrl, clientId: r.clientId } },
        // session reminders aren't the morning nudge: only the master switch and their own choices gate them
        { eventKey: due.key, priority: "urgent" },
      );
      if (res.sent > 0) sent++;
    }
  }

  const summaries = await coachTomorrowSummaries(admin, now).catch((e) => {
    console.warn("[session-reminders] summaries failed", e);
    return 0;
  });
  return { considered: rows.length, sent, summaries };
}

/**
 * At 6 PM in the coach's zone, one push: tomorrow's sessions and calls
 * ("3 sessions · 2 calls, first at 7:00 AM (Sam)"). Nothing when tomorrow is clear.
 */
async function coachTomorrowSummaries(admin: Admin, now: Date): Promise<number> {
  const db = admin as any;
  const { data: coaches } = await db.from("coaches").select("id, user_id, full_name").eq("archived", false).not("user_id", "is", null);
  const list = ((coaches ?? []) as any[]).filter((c) => c.user_id);
  if (!list.length) return 0;
  const { data: prefs } = await db.from("push_notification_preferences").select("user_id, timezone, session_reminders").in("user_id", list.map((c) => c.user_id));
  const prefBy = new Map(((prefs ?? []) as any[]).map((p) => [p.user_id, p]));
  const { sendWebPushToUser } = await import("@/lib/push/push.server");
  let sent = 0;
  for (const coach of list) {
    const p = prefBy.get(coach.user_id);
    const tz = p?.timezone || DEFAULT_TZ;
    if (localHour(now, tz) !== COACH_SUMMARY_HOUR) continue;
    if (readSlotPrefs(p?.session_reminders).day === false) continue;
    const items = await coachDayItems(db, coach.id, tz, localDateISO(new Date(now.getTime() + 24 * 3_600_000), tz));
    const s = daySummary(items, (iso) => fmtClock(new Date(iso), tz));
    if (!s) continue;
    const today = localDateISO(now, tz);
    const r = await sendWebPushToUser(
      admin,
      coach.user_id,
      { title: "Tomorrow", body: s.line, url: "/admin/calendar?tab=upcoming", tag: "coach-tomorrow", data: { kind: "coach_tomorrow" } },
      { eventKey: `coach-tomorrow:${coach.user_id}:${today}`, priority: "normal" },
    );
    if (r.sent > 0) sent++;
  }
  return sent;
}

/** A coach's calls and sessions on one local day (their clients' sessions, their appointments). */
export async function coachDayItems(db: any, coachId: string, tz: string, day: string): Promise<SummaryItem[]> {
  // a day in any zone sits inside this window; filtered by local date below
  const from = new Date(Date.parse(`${day}T00:00:00Z`) - 14 * 3_600_000).toISOString();
  const to = new Date(Date.parse(`${day}T23:59:59Z`) + 14 * 3_600_000).toISOString();
  const { data: mine } = await db.from("clients").select("id, first_name, full_name").eq("assigned_coach_id", coachId).eq("archived", false);
  const ids = ((mine ?? []) as any[]).map((c) => c.id);
  const nameOf = new Map(((mine ?? []) as any[]).map((c) => [c.id, c.first_name ?? c.full_name ?? null]));
  const [{ data: sessions }, { data: appts }] = await Promise.all([
    ids.length
      ? db.from("pt_sessions").select("client_id, starts_at, session_type").in("client_id", ids).eq("status", "Scheduled").gte("starts_at", from).lte("starts_at", to)
      : Promise.resolve({ data: [] }),
    db.from("appointments").select("external_name, starts_at").eq("host_coach_id", coachId).eq("status", "Scheduled").gte("starts_at", from).lte("starts_at", to),
  ]);
  const items: SummaryItem[] = [
    ...((sessions ?? []) as any[]).map((s) => ({ kind: isTrainingSessionType(s.session_type) ? ("pt" as const) : ("call" as const), startsAt: s.starts_at, name: nameOf.get(s.client_id) ?? null })),
    ...((appts ?? []) as any[]).map((a) => ({ kind: "call" as const, startsAt: a.starts_at, name: a.external_name ? String(a.external_name).split(" ")[0] : null })),
  ];
  return items.filter((i) => localDateISO(new Date(i.startsAt), tz) === day);
}
