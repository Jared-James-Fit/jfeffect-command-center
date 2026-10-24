/**
 * Session requests: a client asks for a session from their Schedule, the coach approves it
 * from the card in their chat. Pure helpers (tested); server side is
 * session-requests.functions.ts, the card is components/schedule/session-request-card.tsx.
 */

export type SessionRequestType = "training" | "call" | "assessment" | "other";
export type SessionRequestStatus = "pending" | "approved" | "declined" | "withdrawn";

export type SessionRequest = {
  id: string;
  client_id: string;
  request_type: SessionRequestType;
  preferred_date: string;
  preferred_time: string | null;
  duration_minutes: number;
  timezone: string | null;
  alt_times: string | null;
  note: string | null;
  status: SessionRequestStatus;
  pt_session_id: string | null;
  /** The booked session it moves ("instead of Tuesday"); null = an extra session. */
  replaces_session_id?: string | null;
  message_id: string | null;
  decline_reason: string | null;
  resolved_at: string | null;
  created_at: string;
};

export const REQUEST_TYPES: Array<{ value: SessionRequestType; label: string; hint: string; minutes: number }> = [
  { value: "training", label: "1:1 Training", hint: "In-person session", minutes: 60 },
  { value: "call", label: "Coaching call", hint: "Phone or video", minutes: 30 },
  { value: "assessment", label: "Assessment", hint: "Testing / progress check", minutes: 60 },
  { value: "other", label: "Something else", hint: "Tell your coach below", minutes: 30 },
];

export function requestTypeLabel(t: string): string {
  return REQUEST_TYPES.find((x) => x.value === t)?.label ?? "Session";
}

/** "14:30" / "14:30:00" → "2:30 PM". */
export function clockLabel(time: string | null | undefined): string {
  if (!time) return "";
  const [h, m] = time.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, "0")} ${ampm}`;
}

/** "Tue 27 · 11 AM": a booked session as a one-tap chip. */
export function sessionChipLabel(date: string, time: string): string {
  const d = new Date(`${date}T00:00:00`);
  const wd = d.toLocaleDateString("en-US", { weekday: "short" });
  return `${wd} ${d.getDate()} · ${clockLabel(time).replace(":00 ", " ")}`;
}

/** "Tue, Oct 14 · 2:30 PM" or "Tue, Oct 14 · any time". */
export function requestWhen(r: Pick<SessionRequest, "preferred_date" | "preferred_time">): string {
  const d = new Date(`${r.preferred_date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  return `${d} · ${r.preferred_time ? clockLabel(r.preferred_time) : "any time"}`;
}

/** The chat line the request card sits under (also what push/SMS previews show). */
export function requestMessageBody(r: Pick<SessionRequest, "request_type" | "preferred_date" | "preferred_time">): string {
  return `📅 Session request: ${requestTypeLabel(r.request_type)} · ${requestWhen(r)}`;
}

/** Status line both sides see on the card. */
export function requestStatusLabel(status: SessionRequestStatus, coach = "your coach"): string {
  switch (status) {
    case "pending": return `Waiting for ${coach} to approve`;
    case "approved": return "Approved · booked";
    case "declined": return "Not booked";
    case "withdrawn": return "Withdrawn";
  }
}

/** Clients can ask for today or later, up to ~6 months out. */
export function isRequestableDate(date: string, today: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < today) return false;
  const max = new Date(`${today}T00:00:00Z`);
  max.setUTCDate(max.getUTCDate() + 183);
  return date <= max.toISOString().slice(0, 10);
}

export const MAX_PENDING_REQUESTS = 3;

/**
 * Kinds the coach approves in one tap from the chat card (booked from the client's own
 * usual session, or a call); "Something else" needs the coach to say what it is first.
 */
export function oneTapApprovable(t: string): boolean {
  return t === "training" || t === "assessment" || t === "call";
}

/** Training and assessments use a session credit; a call doesn't (booking-types creditDefaultFor). */
export function requestUsesCredit(t: string): boolean {
  return t === "training" || t === "assessment";
}

