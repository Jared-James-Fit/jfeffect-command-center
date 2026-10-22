/**
 * What a PT session's credit is doing, read straight from its status. The
 * database moves the credit with the status (pt_session_settle_credit), so
 * this is the one wording for it:
 *   Scheduled → holds 1 credit, used by itself once the day is over
 *   Completed → 1 credit used
 *   Missed    → 1 credit used (late cancel or no-show that counts)
 *   Cancelled → credit banked (back in the client's sessions)
 * Pure: no React, no Supabase.
 */

export type CreditState = "held" | "used" | "banked" | "free";

export type SessionCreditInfo = {
  state: CreditState;
  /** Short chip text: "Holds 1 credit", "1 credit used", "Credit banked". */
  label: string;
  /** One plain sentence under it. */
  detail: string;
};

type SessionLike = { status: string; session_date: string; uses_credit?: boolean | null };

/** "Thu Oct 30" */
export function shortDay(dateISO: string): string {
  return new Date(`${dateISO}T00:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }).replace(",", "");
}

export function sessionStatusLabel(status: string): string {
  switch (status) {
    case "Scheduled": return "Booked";
    case "Completed": return "Done";
    case "Missed": return "Missed";
    case "Cancelled": return "Cancelled";
    case "Rescheduled": return "Moved";
    default: return status;
  }
}

/** A booked session whose day is over and that nobody has closed yet. */
export function isOverdue(s: SessionLike, today: string): boolean {
  return s.status === "Scheduled" && s.session_date < today;
}

export function sessionCredit(s: SessionLike, today: string): SessionCreditInfo {
  if (s.uses_credit === false) {
    return { state: "free", label: "No credit", detail: "This kind of session doesn't use a credit." };
  }
  switch (s.status) {
    case "Scheduled":
      if (s.session_date < today) {
        return { state: "held", label: "Holds 1 credit", detail: "Its day is over but it's waiting on you: pick what happened." };
      }
      return {
        state: "held",
        label: "Holds 1 credit",
        detail: s.session_date === today ? "Counts as used tonight, once the day is over." : `Counts as used after ${shortDay(s.session_date)}.`,
      };
    case "Completed":
      return { state: "used", label: "1 credit used", detail: "Counted as one of their sessions." };
    case "Missed":
      return { state: "used", label: "1 credit used", detail: "Late cancel or no-show: counted as one of their sessions." };
    default:
      return { state: "banked", label: "Credit banked", detail: "Back in their sessions to book another time." };
  }
}

/** Where a session lands when it's (re)booked on a date: a day that's over is done. */
export function statusForDate(dateISO: string, today: string): "Scheduled" | "Completed" {
  return dateISO < today ? "Completed" : "Scheduled";
}

/** The credit line under a Move / Rebook button. */
export function moveOutcome(dateISO: string, today: string, usesCredit = true): string {
  if (statusForDate(dateISO, today) === "Completed") {
    return usesCredit ? "That day is over, so it counts as done: 1 credit used." : "That day is over, so it counts as done.";
  }
  if (!usesCredit) return "Booked.";
  return dateISO === today ? "Holds 1 credit, used tonight once the day is over." : `Holds 1 credit, used after ${shortDay(dateISO)}.`;
}

export function creditChipClasses(state: CreditState): string {
  switch (state) {
    case "held": return "border-primary/40 bg-primary/10 text-primary";
    case "used": return "border-success/40 bg-success/10 text-success";
    case "banked": return "border-sky-500/40 bg-sky-500/10 text-sky-300";
    default: return "border-border bg-secondary/40 text-muted-foreground";
  }
}
