// Server-only: reads the coach's Google Calendar and imports a client's PT
// appointments as app sessions (see gcal-session-import.ts for the rules and
// import_calendar_pt_session for the credits). Never import from client code.
import type { SupabaseClient } from "@supabase/supabase-js";
import { GATEWAY_BASE, gatewayHeaders, gcalListCalendars, gcalListEvents, listCalendarEvents, workspaceCalendarConfigured } from "@/lib/google-cal.server";
import { GCAL_PT_SESSION_KEY, isOrganizerCopy } from "@/lib/session-conflicts";
import { attendeesWithout, ownGuestEmails, type GuestLike } from "@/lib/gcal-own-guests";
import {
  dropOwnGuestsFromSeries,
  eventHome,
  loadCoachCalendars,
  ownGuestDrop,
  patchGuests,
  type CoachCalendars,
  type SeriesResult,
} from "@/lib/gcal-own-guests.server";
import { eventNamesClient, looksLikeTraining, planImport, type ImportCandidate, type ImportClient, type ImportEvent, type SkippedEvent } from "@/lib/gcal-session-import";
import { DEFAULT_TZ, localDateISO, localTimeHM } from "@/lib/schedule-time";

type Admin = SupabaseClient<any, any, any>;

export type ImportPreview = {
  candidates: Array<ImportCandidate & { countedByHand: boolean }>;
  skipped: SkippedEvent[];
  /** Days counted by hand (a used credit with no session) that no Google appointment matches. */
  handCountedOnly: Record<string, string[]>;
  /** Training-looking appointments that name none of these clients (back-office review only). */
  unnamedTraining: Array<{ eventId: string; date: string; start: string; summary: string }>;
};

export type ImportResult = {
  created: number;
  linked: number;
  alreadyInApp: number;
  tookOverHandCount: number;
  tagged: number;
  /** Appointments that had the coach's own calendar as a guest (a second copy in their Google), taken off. */
  guestsDropped?: number;
  errors: string[];
};

async function loadClients(admin: Admin, ids: string[], terms: Record<string, string[]> = {}): Promise<ImportClient[]> {
  const { data, error } = await admin
    .from("clients")
    .select("id, full_name, first_name, last_name, preferred_name, email")
    .in("id", ids);
  if (error) throw new Error(error.message);
  return ((data ?? []) as ImportClient[]).map((c) => ({ ...c, terms: terms[c.id] ?? null }));
}

/** Unlinked, unreversed 'used' credits per client: the days counted by hand. */
async function handCountedDays(admin: Admin, clientIds: string[]): Promise<Record<string, string[]>> {
  const { data } = await admin
    .from("session_ledger_events")
    .select("id, client_id, event_type, source, related_event_id, pt_session_id, effective_date")
    .in("client_id", clientIds);
  const rows = (data ?? []) as any[];
  const reversed = new Set(
    rows.filter((r) => r.event_type === "adjusted" && ["revert_on_uncomplete", "reattribute"].includes(r.source)).map((r) => r.related_event_id),
  );
  const out: Record<string, string[]> = {};
  for (const r of rows) {
    if (r.event_type !== "used" || r.pt_session_id || reversed.has(r.id) || !r.effective_date) continue;
    (out[r.client_id] ??= []).push(String(r.effective_date).slice(0, 10));
  }
  for (const k of Object.keys(out)) out[k].sort();
  return out;
}

