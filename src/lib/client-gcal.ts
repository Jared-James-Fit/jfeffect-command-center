/**
 * "Connect Google Calendar" for clients: the pure parts (no I/O, tested).
 *
 * The app keeps one calendar it created, "JF Effect", in the client's own
 * Google account, with the same items as their private calendar feed
 * (calendar-feed.server.ts). Every feed item maps to one Google event with an
 * id derived from the item's uid, so a re-sync updates instead of duplicating,
 * and a session that's cancelled or removed is deleted from Google.
 */
import type { FeedEvent } from "@/lib/ics-feed";

/** Only calendars this app creates: never the client's other calendars or events. */
export const CLIENT_GCAL_SCOPE = "https://www.googleapis.com/auth/calendar.app.created";
export const CLIENT_GCAL_SCOPES = ["openid", "https://www.googleapis.com/auth/userinfo.email", CLIENT_GCAL_SCOPE];
export const CLIENT_GCAL_NAME = "JF Effect";
export const CLIENT_GCAL_DESCRIPTION =
  "Your sessions, calls, workouts and events from JF Effect. Kept up to date by the app: changes made here are replaced.";

/** Items that ended more than this long ago are left alone in Google (history stays). */
export const SYNC_WINDOW_PAST_MS = 2 * 24 * 60 * 60 * 1000;
/** Even with nothing changed, check Google once a day (catches events deleted by hand). */
export const FULL_CHECK_MS = 24 * 60 * 60 * 1000;

export type GoogleTime = { date: string } | { dateTime: string };

export type GoogleEventBody = {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: GoogleTime;
  end: GoogleTime;
  transparency: "transparent" | "opaque";
  status: "confirmed";
  reminders: { useDefault: false; overrides: Array<{ method: "popup"; minutes: number }> };
  source?: { title: string; url: string };
  extendedProperties: { private: { jf: "1"; jfHash: string } };
};

const B32HEX = "0123456789abcdefghijklmnopqrstuv";

/**
 * Google event ids must be base32hex (0-9, a-v), 5 to 1024 characters. The
 * uid itself, encoded: deterministic and collision-free.
 */
