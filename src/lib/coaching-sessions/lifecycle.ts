/**
 * One appointment lifecycle for every meeting (pure, tested in
 * meeting-lifecycle.test.ts): a booked call (a pt_session that isn't
 * training) read as one state the coach and the client both see, and how
 * ready the meeting is.
 *
 *   scheduled             booked, not yet time to confirm (more than a day out)
 *   awaiting_confirmation the confirmation request went and they haven't answered
 *   confirmed             they confirmed (or booked it themselves)
 *   reschedule_requested  they asked for another time (or to cancel): it stays booked until the coach answers
 *   cancelled             cancelled or moved away
 *   completed             it happened
 *   no_show               it was missed and counted
 *
 * Readiness is not data completeness: a meeting is prepared the moment it's
 * booked, whatever the client has sent. The indicator says what's settled and
 * what isn't (confirmation, the client's preparation, the coach's, what needs
 * clarifying, how to join) and never blocks the meeting.
 */

export type AppointmentState =
  | "scheduled"
  | "awaiting_confirmation"
  | "confirmed"
  | "reschedule_requested"
  | "cancelled"
  | "completed"
  | "no_show";

export const STATE_WORDS: Record<AppointmentState, string> = {
  scheduled: "Scheduled",
  awaiting_confirmation: "Awaiting confirmation",
  confirmed: "Confirmed",
  reschedule_requested: "Change requested",
  cancelled: "Cancelled",
  completed: "Completed",
  no_show: "No-show",
};

export type AppointmentInput = {
  status: string | null | undefined;
  startsAt: string | null;
  clientConfirmedAt?: string | null;
  confirmationRequestedAt?: string | null;
  /** an open change request: a move or a cancel */
  pendingChange?: "move" | "cancel" | null;
  /** booked from the client's own app or booking page (they chose the time) */
  bookedByClient?: boolean;
};

export function appointmentState(a: AppointmentInput): AppointmentState {
  const st = String(a.status ?? "Scheduled");
  if (st === "Cancelled" || st === "Rescheduled") return "cancelled";
  if (st === "Completed") return "completed";
  if (st === "Missed") return "no_show";
  if (a.pendingChange) return "reschedule_requested";
  if (a.clientConfirmedAt || a.bookedByClient) return "confirmed";
  if (a.confirmationRequestedAt) return "awaiting_confirmation";
  return "scheduled";
}

/** The appointment is still ahead (or under way, within its length). */
export function isUpcoming(
  a: { startsAt: string | null; endsAt?: string | null; status?: string | null },
  now: Date = new Date(),
): boolean {
  if (!a.startsAt) return false;
  if (a.status && a.status !== "Scheduled") return false;
  const end = a.endsAt ? Date.parse(a.endsAt) : Date.parse(a.startsAt) + 60 * 60_000;
  return end > now.getTime();
}

/** "Starts in 12 min", "Live now", "Tomorrow 3:00 PM": how soon, in words (the caller formats the clock). */
export function soonWords(
  startsAt: string,
  now: Date,
  fmt: { clock: (d: Date) => string; day: (d: Date) => string },
  endsAt?: string | null,
): string {
  const start = Date.parse(startsAt);
  const end = endsAt ? Date.parse(endsAt) : start + 60 * 60_000;
  const t = now.getTime();
  if (t >= start && t < end) return "Live now";
  const mins = Math.round((start - t) / 60_000);
  if (mins >= 0 && mins < 60) return `Starts in ${Math.max(1, mins)} min`;
  return `${fmt.day(new Date(start))} · ${fmt.clock(new Date(start))}`;
}

/** Join is offered from 15 minutes before until the end. */
export function canJoin(
  startsAt: string | null,
  endsAt: string | null | undefined,
  now: Date = new Date(),
  joinUrl?: string | null,
): boolean {
  if (!startsAt || !joinUrl) return false;
  const start = Date.parse(startsAt);
  const end = endsAt ? Date.parse(endsAt) : start + 60 * 60_000;
  return now.getTime() >= start - 15 * 60_000 && now.getTime() < end;
}

export type ReadinessTone = "done" | "waiting" | "attention" | "none";
export type ReadinessItem = {
  key: "confirmation" | "client" | "coach" | "clarify" | "access";
  label: string;
  value: string;
  tone: ReadinessTone;
};
export type Readiness = { ready: boolean; items: ReadinessItem[]; headline: string };

export type ReadinessInput = {
  state: AppointmentState | null;
  /** the plan exists (it always does once a meeting is prepared) */
  planReady: boolean;
  /** Cleo's brief status: "ready", "queued", "running", "failed", "none" */
  briefStatus?: string | null;
  /** the coach opened the plan since it last changed */
  coachReviewed: boolean;
  /** what changed since the coach last looked */
  changesSinceReview: number;
  /** the pre-meeting questions: not needed, sent, answered */
  questions: "not_needed" | "not_sent" | "sent" | "answered";
  /** clarifications still open */
  clarify: number;
  /** how to join: a video link, a place, or nothing set */
  access: { kind: "video" | "place" | "none"; label: string | null };
  format?: string | null;
};