export async function previewGoogleImport(
  admin: Admin,
  opts: { clientIds: string[]; from: string; to: string; terms?: Record<string, string[]>; now?: Date },
): Promise<ImportPreview> {
  if (!workspaceCalendarConfigured()) throw new Error("Google Calendar isn't connected.");
  const clients = await loadClients(admin, opts.clientIds, opts.terms);
  // Every calendar the coach keeps (owner / writer): appointments live in more than the app's one.
  const calendars = await gcalListCalendars();
  const own = calendars.filter((c) => c.accessRole === "owner" || c.accessRole === "writer").map((c) => c.id);
  const listed = await gcalListEvents(
    null,
    new Date(`${opts.from}T00:00:00Z`).toISOString(),
    new Date(`${opts.to}T23:59:59Z`).toISOString(),
    own.length ? own : undefined,
    { strict: true },
  );
  const events: ImportEvent[] = listed.map((e) => ({
    id: e.id,
    calendarId: e.calendarId,
    summary: e.summary,
    description: (e.raw as any)?.description ?? null,
    location: e.location ?? null,
    status: e.status ?? null,
    start: e.start,
    end: e.end,
    allDay: e.allDay,
    appSessionId: e.appSessionId,
    timeZone: (e.raw as any)?.start?.timeZone ?? null,
    attendees: (e.raw as any)?.attendees ?? null,
  }));

  const ids = events.map((e) => e.id);
  const linked = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await admin.from("pt_sessions").select("google_event_id").in("google_event_id", ids.slice(i, i + 200));
    for (const r of (data ?? []) as any[]) if (r.google_event_id) linked.add(r.google_event_id);
  }

  const plan = planImport(events, clients, { now: opts.now, linkedEventIds: linked });
  const counted = await handCountedDays(admin, opts.clientIds);
  const datesByClient = new Map<string, Set<string>>();
  for (const c of plan.candidates) {
    if (!datesByClient.has(c.clientId)) datesByClient.set(c.clientId, new Set());
    datesByClient.get(c.clientId)!.add(c.date);
  }
  // Booked app sessions count as calendar days too (they're already on Google).
  const { data: sessions } = await admin
    .from("pt_sessions")
    .select("client_id, session_date, status")
    .in("client_id", opts.clientIds)
    .neq("status", "Cancelled");
  for (const s of (sessions ?? []) as any[]) {
    if (!datesByClient.has(s.client_id)) datesByClient.set(s.client_id, new Set());
    datesByClient.get(s.client_id)!.add(String(s.session_date));
  }

  const handCountedOnly: Record<string, string[]> = {};
  for (const id of opts.clientIds) {
    const days = datesByClient.get(id) ?? new Set();
    const only = (counted[id] ?? []).filter((d) => d >= opts.from && d <= opts.to && !days.has(d));
    if (only.length) handCountedOnly[id] = only;
  }
  const countedSet = new Map(Object.entries(counted).map(([k, v]) => [k, new Set(v)]));
  const unnamedTraining = events
    .filter((e) => !e.appSessionId && !linked.has(e.id) && !e.allDay && e.status !== "cancelled" && looksLikeTraining(e.summary))
    .filter((e) => !clients.some((c) => eventNamesClient(e, c)))
    .map((e) => {
      const at = new Date(e.start);
      const tz = e.timeZone || DEFAULT_TZ;
      return { eventId: e.id, date: localDateISO(at, tz), start: localTimeHM(at, tz), summary: e.summary ?? "" };
    });
  return {
    unnamedTraining,
    candidates: plan.candidates.map((c) => ({ ...c, countedByHand: c.past && !!countedSet.get(c.clientId)?.has(c.date) })),
    skipped: plan.skipped,
    handCountedOnly,
  };
}

export type GoogleCopy = {
  calendarId: string;
  accessRole: string;
  id: string;
  iCalUID: string | null;
  status: string | null;
  start: string | null;
  end: string | null;
  originalStart: string | null;
  summary: string | null;
  location: string | null;
  organizer: string | null;
  organizerIsThisCalendar: boolean;
  myResponse: string | null;
  /** The coach's own calendars on this copy's guest list (each one puts a second copy in their Google). */
  ownGuests: string[];
  appSessionId: string | null;
  linkedSessionIds: string[];
};

