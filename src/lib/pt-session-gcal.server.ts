// Server-only: keeps PT sessions mirrored in the coach's Google Calendar and
// reads Google for double-booking checks. Never import from client code.
//
// Flow: any insert/edit of a session sets pt_sessions.gcal_dirty (DB trigger).
// syncPtSessionsToGoogle() claims dirty rows (pt_gcal_claim, so the 5-minute
// tick and an on-save kick never push the same row twice), creates / updates /
// deletes the Google event, and clears the flag only if the row didn't change
// meanwhile. Hard deletes go through pt_session_gcal_deletes.
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  GATEWAY_BASE,
  gatewayHeaders,
  gcalListEvents,
  workspaceCalendarConfigured,
} from "@/lib/google-cal.server";
import { GCAL_PT_SESSION_KEY, googleEventBlocksTime, type BusyItem } from "@/lib/session-conflicts";
import { DEFAULT_TZ } from "@/lib/schedule-time";

type Admin = SupabaseClient<any, any, any>;

const MAX_ATTEMPTS = 5;
/** Sessions that ended longer ago than this are never pushed to Google. */
const HISTORY_CUTOFF_MS = 2 * 24 * 60 * 60 * 1000;

export function appOrigin(): string {
  return (process.env.PUBLIC_APP_URL || process.env.SITE_URL || "https://jfeffect.com").replace(/\/$/, "");
}

