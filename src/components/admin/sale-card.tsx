/**
 * One sale as a coach reads it: what it is and when, then three numbers
 * (price, paid, what's left or next), the sessions on it, the next payment in
 * a sentence, and its payments one tap away. Everything in the dollars the
 * client pays. Used by the client's Billing tab and the sale page.
 */
import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/payment-display";
import type { PaymentRow, SaleMoney } from "@/lib/sale-money";
import { cn } from "@/lib/utils";

/** "Oct 30" this year, "Oct 30, 2025" otherwise. */
export function shortDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return null;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-CA", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

const perText = (per: string | null) => (per === "2 weeks" ? "every 2 weeks" : per ? `per ${per}` : null);

function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className={cn("truncate text-[15px] font-bold tabular-nums leading-tight tracking-tight sm:text-base", tone)}>{value}</dd>
      {sub && <dd className="text-[11px] leading-tight text-muted-foreground">{sub}</dd>}
    </div>
  );
}

/** Whole dollars without ".00", so the three numbers fit across a phone. */
function short(cents: number, currency: string): string {
  const whole = cents % 100 === 0;
  return new Intl.NumberFormat("en-CA", { style: "currency", currency, minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 }).format(cents / 100);
}

/** The third number: what's left, or what happens next. */
function third(m: SaleMoney, money: (c: number) => string, endedLabel: string): { label: string; value: ReactNode; sub?: ReactNode; tone?: string } {
  switch (m.state) {
    case "left": {
      const n = m.plan ? m.plan.total - m.plan.made : 0;
      return { label: "Left", value: money(m.leftCents), tone: "text-destructive", sub: n > 0 ? `${n} payment${n === 1 ? "" : "s"} left` : "Still to pay" };
    }
    case "past_due": return { label: "Left", value: money(m.leftCents || m.priceCents), tone: "text-destructive", sub: "Payment failed" };
    case "waiting": return { label: "Left", value: money(m.leftCents), tone: "text-warning", sub: "Nothing paid yet" };
    case "renews": return { label: "Next", value: m.next?.cents != null ? money(m.next.cents) : "—", sub: shortDay(m.next?.date) ?? "Date not synced" };
    case "cancelling": return { label: "Ends", value: shortDay(m.next?.date) ?? "Soon", sub: "No more charges" };
    case "paid": return { label: "Left", value: money(0), tone: "text-success", sub: "Paid in full" };
    case "free": return { label: "Left", value: money(0), sub: "Free" };
    default: return { label: "Left", value: "—", sub: endedLabel };
  }
}

/** The next thing that happens with this sale, in a sentence. */
function nextSentence(m: SaleMoney, money: (c: number) => string, viaStripe: boolean): string | null {
  const when = shortDay(m.next?.date);
  if (m.state === "left" && m.next) {
    const which = m.plan ? ` (${ordinal(m.plan.made + 1)} of ${m.plan.total})` : "";
    return `Next payment: ${m.next.cents != null ? money(m.next.cents) : ""}${when ? ` on ${when}` : ""}${which}${viaStripe ? ", charged automatically" : ""}.`;
  }
  if (m.state === "renews") {
    return when ? `Renews ${when}${viaStripe ? ", charged automatically" : ""}.` : "Renews, but Stripe hasn't sent the next date yet.";
  }
  if (m.state === "past_due") return when ? `Payment failed. Stripe tries again on ${when}.` : "Payment failed. Ask them to update their card.";
  if (m.state === "cancelling") return when ? `Set to stop on ${when}. No more charges after that.` : "Set to stop at the end of this period.";
  return null;
}

export type SaleCardProps = {
  raw: any;
  money: SaleMoney;
  status: { label: string; tone: string };
  /** Badges beside the status (access, archived). */
  badges?: ReactNode;
  sessions?: { granted?: number | null; used?: number | null; reserved?: number | null } | null;
  payments: PaymentRow[];
  /** Lines under the next-payment sentence (payment link state, reminders). */
  notes?: ReactNode;
  menu?: ReactNode;
  /** Links the name to the sale page. */
  linkName?: boolean;
  paymentsOpen?: boolean;
  onRecordPayment?: () => void;
  onVoidPayment?: (p: PaymentRow) => void;
};

