/**
 * Push reminders for calls and training sessions, for the client and the
 * coach. Pure, so every timing rule is tested (session-reminders.test.ts);
 * session-reminders.server.ts runs it from the 5-minute schedule tick and
 * sends through the one push sender (its per-user dedupe and preferences).
 *
 * Which reminders (on top of what already happens when something is booked:
 * the chat card or the booking page, Google's invite with the Meet link, the
 * coach's "booked" push, and the evening-before text for training):
 *   call, client:  a day before (unless the day-before chat message went:
 *                  the confirmation and preparation, automation.server.ts),
 *                  15 minutes before (Join)
 *   call, coach:   15 minutes before (the meeting and the Join link); the
 *                  day's and tomorrow's calls are the coach's summaries
 *   training, client: a day before (unless the evening-before text went), an hour before
 *   training, coach:  15 minutes before; the day's sessions are in the morning summary
 *
 * Deduped by a key with the start time in it, so a moved session gets fresh
 * reminders and the old ones never go; a cancelled one gets none; one booked
 * late gets only the reminders still ahead of it; a reminder that came due
 * while the tick was down is dropped once it's stale; the day-before one waits
 * out quiet hours (the short ones are time-critical and go, silently, in them).
 */
export type ReminderKind = "call" | "pt";
export type ReminderAudience = "client" | "coach";
export type ReminderSlot = "24h" | "1h" | "15m" | "10m";

export const SLOT_MINUTES: Record<ReminderSlot, number> = { "24h": 24 * 60, "1h": 60, "15m": 15, "10m": 10 };

/**
 * How long after its moment a reminder may still go (a tick runs every 5
 * minutes). The day-before one may wait out a night's quiet hours, but only
 * while the start is still at least `DAY_BEFORE_MIN_LEAD` away.
 */
export const SLOT_GRACE_MINUTES: Record<ReminderSlot, number> = { "24h": 12 * 60, "1h": 20, "15m": 8, "10m": 8 };
export const DAY_BEFORE_MIN_LEAD_MINUTES = 3 * 60;

export const SLOTS: Record<`${ReminderKind}:${ReminderAudience}`, ReminderSlot[]> = {
  "call:client": ["24h", "15m"],
  "call:coach": ["15m"],
  "pt:client": ["24h", "1h"],
  "pt:coach": ["15m"],
};

/** Per-person choices (push_notification_preferences.session_reminders): a missing key is on. */
export type SlotPrefs = Partial<Record<"day" | "hour" | "soon", boolean>>;
const PREF_OF: Record<ReminderSlot, keyof SlotPrefs> = { "24h": "day", "1h": "hour", "15m": "soon", "10m": "soon" };

export type QuietHours = { on: boolean; start: number; end: number };

export type ReminderEvent = {
  source: "pt_session" | "appointment";
  id: string;
  kind: ReminderKind;
  status: string;
  startsAt: string;
  /** When this time was set (booked or moved): reminders already past then never go. */
  arrangedAt: string | null;
  /** Training: the evening-before text already went, so no day-before push. */
  textSent?: boolean;
  /** A call: the day-before chat message (confirm, prepare) already went, so no day-before push. */
  dayBeforeSent?: boolean;
};

export type DueReminder = { slot: ReminderSlot; key: string; urgent: boolean };

export function reminderKey(e: Pick<ReminderEvent, "source" | "id" | "startsAt">, slot: ReminderSlot, audience: ReminderAudience): string {
  return `rem:${e.source}:${e.id}:${Date.parse(e.startsAt)}:${slot}:${audience}`;
}

export function inQuiet(hour: number, q: QuietHours): boolean {
  if (!q.on || q.start === q.end) return false;
  return q.start > q.end ? hour >= q.start || hour < q.end : hour >= q.start && hour < q.end;
}

/**
 * The one reminder (if any) to send now to this audience. When several are due
 * at once (the tick was down), only the one closest to the start goes.
 */