export function googleEventId(uid: string): string {
  const bytes = new TextEncoder().encode(uid);
  let out = "jf";
  let value = 0;
  let bits = 0;
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32HEX[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += B32HEX[(value << (5 - bits)) & 31];
  return out.slice(0, 1024);
}

/** FNV-1a, 32-bit, as 8 hex chars. Change detection only, not security. */
export function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function nextDay(dateISO: string): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** One feed item as a Google event: workouts all-day and free, sessions timed with a 1-hour alert. */
export function toGoogleEvent(e: FeedEvent): GoogleEventBody {
  const allDay = !!e.allDayDate;
  const end = !allDay && e.end.getTime() <= e.start.getTime() ? new Date(e.start.getTime() + 60 * 60 * 1000) : e.end;
  const description =
    [e.description?.trim() || null, e.url ? `Open in JF Effect: ${e.url}` : null].filter(Boolean).join("\n\n") || undefined;
  const base = {
    id: googleEventId(e.uid),
    summary: e.summary,
    ...(description ? { description } : {}),
    ...(e.location ? { location: e.location } : {}),
    start: allDay ? { date: e.allDayDate as string } : { dateTime: e.start.toISOString() },
    end: allDay ? { date: nextDay(e.allDayDate as string) } : { dateTime: end.toISOString() },
    transparency: allDay ? ("transparent" as const) : ("opaque" as const),
    status: "confirmed" as const,
    reminders: {
      useDefault: false as const,
      overrides: allDay ? [] : [{ method: "popup" as const, minutes: 60 }],
    },
    ...(e.url && /^https?:\/\//.test(e.url) ? { source: { title: "JF Effect", url: e.url } } : {}),
  };
  return { ...base, extendedProperties: { private: { jf: "1", jfHash: shortHash(JSON.stringify(base)) } } };
}

/** What should be in Google now: live items that haven't long ended, one per id. */
export function desiredGoogleEvents(feed: FeedEvent[], windowStart: Date): GoogleEventBody[] {
  const startDate = windowStart.toISOString().slice(0, 10);
  const byId = new Map<string, GoogleEventBody>();
  for (const e of feed) {
    if (e.cancelled) continue;
    const recent = e.allDayDate ? e.allDayDate >= startDate : e.end.getTime() >= windowStart.getTime();
    if (!recent) continue;
    const g = toGoogleEvent(e);
    byId.set(g.id, g);
  }
  return Array.from(byId.values()).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Fingerprint of everything that should be in the calendar, to skip Google when nothing changed. */
export function syncSetHash(desired: GoogleEventBody[], calendarId: string | null | undefined): string {
  return shortHash(`${calendarId ?? ""}|${desired.map((d) => `${d.id}:${d.extendedProperties.private.jfHash}`).join(",")}`);
}

export type ExistingGoogleEvent = { id: string; status?: string | null; jf?: boolean; hash?: string | null };
export type SyncPlan = { insert: GoogleEventBody[]; update: GoogleEventBody[]; remove: string[] };

/**
 * What to change in Google. Only events the app wrote are ever deleted, so
 * anything the client adds to the calendar by hand is left alone.
 */
export function planSync(desired: GoogleEventBody[], existing: ExistingGoogleEvent[]): SyncPlan {
  const have = new Map(existing.map((e) => [e.id, e]));
  const want = new Set(desired.map((d) => d.id));
  const plan: SyncPlan = { insert: [], update: [], remove: [] };
  for (const d of desired) {
    const ex = have.get(d.id);
    if (!ex) plan.insert.push(d);
    else if (ex.status === "cancelled" || ex.hash !== d.extendedProperties.private.jfHash) plan.update.push(d);
  }
  for (const ex of existing) {
    if (ex.jf && ex.status !== "cancelled" && !want.has(ex.id)) plan.remove.push(ex.id);
  }
  return plan;
}

// ---- Google batch requests (up to 50 calls in one HTTP request) ------------

export type BatchOp = { key: string; method: "POST" | "PUT" | "DELETE"; path: string; body?: unknown };
export type BatchResult = { key: string; status: number; body: any };

export const BATCH_MAX = 50;

export function buildBatchBody(ops: BatchOp[], boundary: string): string {
  const parts = ops.map((op) => {
    const head = `--${boundary}\r\nContent-Type: application/http\r\nContent-ID: <${op.key}>\r\n\r\n${op.method} ${op.path} HTTP/1.1\r\n`;
    if (op.body === undefined) return `${head}\r\n`;
    return `${head}Content-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(op.body)}\r\n`;
  });
  return `${parts.join("")}--${boundary}--\r\n`;
}

export function batchBoundaryOf(contentType: string | null | undefined): string | null {
  const m = /boundary="?([^";]+)"?/i.exec(contentType ?? "");
  return m ? m[1] : null;
}

/** The multipart/mixed reply: one HTTP response per call, matched back by Content-ID. */
export function parseBatchResponse(text: string, boundary: string): BatchResult[] {
  const out: BatchResult[] = [];
  for (const raw of text.split(`--${boundary}`)) {
    const part = raw.trim();
    if (!part || part === "--") continue;
    const status = /HTTP\/[\d.]+\s+(\d{3})/.exec(part);
    if (!status) continue;
    const id = /Content-ID:\s*<response-([^>]+)>/i.exec(part);
    const after = part.slice(status.index);
    const gap = after.search(/\r?\n\r?\n/);
    const bodyText = gap >= 0 ? after.slice(gap).trim() : "";
    let body: any = null;
    if (bodyText) {
      try {
        body = JSON.parse(bodyText);
      } catch {
        body = bodyText;
      }
    }
    out.push({ key: id ? id[1] : "", status: Number(status[1]), body });
  }
  return out;
}

/** Where to send someone after the Google sign-in: an in-app path only, never another site. */
export function safeReturnPath(p: unknown, fallback = "/portal/calendar"): string {
  if (typeof p !== "string") return fallback;
  if (!p.startsWith("/") || p.startsWith("//") || p.startsWith("/\\") || p.length > 300) return fallback;
  return p;
}

/** Plain words for what went wrong in the Google sign-in. */
export function connectErrorMessage(code: string | null | undefined): string {
  switch (code) {
    case "access_denied":
      return "Google sign-in was cancelled, so nothing was connected.";
    case "calendar_permission":
      return "Google didn't give permission to add the JF Effect calendar. Try again and leave the calendar box ticked.";
    case "invalid_state":
      return "This sign-in expired. Go back to the app and tap Connect Google Calendar again.";
    case "not_configured":
      return "Google Calendar isn't set up for this app yet.";
    default:
      return "Couldn't connect Google Calendar. Go back to the app and try again in a minute.";
  }
}
