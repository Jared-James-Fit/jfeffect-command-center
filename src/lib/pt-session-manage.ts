import type { QueryClient } from "@tanstack/react-query";

/**
 * Shared helpers for PT session management (PT Calendar + edit dialog).
 * Pure / browser-safe — no server-only imports.
 */

export type PtLedgerEvent = {
  id: string;
  pt_session_id: string | null;
  event_type: string;
  session_count: number;
  unit_value_minor: number | null;
  currency: string | null;
  source: string | null;
  note: string | null;
  created_at: string;
};

/** Invalidate every cache surface that shows PT sessions or credits. */
export function invalidatePtSessionCaches(qc: QueryClient, clientId?: string | null) {
  qc.invalidateQueries({ queryKey: ["pt-sessions"] });
  qc.invalidateQueries({ queryKey: ["pt-balance"] });
  qc.invalidateQueries({ queryKey: ["pt-pack-purchases"] });
  qc.invalidateQueries({ queryKey: ["pt-adhoc-credits"] });
  qc.invalidateQueries({ queryKey: ["pt-session-events"] });
  qc.invalidateQueries({ queryKey: ["calendar-upcoming"] });
  qc.invalidateQueries({ queryKey: ["appointments"] });
  qc.invalidateQueries({ queryKey: ["client-session-credits"] });
  qc.invalidateQueries({ queryKey: ["client-session-packages"] });
  qc.invalidateQueries({ queryKey: ["my-session-balance"] });
  qc.invalidateQueries({ queryKey: ["my-session-purchase"] });
  qc.invalidateQueries({ queryKey: ["my-next-pt-session"] });
  qc.invalidateQueries({ queryKey: ["portal-appointments"] });
  qc.invalidateQueries({ queryKey: ["portal-appt-pt-sessions"] });
  qc.invalidateQueries({ queryKey: ["my-sessions"] });
  if (clientId) {
    qc.invalidateQueries({ queryKey: ["client", clientId] });
    qc.invalidateQueries({ queryKey: ["client-purchases", clientId] });
  }
}

export function todayISOLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Past scheduled sessions the coach still needs to pick an outcome for. */
export function isNeedsReview(s: { status: string; session_date: string }, today: string): boolean {
  return s.status === "Scheduled" && s.session_date < today;
}

/** Two non-cancelled sessions sharing client + date + start time + location. */
export function duplicateKey(s: {
  client_id: string;
  session_date: string;
  start_time: string;
  location?: string | null;
}): string {
  return [s.client_id, s.session_date, s.start_time, (s.location ?? "").trim().toLowerCase()].join("|");
}

export type CreditTone = "muted" | "primary" | "success" | "warning" | "destructive";

/** Net credit impact of one session, derived from its ledger events. */
export function creditImpact(
  status: string,
  events: PtLedgerEvent[],
): { label: string; tone: CreditTone } {
  const reservedCount = events
    .filter((e) => e.event_type === "reserved")
    .reduce((s, e) => s + -Number(e.session_count ?? 0), 0);
  const releasedCount = events
    .filter((e) => e.event_type === "released")
    .reduce((s, e) => s + Number(e.session_count ?? 0), 0);
  const usedCount = events
    .filter((e) => e.event_type === "used")
    .reduce((s, e) => s + -Number(e.session_count ?? 0), 0);
  const revertedCount = events
    .filter((e) => e.event_type === "adjusted" && e.source === "revert_on_uncomplete")
    .reduce((s, e) => s + Number(e.session_count ?? 0), 0);
  const outstanding = Math.max(reservedCount - releasedCount, 0);
  const netUsed = Math.max(usedCount - revertedCount, 0);

  switch (status) {
    case "Scheduled":
      return outstanding > 0
        ? { label: `Reserved ${outstanding}`, tone: "primary" }
        : { label: "No session used", tone: "muted" };
    case "Completed":
      return netUsed > 0
        ? { label: `Used ${netUsed}`, tone: "success" }
        : { label: "No session used", tone: "muted" };
    case "Cancelled":
      return releasedCount > 0
        ? { label: "Cancelled · session returned", tone: "muted" }
        : { label: "Cancelled · no session used", tone: "muted" };
    case "Missed":
      if (netUsed > 0) return { label: `No-show deducted ${netUsed}`, tone: "destructive" };
      if (releasedCount > 0) return { label: "No-show · session returned", tone: "muted" };
      return { label: "No session used", tone: "muted" };
    default:
      return outstanding > 0
        ? { label: `Reserved ${outstanding}`, tone: "primary" }
        : { label: "No session used", tone: "muted" };
  }
}

export function creditToneClasses(tone: CreditTone): string {
  switch (tone) {
    case "primary":
      return "border-primary/40 bg-primary/10 text-primary";
    case "success":
      return "border-success/40 bg-success/10 text-success";
    case "warning":
      return "border-warning/40 bg-warning/10 text-warning";
    case "destructive":
      return "border-destructive/40 bg-destructive/10 text-destructive";
    default:
      return "border-border bg-secondary/40 text-muted-foreground";
  }
}

/** Human-friendly label for a ledger event in the session history list. */
export function friendlyEventLabel(e: PtLedgerEvent): string {
  switch (e.event_type) {
    case "reserved":
      return "Session reserved";
    case "released":
      return e.source === "convert_on_complete" ? "Reserved session used" : "Session returned";
    case "used":
      return "Session used";
    case "granted":
      return e.source === "admin_adjust" ? "Sessions added by admin" : "Sessions added";
    case "adjusted":
      if (e.source === "revert_on_uncomplete") return "Deduction reversed · session returned";
      return Number(e.session_count) > 0 ? "Sessions added (adjustment)" : "Sessions deducted (adjustment)";
    case "transferred_out":
      return "Sessions applied to new package";
    case "transferred_in":
      return "Sessions received from transfer";
    case "expired":
      return "Sessions expired";
    case "refunded":
      return "Sessions refunded";
    default:
      return e.event_type;
  }
}

export function fmtEventDelta(e: PtLedgerEvent): string {
  const n = Number(e.session_count ?? 0);
  if (e.event_type === "reserved") return "held";
  if (e.event_type === "released") return "freed";
  return n > 0 ? `+${n}` : `${n}`;
}

export function fmtEventTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}