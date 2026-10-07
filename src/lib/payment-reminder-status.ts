/**
 * Pure helpers for the payment reminder status shown on each sale and for the
 * optional payment link expiry date. Mirrors the database job
 * run_payment_setup_reminders / payment_sms_due (3 chat reminders + 1 text).
 */
import { BUSINESS_TZ, businessEpochSeconds } from "@/lib/billing-schedule";

export const MAX_PAYMENT_REMINDERS = 3;

const AWAITING = new Set(["pending payment", "payment link sent", "pending", "unpaid"]);

type SaleLike = {
  archived_at?: string | null;
  payment_status?: string | null;
  stripe_payment_link?: string | null;
  stripe_checkout_session_id?: string | null;
  payment_reminders_paused?: boolean | null;
  payment_reminder_count?: number | null;
  last_payment_reminder_at?: string | null;
  payment_sms_sent_at?: string | null;
  payment_link_expires_at?: string | null;
};

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: BUSINESS_TZ });
}

/** null when reminders don't apply (paid, archived, or no payment link yet). */
export function paymentReminderStatus(sale: SaleLike): { text: string; tone: "muted" | "warn" | "ok" } | null {
  if (sale.archived_at) return null;
  if (!AWAITING.has(String(sale.payment_status ?? "").trim().toLowerCase())) return null;
  if (!sale.stripe_payment_link && !sale.stripe_checkout_session_id) return null;

  if (sale.payment_reminders_paused) return { text: "Payment reminders paused", tone: "muted" };

  const n = Math.max(0, Math.min(MAX_PAYMENT_REMINDERS, Number(sale.payment_reminder_count ?? 0)));
  const sms = sale.payment_sms_sent_at ? " · text sent" : "";
  if (n === 0) return { text: "Reminders on · first one goes out a day after the link", tone: "muted" };
  if (n >= MAX_PAYMENT_REMINDERS) return { text: `All ${MAX_PAYMENT_REMINDERS} reminders sent${sms}`, tone: "warn" };
  const when = sale.last_payment_reminder_at ? ` (${shortDate(sale.last_payment_reminder_at)})` : "";
  return { text: `Reminder ${n} of ${MAX_PAYMENT_REMINDERS} sent${when}${sms}`, tone: "muted" };
}

/** "Link expires Oct 20", or null when the link never expires. */
export function paymentLinkExpiryText(sale: Pick<SaleLike, "payment_link_expires_at" | "archived_at">): string | null {
  if (sale.archived_at || !sale.payment_link_expires_at) return null;
  const t = new Date(sale.payment_link_expires_at).getTime();
  if (!Number.isFinite(t)) return null;
  return t <= Date.now()
    ? `Link expired ${shortDate(sale.payment_link_expires_at)}`
    : `Link expires ${shortDate(sale.payment_link_expires_at)}`;
}

/** YYYY-MM-DD (business timezone) -> ISO timestamp for 11:59:59pm that day. */
export function endOfBusinessDayIso(date: string): string {
  // businessEpochSeconds is 09:00 business time; 9:00 + 14h59m59s = 23:59:59.
  return new Date((businessEpochSeconds(date) + 14 * 3600 + 59 * 60 + 59) * 1000).toISOString();
}

/** ISO timestamp -> YYYY-MM-DD in the business timezone (for a date input). */
export function businessDateOf(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
