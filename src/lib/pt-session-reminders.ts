/**
 * Rules for session reminder texts. Pure, so the timing is unit-tested.
 *
 * One text per session, at 6 PM the evening before, in the session's zone.
 * Why that slot: a day's notice is what cuts no-shows (time to move it, pack a
 * bag, plan the drive), and the evening lands after work, not mid-meeting. A
 * second "2 hours before" text would double the volume for regulars training
 * 2-3x a week and mostly adds noise, so there isn't one.
 *
 * No text when:
 * - the session was booked or moved after that 6 PM mark (it was just arranged,
 *   the client knows; the coach can still choose to text from the Move sheet),
 * - it's under 2 hours away (too late to be useful),
 * - it's outside 9 AM-9 PM local (a missed slot catches up next morning if the
 *   session is still 2+ hours out),
 * - the client turned texts off, has no phone, or the session is hidden.
 */
import { addDaysISO, fmtClock, fmtDayLabel, localDateISO, localHour, wallTimeToUtc } from "@/lib/schedule-time";

export const REMINDER_LOCAL_TIME = "18:00";
export const SEND_FROM_HOUR = 9;
export const SEND_UNTIL_HOUR = 21;
export const MIN_LEAD_MS = 2 * 60 * 60 * 1000;
/** A moved or cancelled session this close gets an optional text to the client. */
export const LAST_MINUTE_CHANGE_MS = 48 * 60 * 60 * 1000;

export type ReminderSession = {
  status: string;
  reminders_enabled: boolean | null;
  visible_to_client: boolean | null;
  reminder_24h_sent_at: string | null;
  starts_at: string;
  session_date: string;
  timezone: string | null;
  time_set_at: string | null;
};

export type ReminderDecision =
  | { action: "send" }
  | { action: "wait"; reason: "not_yet" | "quiet_hours" }
  | {
      action: "skip";
      reason: "not_scheduled" | "reminders_off" | "hidden" | "already_sent" | "too_late" | "arranged_recently";
    };

/** 6 PM local on the day before the session. */
export function reminderSendAt(s: Pick<ReminderSession, "session_date" | "timezone">): Date {
  return wallTimeToUtc(addDaysISO(s.session_date, -1), REMINDER_LOCAL_TIME, s.timezone);
}

export function reminderDecision(s: ReminderSession, now: Date): ReminderDecision {
  if (s.status !== "Scheduled") return { action: "skip", reason: "not_scheduled" };
  if (s.reminders_enabled === false) return { action: "skip", reason: "reminders_off" };
  if (s.visible_to_client === false) return { action: "skip", reason: "hidden" };
  if (s.reminder_24h_sent_at) return { action: "skip", reason: "already_sent" };
  const start = new Date(s.starts_at).getTime();
  if (start - now.getTime() < MIN_LEAD_MS) return { action: "skip", reason: "too_late" };
  const sendAt = reminderSendAt(s);
  if (s.time_set_at && new Date(s.time_set_at).getTime() >= sendAt.getTime()) {
    return { action: "skip", reason: "arranged_recently" };
  }
  if (now.getTime() < sendAt.getTime()) return { action: "wait", reason: "not_yet" };
  const hour = localHour(now, s.timezone);
  if (hour < SEND_FROM_HOUR || hour >= SEND_UNTIL_HOUR) return { action: "wait", reason: "quiet_hours" };
  return { action: "send" };
}

/** "800 Vaughan Ave Unit 404, Selkirk, Manitoba ..." → "800 Vaughan Ave Unit 404". */
export function shortLocation(location: string | null | undefined): string {
  const first = (location ?? "").split(",")[0].trim();
  return first.length > 40 ? first.slice(0, 40).trim() : first;
}

/** "today" / "tomorrow" relative to now in the session's zone, else null. */
export function relativeDayWord(startsAt: Date, now: Date, tz: string | null | undefined): "today" | "tomorrow" | null {
  const sessionDay = localDateISO(startsAt, tz);
  const today = localDateISO(now, tz);
  if (sessionDay === today) return "today";
  if (sessionDay === addDaysISO(today, 1)) return "tomorrow";
  return null;
}

/** Keep texts to plain GSM characters so they never switch to the costlier UCS-2 encoding. */
export function gsmSafe(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\x20-\x7E\n]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function sessionName(title: string | null | undefined): string {
  const t = (title ?? "").trim() || "your session";
  return t.length > 40 ? t.slice(0, 40).trim() : t;
}

export type ReminderTextInput = {
  firstName: string | null | undefined;
  brand: string | null | undefined;
  title: string | null | undefined;
  startsAt: Date;
  tz: string | null | undefined;
  location: string | null | undefined;
  /** Bare host + path, e.g. "jfeffect.com/portal/calendar". */
  link: string;
  now: Date;
};

export function buildSessionReminderSms(i: ReminderTextInput): string {
  const name = (i.firstName ?? "").trim() || "there";
  const brand = (i.brand ?? "").trim() || "your coach";
  const word = relativeDayWord(i.startsAt, i.now, i.tz);
  const day = fmtDayLabel(i.startsAt, i.tz);
  const when = word ? `${word} (${day})` : `on ${day}`;
  const where = shortLocation(i.location);
  const body =
    `Hi ${name}, this is ${brand}. Reminder: ${sessionName(i.title)} ${when} at ${fmtClock(i.startsAt, i.tz)}` +
    `${where ? `, ${where}` : ""}. Need to change it? ${i.link}`;
  return gsmSafe(body);
}

export type ChangeTextInput = {
  kind: "moved" | "cancelled";
  firstName: string | null | undefined;
  brand: string | null | undefined;
  title: string | null | undefined;
  tz: string | null | undefined;
  /** For "moved": the new start. For "cancelled": the cancelled start. */
  startsAt: Date;
  location?: string | null;
  link: string;
};

export function buildSessionChangeSms(i: ChangeTextInput): string {
  const name = (i.firstName ?? "").trim() || "there";
  const brand = (i.brand ?? "").trim() || "your coach";
  const when = `${fmtDayLabel(i.startsAt, i.tz)} at ${fmtClock(i.startsAt, i.tz)}`;
  if (i.kind === "cancelled") {
    return gsmSafe(`Hi ${name}, this is ${brand}. Your ${sessionName(i.title)} on ${when} is cancelled. Your schedule: ${i.link}`);
  }
  const where = shortLocation(i.location);
  return gsmSafe(
    `Hi ${name}, this is ${brand}. Your ${sessionName(i.title)} moved to ${when}${where ? `, ${where}` : ""}. Your schedule: ${i.link}`,
  );
}

/** Whether a change to a session starting at `startsAt` is close enough to text about. */
export function isLastMinute(startsAt: Date, now: Date): boolean {
  const diff = startsAt.getTime() - now.getTime();
  return diff > -60 * 60 * 1000 && diff <= LAST_MINUTE_CHANGE_MS;
}
