/**
 * Google Calendar → app sessions: which of the coach's Google appointments
 * are a client's PT sessions, and what each becomes in the app. The coach
 * books many sessions straight into Google; importing them puts them on the
 * client's calendar and makes their credits follow what was actually booked.
 *
 * Matching is by the client's name in the appointment (title, description or
 * a guest), so "Marc PT", "Training w/ Colten" and "Nico" all match; an
 * appointment that names two clients is left out. A past appointment becomes
 * a done session (uses a credit, taking over a day already counted by hand),
 * an upcoming one a booked session (holds a credit).
 *
 * Pure: the server reads Google and writes the sessions.
 */
import { DEFAULT_TZ, localDateISO, localTimeHM } from "@/lib/schedule-time";

export type ImportClient = {
  id: string;
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  preferred_name?: string | null;
  email?: string | null;
  /** Extra words that mean this client (e.g. a nickname). */
  terms?: string[] | null;
};

export type ImportEvent = {
  id: string;
  calendarId: string;
  summary?: string | null;
  description?: string | null;
  location?: string | null;
  status?: string | null;
  start: string;
  end?: string | null;
  allDay?: boolean;
  /** Set when the event is already the Google copy of an app session. */
  appSessionId?: string | null;
  timeZone?: string | null;
  attendees?: Array<{ email?: string | null; displayName?: string | null }> | null;
};

export type ImportCandidate = {
  eventId: string;
  calendarId: string;
  clientId: string;
  summary: string;
  date: string;
  start: string;
  end: string;
  timezone: string;
  location: string | null;
  /** Ended before now: imported as done (uses a credit). */
  past: boolean;
};

export type SkippedEvent = {
  eventId: string;
  summary: string;
  date: string;
  reason: "already_in_app" | "cancelled" | "all_day" | "two_clients";
};

/** Lowercase, no accents, words only. */
export function normalizeText(text: string | null | undefined): string {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .replace(/[^a-z0-9@.]+/g, " ")
    .trim();
}

function words(text: string): string[] {
  return normalizeText(text).split(/[^a-z0-9]+/).filter(Boolean);
}

/**
 * Does this appointment name the client? A guest with their email, their
 * full name, or their first / preferred name (or a nickname that starts it,
 * 4+ letters: "Nico" for Nicolas) as a word in the title.
 */
export function eventNamesClient(e: ImportEvent, c: ImportClient): boolean {
  const email = normalizeText(c.email);
  if (email && (e.attendees ?? []).some((a) => normalizeText(a.email) === email)) return true;

  const text = normalizeText([e.summary, e.description, ...(e.attendees ?? []).map((a) => a.displayName)].filter(Boolean).join(" "));
  const full = normalizeText(c.full_name);
  if (full && full.includes(" ") && ` ${text} `.includes(` ${full} `)) return true;

  const titleWords = new Set(words(e.summary ?? ""));
  const names = [c.first_name, c.preferred_name, ...(c.terms ?? [])].map(normalizeText).filter(Boolean);
  const first = normalizeText(c.first_name);
  for (const w of titleWords) {
    if (names.includes(w)) return true;
    if (first && w.length >= 4 && first.startsWith(w)) return true;
  }
  return false;
}

const CANCELLED = /\b(cancel+ed|cancel|cx|no show|noshow|rescheduled)\b/;

/** The coach's Google appointments for these clients, as sessions to import. */
export function planImport(
  events: ImportEvent[],
  clients: ImportClient[],
  opts: { now?: Date; linkedEventIds?: Set<string>; tz?: string } = {},
): { candidates: ImportCandidate[]; skipped: SkippedEvent[] } {
  const now = opts.now ?? new Date();
  const linked = opts.linkedEventIds ?? new Set<string>();
  const candidates: ImportCandidate[] = [];
  const skipped: SkippedEvent[] = [];

  for (const e of events) {
    const who = clients.filter((c) => eventNamesClient(e, c));
    if (who.length === 0) continue;
    const tz = e.timeZone || opts.tz || DEFAULT_TZ;
    const startAt = new Date(e.start.length === 10 ? `${e.start}T00:00:00` : e.start);
    const endAt = new Date(e.end ? (e.end.length === 10 ? `${e.end}T00:00:00` : e.end) : startAt.getTime() + 60 * 60_000);
    const date = localDateISO(startAt, tz);
    const summary = e.summary ?? "";
    const skip = (reason: SkippedEvent["reason"]) => skipped.push({ eventId: e.id, summary, date, reason });

    if (e.appSessionId || linked.has(e.id)) { skip("already_in_app"); continue; }
    if (e.status === "cancelled" || CANCELLED.test(normalizeText(summary))) { skip("cancelled"); continue; }
    if (e.allDay || e.start.length === 10) { skip("all_day"); continue; }
    if (who.length > 1) { skip("two_clients"); continue; }

    candidates.push({
      eventId: e.id,
      calendarId: e.calendarId,
      clientId: who[0].id,
      summary,
      date,
      start: localTimeHM(startAt, tz),
      end: localTimeHM(endAt, tz),
      timezone: tz,
      location: e.location?.trim() || null,
      past: endAt.getTime() <= now.getTime(),
    });
  }
  candidates.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  return { candidates, skipped };
}