export function SaleCard({ raw, money: m, status, badges, sessions, payments, notes, menu, linkName = true, paymentsOpen = false, onRecordPayment, onVoidPayment }: SaleCardProps) {
  const [open, setOpen] = useState(paymentsOpen);
  const money = (c: number) => formatMoney(c / 100, m.currency);
  const viaStripe = !!raw.stripe_subscription_id;
  const big = (c: number) => short(c, m.currency);
  const t = third(m, big, status.label);
  const sentence = nextSentence(m, money, viaStripe);
  const start = shortDay(raw.term_start_date);
  const end = shortDay(raw.term_end_date);
  const bought = shortDay(raw.purchased_at);
  const when = start || end ? `${start ?? "?"} – ${end ?? "?"}` : null;
  const granted = Number(sessions?.granted ?? 0);
  const used = Number(sessions?.used ?? 0);
  const booked = Number(sessions?.reserved ?? 0);
  const canRecord = !!onRecordPayment && !raw.archived_at && ["left", "past_due", "waiting"].includes(m.state);
  const shown = payments.filter((p) => !p.voided).length;
  const name = raw.offer_name ?? "Sale";

  return (
    <article className={cn("space-y-3 rounded-xl border border-border bg-card p-3 sm:p-4", raw.archived_at && "opacity-70")}>
      <header className="space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          {linkName
            ? <Link to="/admin/purchases/$id" params={{ id: raw.id }} className="min-w-0 pt-1.5 font-semibold leading-snug hover:underline">{name}</Link>
            : <div className="min-w-0 pt-1.5 font-semibold leading-snug">{name}</div>}
          {menu && <div className="-mr-2 shrink-0">{menu}</div>}
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Badge variant="outline" className={cn("whitespace-nowrap", status.tone)}>{status.label}</Badge>
          {badges}
          <span className="text-xs text-muted-foreground">{[when, bought && `bought ${bought}`].filter(Boolean).join(" · ")}</span>
        </div>
      </header>

      <dl className="grid grid-cols-[repeat(3,minmax(0,auto))] justify-between gap-x-3 rounded-lg bg-muted/40 p-3 sm:grid-cols-3">
        <Stat
          label="Price"
          value={m.kind === "free" ? "Free" : big(m.priceCents)}
          sub={m.kind === "subscription" ? perText(m.per) ?? m.priceNote : m.priceNote}
        />
        <Stat
          label="Paid"
          value={m.kind === "free" ? "—" : big(m.paidCents)}
          sub={m.refundedCents > 0 ? `after ${money(m.refundedCents)} refunded` : m.payments === 0 ? "No payments yet" : `${m.payments} payment${m.payments === 1 ? "" : "s"}`}
        />
        <Stat {...t} />
      </dl>

      {(sentence || granted > 0 || notes) && (
        <div className="space-y-1 text-sm">
          {sentence && <p>{sentence}</p>}
          {granted > 0 && (
            <p className="text-muted-foreground">
              Sessions: <span className="font-medium text-foreground tabular-nums">{used} of {granted} used</span>
              {booked > 0 && <> · {booked} booked</>}
            </p>
          )}
          {notes}
        </div>
      )}

      {(payments.length > 0 || canRecord) && (
        <div className="space-y-2 border-t border-border pt-3">
          <div className="flex items-center justify-between gap-2">
            {payments.length > 0 ? (
              <button type="button" onClick={() => setOpen((v) => !v)} className="flex min-h-9 items-center gap-1 text-sm text-muted-foreground hover:text-foreground" aria-expanded={open}>
                {open ? "Hide payments" : `Show payments (${shown})`}
                <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
              </button>
            ) : <span className="text-sm text-muted-foreground">No payments yet</span>}
            {canRecord && <Button size="sm" variant="outline" className="h-9" onClick={onRecordPayment}>Record a payment</Button>}
          </div>
          {open && payments.length > 0 && (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {payments.map((p) => (
                <li key={p.id} className={cn("flex items-center justify-between gap-3 px-3 py-2 text-sm", p.voided && "text-muted-foreground")}>
                  <div className="min-w-0">
                    <div className={cn("font-medium", p.voided && "line-through")}>{shortDay(p.date) ?? "No date"}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {p.voided ? "Voided" : p.kind === "refund" ? "Refund" : p.method ?? "Payment"}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <div className="text-right">
                      <div className={cn("font-semibold tabular-nums", p.voided && "line-through", p.kind === "refund" && "text-destructive")}>
                        {p.kind === "refund" ? "−" : ""}{money(p.cents)}
                      </div>
                      {!p.voided && p.kind === "payment" && (
                        <div className="text-[11px] text-muted-foreground tabular-nums">{p.taxCents > 0 ? `incl. ${money(p.taxCents)} tax` : "no tax"}</div>
                      )}
                    </div>
                    {p.canVoid && onVoidPayment && !raw.archived_at && (
                      <Button size="sm" variant="ghost" className="h-8 px-2 text-xs text-muted-foreground" onClick={() => onVoidPayment(p)}>Void</Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </article>
  );
}
