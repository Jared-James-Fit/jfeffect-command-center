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
import { smsSender } from "@/lib/sms-identity";
import { fitOneSegment } from "@/lib/sms-policy";
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
  /** Assigned coach's first name: "this is Jared from JF Effect". */
  coach?: string | null;
  title: string | null | undefined;
  startsAt: Date;
  tz: string | null | undefined;
  location: string | null | undefined;
  /** Bare host + path, e.g. "jfeffect.com/portal/calendar". */
  link: string;
  now: Date;
};

/**
 * One SMS segment (160 plain characters), always: the friendliest wording that
 * fits, else a tighter one. A reminder that tips into a second segment costs
 * double (every evening-before text until Nov 13 2026 was 165-178 characters).
 */
export function buildSessionReminderSms(i: ReminderTextInput): string {
  const name = gsmSafe((i.firstName ?? "").trim()) || "there";
  const brand = gsmSafe(smsSender(i.coach, i.brand));
  const word = relativeDayWord(i.startsAt, i.now, i.tz);
  const day = fmtDayLabel(i.startsAt, i.tz);
  const when = word ? `${word} (${day})` : `on ${day}`;
  const time = fmtClock(i.startsAt, i.tz);
  const where = gsmSafe(shortLocation(i.location));
  const at = where ? `, ${where}` : "";
  const title = gsmSafe(sessionName(i.title));
  return fitOneSegment([
    `Hi ${name}, this is ${brand}. Reminder: ${title} ${when} at ${time}${at}. Need to change it? ${i.link}`,
    `Hi ${name}, ${brand} here. Reminder: ${title} ${when} at ${time}${at}. Change it: ${i.link}`,
    `${brand}: reminder, ${title} ${when} at ${time}${at}. Change it: ${i.link}`,
    `${brand}: ${title} ${when} at ${time}. Change it: ${i.link}`,
    `${brand}: ${title} ${day} ${time}. ${i.link}`,
  ]);
}

export type ChangeTextInput = {
  kind: "moved" | "cancelled";
  firstName: string | null | undefined;
  brand: string | null | undefined;
  coach?: string | null;
  title: string | null | undefined;
  tz: string | null | undefined;
  /** For "moved": the new start. For "cancelled": the cancelled start. */
  startsAt: Date;
  location?: string | null;
  link: string;
};

export function buildSessionChangeSms(i: ChangeTextInput): string {
  const name = gsmSafe((i.firstName ?? "").trim()) || "there";
  const brand = gsmSafe(smsSender(i.coach, i.brand));
  const when = `${fmtDayLabel(i.startsAt, i.tz)} at ${fmtClock(i.startsAt, i.tz)}`;
  const title = gsmSafe(sessionName(i.title));
  if (i.kind === "cancelled") {
    return fitOneSegment([
      `Hi ${name}, this is ${brand}. Your ${title} on ${when} is cancelled. Your schedule: ${i.link}`,
      `Hi ${name}, ${brand} here. Your ${title} on ${when} is cancelled. ${i.link}`,
      `${brand}: your ${title} on ${when} is cancelled. ${i.link}`,
    ]);
  }
  const where = gsmSafe(shortLocation(i.location));
  const at = where ? `, ${where}` : "";
  return fitOneSegment([
    `Hi ${name}, this is ${brand}. Your ${title} moved to ${when}${at}. Your schedule: ${i.link}`,
    `Hi ${name}, ${brand} here. Your ${title} moved to ${when}${at}. ${i.link}`,
    `${brand}: your ${title} moved to ${when}${at}. ${i.link}`,
    `${brand}: your ${title} moved to ${when}. ${i.link}`,
  ]);
}

/** Whether a change to a session starting at `startsAt` is close enough to text about. */
export function isLastMinute(startsAt: Date, now: Date, windowMs: number = LAST_MINUTE_CHANGE_MS): boolean {
  const diff = startsAt.getTime() - now.getTime();
  return diff > -60 * 60 * 1000 && diff <= windowMs;
}

/** Someone the app can reach by push gets the chat message's push; a text is for the next day only. */
export const PUSH_REACHABLE_CHANGE_MS = 24 * 60 * 60 * 1000;

export type ChangeTextDecision = { text: true } | { text: false; reason: "not_last_minute" | "push_reaches_them" };

/**
 * Whether a moved or cancelled session is worth a text on top of the chat
 * message (which already pushes). Without push: within 48 hours. With push:
 * within 24 hours (a missed push then means a wasted trip). A change the client
 * asked for themselves (an approved request) is never texted to someone push
 * reaches: they're in the app waiting for the answer.
 */
export function changeTextDecision(o: {
  startsAt: Date;
  previousStartsAt?: Date | null;
  now: Date;
  pushReachable: boolean;
  clientAsked?: boolean;
}): ChangeTextDecision {
  if (o.clientAsked && o.pushReachable) return { text: false, reason: "push_reaches_them" };
  const windowMs = o.pushReachable ? PUSH_REACHABLE_CHANGE_MS : LAST_MINUTE_CHANGE_MS;
  const urgent = isLastMinute(o.startsAt, o.now, windowMs) || (!!o.previousStartsAt && isLastMinute(o.previousStartsAt, o.now, windowMs));
  if (urgent) return { text: true };
  return { text: false, reason: o.pushReachable && (isLastMinute(o.startsAt, o.now) || (!!o.previousStartsAt && isLastMinute(o.previousStartsAt, o.now))) ? "push_reaches_them" : "not_last_minute" };
}
