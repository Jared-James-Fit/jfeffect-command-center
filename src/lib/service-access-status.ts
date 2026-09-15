/**
 * ACCESS STATUS — separate from payment status.
 *
 * A paid sale whose coaching start date is in the future must NOT read as
 * "Active": the client has paid, but service has not begun. Payment truth
 * stays in the billing columns; this is purely about access.
 */
import { businessToday } from "@/lib/billing-schedule";
import { formatCalendarDate } from "@/lib/calendar-date";

export type AccessState = "not_started" | "upcoming" | "active" | "ended";

export type AccessSale = {
  service_start_date?: string | null;
  term_start_date?: string | null;
  term_end_date?: string | null;
  package_expiry_date?: string | null;
  payment_status?: string | null;
  status?: string | null;
};

const NOT_STARTED_PAYMENT = new Set([
  "Pending Payment",
  "Payment Link Sent",
  "Pending",
  "Draft",
]);

function day(value?: string | null): string | null {
  const s = typeof value === "string" ? value.slice(0, 10) : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/** Canonical access state for one sale on a given calendar day. */
export function resolveAccessState(sale: AccessSale, today = businessToday()): AccessState {
  const status = String(sale.status ?? "");
  if (status === "draft" || NOT_STARTED_PAYMENT.has(String(sale.payment_status ?? ""))) {
    return "not_started";
  }
  const end = day(sale.term_end_date) ?? day(sale.package_expiry_date);
  if (end && end < today) return "ended";
  const start = day(sale.service_start_date) ?? day(sale.term_start_date);
  if (start && start > today) return "upcoming";
  return "active";
}

export function accessStateLabel(state: AccessState): string {
  switch (state) {
    case "not_started":
      return "Access not started";
    case "upcoming":
      return "Access upcoming";
    case "ended":
      return "Access ended";
    default:
      return "Access active";
  }
}

/** Short badge text, with the date when access has not begun yet. */
export function accessBadge(sale: AccessSale, today = businessToday()): { state: AccessState; label: string } {
  const state = resolveAccessState(sale, today);
  if (state === "upcoming") {
    const start = day(sale.service_start_date) ?? day(sale.term_start_date);
    return { state, label: `Starts ${formatCalendarDate(start)}` };
  }
  return { state, label: accessStateLabel(state) };
}
