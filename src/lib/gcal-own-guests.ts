/**
 * The coach as a guest of their own event. When an event on one of the coach's
 * calendars (the one the app writes to, "Fitness Coaching") lists another of
 * their own calendars as a guest (their main calendar, jaredjamesfit@gmail.com),
 * Google puts an invitation copy of it on that calendar: the same session shows
 * twice in the coach's Google, once as the event and once with Yes / No / Maybe.
 * Nicolas's weekend series was made in Google that way, so every session of his
 * showed twice. Dropping the coach's own calendars from the guest list takes the
 * copy away and leaves the event, its reminders and the client's invitation as
 * they are.
 *
 * Pure: the Google calls are in gcal-own-guests.server.ts.
 */
import { googleOccurrenceKey, isOrganizerCopy } from "@/lib/session-conflicts";

export type GuestLike = {
  email?: string | null;
  displayName?: string | null;
  optional?: boolean | null;
  responseStatus?: string | null;
  comment?: string | null;
  additionalGuests?: number | null;
  organizer?: boolean | null;
  self?: boolean | null;
  resource?: boolean | null;
  id?: string | null;
};

type When = { dateTime?: string | null; date?: string | null } | null | undefined;

export type EventLike = {
  id: string;
  iCalUID?: string | null;
  status?: string | null;
  summary?: string | null;
  location?: string | null;
  start?: When;
  end?: When;
  originalStartTime?: When;
  recurringEventId?: string | null;
  organizer?: { email?: string | null; self?: boolean | null } | null;
  attendees?: GuestLike[] | null;
};

const lower = (s: string | null | undefined) => String(s ?? "").trim().toLowerCase();

/**
 * The coach's own calendars a guest list must never hold: their main calendar
 * and the calendar(s) the app writes to, when they own them. Another calendar
 * they can only write to (a family or a partner's) is someone else's, and a
 * guest there is on purpose.
 */
export function coachOwnCalendarIds(
  calendars: Array<{ id: string; primary?: boolean | null; accessRole?: string | null }>,
  appCalendarIds: Array<string | null | undefined>,
): Set<string> {
  const app = new Set(appCalendarIds.map(lower).filter(Boolean));
  const out = new Set<string>();
  for (const c of calendars) {
    if (c.accessRole !== "owner") continue;
    if (c.primary || app.has(lower(c.id))) out.add(lower(c.id));
  }
  return out;
}

/**
 * Guests on this copy of the event that are the coach's own calendars: only on
 * the organizer's copy (an invitation copy's guest list isn't ours to change),
 * never the organizer itself.
 */
export function ownGuestEmails(e: EventLike, calendarId: string, own: Set<string>): string[] {
  if (!own.size || !isOrganizerCopy(e, calendarId)) return [];
  const organizer = lower(e.organizer?.email || calendarId);
  const out: string[] = [];
  for (const a of e.attendees ?? []) {
    const email = lower(a.email);
    if (!email || email === organizer || a.organizer) continue;
    if (own.has(email) && !out.includes(email)) out.push(email);
  }
  return out;
}

/**
 * The guest list without these addresses, as Google takes it back on a PATCH
 * (a list replaces the whole list): everyone else kept with their answer, note
 * and plus-ones; Google's read-only flags left off.
 */
export function attendeesWithout(attendees: GuestLike[] | null | undefined, emails: string[]): GuestLike[] {
  const drop = new Set(emails.map(lower));
  return (attendees ?? [])
    .filter((a) => !drop.has(lower(a.email)))
    .map((a) => {
      const out: GuestLike = { email: a.email };
      if (a.displayName) out.displayName = a.displayName;
      if (a.optional) out.optional = true;
      if (a.responseStatus) out.responseStatus = a.responseStatus;
      if (a.comment) out.comment = a.comment;
      if (a.additionalGuests) out.additionalGuests = a.additionalGuests;
      return out;
    });
}

function instant(w: When): string {
  if (w?.dateTime) {
    const ms = Date.parse(w.dateTime);
    return Number.isNaN(ms) ? w.dateTime : String(ms);
  }
  return w?.date ?? "";
}

/**
 * Taking a guest copy away loses nothing only while it says what the event says:
 * same time, title and place (or it's already cancelled). One that differs holds
 * something the event doesn't (Nicolas's October sessions were edited on the
 * coach's copy before the app wrote to the event itself) and stays.
 */
export function copyMatchesEvent(event: EventLike | null | undefined, copy: EventLike): boolean {
  if (copy.status === "cancelled") return true;
  if (!event || event.status === "cancelled") return false;
  return (
    instant(event.start) === instant(copy.start) &&
    instant(event.end) === instant(copy.end) &&
    (event.summary ?? "") === (copy.summary ?? "") &&
    (event.location ?? "") === (copy.location ?? "")
  );
}

export type SeriesCheck = {
  safe: boolean;
  /** Original starts of guest copies that differ from the event. */
  differs: string[];
  /** Guest copies an app session points at. */
  linked: string[];
};

/**
 * Whether a whole series can drop a guest: every copy of it on that guest's
 * calendar matches the event's own occurrence and no app session points at one.
 */
export function seriesGuestCopiesSafe(
  eventInstances: EventLike[],
  guestInstances: EventLike[],
  linkedGuestIds: Set<string>,
): SeriesCheck {
  const byKey = new Map(eventInstances.map((e) => [googleOccurrenceKey(e), e]));
  const differs: string[] = [];
  const linked: string[] = [];
  for (const g of guestInstances) {
    const when = g.originalStartTime?.dateTime || g.originalStartTime?.date || g.start?.dateTime || g.start?.date || g.id;
    if (linkedGuestIds.has(g.id)) linked.push(String(when));
    else if (!copyMatchesEvent(byKey.get(googleOccurrenceKey(g)), g)) differs.push(String(when));
  }
  return { safe: differs.length === 0 && linked.length === 0, differs, linked };
}
