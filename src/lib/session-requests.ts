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
