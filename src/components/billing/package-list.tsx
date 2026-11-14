/**
 * A client's session packages as one list, the same on the Sessions and
 * Billing tabs: the one being trained now first, then the ones with money
 * left, then the settled ones folded away; each group in the order they were
 * bought, so "Package 3 · Renewed from Package 2" still reads in order.
 *
 * A row is short: its number and period, its training and money in a word
 * each ("Training now" / "Paying now" when it's the one), and one thin bar
 * for each. Tapping it opens everything about it: its sessions (the
 * per-session grid lives only here), how it's paid (the installments still
 * to come and the payments received), how payments cover its training, and
 * where it came from. The tab it's on decides which comes first.
 */
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, Check, ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/nutrition/nutrition-ui";
import {
  CoverageBar,
  PaymentStatusText,
  SegmentBar,
  SessionBar,
  StatusText,
  TrainingStatusText,
} from "@/components/billing/package-visuals";
import { ptClientLedgerQuery, ptSessionsQuery } from "@/components/sessions/session-queries";
import { sessionPlaces } from "@/lib/session-packages";
import { salePayments, type PaymentRow } from "@/lib/sale-money";
import { shortDay } from "@/lib/session-credit";
import { fmtWallClock } from "@/lib/schedule-time";
import { coverageWords, orderPackages } from "@/lib/package-view";
import type { Installment, PackageAccount } from "@/lib/payment-schedule";
import { cn } from "@/lib/utils";

/** "Fri, Nov 13" (the year only when it isn't this year). */
export function payDay(iso: string | null | undefined, thisYear = new Date().getFullYear()): string {
  if (!iso) return "";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric", ...(d.getFullYear() === thisYear ? {} : { year: "numeric" }) });
}

/** "Oct 5 – Nov 1", "Nov 2 – 29" in one month. */
export function period(a: string | null, b: string | null): string | null {
  const d = (iso: string) => new Date(`${iso}T00:00:00`);
  const fmt = (iso: string) => d(iso).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
  if (a && b) {
    const sameMonth = d(a).getMonth() === d(b).getMonth() && d(a).getFullYear() === d(b).getFullYear();
    return sameMonth ? `${fmt(a)} – ${d(b).getDate()}` : `${fmt(a)} – ${fmt(b)}`;
  }
  return a ? `from ${fmt(a)}` : b ? `to ${fmt(b)}` : null;
}

/** "16/16 done", or "7 done · 9 booked · 0 left". */
export function packageSessionsLine(x: PackageAccount): string {
  const s = x.sessions;
  if (s.completed >= s.purchased && s.booked === 0 && s.available === 0 && !s.expired) return `${s.completed}/${s.purchased} done`;
  const parts = [`${s.completed} done`, `${s.booked} booked`, `${s.available} left`];
  if (s.expired) parts.push(`${s.expired} expired`);
  return parts.join(" · ");
}

/** How what's left on it gets paid, in a few words (without its dates where they're listed under it). */
export function planLine(x: PackageAccount, money: (c: number) => string, opts: { dates?: boolean } = {}): string {
  if (x.state === "paid") return "Paid in full";
  if (x.state === "free") return "Free";
  if (x.state === "ended") return "Cancelled";
  if (x.state === "waiting") return "Payment link sent, nothing paid yet";
  const sc = x.schedule;
  if (!sc || sc.how === "none") return "No payment dates";
  const list = sc.installments;
  const n = list.length;
  const when = n ? `${payDay(list[0].date)}${n > 1 ? ` – ${payDay(list[n - 1].date)}` : ""}` : "";
  const by = sc.how === "auto_pay" ? "Auto-pay" : sc.how === "stripe" ? "Stripe" : "Collected by you";
  return `${by} · ${n} payment${n === 1 ? "" : "s"} of ${money(list[0]?.cents ?? 0)}${when && opts.dates !== false ? `, ${when}` : ""}`;
}

