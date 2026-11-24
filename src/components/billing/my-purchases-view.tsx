/**
 * My Purchases, the client's screens (portal/purchases and a purchase's page):
 * drawn from the client purchases model (my-purchases.ts), which reads the same
 * numbers as the coach's Billing tab. Neutral, one accent per meaning: green
 * done, amber needs them, red a payment that failed or is overdue.
 */
import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, CalendarClock, CheckCircle2, ChevronDown, ChevronRight, CreditCard, ExternalLink, Loader2, MessageCircle, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SegmentBar } from "@/components/billing/package-visuals";
import { billingDay, billingRange } from "@/lib/date-range";
import { termRange, timeLeftWords } from "@/lib/coaching-plan";
import { fmtWallClock } from "@/lib/schedule-time";
import { getMyReceipt } from "@/lib/my-billing.functions";
import { createCustomerPortalSession } from "@/lib/stripe-checkout.functions";
import { useClientImpersonation } from "@/lib/client-impersonation";
import type { Installment } from "@/lib/payment-schedule";
import type { MyAction, MyOpen, MyPackage, MyPast, MyPayment, MyPlan, MySessionEntry, MySummary, Tone } from "@/lib/my-purchases";
import { cn } from "@/lib/utils";
import type { MyBillingView } from "@/components/billing/use-my-billing";

type Money = (cents: number) => string;

const TONE_TEXT: Record<Tone, string> = { done: "text-success", neutral: "text-muted-foreground", attention: "text-warning", error: "text-destructive" };
const TONE_DOT: Record<Tone, string> = { done: "bg-success", neutral: "bg-muted-foreground/60", attention: "bg-warning", error: "bg-destructive" };

export function Status({ text, tone, className }: { text: string; tone: Tone; className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 text-[13px]", TONE_TEXT[tone], className)}>
      <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", TONE_DOT[tone])} />
      {text}
    </span>
  );
}

export const Panel = ({ children, className, ...rest }: { children: ReactNode; className?: string } & Record<`data-${string}`, unknown>) => (
  <section className={cn("rounded-2xl border border-border bg-card", className)} {...rest}>{children}</section>
);

export const SectionTitle = ({ children, aside }: { children: ReactNode; aside?: ReactNode }) => (
  <div className="flex items-baseline justify-between gap-3 px-1">
    <h2 className="text-[16px] font-semibold">{children}</h2>
    {aside}
  </div>
);

const day = (iso: string | null | undefined) => billingDay(iso) ?? "";
const weekday = (iso: string | null | undefined) => billingDay(iso, { weekday: true }) ?? "";

/* ---------------- The overview ---------------- */

export function SummaryPanel({ s, money }: { s: MySummary; money: Money }) {
  if (s.state === "nothing") {
    return (
      <Panel className="px-4 py-8 text-center" data-my-summary="nothing">
        <Receipt className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden />
        <p className="mt-2 text-[15px] font-semibold">No purchases yet</p>
        <p className="mx-auto mt-1 max-w-xs text-[14px] text-muted-foreground">When your coach sets up a package or plan for you, it shows here with your payments and receipts.</p>
      </Panel>
    );
  }
  const owing = s.outstandingCents > 0;
  return (
    <Panel className="divide-y divide-border" data-my-summary={s.state}>
      <div className="px-4 py-4">
        {owing ? (
          <>
            <div className="text-[13px] text-muted-foreground">Left to pay</div>
            <div className="mt-0.5 text-[28px] font-semibold leading-tight tabular-nums" data-my-outstanding={s.outstandingCents}>{money(s.outstandingCents)}</div>
            <div className="mt-1">
              {s.overdueCents > 0
                ? <Status tone="error" text={`${money(s.overdueCents)} overdue`} />
                : <Status tone="done" text="Nothing overdue" />}
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 text-[18px] font-semibold"><CheckCircle2 className="h-5 w-5 text-success" aria-hidden />All paid up</div>
            <p className="mt-0.5 text-[14px] text-muted-foreground">Nothing owing.</p>
          </>
        )}
      </div>
      <dl className="divide-y divide-border">
        {s.next && (
          <Row label={s.next.recurring ? "Next charge" : "Next payment"} data-my-next>
            <span className="block font-semibold tabular-nums">{money(s.next.cents)}</span>
            <span className="block text-[13px] text-muted-foreground">{s.next.state === "due_today" || s.next.state === "unconfirmed" ? "Today" : weekday(s.next.date)}{s.next.auto ? " · automatic" : ""}</span>
          </Row>
        )}
        <Row label="Paid so far" data-my-paid={s.paidCents}><span className="font-semibold tabular-nums">{money(s.paidCents)}</span></Row>
      </dl>
      {s.noDatesCents > 0 && (
        <p className="px-4 py-3 text-[13px] text-muted-foreground" data-my-no-dates>
          {money(s.noDatesCents)} has no payment date yet. Your coach will let you know when it's due.
        </p>
      )}
      {s.taxIncluded && <p className="px-4 py-2.5 text-[12px] text-muted-foreground">Amounts include tax.</p>}
    </Panel>
  );
}

