// Server-only: reads the coach's Google Calendar and imports a client's PT
// appointments as app sessions (see gcal-session-import.ts for the rules and
// import_calendar_pt_session for the credits). Never import from client code.
import type { SupabaseClient } from "@supabase/supabase-js";
import { GATEWAY_BASE, gatewayHeaders, gcalListEvents, workspaceCalendarConfigured } from "@/lib/google-cal.server";
import { GCAL_PT_SESSION_KEY } from "@/lib/session-conflicts";
import { planImport, type ImportCandidate, type ImportClient, type ImportEvent, type SkippedEvent } from "@/lib/gcal-session-import";

type Admin = SupabaseClient<any, any, any>;

export type ImportPreview = {
  candidates: Array<ImportCandidate & { countedByHand: boolean }>;
  skipped: SkippedEvent[];
  /** Days counted by hand (a used credit with no session) that no Google appointment matches. */
  handCountedOnly: Record<string, string[]>;
};

export type ImportResult = {
  created: number;
  linked: number;
  alreadyInApp: number;
  tookOverHandCount: number;
  tagged: number;
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
  const listed = await gcalListEvents(null, new Date(`${opts.from}T00:00:00Z`).toISOString(), new Date(`${opts.to}T23:59:59Z`).toISOString(), undefined, { strict: true });
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
  return {
    candidates: plan.candidates.map((c) => ({ ...c, countedByHand: c.past && !!countedSet.get(c.clientId)?.has(c.date) })),
    skipped: plan.skipped,
    handCountedOnly,
  };
}

/** Mark the Google event as this session's copy (title, time and notes untouched). */
async function tagEvent(calendarId: string, eventId: string, sessionId: string): Promise<boolean> {
  const res = await fetch(
    `${GATEWAY_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=none`,
    {
      method: "PATCH",
      headers: gatewayHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ extendedProperties: { private: { [GCAL_PT_SESSION_KEY]: sessionId } } }),
    },
  );
  return res.ok;
}

export async function applyGoogleImport(admin: Admin, candidates: ImportCandidate[]): Promise<ImportResult> {
  const out: ImportResult = { created: 0, linked: 0, alreadyInApp: 0, tookOverHandCount: 0, tagged: 0, errors: [] };
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
    const r = data as { id: string; result: string; took_over_tally?: boolean };
    if (r.result === "already_in_app") { out.alreadyInApp++; continue; }
    if (r.result === "linked") out.linked++;
    else out.created++;
    if (r.took_over_tally) out.tookOverHandCount++;
    try {
      if (await tagEvent(c.calendarId, c.eventId, r.id)) out.tagged++;
      else out.errors.push(`${c.date} ${c.summary}: couldn't tag the Google event`);
    } catch (e: any) {
      out.errors.push(`${c.date} ${c.summary}: ${e?.message ?? "couldn't tag the Google event"}`);
    }
  }
  return out;
}