const STATE_CHIP: Partial<Record<Installment["state"], { text: string; tone: "error" | "attention" | "neutral" }>> = {
  failed: { text: "Failed", tone: "error" },
  overdue: { text: "Overdue", tone: "error" },
  unconfirmed: { text: "Not confirmed", tone: "attention" },
  due_today: { text: "Today", tone: "attention" },
};

export function InstallmentRow({ i, money, action, inPackage }: { i: Installment; money: (c: number) => string; action?: ReactNode; inPackage?: boolean }) {
  const chip = STATE_CHIP[i.state];
  return (
    <li className="flex min-h-11 items-center gap-3 py-1.5" data-installment={i.state}>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] tabular-nums">{payDay(i.date)}</div>
        <div className="text-[12px] text-muted-foreground">
          {[inPackage ? null : i.label, i.nth && i.of ? `payment ${i.nth} of ${i.of}` : null, i.recurring ? "subscription" : i.auto ? "auto-pay" : "collected by you"].filter(Boolean).join(" · ")}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {chip && <StatusChip tone={chip.tone === "attention" && i.auto ? "neutral" : chip.tone}>{chip.text}</StatusChip>}
        <span className="text-[14px] font-semibold tabular-nums">{money(i.cents)}</span>
        {action}
      </div>
    </li>
  );
}

export function PaymentHistory({ rows, labels, money, limit = 8 }: { rows: PaymentRow[]; labels: Map<string, string>; money: (c: number) => string; limit?: number }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, limit);
  return (
    <>
      <ul className="divide-y divide-border">
        {shown.map((r) => (
          <li key={r.id} className={cn("flex items-center justify-between gap-3 py-1.5", r.voided && "text-muted-foreground")} data-payment={r.kind}>
            <div className="min-w-0">
              <div className={cn("text-[14px] tabular-nums", r.voided && "line-through")}>{payDay(r.date) || "No date"}</div>
              <div className="text-[12px] text-muted-foreground">
                {(r.saleId && labels.get(r.saleId)) || "Payment"} · {r.voided ? "Voided" : r.kind === "refund" ? "Refund" : r.method ?? "Payment"}
                {r.receiptUrl && !r.voided && <> · <a href={r.receiptUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">Receipt</a></>}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className={cn("text-[14px] font-semibold tabular-nums", r.voided && "line-through", r.kind === "refund" && !r.voided && "text-destructive")}>
                {r.kind === "refund" ? "−" : ""}{money(r.cents)}
              </div>
              {!r.voided && r.kind === "payment" && <div className="text-[12px] text-muted-foreground tabular-nums">{r.taxCents > 0 ? `incl. ${money(r.taxCents)} tax` : "no tax"}</div>}
            </div>
          </li>
        ))}
      </ul>
      {rows.length > limit && (
        <button type="button" onClick={() => setAll((v) => !v)} className="flex min-h-10 w-full items-center justify-center gap-1 text-[13px] text-muted-foreground">
          {all ? "Show fewer" : `Show all ${rows.length}`}
          <ChevronDown className={cn("h-4 w-4 transition-transform", all && "rotate-180")} />
        </button>
      )}
    </>
  );
}

/** A folded part inside an open package. */
function Part({ title, aside, defaultOpen = false, children, ...rest }: {
  title: string;
  aside?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
} & Record<`data-${string}`, unknown>) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-border" {...rest}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex min-h-11 w-full items-center justify-between gap-3 text-left">
        <span className="text-[14px] font-medium">{title}</span>
        <span className="flex min-w-0 items-center gap-1 text-[13px] text-muted-foreground">
          <span className="truncate">{aside}</span>
          <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")} />
        </span>
      </button>
      {open && <div className="space-y-2 pb-3">{children}</div>}
    </div>
  );
}

