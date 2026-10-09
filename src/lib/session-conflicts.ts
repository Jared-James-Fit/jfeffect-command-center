/**
 * Double-booking rules, shared by the booking dialog, the Move sheet and the
 * server check. Pure and unit-tested.
 *
 * A slot conflicts with anything that overlaps it (back-to-back is fine):
 * - another scheduled PT session or appointment in the app, or
 * - a Google Calendar event that actually blocks time.
 *
 * Google events that do NOT block: all-day events (birthdays, "gym closed"
 * notes), events marked "Free", cancelled events, events you declined, and the
 * copies of app sessions this app put in Google itself (they're already counted
 * as app sessions).
 */
import { overlaps } from "@/lib/schedule-time";

export type BusyItem = {
  source: "app" | "google";
  id: string;
  title: string;
  start: number;
  end: number;
};

export type SlotInput = { key: string; start: number; end: number };

export type SlotConflict = { key: string; items: BusyItem[] };

export function findConflicts(slots: SlotInput[], busy: BusyItem[]): SlotConflict[] {
  const out: SlotConflict[] = [];
  for (const slot of slots) {
    const items = busy.filter((b) => overlaps(slot, b));
    if (items.length) out.push({ key: slot.key, items: items.sort((a, b) => a.start - b.start) });
  }
  return out;
}

/** Marker the sync writes on every Google event it creates for a PT session. */
export const GCAL_PT_SESSION_KEY = "jfPtSessionId";

export type GoogleEventLike = {
  id: string;
  status?: string | null;
  transparency?: string | null;
  start?: { dateTime?: string | null; date?: string | null } | null;
  end?: { dateTime?: string | null; date?: string | null } | null;
  attendees?: Array<{ self?: boolean; responseStatus?: string }> | null;
  extendedProperties?: { private?: Record<string, string> | null } | null;
};

/** The app session id behind a Google event this app created, if any. */
export function appSessionIdOf(e: Pick<GoogleEventLike, "extendedProperties">): string | null {
  return e.extendedProperties?.private?.[GCAL_PT_SESSION_KEY] ?? null;
}

type GoogleWhen = { dateTime?: string | null; date?: string | null } | null | undefined;
type GoogleOccurrenceLike = {
  id: string;
  iCalUID?: string | null;
  status?: string | null;
  start?: GoogleWhen;
  originalStartTime?: GoogleWhen;
};

function whenKey(w: GoogleWhen): string | null {
  if (w?.dateTime) {
    const ms = Date.parse(w.dateTime);
    return Number.isNaN(ms) ? w.dateTime : String(ms);
  }
  return w?.date ?? null;
}

/**
 * One key per occurrence of a Google event. Every repeat of a recurring event
 * shares the series' iCalUID, so keying on the UID alone collapses a weekly
 * session into its first week. The original start pins the occurrence: it
 * stays put when one repeat is moved, and matches across calendars.
 */
export function googleOccurrenceKey(e: GoogleOccurrenceLike): string {
  return `${e.iCalUID || e.id}|${whenKey(e.originalStartTime) ?? whenKey(e.start) ?? ""}`;
}

/**
 * Merge the event lists of several calendars (the app's calendar plus the
 * coach's main one). Drops cancelled and start-less rows, and shows an event
 * that sits on both calendars once, keeping the first calendar's copy.
 */
export function mergeGoogleCalendarLists<T extends GoogleOccurrenceLike>(
  lists: Array<{ id: string; items: T[] }>,
): Array<{ calendarId: string; event: T }> {
  const seen = new Set<string>();
  const out: Array<{ calendarId: string; event: T }> = [];
  for (const { id: calendarId, items } of lists) {
    for (const e of items) {
      if (e.status === "cancelled" || !(e.start?.dateTime || e.start?.date)) continue;
      const key = googleOccurrenceKey(e);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ calendarId, event: e });
    }
  }
  return out;
}

export function googleEventBlocksTime(e: GoogleEventLike): boolean {
  if (e.status === "cancelled") return false;
  if (e.transparency === "transparent") return false;
  if (!e.start?.dateTime || !e.end?.dateTime) return false; // all-day
  if (appSessionIdOf(e)) return false;
  const me = (e.attendees ?? []).find((a) => a.self);
  if (me?.responseStatus === "declined") return false;
  return true;
}

export function slotLabelKey(dateISO: string, startHM: string): string {
  return `${dateISO}T${startHM.slice(0, 5)}`;
}
