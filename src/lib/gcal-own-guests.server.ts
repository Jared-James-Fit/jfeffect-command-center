// Server-only: takes the coach's own calendars off the guest list of events on
// their calendars, so a session shows once in their Google (see gcal-own-guests.ts
// for why and the rules). Every write is sendUpdates=none: nobody is emailed.
import type { SupabaseClient } from "@supabase/supabase-js";
import { GATEWAY_BASE, gatewayHeaders, gcalListCalendars } from "@/lib/google-cal.server";
import {
  attendeesWithout,
  coachOwnCalendarIds,
  copyMatchesEvent,
  ownGuestEmails,
  seriesGuestCopiesSafe,
  type EventLike,
  type GuestLike,
} from "@/lib/gcal-own-guests";
import { isOrganizerCopy } from "@/lib/session-conflicts";

type Admin = SupabaseClient<any, any, any>;

export async function gapi(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown) {
  const res = await fetch(`${GATEWAY_BASE}${path}`, {
    method,
    headers: gatewayHeaders(body ? { "Content-Type": "application/json" } : {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  const data: any = res.status === 204 ? {} : await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export function eventPath(calendarId: string, eventId?: string) {
  const base = `/calendars/${encodeURIComponent(calendarId)}/events`;
  return eventId ? `${base}/${encodeURIComponent(eventId)}?sendUpdates=none` : `${base}?sendUpdates=none`;
}

function isRateLimited(r: { status: number; data: any }): boolean {
  return r.status === 429 || (r.status === 403 && /rate ?limit|quota/i.test(String(r.data?.error?.message ?? "")));
}

export type CoachCalendars = {
  /** Calendars the coach owns or can write to (where the app may write an event). */
  writable: Set<string>;
  /** The coach's own calendars a guest list must not hold (lowercase). */
  own: Set<string>;
};

/** Read once per run: the coach's calendars and which of them are their own. */
export async function loadCoachCalendars(admin: Admin): Promise<CoachCalendars> {
  const [cals, conns] = await Promise.all([
    gcalListCalendars(),
    admin.from("google_calendar_connections").select("selected_calendar_id").not("selected_calendar_id", "is", null),
  ]);
  return {
    writable: new Set(cals.filter((c) => c.accessRole === "owner" || c.accessRole === "writer").map((c) => c.id)),
    own: coachOwnCalendarIds(cals, ((conns.data ?? []) as any[]).map((c) => c.selected_calendar_id)),
  };
}

export type EventHome = { calendarId: string; event: EventLike; organizer: boolean };

/**
 * The copy of an event to write: the event itself (on its organizer's calendar)
 * when `calendarId` only holds an invitation to it and the organizer is one of
 * the coach's writable calendars, else the copy on `calendarId`. Null when the
 * event can't be read there.
 */
export async function eventHome(calendarId: string, eventId: string, writable: Set<string>): Promise<EventHome | null> {
  const r = await gapi("GET", eventPath(calendarId, eventId));
  if (!r.ok) return null;
  if (isOrganizerCopy(r.data, calendarId)) return { calendarId, event: r.data, organizer: true };
  const org = r.data?.organizer?.email as string | undefined;
  if (org && writable.has(org)) {
    const own = await gapi("GET", eventPath(org, eventId));
    if (own.ok) return { calendarId: org, event: own.data, organizer: true };
  }
  return { calendarId, event: r.data, organizer: false };
}

/** Of these Google event ids on this calendar, the ones an app session points at (other than `exceptSessionId`). */
async function linkedOn(admin: Admin, calendarId: string, ids: string[], exceptSessionId?: string): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await admin
      .from("pt_sessions")
      .select("id, google_event_id, google_calendar_id")
      .in("google_event_id", ids.slice(i, i + 200));
    for (const r of (data ?? []) as any[]) {
      if (r.id === exceptSessionId) continue;
      if (String(r.google_calendar_id ?? "").toLowerCase() === calendarId.toLowerCase()) out.add(r.google_event_id);
    }
  }
  return out;
}

export type GuestDrop = { attendees: GuestLike[]; dropped: string[] };

/**
 * The guest list to send with a write of this one event (the organizer's copy)
 * so the coach's own calendars come off it, or null when there's nothing to
 * drop. Each own calendar's copy is read first and kept when it holds something
 * the event doesn't, or another session points at it; one this session wrote
 * itself before it was moved onto the event (`sessionCalendar`) can go, since
 * the session's own write now lands on the event.
 */
export async function ownGuestDrop(
  admin: Admin,
  home: EventHome,
  own: Set<string>,
  opts: { sessionId?: string; sessionCalendar?: string | null } = {},
): Promise<GuestDrop | null> {
  if (!home.organizer) return null;
  const guests = ownGuestEmails(home.event, home.calendarId, own);
  if (!guests.length) return null;
  const dropped: string[] = [];
  for (const g of guests) {
    const copy = await gapi("GET", eventPath(g, home.event.id));
    if (copy.status === 404 || copy.status === 410) { dropped.push(g); continue; }
    if (!copy.ok) continue; // can't tell what's on it: leave it
    if ((await linkedOn(admin, g, [home.event.id], opts.sessionId)).size) continue;
    const ownEarlierWrite = !!opts.sessionCalendar && opts.sessionCalendar.toLowerCase() === g;
    if (ownEarlierWrite || copyMatchesEvent(home.event, copy.data)) dropped.push(g);
  }
  if (!dropped.length) return null;
  return { attendees: attendeesWithout(home.event.attendees, dropped), dropped };
}

/** PATCH only the guest list (nobody emailed). */
export async function patchGuests(calendarId: string, eventId: string, attendees: GuestLike[]) {
  return gapi("PATCH", eventPath(calendarId, eventId), { attendees });
}

/** Repeats are read this far ahead; nothing the app links is further out. */
const SERIES_HORIZON_MS = 2 * 366 * 24 * 60 * 60 * 1000;
const MAX_PAGES = 4;

async function listInstances(calendarId: string, masterId: string): Promise<{ ok: boolean; missing: boolean; items: EventLike[] }> {
  const items: EventLike[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = new URLSearchParams({ maxResults: "2500", timeMax: new Date(Date.now() + SERIES_HORIZON_MS).toISOString() });
    if (pageToken) q.set("pageToken", pageToken);
    const r = await gapi(
      "GET",
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(masterId)}/instances?${q.toString()}`,
    );
    if (!r.ok) return { ok: false, missing: page === 0 && (r.status === 404 || r.status === 410), items };
    items.push(...((r.data?.items ?? []) as EventLike[]));
    pageToken = r.data?.nextPageToken;
    if (!pageToken) return { ok: true, missing: false, items };
  }
  return { ok: false, missing: false, items }; // more than we read: not checked whole
}

export type SeriesResult = {
  calendarId: string;
  masterId: string;
  summary: string | null;
  guests: string[];
  /** dropped: off the series; unsafe: a copy holds something the event doesn't (or is linked); none: nothing to drop. */
  outcome: "dropped" | "would_drop" | "unsafe" | "none" | "failed";
  differs: string[];
  linked: string[];
  instancesFixed: number;
  instancesLeft: number;
  error?: string;
};

/**
 * Take the coach's own calendars off a whole repeating event's guest list, once
 * every copy of it on those calendars is checked to hold nothing the event
 * doesn't and no session points at one: the series itself (its future repeats)
 * and, with `instances`, every repeat changed on its own (an app session's
 * repeat is one) that still lists them. `apply: false` only reports.
 */
export async function dropOwnGuestsFromSeries(
  admin: Admin,
  calendarId: string,
  masterId: string,
  own: Set<string>,
  opts: { apply: boolean; instances: boolean },
): Promise<SeriesResult> {
  const out: SeriesResult = {
    calendarId, masterId, summary: null, guests: [], outcome: "none", differs: [], linked: [], instancesFixed: 0, instancesLeft: 0,
  };
  const master = await gapi("GET", eventPath(calendarId, masterId));
  if (!master.ok) return { ...out, outcome: "failed", error: `read the series (${master.status})` };
  out.summary = master.data?.summary ?? null;
  if (!isOrganizerCopy(master.data, calendarId)) return out;

  const repeats = await listInstances(calendarId, masterId);
  if (!repeats.ok) return { ...out, outcome: "failed", error: "read the repeats" };
  const guests = new Set(ownGuestEmails(master.data, calendarId, own));
  for (const e of repeats.items) for (const g of ownGuestEmails(e, calendarId, own)) guests.add(g);
  out.guests = [...guests];
  if (!guests.size) return out;

  for (const g of guests) {
    const copies = await listInstances(g, masterId);
    if (!copies.ok && !copies.missing) return { ...out, outcome: "failed", error: `read the copies on ${g}` };
    const linked = await linkedOn(admin, g, copies.items.map((c) => c.id));
    const check = seriesGuestCopiesSafe(repeats.items, copies.items, linked);
    out.differs.push(...check.differs);
    out.linked.push(...check.linked);
  }
  if (out.differs.length || out.linked.length) return { ...out, outcome: "unsafe" };
  if (!opts.apply) {
    const left = repeats.items.filter((e) => ownGuestEmails(e, calendarId, own).length).length;
    return { ...out, outcome: "would_drop", instancesLeft: left };
  }

  const drop = [...guests];
  if (ownGuestEmails(master.data, calendarId, own).length) {
    const r = await patchGuests(calendarId, masterId, attendeesWithout(master.data.attendees, drop));
    if (!r.ok) return { ...out, outcome: "failed", error: r.data?.error?.message || `update the series (${r.status})` };
  }
  out.outcome = "dropped";
  if (!opts.instances) return out;

  // Repeats changed on their own keep their own guest list: read them again
  // (the series' change has reached the rest) and fix the ones still listing them.
  const after = await listInstances(calendarId, masterId);
  const still = (after.ok ? after.items : repeats.items).filter((e) => ownGuestEmails(e, calendarId, own).length);
  for (const e of still) {
    const r = await patchGuests(calendarId, e.id, attendeesWithout(e.attendees, ownGuestEmails(e, calendarId, own)));
    if (r.ok) { out.instancesFixed++; continue; }
    out.error = r.data?.error?.message || `update a repeat (${r.status})`;
    if (isRateLimited(r)) break; // run it again later: what's done stays done
  }
  out.instancesLeft = still.length - out.instancesFixed;
  return out;
}