export function dueReminder(
  e: ReminderEvent,
  audience: ReminderAudience,
  now: Date,
  opts: { prefs?: SlotPrefs | null; quiet?: QuietHours | null; localHour?: number } = {},
): DueReminder | null {
  if (e.status !== "Scheduled") return null;
  const start = Date.parse(e.startsAt);
  if (!Number.isFinite(start)) return null;
  const t = now.getTime();
  if (t >= start) return null;
  const arranged = e.arrangedAt ? Date.parse(e.arrangedAt) : null;
  const slots = SLOTS[`${e.kind}:${audience}`] ?? [];
  let pick: ReminderSlot | null = null;
  for (const slot of slots) {
    const at = start - SLOT_MINUTES[slot] * 60_000;
    if (t < at) continue; // not yet
    if (t - at > SLOT_GRACE_MINUTES[slot] * 60_000) continue; // stale
    if (slot === "24h" && start - t < DAY_BEFORE_MIN_LEAD_MINUTES * 60_000) continue; // too close now; the hour-before one covers it
    if (arranged != null && arranged > at) continue; // booked or moved after this one's moment
    if (opts.prefs && opts.prefs[PREF_OF[slot]] === false) continue;
    if (slot === "24h" && e.kind === "pt" && audience === "client" && e.textSent) continue;
    if (slot === "24h" && e.kind === "call" && audience === "client" && e.dayBeforeSent) continue;
    if (pick == null || SLOT_MINUTES[slot] < SLOT_MINUTES[pick]) pick = slot;
  }
  if (!pick) return null;
  const urgent = pick !== "24h";
  // the day-before one waits out quiet hours (its grace covers a 7am end for most evenings)
  if (!urgent && opts.quiet && opts.localHour != null && inQuiet(opts.localHour, opts.quiet)) return null;
  return { slot: pick, key: reminderKey(e, pick, audience), urgent };
}

export type ReminderCopyInput = {
  kind: ReminderKind;
  audience: ReminderAudience;
  slot: ReminderSlot;
  /** The time ("3:00 PM"), in the person's zone. */
  when: string;
  /** For the day-before one: "tomorrow" / "today" / "on Fri, Nov 27". */
  day: string;
  title: string | null;
  otherName: string | null;
  location: string | null;
  joinUrl: string | null;
};

/** Short, plain words; the Join link goes in the push's url, never typed into the body. */
export function reminderCopy(i: ReminderCopyInput): { title: string; body: string } {
  const what = (i.title ?? "").trim() || (i.kind === "call" ? "Your call" : "Training");
  const where = (i.location ?? "").split(",")[0]?.trim() ?? "";
  if (i.audience === "coach") {
    const who = (i.otherName ?? "").trim() || (i.kind === "call" ? "Your call" : "Your session");
    const mins = SLOT_MINUTES[i.slot];
    return i.kind === "call"
      ? { title: `${who} in ${mins} min`, body: `${what} at ${i.when}. Tap to open the meeting${i.joinUrl ? " and join" : ""}.` }
      : { title: `${who} in ${mins} min`, body: [what, i.when, where].filter(Boolean).join(" · ") };
  }
  if (i.kind === "call") {
    if (i.slot === "24h") return { title: `Call ${i.day} at ${i.when}`, body: `${what}${i.otherName ? ` with ${i.otherName}` : ""}. Need to move it? Tap to see it.` };
    if (i.slot === "1h") return { title: "Your call starts in 1 hour", body: `${what} at ${i.when}.` };
    return { title: `Your call starts in ${SLOT_MINUTES[i.slot]} minutes`, body: i.joinUrl ? "Tap to join." : `${what} at ${i.when}.` };
  }
  if (i.slot === "24h") return { title: `Training ${i.day} at ${i.when}`, body: [what, where].filter(Boolean).join(" · ") };
  return { title: "Training in 1 hour", body: [i.when, where].filter(Boolean).join(" · ") };
}

export type SummaryItem = { kind: ReminderKind; startsAt: string; name: string | null };

/**
 * The coach's summary of a day's calls and sessions, one push: "3 sessions ·
 * 2 calls" and the first one's time. Null when there's nothing.
 */
export function daySummary(items: readonly SummaryItem[], fmtTime: (iso: string) => string): { calls: number; sessions: number; line: string } | null {
  if (!items.length) return null;
  const sorted = [...items].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const calls = sorted.filter((i) => i.kind === "call").length;
  const sessions = sorted.length - calls;
  const parts = [sessions ? `${sessions} session${sessions === 1 ? "" : "s"}` : null, calls ? `${calls} call${calls === 1 ? "" : "s"}` : null].filter(Boolean);
  const first = sorted[0]!;
  return { calls, sessions, line: `${parts.join(" · ")}, first at ${fmtTime(first.startsAt)}${first.name ? ` (${first.name})` : ""}` };
}

/** Read the stored choices (anything odd reads as on). */
export function readSlotPrefs(raw: unknown): SlotPrefs {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: SlotPrefs = {};
  for (const k of ["day", "hour", "soon"] as const) if (o[k] === false) out[k] = false;
  return out;
}
