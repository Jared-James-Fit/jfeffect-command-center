/**
 * Display-only mapping for the Coaching Management board.
 *
 * Every value comes from the existing clients-directory RPC row — no new
 * snapshot table, no derived persistence. When a signal is not supplied the
 * corresponding widget is hidden rather than guessed.
 */

export type CoachingStatusKey =
  | "onboarding"
  | "active"
  | "at_risk"
  | "paused"
  | "cancelling"
  | "ended";

export const COACHING_STATUSES: { key: CoachingStatusKey; label: string }[] = [
  { key: "onboarding", label: "Onboarding" },
  { key: "active", label: "Active" },
  { key: "at_risk", label: "At Risk" },
  { key: "paused", label: "Paused" },
  { key: "cancelling", label: "Cancelling" },
  { key: "ended", label: "Ended" },
];

export type RiskKey =
  | "failed_payment"
  | "cancellation_requested"
  | "no_check_in"
  | "missed_workouts"
  | "no_workout";

export type RiskAlert = { key: RiskKey; label: string; detail: string };

export type ManagementInput = {
  client_status?: string | null;
  account_status?: string | null;
  payment_status?: string | null;
  f_payment_issue?: boolean | null;
  missed_workouts_count?: number | null;
  /** Days since last logged workout, when the source provides it. */
  days_since_workout?: number | null;
  /** Days since last check-in, when the source provides it. */
  days_since_check_in?: number | null;
  cancellation_requested?: boolean | null;
  f_new_client?: boolean | null;
  f_needs_setup?: boolean | null;
};

const PAUSED = new Set(["paused", "on_hold", "hold"]);
const CANCELLING = new Set(["cancelling", "cancel_requested", "ending", "pending_cancellation"]);
const ENDED = new Set(["ended", "cancelled", "canceled", "inactive", "archived", "deactivated", "churned"]);
const ONBOARDING = new Set(["onboarding", "new", "pending", "setup"]);

/**
 * Deterministic risk signals only, highest priority first. Missing inputs are
 * simply not evaluated.
 */
export function riskAlerts(row: ManagementInput): RiskAlert[] {
  const out: RiskAlert[] = [];
  if (row.f_payment_issue || (row.payment_status ?? "").toLowerCase() === "failed") {
    out.push({ key: "failed_payment", label: "Failed payment", detail: "Most recent payment did not succeed." });
  }
  if (row.cancellation_requested) {
    out.push({ key: "cancellation_requested", label: "Cancellation requested", detail: "Client has requested to cancel." });
  }
  if (typeof row.days_since_check_in === "number" && row.days_since_check_in >= 14) {
    out.push({ key: "no_check_in", label: "No check-in 14d+", detail: `No check-in for ${row.days_since_check_in} days.` });
  }
  if (typeof row.missed_workouts_count === "number" && row.missed_workouts_count >= 3) {
    out.push({ key: "missed_workouts", label: "Repeated missed workouts", detail: `${row.missed_workouts_count} missed workouts recorded.` });
  }
  if (typeof row.days_since_workout === "number" && row.days_since_workout >= 10) {
    out.push({ key: "no_workout", label: "No workout 10d+", detail: `No logged workout for ${row.days_since_workout} days.` });
  }
  return out;
}

export function topRiskAlert(row: ManagementInput): RiskAlert | null {
  return riskAlerts(row)[0] ?? null;
}

export function coachingStatus(row: ManagementInput): { key: CoachingStatusKey; label: string } {
  const raw = String(row.client_status ?? row.account_status ?? "").toLowerCase();
  let key: CoachingStatusKey = "active";
  if (ENDED.has(raw)) key = "ended";
  else if (CANCELLING.has(raw) || row.cancellation_requested) key = "cancelling";
  else if (PAUSED.has(raw)) key = "paused";
  else if (ONBOARDING.has(raw) || (row.f_new_client && row.f_needs_setup)) key = "onboarding";
  else if (topRiskAlert(row)) key = "at_risk";
  return { key, label: COACHING_STATUSES.find((s) => s.key === key)!.label };
}

/** Conditional widgets: only render what a real source backs. */
export function showPtWidgets(row: { coaching_type?: string | null; pt_sessions_remaining?: number | null }): boolean {
  const t = String(row.coaching_type ?? "").toLowerCase();
  if (t.includes("pt") || t.includes("hybrid") || t.includes("in-person") || t.includes("in person")) return true;
  return typeof row.pt_sessions_remaining === "number";
}

export const NO_RECURRING_PAYMENT = "No recurring payment";

export function recurringPaymentDisplay(row: {
  next_payment_at?: string | null;
  recurring_amount?: number | null;
}): { hasPayment: boolean; label: string } {
  if (!row.next_payment_at) return { hasPayment: false, label: NO_RECURRING_PAYMENT };
  return { hasPayment: true, label: row.next_payment_at };
}