/**
 * Back-office check (the hook's `inspect`): every copy of a client's appointments
 * on every calendar the coach can see, unmerged, with who organizes each one and
 * which app session points at it. For telling an event from an invitation to it
 * when Google and the app disagree.
 */
export async function inspectGoogleCopies(
  admin: Admin,
  opts: { clientIds: string[]; from: string; to: string; terms?: Record<string, string[]> },
): Promise<GoogleCopy[]> {
  if (!workspaceCalendarConfigured()) throw new Error("Google Calendar isn't connected.");
  const clients = await loadClients(admin, opts.clientIds, opts.terms);
  const calendars = await gcalListCalendars();
  const { own } = await loadCoachCalendars(admin).catch(() => ({ own: new Set<string>() }));
  const timeMin = new Date(`${opts.from}T00:00:00Z`).toISOString();
  const timeMax = new Date(`${opts.to}T23:59:59Z`).toISOString();
  const out: GoogleCopy[] = [];
  for (const cal of calendars) {
    const { items } = await listCalendarEvents(cal.id, timeMin, timeMax);
    for (const e of items as any[]) {
      const ev: ImportEvent = {
        id: e.id, calendarId: cal.id, summary: e.summary, description: e.description ?? null, location: e.location ?? null,
        status: e.status ?? null, start: e.start?.dateTime || e.start?.date, end: e.end?.dateTime || e.end?.date,
        allDay: !e.start?.dateTime, appSessionId: e.extendedProperties?.private?.[GCAL_PT_SESSION_KEY] ?? null,
        timeZone: e.start?.timeZone ?? null, attendees: e.attendees ?? null,
      };
      if (!clients.some((c) => eventNamesClient(ev, c))) continue;
      out.push({
        calendarId: cal.id,
        accessRole: cal.accessRole,
        id: e.id,
        iCalUID: e.iCalUID ?? null,
        status: e.status ?? null,
        start: ev.start ?? null,
        end: ev.end ?? null,
        originalStart: e.originalStartTime?.dateTime || e.originalStartTime?.date || null,
        summary: e.summary ?? null,
        location: e.location ?? null,
        organizer: e.organizer?.email ?? null,
        organizerIsThisCalendar: isOrganizerCopy(e, cal.id),
        myResponse: (e.attendees ?? []).find((a: any) => a.self)?.responseStatus ?? null,
        ownGuests: (e.attendees ?? [])
          .map((a: any) => String(a.email ?? "").toLowerCase())
          .filter((m: string) => own.has(m) && m !== String(e.organizer?.email ?? "").toLowerCase()),
        appSessionId: ev.appSessionId ?? null,
        linkedSessionIds: [],
      });
    }
  }
  const ids = Array.from(new Set(out.map((c) => c.id)));
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await admin.from("pt_sessions").select("id, google_event_id, google_calendar_id").in("google_event_id", ids.slice(i, i + 200));
    for (const r of (data ?? []) as any[]) {
      for (const c of out) if (c.id === r.google_event_id && (!r.google_calendar_id || r.google_calendar_id === c.calendarId)) c.linkedSessionIds.push(r.id);
    }
  }
  return out.sort((a, b) => Date.parse(a.start ?? "") - Date.parse(b.start ?? "") || a.calendarId.localeCompare(b.calendarId));
}

/**
 * Mark the Google event as this session's copy (title, time and notes untouched).
 * An upcoming one also takes the session's place (its booking type's), so Google
 * and the app say the same gym.
 */
async function tagEvent(
  calendarId: string,
  eventId: string,
  sessionId: string,
  location?: string | null,
  attendees?: GuestLike[] | null,
): Promise<boolean> {
  const res = await fetch(
    `${GATEWAY_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=none`,
    {
      method: "PATCH",
      headers: gatewayHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        ...(location ? { location } : {}),
        ...(attendees ? { attendees } : {}),
        extendedProperties: { private: { [GCAL_PT_SESSION_KEY]: sessionId } },
      }),
    },
  );
  return res.ok;
}