/**
 * The compact readiness strip. `ready` means the coach can walk in now: the
 * plan exists. Everything else is information (a client who sent nothing is
 * "Not needed" or "No answers yet", never a blocker).
 */
export function meetingReadiness(x: ReadinessInput): Readiness {
  const items: ReadinessItem[] = [];
  if (x.state) {
    const tone: ReadinessTone =
      x.state === "confirmed"
        ? "done"
        : x.state === "reschedule_requested"
          ? "attention"
          : x.state === "cancelled" || x.state === "no_show"
            ? "attention"
            : "waiting";
    items.push({ key: "confirmation", label: "Appointment", value: STATE_WORDS[x.state], tone });
  }
  items.push({
    key: "client",
    label: "Client prep",
    value:
      x.questions === "answered"
        ? "Answered"
        : x.questions === "sent"
          ? "Sent, no answers yet"
          : x.questions === "not_sent"
            ? "Not sent"
            : "Not needed",
    tone: x.questions === "answered" ? "done" : x.questions === "sent" ? "waiting" : "none",
  });
  const briefWorking = x.briefStatus === "queued" || x.briefStatus === "running";
  items.push({
    key: "coach",
    label: "Your prep",
    value: !x.planReady
      ? "Preparing"
      : x.changesSinceReview > 0 && x.coachReviewed
        ? `${x.changesSinceReview} new since you looked`
        : x.coachReviewed
          ? "Reviewed"
          : briefWorking
            ? "Plan ready · Cleo refining"
            : "Plan ready",
    tone: !x.planReady ? "waiting" : x.changesSinceReview > 0 ? "attention" : "done",
  });
  items.push({
    key: "clarify",
    label: "To clarify",
    value: x.clarify > 0 ? `${x.clarify} to settle` : "Nothing",
    tone: x.clarify > 0 ? "attention" : "done",
  });
  if (x.format !== "retrospective")
    items.push({
      key: "access",
      label: "Access",
      value:
        x.access.kind === "video"
          ? "Video link ready"
          : x.access.kind === "place"
            ? (x.access.label ?? "In person")
            : "No link or place set",
      tone: x.access.kind === "none" ? "attention" : "done",
    });
  const ready = x.planReady;
  const attention = items.filter((i) => i.tone === "attention").length;
  const headline = !ready
    ? "Preparing the plan"
    : attention
      ? `Ready · ${attention} to look at`
      : "Ready";
  return { ready, items, headline };
}

/* ------------------------------------------------------------------ */
/* Automation timing                                                   */

/** The confirmation request goes this long before the start. */
export const CONFIRM_LEAD_MIN = 24 * 60;
/** It's not sent once the start is closer than this (the booking itself just said it). */
export const CONFIRM_MIN_LEAD_MIN = 3 * 60;
/** A late booking (made within a day of the start) isn't asked to confirm: they just chose it. */
export const LATE_BOOKING_MIN = 24 * 60;

export type ConfirmInput = {
  status: string | null;
  startsAt: string | null;
  createdAt: string | null;
  timeSetAt: string | null;
  clientConfirmedAt: string | null;
  confirmationRequestedAt: string | null;
  bookedByClient: boolean;
  /** the client has the app (the request goes to their coach chat) */
  hasApp: boolean;
  visibleToClient: boolean;
};

/**
 * Whether the confirmation request is due now: one day out (24h, until 3h
 * before), once per time (a move clears both stamps), never for a call they
 * booked themselves, one booked or moved within a day of its start, a
 * cancelled one, or a client with no app to answer in.
 */
export function confirmationDue(x: ConfirmInput, now: Date = new Date()): boolean {
  if (x.status !== "Scheduled" || !x.startsAt || !x.hasApp || !x.visibleToClient) return false;
  if (x.bookedByClient || x.clientConfirmedAt || x.confirmationRequestedAt) return false;
  const start = Date.parse(x.startsAt);
  const t = now.getTime();
  const lead = (start - t) / 60_000;
  if (lead > CONFIRM_LEAD_MIN || lead < CONFIRM_MIN_LEAD_MIN) return false;
  const arranged = Date.parse(x.timeSetAt ?? x.createdAt ?? "");
  if (Number.isFinite(arranged) && (start - arranged) / 60_000 < LATE_BOOKING_MIN) return false;
  return true;
}

/** Who booked it: the client themselves (their app, the booking page) or someone else. */
export const SELF_BOOKED_VIA = new Set(["client_app", "booking_page"]);
