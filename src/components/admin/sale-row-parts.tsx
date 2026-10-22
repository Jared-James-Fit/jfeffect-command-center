/**
 * Small display pieces for a sale: its date format, status badge, access
 * badge and payment-link state. Display only (no data loading). The money
 * itself is sale-money.ts, drawn by SaleCard.
 */
import { Badge } from "@/components/ui/badge";
import { accessBadge } from "@/lib/service-access-status";
import type { PaymentDisplay } from "@/lib/payment-display";
import type { SaleMoney } from "@/lib/sale-money";

export function fmtDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
}

export const TONE = {
  ok: "border-emerald-500/40 text-emerald-500 bg-emerald-500/10",
  info: "border-blue-500/40 text-blue-500 bg-blue-500/10",
  warn: "border-amber-500/40 text-amber-500 bg-amber-500/10",
  bad: "border-destructive/40 text-destructive bg-destructive/5",
  muted: "border-border text-muted-foreground",
};

export function hasPaymentDestination(r: any) {
  return Boolean(r?.stripe_payment_link || r?.stripe_checkout_session_id || r?.stripe_subscription_id);
}

/**
 * The one-word state of a sale, from the same money reading as its numbers,
 * so the badge can never say "Paid in Full" on a cancelled subscription or
 * "Past Due" on a payment link nobody has opened.
 */
export function saleStatus(r: any, m: SaleMoney): { label: string; tone: string } {
  if (r.archived_at) return { label: "Archived", tone: TONE.muted };
  const raw = String(r.payment_status ?? "").trim().toLowerCase();
  switch (m.state) {
    case "waiting":
      if (raw === "draft") return { label: "Draft", tone: TONE.muted };
      return hasPaymentDestination(r) ? { label: "Link sent", tone: TONE.warn } : { label: "Not paid yet", tone: TONE.warn };
    case "left":
      return m.plan ? { label: `${m.plan.made} of ${m.plan.total} paid`, tone: TONE.info } : { label: "Part paid", tone: TONE.warn };
    case "past_due": return { label: "Payment failed", tone: TONE.bad };
    case "renews": return { label: "Active", tone: TONE.ok };
    case "cancelling": return { label: "Cancelling", tone: TONE.warn };
    case "free": return { label: "Free", tone: TONE.muted };
    case "ended":
      if (raw === "voided") return { label: "Voided", tone: TONE.muted };
      if (raw === "refunded") return { label: "Refunded", tone: TONE.muted };
      return { label: "Cancelled", tone: TONE.muted };
    case "paid": {
      const end = r.term_end_date ?? r.package_expiry_date ?? null;
      const over = end ? new Date(`${String(end).slice(0, 10)}T23:59:59`) < new Date() : false;
      return over ? { label: "Completed", tone: TONE.muted } : { label: "Paid", tone: TONE.ok };
    }
  }
}

/**
 * Access beside the status, only when it says something the status doesn't:
 * "Starts after payment" or "Starts Nov 1". "Access active" next to Active, or
 * "Access ended" next to a package still being paid, only adds noise.
 */
export function AccessBadge({ raw }: { raw: any }) {
  const { state, label } = accessBadge(raw);
  if (state === "ended" || state === "active") return null;
  const tone = state === "upcoming" ? TONE.info : TONE.muted;
  return <Badge variant="outline" className={`${tone} whitespace-nowrap text-[10px]`}>{label}</Badge>;
}

export function nextPaymentCell(d: PaymentDisplay, raw?: any) {
  if (d.status === "draft") return { text: "Not started", tone: "text-muted-foreground", helper: "Draft record — no payment requested." as string | null };
  if (d.status === "pending_payment") {
    const ready = hasPaymentDestination(raw);
    return {
      text: "Awaiting payment",
      tone: "text-amber-500",
      helper: ready
        ? "Payment link ready — waiting on Stripe confirmation."
        : "Payment link not created. Use Create payment link to retry this sale.",
    };
  }
  const r = d.renewal;
  if (r.kind === "none") return { text: "No renewal", tone: "text-muted-foreground", helper: null as string | null };
  if (r.kind === "free") return { text: "No payment", tone: "text-muted-foreground", helper: null };
  if (r.kind === "cancelled") return { text: r.date ? `Ended ${fmtDate(r.date)}` : "Cancelled", tone: "text-muted-foreground", helper: null };
  if (r.kind === "cancels") return { text: `Cancels on ${r.valueText}`, tone: "text-amber-500", helper: null };
  if (r.kind === "first_payment") return { text: `First payment ${r.valueText}`, tone: "text-foreground", helper: r.helper };
  if (r.kind === "retry") return { text: `Retry ${r.valueText}`, tone: "text-destructive", helper: null };
  if (r.kind === "past_due") return { text: "Past due", tone: "text-destructive", helper: "No retry date synced." };
  if (r.kind === "unavailable") return { text: "Next payment unavailable", tone: "text-amber-500", helper: r.helper };
  return { text: r.valueText, tone: "text-foreground", helper: null };
}