export async function applyGoogleImport(admin: Admin, candidates: ImportCandidate[]): Promise<ImportResult> {
  const out: ImportResult = { created: 0, linked: 0, alreadyInApp: 0, tookOverHandCount: 0, tagged: 0, errors: [] };
  // The coach's calendars, read once and only if something is imported.
  let calendarsRead: Promise<CoachCalendars> | null = null;
  const calendars = () =>
    (calendarsRead ??= loadCoachCalendars(admin).catch(() => ({ writable: new Set<string>(), own: new Set<string>() })));
  const series = new Map<string, { calendarId: string; masterId: string }>();
  // Oldest first, so each day's credit lands where the client's packages ran in order.
  const ordered = [...candidates].sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  for (const c of ordered) {
    const { data, error } = await (admin as any).rpc("import_calendar_pt_session", {
      _client_id: c.clientId,
      _event_id: c.eventId,
      _calendar_id: c.calendarId,
      _date: c.date,
      _start: c.start,
      _end: c.end,
      _tz: c.timezone,
      _title: "1:1 Training",
      _location: c.location,
      _completed: c.past,
    });
    if (error) { out.errors.push(`${c.date} ${c.start} ${c.summary}: ${error.message}`); continue; }
    const r = data as { id: string; result: string; took_over_tally?: boolean; location?: string | null };
    if (r.result === "already_in_app") { out.alreadyInApp++; continue; }
    if (r.result === "linked") out.linked++;
    else out.created++;
    if (r.took_over_tally) out.tookOverHandCount++;
    // A new upcoming session is at its booking type's place; Google says the same.
    // A past one stays as Google has it (where it really was).
    const place = r.result === "created" && !c.past && r.location && r.location !== c.location ? r.location : null;
    // An appointment the coach made in Google with themselves as a guest shows twice in their
    // Google (the event and an invitation to it): the tag takes their own calendar off its guests.
    let guests: GuestLike[] | null = null;
    try {
      const cals = await calendars();
      if (cals.own.size) {
        const home = await eventHome(c.calendarId, c.eventId, cals.writable);
        if (home && home.calendarId === c.calendarId) {
          const drop = await ownGuestDrop(admin, home, cals.own, { sessionId: r.id });
          if (drop) {
            guests = drop.attendees;
            const masterId = home.event.recurringEventId;
            if (masterId) series.set(`${c.calendarId}|${masterId}`, { calendarId: c.calendarId, masterId });
          }
        }
      }
    } catch {
      // Tag it as it is; the session's next sync looks again.
    }
    try {
      if (await tagEvent(c.calendarId, c.eventId, r.id, place, guests)) {
        out.tagged++;
        if (guests) out.guestsDropped = (out.guestsDropped ?? 0) + 1;
      }
      else out.errors.push(`${c.date} ${c.summary}: couldn't tag the Google event`);
    } catch (e: any) {
      out.errors.push(`${c.date} ${c.summary}: ${e?.message ?? "couldn't tag the Google event"}`);
    }
  }
  // Its other repeats too, when every copy on the coach's own calendar says what the event says.
  for (const { calendarId, masterId } of series.values()) {
    try {
      await dropOwnGuestsFromSeries(admin, calendarId, masterId, (await calendars()).own, { apply: true, instances: false });
    } catch {
      // The sessions' next syncs try again.
    }
  }
  return out;
}

export type OwnInviteReport = {
  apply: boolean;
  /** The coach's own calendars a guest list may not hold. */
  own: string[];
  series: SeriesResult[];
  /** Single appointments (and repeats of a series that couldn't be fixed whole). */
  events: Array<{ calendarId: string; eventId: string; summary: string | null; start: string | null; guests: string[]; outcome: "dropped" | "would_drop" | "kept" | "failed"; error?: string }>;
};

