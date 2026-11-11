/**
 * "You're booked in": when a session goes on a client's calendar without
 * them booking it themselves, they hear about it in their coach chat (with
 * the session as a card) and get a push. One message per booking spree: the
 * nine sessions Book ahead writes one by one are one message, never nine.
 *
 * Pure (rules and wording) so it's tested; the sending is
 * session-booked.server.ts, woken by the database the moment a session is
 * inserted (`pt_sessions_booked_kick`) and by pg_cron as the safety net.
 */

export const SESSION_BOOKED_KIND = "session_booked" as const;

/** The client booked these themselves (their app, a booking link) or the coach's Google brought them in. */
export const SELF_OR_IMPORTED_VIA = ["client_app", "booking_page", "google_calendar"] as const;

/** A booking spree (Book ahead, a repeating booking) is over once nothing new has come in for this long. */
export const BOOKED_QUIET_MS = 4_000;
/** …but never hold a message longer than this waiting for the spree to end. */
export const BOOKED_MAX_WAIT_MS = 20_000;
/** Older than this and it's history, not news (and never announced late). */
export const BOOKED_LOOKBACK_MS = 2 * 24 * 60 * 60 * 1000;
/** The message lists this many sessions; the card shows them all. */
export const BOOKED_LIST_MAX = 4;

export type BookedSessionRow = {
  id: string;
  client_id: string;
  title: string | null;
  session_type?: string | null;
  session_date: string;
  start_time: string;
  end_time: string;
  starts_at: string;
  created_at: string;
  status: string;
  location?: string | null;
  wants_meet?: boolean | null;
  booked_via?: string | null;
  visible_to_client?: boolean | null;
  send_confirmation_email?: boolean | null;
  confirmation_sent_at?: string | null;
};

/**
 * Is this a booking the client should hear about from their coach? The same
 * rule as the database's kick and pg_cron (20270227090000_session_booked_message.sql).
 */
export function shouldAnnounceBooking(s: BookedSessionRow, now: Date): boolean {
  if (s.confirmation_sent_at) return false;
  if (s.status !== "Scheduled") return false;
  if (s.visible_to_client === false || s.send_confirmation_email === false) return false;
  if ((SELF_OR_IMPORTED_VIA as readonly string[]).includes(s.booked_via ?? "")) return false;
  if (Date.parse(s.starts_at) <= now.getTime()) return false;
  return now.getTime() - Date.parse(s.created_at) <= BOOKED_LOOKBACK_MS;
}

/** How long until the spree that includes these looks finished (0 = send now). */
export function quietWaitMs(createdAts: string[], now: Date, waitedMs: number): number {
  if (!createdAts.length) return 0;
  const newest = Math.max(...createdAts.map((c) => Date.parse(c)));
  const left = newest + BOOKED_QUIET_MS - now.getTime();
  if (left <= 0) return 0;
  return Math.max(0, Math.min(left, BOOKED_MAX_WAIT_MS - waitedMs));
}

/** "Wed, Nov 11" for a yyyy-mm-dd, the same on every server. */
export function bookedDay(dateISO: string): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" })
    .format(new Date(Date.UTC(y, m - 1, d)));
}

function clock(hm: string): { text: string; suffix: "AM" | "PM" } {
  const [h, m] = hm.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return { text: `${h12}:${String(m || 0).padStart(2, "0")}`, suffix };
}

/** "4:00–4:30 PM", "11:30 AM–12:30 PM", or "4:00 PM" with no end. */
export function bookedTimes(start: string, end?: string | null): string {
  const a = clock(start.slice(0, 5));
  if (!end || end.slice(0, 5) <= start.slice(0, 5)) return `${a.text} ${a.suffix}`;
  const b = clock(end.slice(0, 5));
  return a.suffix === b.suffix ? `${a.text}–${b.text} ${b.suffix}` : `${a.text} ${a.suffix}–${b.text} ${b.suffix}`;
}

/** Where, in a few words: "Video call", "Phone call" or the first line of the address. */
export function bookedPlace(s: Pick<BookedSessionRow, "location" | "wants_meet">): string {
  const loc = (s.location ?? "").trim();
  if (s.wants_meet || /video|zoom|meet\b/i.test(loc)) return "Video call";
  if (/^phone/i.test(loc)) return "Phone call";
  const first = loc.split(",")[0].trim();
  return first.length > 40 ? first.slice(0, 40).trim() : first;
}

function byStart(a: BookedSessionRow, b: BookedSessionRow): number {
  return `${a.session_date} ${a.start_time}`.localeCompare(`${b.session_date} ${b.start_time}`);
}

/**
 * The chat line (also the inbox preview, and all an older app shows):
 * "✅ Booked: 1:1 Meeting · Wed, Nov 11 · 4:00–4:30 PM · Video call. It's in your calendar."
 * "✅ Booked 9 sessions (1:1 Training): Mon, Nov 16 · 10:30 AM, … and 5 more. They're in your calendar."
 */
export function bookedMessageBody(sessions: BookedSessionRow[]): string {
  const list = [...sessions].sort(byStart);
  if (!list.length) return "";
  if (list.length === 1) {
    const s = list[0];
    const title = s.title || s.session_type || "Session";
    const place = bookedPlace(s);
    return `✅ Booked: ${title} · ${bookedDay(s.session_date)} · ${bookedTimes(s.start_time, s.end_time)}${place ? ` · ${place}` : ""}. It's in your calendar.`;
  }
  const titles = new Set(list.map((s) => s.title || s.session_type || ""));
  const title = titles.size === 1 ? [...titles][0] : "";
  const shown = list.length > BOOKED_LIST_MAX + 1 ? list.slice(0, BOOKED_LIST_MAX) : list;
  const items = shown.map((s) => `${bookedDay(s.session_date)} · ${bookedTimes(s.start_time)}`);
  const more = list.length - shown.length;
  const joined = more > 0
    ? `${items.join(", ")} and ${more} more`
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
  return `✅ Booked ${list.length} sessions${title ? ` (${title})` : ""}: ${joined}. They're in your calendar.`;
}

/** The card the message carries: the sessions, read live (a move or cancel shows as it is now). */
export function bookedCard(sessions: Pick<BookedSessionRow, "id" | "session_date" | "start_time">[]) {
  const ids = [...sessions]
    .sort((a, b) => `${a.session_date} ${a.start_time}`.localeCompare(`${b.session_date} ${b.start_time}`))
    .map((s) => s.id);
  return { type: "file" as const, url: "", kind: SESSION_BOOKED_KIND, session_ids: ids };
}

/**
 * The coach's toast after booking: says the client is being told only when
 * they will be (a login to read it, visible, confirmation on, still ahead).
 */
export function bookedToast(count: number, first: string, tellsClient: boolean): string {
  const what = count > 1 ? `Booked ${count} sessions` : "Session booked";
  return tellsClient && first ? `${what} · ${first} gets a message in their chat` : what;
}