async function gapi(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown) {
  const res = await fetch(`${GATEWAY_BASE}${path}`, {
    method,
    headers: gatewayHeaders(body ? { "Content-Type": "application/json" } : {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  const data: any = res.status === 204 ? {} : await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function eventPath(calendarId: string, eventId?: string) {
  const base = `/calendars/${encodeURIComponent(calendarId)}/events`;
  // sendUpdates=none: these events have no attendees, and the client is never emailed by Google.
  return eventId ? `${base}/${encodeURIComponent(eventId)}?sendUpdates=none` : `${base}?sendUpdates=none`;
}

type SessionRow = {
  id: string;
  client_id: string;
  title: string | null;
  session_type: string | null;
  starts_at: string;
  ends_at: string;
  timezone: string | null;
  location: string | null;
  notes: string | null;
  status: string;
  updated_at: string;
  google_event_id: string | null;
  google_calendar_id: string | null;
  gcal_attempts: number | null;
};

export function sessionEventBody(s: SessionRow, clientName: string | null) {
  const tz = s.timezone || DEFAULT_TZ;
  const title = s.title || s.session_type || "PT Session";
  return {
    summary: clientName ? `${clientName} · ${title}` : title,
    location: s.location || undefined,
    description: [
      s.session_type && s.session_type !== title ? s.session_type : null,
      s.notes || null,
      `Open in JF Effect: ${appOrigin()}/admin/clients/${s.client_id}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    start: { dateTime: s.starts_at, timeZone: tz },
    end: { dateTime: s.ends_at, timeZone: tz },
    transparency: "opaque",
    extendedProperties: { private: { [GCAL_PT_SESSION_KEY]: s.id } },
  };
}

/** The calendar the app writes sessions to: the client's coach's pick, else the workspace pick. */
async function makeCalendarResolver(admin: Admin) {
  const { data: conns } = await admin
    .from("google_calendar_connections")
    .select("coach_id, selected_calendar_id, updated_at")
    .not("selected_calendar_id", "is", null)
    .order("updated_at", { ascending: false });
  const byCoach = new Map<string, string>();
  for (const c of (conns ?? []) as any[]) if (!byCoach.has(c.coach_id)) byCoach.set(c.coach_id, c.selected_calendar_id);
  const fallback = ((conns ?? []) as any[])[0]?.selected_calendar_id ?? "primary";
  return (coachId: string | null | undefined) => (coachId && byCoach.get(coachId)) || fallback;
}

async function runPool<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

export type GcalSyncResult = {
  skipped?: string;
  claimed: number;
  created: number;
  updated: number;
  removed: number;
  failed: number;
};

export async function syncPtSessionsToGoogle(admin: Admin, limit = 12): Promise<GcalSyncResult> {
  const result: GcalSyncResult = { claimed: 0, created: 0, updated: 0, removed: 0, failed: 0 };
  if (!workspaceCalendarConfigured()) return { ...result, skipped: "google_not_configured" };

  const { data: claimed, error } = await (admin as any).rpc("pt_gcal_claim", { _limit: limit });
  if (error) throw new Error(`pt_gcal_claim: ${error.message}`);
  const rows = (claimed ?? []) as SessionRow[];
  result.claimed = rows.length;

  if (rows.length) {
    const resolveCalendar = await makeCalendarResolver(admin);
    const clientIds = Array.from(new Set(rows.map((r) => r.client_id)));
    const { data: clients } = await admin
      .from("clients")
      .select("id, full_name, assigned_coach_id")
      .in("id", clientIds);
    const clientById = new Map(((clients ?? []) as any[]).map((c) => [c.id, c]));

    // A few at a time: fast enough for a bulk booking, gentle on the request time limit.
    await runPool(rows, 4, async (row) => {
      let eventId = row.google_event_id;
      let calendarId = row.google_calendar_id;
      try {
        const client = clientById.get(row.client_id);
        const stale = new Date(row.ends_at).getTime() < Date.now() - HISTORY_CUTOFF_MS;
        if (row.status === "Scheduled" && !stale) {
          const target: string = calendarId || resolveCalendar(client?.assigned_coach_id);
          calendarId = target;
          const body = sessionEventBody(row, client?.full_name ?? null);
          if (eventId) {
            const r = await gapi("PATCH", eventPath(target, eventId), body);
            if (r.ok) result.updated++;
            else if (r.status === 404 || r.status === 410) eventId = null; // removed in Google: recreate
            else throw new Error(r.data?.error?.message || `Google update failed (${r.status})`);
          }
          if (!eventId) {
            const r = await gapi("POST", eventPath(target), body);
            if (!r.ok || !r.data?.id) throw new Error(r.data?.error?.message || `Google create failed (${r.status})`);
            eventId = r.data.id as string;
            result.created++;
          }
        } else if ((row.status === "Cancelled" || row.status === "Rescheduled") && eventId) {
          const r = await gapi("DELETE", eventPath(calendarId || resolveCalendar(client?.assigned_coach_id), eventId));
          if (!r.ok && r.status !== 404 && r.status !== 410) {
            throw new Error(r.data?.error?.message || `Google delete failed (${r.status})`);
          }
          eventId = null;
          result.removed++;
        }
        // Completed / no-show / old sessions keep whatever is in Google as history.

        const now = new Date().toISOString();
        const { data: done } = await admin
          .from("pt_sessions")
          .update({
            gcal_dirty: false,
            gcal_claimed_at: null,
            gcal_synced_at: now,
            gcal_error: null,
            gcal_attempts: 0,
            google_event_id: eventId,
            google_calendar_id: eventId ? calendarId : null,
          } as any)
          .eq("id", row.id)
          .eq("updated_at", row.updated_at)
          .select("id");
        if (!done?.length) {
          // Edited while we were syncing: keep the event link, stay dirty, next run catches up.
          const { data: still } = await admin
            .from("pt_sessions")
            .update({ google_event_id: eventId, google_calendar_id: eventId ? calendarId : null, gcal_claimed_at: null } as any)
            .eq("id", row.id)
            .select("id");
          if (!still?.length && eventId && calendarId) {
            // Deleted while we were syncing: don't leave an orphan behind in Google.
            await gapi("DELETE", eventPath(calendarId, eventId));
          }
        }
      } catch (e: any) {
        result.failed++;
        await admin
          .from("pt_sessions")
          .update({
            gcal_error: String(e?.message ?? e).slice(0, 500),
            gcal_attempts: Math.min(MAX_ATTEMPTS, Number(row.gcal_attempts ?? 0) + 1),
            gcal_claimed_at: null,
            // An event we just created must not be created again on retry.
            google_event_id: eventId,
            google_calendar_id: eventId ? calendarId : row.google_calendar_id,
          } as any)
          .eq("id", row.id);
      }
    });
  }

  // Sessions deleted from the app.
  const { data: deletes } = await (admin as any).rpc("pt_gcal_pop_deletes", { _limit: limit });
  if (deletes?.length) {
    const resolveCalendar = await makeCalendarResolver(admin);
    for (const d of deletes as any[]) {
      const r = await gapi("DELETE", eventPath(d.google_calendar_id || resolveCalendar(null), d.google_event_id));
      if (r.ok || r.status === 404 || r.status === 410) {
        result.removed++;
      } else {
        result.failed++;
        await admin.from("pt_session_gcal_deletes" as any).insert({
          google_event_id: d.google_event_id,
          google_calendar_id: d.google_calendar_id,
          attempts: Number(d.attempts ?? 0) + 1,
          last_error: String(r.data?.error?.message ?? r.status).slice(0, 500),
        });
      }
    }
  }
  return result;
}

/**
 * Google events that block time in [timeMin, timeMax], for double-booking
 * checks. `checked` is false when Google couldn't be read, so the UI can say so
 * instead of implying the slot is free.
 */
export async function listGoogleBusy(
  coachId: string | null,
  timeMinISO: string,
  timeMaxISO: string,
): Promise<{ checked: boolean; items: BusyItem[] }> {
  if (!workspaceCalendarConfigured()) return { checked: false, items: [] };
  try {
    const events = await gcalListEvents(coachId, timeMinISO, timeMaxISO, undefined, { strict: true });
    const items: BusyItem[] = events
      .filter((e) => googleEventBlocksTime(e.raw))
      .map((e) => ({
        source: "google" as const,
        id: e.id,
        title: e.summary || "Busy",
        start: new Date(e.start).getTime(),
        end: new Date(e.end).getTime(),
      }));
    return { checked: true, items };
  } catch {
    return { checked: false, items: [] };
  }
}