/**
 * Back-office (the hook's `ownInvites`): these clients' appointments on the
 * coach's calendars that list one of the coach's own calendars as a guest, so
 * each shows twice in their Google. Without `apply` it only reports; with it, a
 * repeating one comes off the guest list as a whole series (every repeat) when
 * every copy is checked to hold nothing the event doesn't, otherwise repeat by
 * repeat like a single one, each copy checked first. Clients stay invited and
 * nobody is emailed.
 */
export async function dropOwnInvites(
  admin: Admin,
  opts: { clientIds: string[]; from: string; to: string; terms?: Record<string, string[]>; apply: boolean },
): Promise<OwnInviteReport> {
  if (!workspaceCalendarConfigured()) throw new Error("Google Calendar isn't connected.");
  const clients = await loadClients(admin, opts.clientIds, opts.terms);
  const { own, writable } = await loadCoachCalendars(admin);
  const report: OwnInviteReport = { apply: opts.apply, own: [...own], series: [], events: [] };
  if (!own.size) return report;
  const timeMin = new Date(`${opts.from}T00:00:00Z`).toISOString();
  const timeMax = new Date(`${opts.to}T23:59:59Z`).toISOString();

  const found: Array<{ calendarId: string; event: any }> = [];
  for (const calendarId of writable) {
    const { items } = await listCalendarEvents(calendarId, timeMin, timeMax);
    for (const e of items as any[]) {
      if (e.status === "cancelled" || !ownGuestEmails(e, calendarId, own).length) continue;
      const ev: ImportEvent = {
        id: e.id, calendarId, summary: e.summary, description: e.description ?? null, location: e.location ?? null,
        status: e.status ?? null, start: e.start?.dateTime || e.start?.date, end: e.end?.dateTime || e.end?.date,
        allDay: !e.start?.dateTime, appSessionId: e.extendedProperties?.private?.[GCAL_PT_SESSION_KEY] ?? null,
        timeZone: e.start?.timeZone ?? null, attendees: e.attendees ?? null,
      };
      if (clients.some((c) => eventNamesClient(ev, c))) found.push({ calendarId, event: e });
    }
  }

  const bySeries = new Map<string, Array<{ calendarId: string; event: any }>>();
  const singles: Array<{ calendarId: string; event: any }> = [];
  for (const f of found) {
    const master = f.event.recurringEventId as string | undefined;
    if (!master) { singles.push(f); continue; }
    const k = `${f.calendarId}|${master}`;
    if (!bySeries.has(k)) bySeries.set(k, []);
    bySeries.get(k)!.push(f);
  }

  for (const [k, repeats] of bySeries) {
    const [calendarId, masterId] = k.split("|");
    const res = await dropOwnGuestsFromSeries(admin, calendarId, masterId, own, { apply: opts.apply, instances: true });
    report.series.push(res);
    // A series that can't come off whole (a copy holds something the event doesn't): repeat by repeat.
    if (res.outcome === "unsafe" || res.outcome === "failed") singles.push(...repeats);
  }

  for (const { calendarId, event } of singles) {
    const row: OwnInviteReport["events"][number] = {
      calendarId, eventId: event.id, summary: event.summary ?? null, start: event.start?.dateTime || event.start?.date || null,
      guests: ownGuestEmails(event, calendarId, own), outcome: "kept",
    };
    try {
      const drop = await ownGuestDrop(admin, { calendarId, event, organizer: true }, own);
      if (drop) {
        if (!opts.apply) row.outcome = "would_drop";
        else {
          const r = await patchGuests(calendarId, event.id, attendeesWithout(event.attendees, drop.dropped));
          row.outcome = r.ok ? "dropped" : "failed";
          if (!r.ok) row.error = r.data?.error?.message || `update failed (${r.status})`;
        }
      }
    } catch (e: any) {
      row.outcome = "failed";
      row.error = String(e?.message ?? e);
    }
    report.events.push(row);
  }
  return report;
}