/** How far from the asked-for day a booked session can be and still be the one it replaces. */
export const REPLACE_WINDOW_DAYS = 6;

export type BookedSessionLite = { id: string; session_date: string; start_time: string; status?: string | null };

function dayNumber(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}
function weekdayOf(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}
/** Monday of the date's week, as a day number. */
function weekOf(iso: string): number {
  return dayNumber(iso) - ((weekdayOf(iso) + 6) % 7);
}

const WEEKDAY_WORDS: Array<[RegExp, number]> = [
  [/\bsun(day)?s?\b/i, 0],
  [/\bmon(day)?s?\b/i, 1],
  [/\btue(s|sday)?s?\b/i, 2],
  [/\bwed(s|nesday)?s?\b/i, 3],
  [/\bthu(r|rs|rsday)?s?\b/i, 4],
  [/\bfri(day)?s?\b/i, 5],
  [/\bsat(urday)?s?\b/i, 6],
];
const MOVE_WORDS = /\b(chang|mov|swap|switch|instead|resched|push|replac)/i;

/** Weekdays a note names ("Changing Tuesday session" → [2]), 0 = Sunday. */
export function mentionedWeekdays(note: string | null | undefined): number[] {
  const text = String(note ?? "");
  return WEEKDAY_WORDS.filter(([re]) => re.test(text)).map(([, d]) => d);
}

/**
 * The client's booked sessions a request could be instead of: still booked, today or
 * later, within a week of the asked-for day, and not already at the asked-for time.
 * Soonest first.
 */
export function replaceCandidates<T extends BookedSessionLite>(
  req: Pick<SessionRequest, "preferred_date" | "preferred_time">,
  booked: T[],
  today: string,
): T[] {
  const target = dayNumber(req.preferred_date);
  const time = req.preferred_time?.slice(0, 5) ?? null;
  return booked
    .filter((s) => (s.status ?? "Scheduled") === "Scheduled" && s.session_date >= today)
    .filter((s) => Math.abs(dayNumber(s.session_date) - target) <= REPLACE_WINDOW_DAYS)
    .filter((s) => !(s.session_date === req.preferred_date && s.start_time.slice(0, 5) === time))
    .sort((a, b) => a.session_date.localeCompare(b.session_date) || a.start_time.localeCompare(b.start_time));
}

/**
 * Which booked session a request is instead of, when it's clear: the one the client
 * picked; else one on a weekday the note names ("Changing Tuesday session for this
 * day"), the closest to the asked-for day; else, when the note talks about moving and
 * only one session is booked that week, that one. Null = an extra session (or not
 * clear, and the coach picks).
 */
export function suggestReplaced(
  req: Pick<SessionRequest, "preferred_date" | "preferred_time" | "note"> & { replaces_session_id?: string | null },
  booked: BookedSessionLite[],
  today: string,
): string | null {
  const near = replaceCandidates(req, booked, today);
  if (req.replaces_session_id) return near.some((s) => s.id === req.replaces_session_id) ? req.replaces_session_id : null;
  const target = dayNumber(req.preferred_date);
  const closest = (list: BookedSessionLite[]) =>
    [...list].sort((a, b) => Math.abs(dayNumber(a.session_date) - target) - Math.abs(dayNumber(b.session_date) - target))[0]?.id ?? null;

  const days = mentionedWeekdays(req.note);
  if (days.length) {
    // "Thursday instead of Tuesday": the day it's going to is the asked-for one, so the
    // other day named is the one it leaves.
    const others = days.filter((d) => d !== weekdayOf(req.preferred_date));
    for (const set of [others, days]) {
      const hit = near.filter((s) => set.includes(weekdayOf(s.session_date)));
      if (hit.length) return closest(hit);
    }
  }
  if (MOVE_WORDS.test(req.note ?? "")) {
    const sameWeek = near.filter((s) => weekOf(s.session_date) === weekOf(req.preferred_date));
    if (sameWeek.length === 1) return sameWeek[0].id;
  }
  return null;
}