export type PackageListProps = {
  packages: PackageAccount[];
  ledger: any[];
  money: (c: number) => string;
  /** Which tab it's on: what opens first in a package. */
  mode: "sessions" | "billing";
  isAdmin: boolean;
  /** The Sessions tab's own rows for a package's sessions; else they're read here when opened. */
  renderSessions?: (saleId: string) => ReactNode;
  /** For the sessions read here (Billing). */
  clientId?: string;
  onOpenSessions?: () => void;
  onOpenBilling?: () => void;
  onRecord?: (saleId: string) => void;
  onSetDates?: (saleId: string) => void;
  onEditDates?: (saleId: string) => void;
};

export function PackageList(props: PackageListProps) {
  const { open, settled } = useMemo(() => orderPackages(props.packages), [props.packages]);
  const chain = [...props.packages].sort((a, b) => a.number - b.number).map((x) => x.number);
  const [showSettled, setShowSettled] = useState(false);
  if (props.packages.length === 0) return null;
  return (
    <section className="space-y-2" data-package-list={props.mode}>
      <div className="flex items-baseline justify-between gap-2 px-0.5">
        <h4 className="text-[15px] font-semibold">Packages</h4>
        {chain.length > 1 && <span className="text-[13px] tabular-nums text-muted-foreground" data-package-chain>{chain.join(" → ")}</span>}
      </div>
      {open.map((x) => <PackageCard key={x.saleId} x={x} {...props} />)}
      {settled.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border" data-package-settled>
          <button type="button" aria-expanded={showSettled} onClick={() => setShowSettled((v) => !v)} className="flex min-h-12 w-full items-center justify-between gap-3 px-3 text-left">
            <span className="flex min-w-0 items-center gap-2 text-[14px]">
              <Check className="h-4 w-4 shrink-0 text-success" />
              <span className="truncate">{settled.length === 1 ? settled[0].label : `Packages ${settled.map((x) => x.number).join(", ")}`} · paid in full</span>
            </span>
            <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", showSettled && "rotate-180")} />
          </button>
          {showSettled && (
            <div className="space-y-2 border-t border-border p-2">
              {settled.map((x) => <PackageCard key={x.saleId} x={x} {...props} />)}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function PackageCard({ x, ledger, money, mode, isAdmin, renderSessions, clientId, onOpenSessions, onOpenBilling, onRecord, onSetDates, onEditDates }: PackageListProps & { x: PackageAccount }) {
  const [open, setOpen] = useState(false);
  const s = x.sessions;
  const when = period(x.from, x.to);
  const auto = x.schedule?.how === "auto_pay" || x.schedule?.how === "stripe";
  const payments = useMemo(() => salePayments(ledger.filter((l: any) => l.purchase_id === x.saleId)), [ledger, x.saleId]);
  const size = Math.max(s.purchased, s.completed + s.booked + s.available + s.expired);
  const cov = x.coverage;
  // On Billing the session bar says what's paid for (green) and what isn't yet (amber); on Sessions, done and booked.
  const paidFor = cov ? Math.min(s.completed, cov.covered + (cov.partCents > 0 ? 1 : 0)) : s.completed;
  const sessionParts = mode === "billing" && cov
    ? [{ value: paidFor, tone: "done" as const }, { value: Math.max(0, Math.min(s.completed, s.purchased) - paidFor), tone: "unpaid" as const }, { value: s.booked, tone: "booked" as const }]
    : [{ value: s.completed, tone: "done" as const }, { value: s.booked, tone: "booked" as const }];
  const owing = x.balanceCents > 0 && x.state !== "waiting";

  const trainingWord = x.trainingNow
    ? <StatusText tone="neutral" className="font-semibold text-foreground" data-training-status="now">Training now</StatusText>
    : <TrainingStatusText status={x.training} />;
  const late = x.payment === "overdue" || x.payment === "failed";
  const payingWord = x.payingNow && !late
    ? <StatusText tone="neutral" className="font-semibold text-foreground" data-payment-status="now">{x.payment === "due" ? "Paying now · due today" : "Paying now"}</StatusText>
    : <PaymentStatusText status={x.payment} auto={auto} />;

  const sessionsPart = (
    <Part
      key="sessions"
      title="Sessions"
      aside={packageSessionsLine(x)}
      defaultOpen={mode === "sessions"}
      data-package-part="sessions"
    >
      {mode === "billing" && cov
        ? <CoverageBar cells={cov.cells} />
        : <SessionBar completed={s.completed} booked={s.booked} available={s.available} expired={s.expired} />}
      {renderSessions ? renderSessions(x.saleId) : clientId ? <PackageAppointments clientId={clientId} saleId={x.saleId} /> : null}
      {mode === "billing" && onOpenSessions && (
        <Button size="sm" variant="ghost" className="h-10 px-2 text-muted-foreground" onClick={onOpenSessions}>Open on Sessions<ChevronRight className="ml-0.5 h-4 w-4" /></Button>
      )}
    </Part>
  );

  const coverLines = coverageWords(x, money);
  const moneyPart = (
    <Part
      key="money"
      title="Payments"
      aside={x.state === "paid" ? "Paid in full" : `${money(x.paidCents)} of ${money(x.totalCents)} paid`}
      defaultOpen={mode === "billing"}
      data-package-part="payments"
    >
      <p className={cn("text-[13px]", x.schedule?.how === "none" ? "text-warning" : "text-muted-foreground")}>{planLine(x, money, { dates: false })}</p>
      {x.schedule && x.schedule.installments.length > 0 && (
        <div>
          <div className="text-[12px] font-medium text-muted-foreground">Still to come</div>
          <ul className="divide-y divide-border">
            {x.schedule.installments.map((i) => <InstallmentRow key={i.key} i={i} money={money} inPackage />)}
          </ul>
        </div>
      )}
      <div>
        <div className="text-[12px] font-medium text-muted-foreground">Received</div>
        {payments.length > 0
          ? <PaymentHistory rows={payments} labels={new Map([[x.saleId, x.label]])} money={money} limit={6} />
          : <p className="py-1 text-[13px] text-muted-foreground">None yet.</p>}
      </div>
      {coverLines && (
        <div className="space-y-0.5 rounded-lg bg-muted/50 p-2.5 text-[13px] text-muted-foreground" data-package-coverage>
          {coverLines.map((l) => <p key={l}>{l}</p>)}
          <p className="text-[12px]">Payments go on the package, not on a session, so this is an even split, not which appointment a payment was for.</p>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {isAdmin && onRecord && (x.state === "left" || x.state === "past_due") && (
          <Button size="sm" variant="outline" className="h-10" onClick={() => onRecord(x.saleId)}>Record payment</Button>
        )}
        {isAdmin && onSetDates && x.schedule?.canSetDates && (
          <Button size="sm" variant="outline" className="h-10" onClick={() => onSetDates(x.saleId)}><CalendarClock className="mr-1.5 h-4 w-4" />Set dates</Button>
        )}
        {mode === "sessions" && onOpenBilling && (
          <Button size="sm" variant="ghost" className="h-10 px-2 text-muted-foreground" onClick={onOpenBilling}>Open on Billing<ChevronRight className="ml-0.5 h-4 w-4" /></Button>
        )}
      </div>
    </Part>
  );

  return (
    <div className={cn("overflow-hidden rounded-xl border", x.trainingNow ? "border-foreground/30" : "border-border")} data-package-card={x.number}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="w-full space-y-2 px-3 py-2.5 text-left">
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-[15px] font-semibold">
            {x.label}{when ? <span className="font-normal text-muted-foreground"> · {when}</span> : null}
          </span>
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="min-w-0 space-y-1">
            <div className="min-w-0 truncate">{trainingWord}</div>
            <SegmentBar parts={sessionParts} total={size} label={packageSessionsLine(x)} />
            <div className="text-[12px] tabular-nums text-muted-foreground">{packageSessionsLine(x)}</div>
          </div>
          <div className="min-w-0 space-y-1">
            <div className="min-w-0 truncate">{payingWord}</div>
            <SegmentBar parts={[{ value: x.paidCents, tone: "done" }]} total={x.totalCents} label={`${money(x.paidCents)} of ${money(x.totalCents)} paid`} />
            <div className="text-[12px] tabular-nums text-muted-foreground">
              {x.state === "free" ? "Free" : x.state === "waiting" ? `${money(x.balanceCents)} link sent` : `${money(x.paidCents)} of ${money(x.totalCents)}`}
            </div>
          </div>
        </div>
        {mode === "billing" && (owing || x.unpaidDeliveredCents > 0) && (
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-[13px] tabular-nums">
            <span><span className="text-muted-foreground">Left to pay </span><span className="font-semibold">{money(x.balanceCents)}</span></span>
            {x.unpaidDeliveredCents > 0 && (
              <span className="text-warning" data-package-unpaid-delivered>{money(x.unpaidDeliveredCents)} trained, not paid for</span>
            )}
          </div>
        )}
      </button>

      {open && (
        <div className="px-3 pb-1">
          {mode === "sessions" ? [sessionsPart, moneyPart] : [moneyPart, sessionsPart]}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border py-2.5 text-[13px] text-muted-foreground" data-package-origin>
            <span className="min-w-0">
              {x.renewedFrom
                ? `Renewed from ${x.renewedFrom.number ? `Package ${x.renewedFrom.number}` : "the package before"}${x.boughtOn ? ` on ${payDay(x.boughtOn)}` : ""}`
                : x.boughtOn ? `Bought ${payDay(x.boughtOn)}` : "Bought"}
              {` · ${x.name}`}
            </span>
            {isAdmin && onEditDates && (
              <button type="button" className="underline underline-offset-2" onClick={() => onEditDates(x.saleId)}>Edit dates</button>
            )}
            <Link to="/admin/purchases/$id" params={{ id: x.saleId }} className="inline-flex items-center gap-1 underline underline-offset-2">
              Open the sale<ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

/** A package's sessions, read when it's opened (Billing; the Sessions tab passes its own rows). */
function PackageAppointments({ clientId, saleId }: { clientId: string; saleId: string }) {
  const sessionsQ = useQuery(ptSessionsQuery(clientId));
  const ledgerQ = useQuery(ptClientLedgerQuery(clientId));
  const rows = useMemo(() => {
    const places = sessionPlaces((ledgerQ.data ?? []) as any);
    return ((sessionsQ.data ?? []) as any[])
      .filter((s) => places.get(s.id)?.purchaseId === saleId)
      .sort((a, b) => `${a.session_date}${a.start_time}`.localeCompare(`${b.session_date}${b.start_time}`));
  }, [sessionsQ.data, ledgerQ.data, saleId]);
  if (sessionsQ.isLoading || ledgerQ.isLoading) return <div className="h-16 animate-pulse rounded-lg bg-muted" aria-busy="true" />;
  if (rows.length === 0) return <p className="text-[13px] text-muted-foreground">No sessions on it.</p>;
  return (
    <ul className="divide-y divide-border rounded-lg border border-border" data-package-appointments>
      {rows.map((s) => (
        <li key={s.id} className="flex min-h-10 items-center justify-between gap-3 px-3 py-1.5 text-[14px] tabular-nums">
          <span>{shortDay(s.session_date)} · {fmtWallClock(String(s.start_time).slice(0, 5))}</span>
          <span className={cn("text-[13px]", s.status === "Completed" ? "text-success" : "text-muted-foreground")}>
            {s.status === "Completed" ? "Done" : s.status === "Scheduled" ? "Booked" : s.status === "Missed" ? "Missed · counted" : s.status}
          </span>
        </li>
      ))}
    </ul>
  );
}