function Row({ label, children, ...rest }: { label: string; children: ReactNode } & Record<`data-${string}`, unknown>) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-4 py-3 text-[14px]" {...rest}>
      <dt className="shrink-0 whitespace-nowrap text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}

/* ---------------- Things to do (only when there's something real to do) ---------------- */

export function ActionList({ actions, money }: { actions: MyAction[]; money: Money }) {
  if (actions.length === 0) return null;
  return (
    <div className="space-y-2" data-my-actions>
      {actions.map((a, i) => <ActionCard key={`${a.kind}:${a.saleId}`} a={a} money={money} primary={i === 0} />)}
    </div>
  );
}

function ActionCard({ a, money, primary }: { a: MyAction; money: Money; primary: boolean }) {
  const tone = a.kind === "pay" ? "border-warning/50" : "border-destructive/50";
  return (
    <Panel className={cn("space-y-2 px-4 py-3", tone)} data-my-action={a.kind}>
      <div className="flex items-start gap-2">
        <AlertTriangle className={cn("mt-0.5 h-4 w-4 shrink-0", a.kind === "pay" ? "text-warning" : "text-destructive")} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold">
            {a.kind === "pay" ? `Ready to pay · ${money(a.cents)}` : a.kind === "card" ? "Your card didn't go through" : `Payment overdue · ${money(a.cents)}`}
          </div>
          <p className="text-[13px] text-muted-foreground">
            {a.kind === "pay"
              ? a.name
              : a.kind === "card"
                ? `${money(a.cents)} for ${a.name}. Stripe tries again on its own; updating your card fixes it sooner.`
                : `${a.name}, due ${weekday(a.date)}. Pay your coach the way you usually do.`}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 pl-6">
        {a.kind === "pay" && (
          <Button asChild size="sm" className="h-10" variant={primary ? "default" : "outline"}>
            <Link to="/portal/purchases/$id" params={{ id: a.saleId }}>Review and pay</Link>
          </Button>
        )}
        {a.kind === "card" && <UpdateCardButton variant={primary ? "default" : "outline"} />}
        {a.kind === "overdue" && (
          <Button asChild size="sm" variant="outline" className="h-10">
            <Link to="/portal/messages"><MessageCircle className="mr-1.5 h-4 w-4" />Message your coach</Link>
          </Button>
        )}
      </div>
    </Panel>
  );
}

