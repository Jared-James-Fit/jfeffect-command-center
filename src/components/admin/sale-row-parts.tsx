/**
 * How one sale reads in a client's Sales list: status, access, the money in
 * the dollars the client pays, sessions used, dates and the next payment.
 * Display only (no data loading), so the table and any preview share it.
 */
import { Badge } from "@/components/ui/badge";
import { accessBadge } from "@/lib/service-access-status";
import { formatMoney, type PaymentDisplay } from "@/lib/payment-display";

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

export function resolveSaleStatus(r: any, d: PaymentDisplay): { label: string; tone: string } {
  if (r.archived_at) return { label: "Archived", tone: TONE.muted };
  if (d.status === "draft") return { label: "Draft", tone: TONE.muted };
  if (d.status === "pending_payment") {
    return hasPaymentDestination(r)
      ? { label: "Payment Link Ready", tone: TONE.warn }
      : { label: "Pending Payment", tone: TONE.warn };
  }
  if ((r.payment_status ?? "") === "Failed") return { label: "Failed", tone: TONE.bad };
  const kind = d.renewal.kind;
  const plan = d.installmentPlan;
  if (plan && d.amountOutstanding > 0 && (kind === "renew" || kind === "unavailable" || kind === "none")) {
    return { label: `${plan.paymentsMade} of ${plan.numberOfPayments} paid`, tone: TONE.info };
  }
  if (kind === "cancelled") return { label: "Cancelled", tone: TONE.muted };
  if (kind === "cancels") return { label: "Cancelling", tone: TONE.warn };
  if (kind === "first_payment") return { label: "Trialing", tone: TONE.info };
  if (kind === "retry" || kind === "past_due") return { label: "Past Due", tone: TONE.bad };
  if (kind === "renew" || kind === "unavailable") return { label: "Active", tone: TONE.ok };
  if (kind === "free") return { label: "Free", tone: TONE.muted };
  const end = r.term_end_date ?? r.package_expiry_date ?? null;
  const expired = end ? new Date(`${String(end).slice(0, 10)}T23:59:59`) < new Date() : false;
  if (expired) return { label: d.isPaidInFull ? "Completed" : "Expired", tone: TONE.muted };
  if (d.isPaidInFull) return { label: "Paid in Full", tone: TONE.ok };
  if (d.status === "partially_paid") return { label: "Partially Paid", tone: TONE.warn };
  if (d.status === "unpaid" || d.status === "past_due") return { label: "Past Due", tone: TONE.bad };
  if (d.status === "pending_setup") return { label: "Payment setup pending", tone: TONE.warn };
  return { label: "Unknown", tone: TONE.muted };
}

/**
 * Access beside the status, only when it adds something: "Access ended" next
 * to Completed says nothing new, and next to "2 of 4 paid" on a session
 * package it reads as if the client lost access while they're still paying.
 */
export function AccessBadge({ raw }: { raw: any }) {
  const { state, label } = accessBadge(raw);
  if (state === "ended") return null;
  const tone = state === "active" ? TONE.ok : state === "upcoming" ? TONE.info : TONE.muted;
  return <Badge variant="outline" className={`${tone} ml-1 whitespace-nowrap text-[10px]`}>{label}</Badge>;
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

/** Tax as a share of the price, from what was paid on this sale. */
function saleRate(d: PaymentDisplay): number | null {
  const beforeTax = d.amountPaid - d.amountTaxPaid;
  return d.amountTaxPaid > 0 && beforeTax > 0 ? d.amountTaxPaid / beforeTax : null;
}

function withTax(amount: number, rate: number | null): number {
  return Math.round(amount * (1 + (rate ?? 0)) * 100) / 100;
}

/**
 * The money and sessions on one sale, in the dollars the client pays: the
 * price with tax, how far through the payments they are, what's left, and how
 * many of the package's sessions are used.
 */
export function SaleMoney({ display, rate, sessions }: { display: PaymentDisplay; rate: number | null; sessions?: { granted?: number | null; used?: number | null; reserved?: number | null } | null }) {
  const money = (n: number) => formatMoney(n, display.currency);
  const r = saleRate(display) ?? rate;
  const plan = display.installmentPlan;
  const openEnded = display.isRecurring && !plan;
  const price = plan ? plan.contractTotal : display.contractTotal;
  const priceLine = `${money(withTax(price, r))}${r ? ` (${money(price)} + tax)` : ""}${openEnded ? " per payment" : ""}`;

  let payLine: string | null = null;
  if (openEnded) payLine = display.amountPaid > 0 ? `${money(display.amountPaid)} paid so far` : null;
  else if (display.isPaidInFull) payLine = "Paid in full";
  else if (plan) payLine = `${plan.paymentsMade} of ${plan.numberOfPayments} payments made · ${money(withTax(plan.amountRemaining, r))} left`;
  else if (display.amountOutstanding > 0) {
    payLine = display.amountPaid > 0
      ? `${money(display.amountPaid)} paid · ${money(withTax(display.amountOutstanding, r))} left`
      : `${money(withTax(display.amountOutstanding, r))} to pay`;
  }

  const granted = Number(sessions?.granted ?? 0);
  const used = Number(sessions?.used ?? 0);
  const held = Number(sessions?.reserved ?? 0);
  return (
    <div className="space-y-0.5 text-xs tabular-nums text-muted-foreground">
      <div className="text-foreground">{priceLine}</div>
      {payLine && <div className={payLine === "Paid in full" ? "text-success" : undefined}>{payLine}</div>}
      {granted > 0 && <div>{used} of {granted} sessions used{held > 0 ? ` · ${held} booked` : ""}</div>}
    </div>
  );
}

/** "Aug 10 – Sep 6" when the term is set, else the day it was bought. */
export function SaleDates({ raw }: { raw: any }) {
  const start = fmtDate(raw.term_start_date);
  const end = fmtDate(raw.term_end_date);
  const bought = fmtDate(raw.purchased_at);
  if (start || end) {
    return <div><div>{start ?? "?"} – {end ?? "?"}</div>{bought && <div className="text-[11px] text-muted-foreground">Bought {bought}</div>}</div>;
  }
  return <div>{bought ? `Bought ${bought}` : "—"}</div>;
}

/** The next payment, with its amount while an installment plan is being paid. */
export function nextText(d: PaymentDisplay, next: ReturnType<typeof nextPaymentCell>, rate: number | null): string {
  const plan = d.installmentPlan;
  if (plan && d.amountOutstanding > 0 && d.renewal.kind === "renew") {
    return `${formatMoney(withTax(plan.installmentAmount, saleRate(d) ?? rate), d.currency)} · ${next.text}`;
  }
  if (d.isPaidInFull && !d.isRecurring) return "Paid in full";
  return next.text;
}