/** Stripe's own page for their card and invoices (never in a coach's preview: it would open the coach's). */
export function UpdateCardButton({
  label = "Update card",
  variant = "default",
  returnPath = "/portal/purchases",
}: {
  label?: string;
  variant?: "default" | "outline";
  /** Where Stripe's page sends them back. */
  returnPath?: string;
}) {
  const portalFn = useServerFn(createCustomerPortalSession);
  const { client } = useClientImpersonation();
  const [busy, setBusy] = useState(false);
  const open = async () => {
    if (client) {
      toast.info("Preview only. Only the client can open their card details.");
      return;
    }
    setBusy(true);
    try {
      const { url } = await portalFn({ data: { origin: window.location.origin, returnPath } });
      window.location.assign(url);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't open your card details");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button size="sm" variant={variant} className="h-10" onClick={open} disabled={busy} data-my-update-card>
      {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CreditCard className="mr-1.5 h-4 w-4" />}{label}
    </Button>
  );
}

/* ---------------- What they're on ---------------- */

export function PackageCard({ x, money }: { x: MyPackage; money: Money }) {
  const s = x.sessions;
  return (
    <Link to="/portal/purchases/$id" params={{ id: x.saleId }} className="block" data-my-package={x.label}>
      <Panel className="space-y-2.5 px-4 py-3.5 transition-colors hover:bg-muted/40">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[16px] font-semibold leading-snug">{x.label}</div>
            <div className="text-[13px] leading-snug text-muted-foreground">{x.name}</div>
          </div>
          <span className="flex shrink-0 items-center gap-1">
            <Status text={x.training.text} tone={x.now ? "neutral" : x.training.tone} className={x.now ? "font-medium text-foreground" : undefined} />
            <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
          </span>
        </div>
        <SegmentBar
          parts={[{ value: s.completed, tone: "done" }, { value: s.booked, tone: "booked" }]}
          total={Math.max(s.purchased, 1)}
          label={`${s.completed} completed, ${s.booked} booked, ${s.available} left to book of ${s.purchased}`}
        />
        <SessionCounts s={s} />
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[13px]">
          <span className="tabular-nums text-muted-foreground"><span className="font-semibold text-foreground">{money(x.paidCents)}</span> of {money(x.totalCents)} paid</span>
          <Status text={x.payment.text} tone={x.payment.tone} />
        </div>
      </Panel>
    </Link>
  );
}

export function SessionCounts({ s }: { s: MyPackage["sessions"] }) {
  const parts: Array<[number, string]> = [[s.completed, "completed"], [s.booked, "booked"], [s.available, "left to book"]];
  if (s.expired > 0) parts.push([s.expired, "expired"]);
  return (
    <div className="text-[13px] tabular-nums text-muted-foreground" data-my-counts>
      {parts.map(([n, w], i) => <span key={w}>{i > 0 ? " · " : ""}<span className="font-semibold text-foreground">{n}</span> {w}</span>)}
      <span> · of {s.purchased}</span>
    </div>
  );
}

export function PlanCard({ x, money, today, link = true }: { x: MyPlan; money: Money; today: string; link?: boolean }) {
  const p = x.plan;
  const year = Number(today.slice(0, 4));
  const body = (
    <Panel className={cn("space-y-2 px-4 py-3.5", link && "transition-colors hover:bg-muted/40")} data-my-plan={p.kind}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 text-[16px] font-semibold leading-snug">{p.name}</div>
        <span className="flex shrink-0 items-center gap-1">
          {p.kind === "subscription"
            ? p.state === "past_due" ? <Status tone="error" text="Payment failed" /> : p.state === "cancelling" ? <Status tone="attention" text="Ending" /> : <Status tone="done" text="Active" />
            : p.state === "left" ? <Status tone="neutral" text="Payment plan" /> : p.state === "past_due" ? <Status tone="error" text="Payment due" /> : <Status tone="done" text="Paid in full" />}
          {link && <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />}
        </span>
      </div>
      {p.kind === "subscription" ? (
        <p className="text-[13px] text-muted-foreground">
          <span className="font-semibold tabular-nums text-foreground">{money(p.cents)}</span> a {p.per ?? "period"}
          {p.state === "cancelling" && p.end ? ` · ends ${weekday(p.end)}, no more charges` : p.state === "past_due" ? " · Stripe tries again on its own" : p.next ? ` · renews ${weekday(p.next)}${p.auto ? ", automatic" : ""}` : ""}
        </p>
      ) : p.timing === "no_dates" ? (
        <p className="text-[13px] text-muted-foreground">{p.duration ? `${p.duration.toLowerCase()} · ` : ""}{money(p.paidCents)} paid · your coach will confirm its dates</p>
      ) : (
        <>
          {p.elapsed != null && p.timing !== "upcoming" && (
            <SegmentBar parts={[{ value: Math.round(p.elapsed * 1000), tone: "booked" }]} total={1000} label={`${Math.round(p.elapsed * 100)}% of the term gone by`} />
          )}
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[13px]">
            <span className="text-foreground">{termRange(p.start, p.end, year)}</span>
            <span className={cn("tabular-nums", p.timing === "ending_soon" ? "text-warning" : "text-muted-foreground")}>
              {p.timing === "upcoming" && p.start ? `Starts ${day(p.start)}` : timeLeftWords(p, today)}
            </span>
          </div>
        </>
      )}
    </Panel>
  );
  return link ? <Link to="/portal/purchases/$id" params={{ id: x.saleId }} className="block">{body}</Link> : body;
}

export function OpenCard({ x, money }: { x: MyOpen; money: Money }) {
  return (
    <Link to="/portal/purchases/$id" params={{ id: x.saleId }} className="block" data-my-open>
      <Panel className="flex items-start justify-between gap-3 px-4 py-3.5 transition-colors hover:bg-muted/40">
        <div className="min-w-0">
          <div className="text-[16px] font-semibold leading-snug">{x.name}</div>
          <div className="text-[13px] tabular-nums text-muted-foreground">{x.paidCents > 0 ? `${money(x.paidCents)} paid · ` : ""}{money(x.leftCents)} {x.payment.text === "Ready to pay" ? "to pay" : "left"}</div>
        </div>
        <span className="flex shrink-0 items-center gap-1">
          <Status text={x.payment.text} tone={x.payment.tone} />
          <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
        </span>
      </Panel>
    </Link>
  );
}

/* ---------------- Payments and receipts ---------------- */

export function PaymentsList({ payments, money, limit, showFor = true }: { payments: MyPayment[]; money: Money; limit?: number; showFor?: boolean }) {
  const [all, setAll] = useState(false);
  if (payments.length === 0) return <p className="px-1 text-[14px] text-muted-foreground">No payments yet.</p>;
  const shown = limit && !all ? payments.slice(0, limit) : payments;
  return (
    <div className="space-y-2">
      <Panel>
        <ul className="divide-y divide-border" data-my-payments>
          {shown.map((p) => <PaymentItem key={p.id} p={p} money={money} showFor={showFor} />)}
        </ul>
      </Panel>
      {limit && payments.length > limit && (
        <button type="button" onClick={() => setAll((v) => !v)} className="flex min-h-10 w-full items-center justify-center gap-1 text-[14px] text-muted-foreground hover:text-foreground">
          {all ? "Show fewer" : `Show all ${payments.length} payments`}
          <ChevronDown className={cn("h-4 w-4 transition-transform", all && "rotate-180")} aria-hidden />
        </button>
      )}
    </div>
  );
}

function PaymentItem({ p, money, showFor }: { p: MyPayment; money: Money; showFor: boolean }) {
  const refund = p.kind === "refund";
  const how = p.byHand ? `${p.method} · recorded by your coach` : p.method;
  return (
    <li className="flex items-start justify-between gap-3 px-4 py-3" data-my-payment={p.kind}>
      <div className="min-w-0">
        <div className="text-[14px] font-medium">{weekday(p.date) || "No date"}</div>
        <div className="flex flex-wrap items-center gap-x-1.5 text-[13px] leading-snug text-muted-foreground">
          <span>{[refund ? "Refund" : null, showFor ? p.forLabel : null, how].filter(Boolean).join(" · ")}</span>
          <ReceiptLink p={p} />
        </div>
        {p.note && <div className="text-[13px] text-muted-foreground">{p.note}</div>}
      </div>
      <div className="shrink-0 text-right">
        <div className={cn("text-[15px] font-semibold tabular-nums", refund && "text-muted-foreground")}>{refund ? `−${money(p.cents)}` : money(p.cents)}</div>
        {p.taxCents > 0 && <div className="text-[12px] tabular-nums text-muted-foreground">incl. {money(p.taxCents)} tax</div>}
      </div>
    </li>
  );
}

/** A receipt to open; one Stripe has but the app hasn't saved yet is asked for once, on the tap. */
function ReceiptLink({ p }: { p: MyPayment }) {
  const fn = useServerFn(getMyReceipt);
  const qc = useQueryClient();
  const [url, setUrl] = useState<string | null>(p.receipt.kind === "url" ? p.receipt.url : null);
  const [busy, setBusy] = useState(false);
  const [none, setNone] = useState(false);
  const cls = "inline-flex min-h-8 items-center gap-1 text-[13px] font-medium text-foreground underline-offset-2 hover:underline";
  if (url) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className={cls} data-my-receipt>
        <Receipt className="h-3.5 w-3.5" aria-hidden />Receipt<ExternalLink className="h-3 w-3 text-muted-foreground" aria-hidden />
      </a>
    );
  }
  if (p.receipt.kind !== "fetch" || none) return null;
  const get = async () => {
    setBusy(true);
    try {
      const res = await fn({ data: { ledger_id: p.id } });
      if (res.url) {
        setUrl(res.url);
        void qc.invalidateQueries({ queryKey: ["my-billing"] });
      } else {
        setNone(true);
        toast.info("No receipt is available for this payment.");
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't get the receipt");
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" onClick={get} disabled={busy} className={cls} data-my-receipt-get>
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Receipt className="h-3.5 w-3.5" aria-hidden />}Get receipt
    </button>
  );
}

/* ---------------- Past purchases ---------------- */

export function PastList({ past }: { past: MyPast[] }) {
  const [open, setOpen] = useState(false);
  if (past.length === 0) return null;
  return (
    <Panel data-my-past>
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex min-h-12 w-full items-center justify-between gap-3 px-4 text-left">
        <span className="text-[15px] font-medium">Past purchases</span>
        <span className="flex items-center gap-1 text-[13px] text-muted-foreground">{past.length}<ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden /></span>
      </button>
      {open && (
        <ul className="divide-y divide-border border-t border-border">
          {past.map((x) => (
            <li key={x.saleId}>
              <Link to="/portal/purchases/$id" params={{ id: x.saleId }} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/40">
                <div className="min-w-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[14px] font-medium leading-snug">{x.name}</span>
                    {x.date && <span className="shrink-0 whitespace-nowrap text-[13px] tabular-nums text-muted-foreground">{day(x.date)}</span>}
                  </div>
                  {x.sub && <div className="text-[13px] leading-snug text-muted-foreground">{x.sub}</div>}
                  <div className="text-[13px] leading-snug text-muted-foreground">{x.line}</div>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ---------------- A package's sessions, and what's still to pay ---------------- */

const LOG_GROUPS: Array<{ key: string; title: string; kinds: MySessionEntry["kind"][]; newestFirst: boolean }> = [
  { key: "booked", title: "Booked", kinds: ["booked"], newestFirst: false },
  { key: "done", title: "Completed", kinds: ["completed", "counted"], newestFirst: true },
  { key: "returned", title: "Not counted", kinds: ["returned"], newestFirst: true },
];

/** A package's sessions: what's booked next, what's done (newest first), and what gave its credit back. */
export function SessionLog({ entries }: { entries: MySessionEntry[] }) {
  if (entries.length === 0) return <p className="px-1 text-[14px] text-muted-foreground">No sessions on it yet.</p>;
  return (
    <div className="space-y-3" data-my-session-log>
      {LOG_GROUPS.map((g) => {
        const rows = entries.filter((e) => g.kinds.includes(e.kind));
        if (rows.length === 0) return null;
        return <LogGroup key={g.key} title={g.title} rows={g.newestFirst ? [...rows].reverse() : rows} />;
      })}
      <p className="px-1 text-[12px] text-muted-foreground">A session counts once it's completed, or when a late cancel or no-show is counted. A cancelled or moved session gives its session back.</p>
    </div>
  );
}

function LogGroup({ title, rows }: { title: string; rows: MySessionEntry[] }) {
  const [all, setAll] = useState(false);
  const LIMIT = 6;
  const shown = all ? rows : rows.slice(0, LIMIT);
  return (
    <Panel data-my-log-group={title}>
      <div className="flex items-baseline justify-between px-4 pt-3 pb-1 text-[13px] text-muted-foreground">
        <span className="font-medium text-foreground">{title}</span>
        <span className="tabular-nums">{rows.length}</span>
      </div>
      <ul className="divide-y divide-border">
        {shown.map((e) => (
          <li key={e.id} className="flex min-h-11 items-center justify-between gap-3 px-4 py-2 text-[14px]">
            <span className="tabular-nums">{weekday(e.date)}{e.start ? ` · ${fmtWallClock(e.start)}` : ""}</span>
            {/* Only what the group's title doesn't already say: a counted miss, cancelled or moved. */}
            {e.label !== title && <Status text={e.label.replace(" · not counted", "")} tone={e.tone} />}
          </li>
        ))}
      </ul>
      {rows.length > LIMIT && (
        <button type="button" onClick={() => setAll((v) => !v)} className="flex min-h-10 w-full items-center justify-center gap-1 border-t border-border text-[13px] text-muted-foreground hover:text-foreground">
          {all ? "Show fewer" : `Show all ${rows.length}`}
          <ChevronDown className={cn("h-4 w-4 transition-transform", all && "rotate-180")} aria-hidden />
        </button>
      )}
    </Panel>
  );
}

export function UpcomingPayments({ list, money }: { list: Installment[]; money: Money }) {
  if (list.length === 0) return null;
  return (
    <ul className="divide-y divide-border" data-my-upcoming>
      {list.map((i) => (
        <li key={i.key} className="flex min-h-10 items-center justify-between gap-3 px-4 py-2 text-[14px]">
          <span className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-muted-foreground" aria-hidden />
            <span className={cn(i.state === "overdue" || i.state === "failed" ? "text-destructive" : undefined)}>
              {weekday(i.date)}{i.state === "overdue" ? " · overdue" : i.state === "failed" ? " · failed" : i.state === "due_today" ? " · today" : ""}
            </span>
          </span>
          <span className="tabular-nums"><span className="font-semibold">{money(i.cents)}</span><span className="text-muted-foreground">{i.auto ? " · automatic" : ""}</span></span>
        </li>
      ))}
    </ul>
  );
}

/** "Jun 2 – 29", "Jun 2, 2026 – Jun 2, 2027". */
export const period = (a: string | null, b: string | null) => billingRange(a, b);

/** The list page under its header: things to do, the overview, then only the sections that apply. */
export function MyPurchasesBody({ view, today }: { view: MyBillingView; today: string }) {
  const { mine, money } = view;
  const s = mine.summary;
  return (
    <>
      <ActionList actions={s.actions} money={money} />
      <SummaryPanel s={s} money={money} />

      {mine.packages.length > 0 && (
        <section className="space-y-2.5" data-my-section="packages">
          <SectionTitle>Your sessions</SectionTitle>
          {mine.packages.map((x) => <PackageCard key={x.saleId} x={x} money={money} />)}
        </section>
      )}

      {mine.plans.length > 0 && (
        <section className="space-y-2.5" data-my-section="plans">
          <SectionTitle>Your coaching</SectionTitle>
          {mine.plans.map((x) => <PlanCard key={x.saleId} x={x} money={money} today={today} />)}
        </section>
      )}

      {mine.open.length > 0 && (
        <section className="space-y-2.5" data-my-section="open">
          <SectionTitle>Open purchases</SectionTitle>
          {mine.open.map((x) => <OpenCard key={x.saleId} x={x} money={money} />)}
        </section>
      )}

      {s.state !== "nothing" && (
        <section className="space-y-2.5" data-my-section="payments">
          <SectionTitle>Payments and receipts</SectionTitle>
          <PaymentsList payments={mine.payments} money={money} limit={5} />
        </section>
      )}

      <PastList past={mine.past} />
    </>
  );
}
