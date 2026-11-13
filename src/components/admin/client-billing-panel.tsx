/**
 * A client's Billing overview: money, not training. What's outstanding and
 * what's been paid, split into overdue, due today, scheduled and what has no
 * payment dates yet; the next payment and whether auto-pay collects it; the
 * payments coming up, oldest owed first; anything that needs the coach (a
 * failed payment, a balance with no dates, training past every package that
 * isn't billed yet); and every payment that came in, with its receipt.
 *
 * Everything reads payment-schedule.ts (useClientPayments), the same model
 * as the Sessions tab's billing line, so the two never disagree. Amounts are
 * in the dollars the client pays. Nothing here charges anyone.
 */
import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, Banknote, CalendarClock, ChevronDown, Repeat, Wallet } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CardHeader, StatusChip } from "@/components/nutrition/nutrition-ui";
import { RecordPaymentDialog } from "@/components/admin/sale-payment-dialogs";
import { useClientPayments } from "@/components/billing/use-client-payments";
import { renewSessionPackage, setPaymentDates } from "@/lib/billing.functions";
import { useAuth } from "@/lib/auth";
import { formatMoney } from "@/lib/payment-display";
import { billingPeriod, salePayments, type PaymentRow } from "@/lib/sale-money";
import { addPeriod } from "@/lib/session-packages";
import { saleLabels, type ClientPayments, type Installment, type PackageAccount, type SaleSchedule } from "@/lib/payment-schedule";
import type { PayingNow } from "@/lib/package-status";
import { BarLegend, CoverageBar, PaymentBar, PaymentStatusText, RoleTag, SessionBar, TrainingStatusText } from "@/components/billing/package-visuals";
import { cn } from "@/lib/utils";

/** "Fri Nov 13" (the year only when it isn't this year). */
export function payDay(iso: string | null | undefined, thisYear = new Date().getFullYear()): string {
  if (!iso) return "";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric", ...(d.getFullYear() === thisYear ? {} : { year: "numeric" }) });
}

export function ClientBillingPanel({ clientId, onOpenSessions }: { clientId: string; onOpenSessions?: () => void }) {
  const qc = useQueryClient();
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const { data, payments, isLoading, isError, refetch, isFetching } = useClientPayments(clientId);
  const [recording, setRecording] = useState<string | null>(null);
  const [dating, setDating] = useState<string | null>(null);

  const invalidate = () => {
    for (const key of [["client-billing", clientId], ["client-purchases", clientId], ["pt-balance", clientId], ["pt-pack-purchases", clientId], ["pt-client-ledger", clientId], ["pt-payment-ledger", clientId]]) {
      qc.invalidateQueries({ queryKey: key });
    }
  };

  const renewFn = useServerFn(renewSessionPackage);
  const renew = useMutation({
    mutationFn: (purchaseId: string) => renewFn({ data: { purchase_id: purchaseId } }),
    onSuccess: () => {
      toast.success("Next package added", { description: "It's on this page until it's paid. Nothing was charged." });
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't add the renewal"),
  });

  const sales = (data?.purchases ?? []) as any[];
  const saleOf = (id: string | null) => sales.find((s) => s.id === id) ?? null;
  const recordingSale = saleOf(recording);
  const datingSale = saleOf(dating);

  return (
    <Card className="space-y-4 border-border bg-card p-4 md:col-span-3 md:p-6" data-billing-overview>
      <CardHeader
        icon={Wallet}
        title="Billing"
        actions={isAdmin && payments && payments.balances.length > 0 ? (
          <RecordButton balances={payments.balances} onPick={setRecording} />
        ) : null}
      />
      {isLoading && (
        <div className="space-y-3" aria-busy="true">
          <div className="h-32 animate-pulse rounded-xl bg-muted" />
          <div className="h-24 animate-pulse rounded-xl bg-muted" />
        </div>
      )}
      {isError && (
        <div className="space-y-2 rounded-xl border border-destructive/40 p-4 text-center">
          <p className="text-[14px] text-destructive">Billing couldn't be loaded.</p>
          <Button size="sm" variant="outline" className="h-10" disabled={isFetching} onClick={() => refetch()}>Try again</Button>
        </div>
      )}
      {payments && data && (
        <BillingOverview
          p={payments}
          ledger={data.ledger ?? []}
          labels={saleLabels(sales)}
          isAdmin={isAdmin}
          renewing={renew.isPending}
          onOpenSessions={onOpenSessions}
          onRecord={setRecording}
          onSetDates={setDating}
          onRenew={(id) => renew.mutate(id)}
        />
      )}

      {recordingSale && payments && (
        <RecordPaymentDialog
          sale={recordingSale}
          money={payments.money.get(recordingSale.id)!}
          open
          onOpenChange={(o) => { if (!o) setRecording(null); }}
          onDone={invalidate}
        />
      )}
      {datingSale && payments && (
        <SetPaymentDatesDialog
          sale={datingSale}
          balance={payments.balances.find((b) => b.saleId === datingSale.id) ?? null}
          open
          onOpenChange={(o) => { if (!o) setDating(null); }}
          onDone={invalidate}
        />
      )}
    </Card>
  );
}

/** Record a payment: straight to the one balance, or pick which one. */
function RecordButton({ balances, onPick }: { balances: SaleSchedule[]; onPick: (saleId: string) => void }) {
  if (balances.length === 1) {
    return (
      <Button size="sm" variant="outline" className="h-10 px-3" onClick={() => onPick(balances[0].saleId)}>
        <Banknote className="mr-1.5 h-4 w-4" /> Record payment
      </Button>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" className="h-10 px-3"><Banknote className="mr-1.5 h-4 w-4" /> Record payment<ChevronDown className="ml-1 h-4 w-4" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {balances.map((b) => (
          <DropdownMenuItem key={b.saleId} onSelect={() => onPick(b.saleId)}>
            <span className="min-w-0 flex-1 truncate">{b.label}</span>
            <span className="ml-2 tabular-nums text-muted-foreground">{formatMoney(b.money.leftCents / 100, b.money.currency)} left</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The overview itself. Pure view over the payments model, so it can be
 * checked with fixture data (Marc's real records are the reference).
 *
 * In order of weight: what's outstanding (big), then the three numbers that
 * need a decision (training delivered and not paid for, due now, overdue),
 * then everything later in one quiet line; then the package(s) the money is
 * going to now; then every package as a timeline, each with its sessions
 * and its payments as two bars.
 */
export function BillingOverview({ p, ledger, labels, isAdmin, renewing, onOpenSessions, onRecord, onSetDates, onRenew }: {
  p: ClientPayments;
  ledger: any[];
  labels: Map<string, string>;
  isAdmin: boolean;
  renewing?: boolean;
  onOpenSessions?: () => void;
  onRecord: (saleId: string) => void;
  onSetDates: (saleId: string) => void;
  onRenew: (fromSaleId: string) => void;
}) {
  const money = (c: number) => formatMoney(c / 100, p.currency);
  const history = useMemo(() => salePayments(ledger), [ledger]);
  const needsDates = p.balances.filter((b) => b.how === "none");
  const ended = p.recurring.filter((r) => r.state === "cancelling");
  const accountOf = new Map(p.packages.map((x) => [x.saleId, x]));
  const dueAuto = p.upcoming.some((i) => (i.state === "due_today" || i.state === "unconfirmed") && i.auto);

  return (
    <>
      <section className="space-y-3 rounded-xl border border-border p-3 sm:p-4" data-billing-totals>
        <div>
          <div className="text-[13px] text-muted-foreground">Outstanding balance</div>
          <div className={cn("text-[28px] font-semibold leading-tight tabular-nums", p.overdueCents > 0 && "text-destructive")} data-outstanding>{money(p.outstandingCents)}</div>
          <div className="text-[12px] text-muted-foreground">{p.outstandingCents > 0 ? (p.taxIncluded ? "Tax included" : "Before tax (no tax paid on file yet)") : "Nothing left to pay"}</div>
        </div>

        <dl className="grid grid-cols-[1.35fr_1fr_1fr] divide-x divide-border overflow-hidden rounded-lg border border-border" data-billing-key>
          <Key
            label="Unpaid training delivered"
            value={money(p.unpaidDeliveredCents)}
            swatch={p.unpaidDeliveredCents > 0 ? "unpaid" : null}
            muted={p.unpaidDeliveredCents === 0}
            data-unpaid-delivered={p.unpaidDeliveredCents}
          />
          <Key
            label="Due now"
            sub={p.dueNowCents > 0 ? (dueAuto ? "auto-pay" : "to collect") : null}
            value={money(p.dueNowCents)}
            tone={p.dueNowCents > 0 && !dueAuto ? "attention" : undefined}
            muted={p.dueNowCents === 0}
            data-split="Due now"
          />
          <Key
            label="Overdue"
            sub={p.overdueCents > 0 ? `${p.overdue.length} payment${p.overdue.length === 1 ? "" : "s"}` : null}
            value={money(p.overdueCents)}
            tone={p.overdueCents > 0 ? "error" : undefined}
            muted={p.overdueCents === 0}
            data-split="Overdue"
          />
        </dl>

        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-muted-foreground" data-billing-secondary>
          <span data-split="Future installments">Future installments <span className="font-medium tabular-nums text-foreground">{money(p.scheduledCents)}</span></span>
          {p.unscheduledCents > 0 && (
            <span className="text-warning" data-split="No dates yet">No dates yet <span className="font-medium tabular-nums">{money(p.unscheduledCents)}</span></span>
          )}
          <span>Paid so far <span className="font-medium tabular-nums text-foreground" data-paid>{money(p.paidCents)}</span></span>
          {p.notBilledDeliveredCents > 0 && (
            <span className="text-warning">{money(p.notBilledDeliveredCents)} of training not billed yet</span>
          )}
        </div>

        <AutoPayLine p={p} money={money} />
      </section>

      {p.overdue.length > 0 && (
        <section className="space-y-2 rounded-xl border border-destructive/40 p-3" data-billing-overdue>
          <h4 className="flex items-center gap-1.5 text-[15px] font-semibold text-destructive"><AlertTriangle className="h-4 w-4" /> Overdue</h4>
          <ul className="divide-y divide-border">
            {p.overdue.map((i) => (
              <InstallmentRow key={i.key} i={i} money={money} action={isAdmin && !i.auto ? <Button size="sm" variant="outline" className="h-9" onClick={() => onRecord(i.saleId)}>Record</Button> : null} />
            ))}
          </ul>
          {p.overdue.some((i) => i.state === "failed") && (
            <p className="text-[13px] text-muted-foreground">Stripe couldn't charge the card and retries on its own. If it keeps failing, ask them to update their card, or record what they pay you directly.</p>
          )}
        </section>
      )}

      {p.payingNow.length > 0 && (
        <section className="space-y-2" data-paying-off>
          <h4 className="text-[15px] font-semibold">Currently paying off</h4>
          {p.payingNow.map((x) => (
            <PayingCard
              key={x.saleId}
              x={x}
              account={accountOf.get(x.saleId) ?? null}
              balance={p.balances.find((b) => b.saleId === x.saleId) ?? null}
              money={money}
            />
          ))}
        </section>
      )}

      {(p.notBilled || needsDates.length > 0 || ended.length > 0 || p.autoPay?.uncoveredCents) ? (
        <section className="space-y-2" data-billing-attention>
          {p.notBilled && (
            <AttentionRow
              title={p.notBilled.kind === "renewal"
                ? `${p.notBilled.trained} session${p.notBilled.trained === 1 ? "" : "s"} trained past their last package`
                : `${p.notBilled.sessions} session${p.notBilled.sessions === 1 ? "" : "s"} trained past what was bought`}
              text={p.notBilled.kind === "renewal"
                ? `Not billed yet. The next package is ${money(p.notBilled.eachCents)}${p.taxIncluded ? "" : " + tax"}.`
                : "Not billed yet, and there's no package to renew. Sell them one."}
              action={isAdmin && p.notBilled.kind === "renewal" && p.notBilled.fromSaleId ? (
                <Button size="sm" className="h-10" disabled={renewing} onClick={() => onRenew((p.notBilled as any).fromSaleId)}>
                  <Repeat className="mr-1.5 h-4 w-4" /> {renewing ? "Adding…" : "Add the next package"}
                </Button>
              ) : null}
            />
          )}
          {needsDates.map((b) => (
            <AttentionRow
              key={b.saleId}
              title={`${b.label}: ${money(b.unscheduledCents)} with no payment dates`}
              text={b.canSetDates ? "Not overdue: nothing says when it's due. Set the dates, or record a payment when it comes in." : "Not overdue: nothing collects it. Send a payment link or record a payment when it comes in."}
              action={isAdmin ? (
                b.canSetDates
                  ? <Button size="sm" variant="outline" className="h-10" onClick={() => onSetDates(b.saleId)}><CalendarClock className="mr-1.5 h-4 w-4" /> Set dates</Button>
                  : <Button size="sm" variant="outline" className="h-10" onClick={() => onRecord(b.saleId)}>Record</Button>
              ) : null}
            />
          ))}
          {ended.map((r) => (
            <AttentionRow key={r.saleId} tone="neutral" title={`${r.name} ends ${payDay(r.next)}`} text="No more charges after that." />
          ))}
        </section>
      ) : null}

      {p.packages.length > 0 && (
        <PackageHistory
          packages={p.packages}
          ledger={ledger}
          money={money}
          isAdmin={isAdmin}
          onOpenSessions={onOpenSessions}
          onRecord={onRecord}
          onSetDates={onSetDates}
        />
      )}

      {p.upcoming.length > 0 && (
        <Folder title="All upcoming payments" summary={`${p.upcoming.length}`} data-billing-upcoming>
          <Upcoming items={p.upcoming} money={money} isAdmin={isAdmin} onRecord={onRecord} />
        </Folder>
      )}

      {p.waiting.length > 0 && (
        <Folder title="Payment links out" summary={`${p.waiting.length}`} data-billing-waiting>
          <p className="text-[13px] text-muted-foreground">Nothing paid on these yet, so they aren't counted as owed.</p>
          <ul className="divide-y divide-border">
            {p.waiting.map((w) => (
              <li key={w.saleId} className="flex items-center justify-between gap-2 py-2 text-[14px]">
                <span className="min-w-0 truncate">{w.name}{w.since ? <span className="text-muted-foreground"> · since {payDay(w.since)}</span> : null}</span>
                <span className="shrink-0 tabular-nums">{money(w.cents)}</span>
              </li>
            ))}
          </ul>
        </Folder>
      )}

      {history.length > 0 && (
        <Folder title="Payment history" summary={`${history.filter((h) => !h.voided).length}`} data-billing-history>
          <PaymentHistory rows={history} labels={labels} money={money} />
        </Folder>
      )}

      {p.outstandingCents === 0 && !p.next && history.length === 0 && p.waiting.length === 0 && (
        <p className="text-[14px] text-muted-foreground">Nothing billed yet.</p>
      )}
    </>
  );
}

/** One of the three numbers that need a decision. */
function Key({ label, sub, value, tone, muted, swatch, ...rest }: {
  label: string;
  sub?: string | null;
  value: string;
  tone?: "attention" | "error";
  muted?: boolean;
  /** Ties the number to the bars' colour for it. */
  swatch?: "unpaid" | null;
} & Record<`data-${string}`, unknown>) {
  return (
    <div className="flex min-w-0 flex-col-reverse justify-end px-2.5 py-2" {...rest}>
      {/* The number first (so the three line up whatever their labels), then what it is. */}
      <dt className="text-[12px] leading-tight text-muted-foreground">
        {swatch === "unpaid" && <span aria-hidden className="mr-1.5 inline-block h-2 w-2 rounded-full bg-warning align-middle" />}
        {label}
        {sub && <span className="block">{sub}</span>}
      </dt>
      <dd className={cn("text-[16px] font-semibold tabular-nums", tone === "error" && "text-destructive", tone === "attention" && "text-warning", muted && "text-muted-foreground")}>{value}</dd>
    </div>
  );
}

/* ---------------- Paying now ---------------- */

/** "today", "Fri Nov 27", "failed Fri Nov 13", "overdue since Fri Nov 13". */
function whenDue(i: Installment): string {
  if (i.state === "failed") return `failed ${payDay(i.date)}`;
  if (i.state === "overdue") return `overdue since ${payDay(i.date)}`;
  if (i.state === "due_today") return "today";
  if (i.state === "unconfirmed") return `${payDay(i.date)}, not confirmed by Stripe yet`;
  return payDay(i.date);
}

/**
 * A package the money is going to now: its period, total, paid, left, the
 * payment bar, the next payment and its status, and (for auto-pay) the
 * packages queued behind it.
 */
function PayingCard({ x, account, balance, money }: {
  x: PayingNow<Installment>;
  account: PackageAccount | null;
  balance: SaleSchedule | null;
  money: (c: number) => string;
}) {
  const total = account?.totalCents ?? balance?.money.priceCents ?? 0;
  const paid = account?.paidCents ?? balance?.money.paidCents ?? 0;
  const left = account?.balanceCents ?? balance?.money.leftCents ?? 0;
  const when = account ? period(account.from, account.to) : null;
  const status = account?.payment ?? (x.next.state === "failed" ? "failed" : x.next.state === "overdue" ? "overdue" : x.next.state === "due_today" || x.next.state === "unconfirmed" ? "due" : paid > 0 ? "partial" : "scheduled");
  const by = x.how === "auto_pay" ? "auto-pay" : x.how === "stripe" ? "Stripe" : "collected by you";
  return (
    <div className="space-y-2 rounded-xl border border-border p-3" data-paying-package={account?.number ?? x.label}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <div className="text-[16px] font-semibold leading-tight">{x.label}</div>
          {when && <div className="whitespace-nowrap text-[13px] text-muted-foreground">Training {when}</div>}
        </div>
        <PaymentStatusText status={status} auto={x.next.auto} className="shrink-0" />
      </div>
      <div className="flex items-baseline justify-between gap-2 text-[13px] tabular-nums text-muted-foreground">
        <span><span className="font-semibold text-foreground">{money(paid)}</span> of {money(total)} paid</span>
        <span><span className="font-semibold text-foreground">{money(left)}</span> left</span>
      </div>
      <PaymentBar paidCents={paid} totalCents={total} />
      <p className="text-[13px]" data-paying-next>
        <span className="text-muted-foreground">Next </span>
        <span className="font-semibold tabular-nums">{money(x.next.cents)}</span>
        <span className={cn(x.next.state === "failed" || x.next.state === "overdue" ? "text-destructive" : "text-muted-foreground")}> {whenDue(x.next)}</span>
        <span className="text-muted-foreground"> · {by}{x.next.nth && x.next.of ? ` · payment ${x.next.nth} of ${x.next.of}` : ""}</span>
      </p>
      {x.then.length > 0 && (
        <p className="text-[13px] text-muted-foreground" data-paying-then>
          Then {x.then.map((t) => `${t.label} from ${payDay(t.first)}`).join(", ")}
        </p>
      )}
    </div>
  );
}

/* ---------------- Packages ---------------- */

/** "Oct 5 – Nov 1", "Nov 2 – 29" in one month. */
function period(a: string | null, b: string | null): string | null {
  const d = (iso: string) => new Date(`${iso}T00:00:00`);
  const fmt = (iso: string) => d(iso).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
  if (a && b) {
    const sameMonth = d(a).getMonth() === d(b).getMonth() && d(a).getFullYear() === d(b).getFullYear();
    return sameMonth ? `${fmt(a)} – ${d(b).getDate()}` : `${fmt(a)} – ${fmt(b)}`;
  }
  return a ? `from ${fmt(a)}` : b ? `to ${fmt(b)}` : null;
}

/** "16/16 completed", or "7 completed · 9 booked · 0 available". */
export function packageSessionsLine(x: PackageAccount): string {
  const s = x.sessions;
  if (s.completed >= s.purchased && s.booked === 0 && s.available === 0) return `${s.completed}/${s.purchased} completed`;
  const parts = [`${s.completed} completed`, `${s.booked} booked`, `${s.available} available`];
  if (s.expired) parts.push(`${s.expired} expired`);
  return parts.join(" · ");
}

/** How what's left on it gets paid, in a few words. */
function planLine(x: PackageAccount, money: (c: number) => string): string {
  if (x.state === "paid") return "Paid in full";
  if (x.state === "free") return "Free";
  if (x.state === "ended") return "Cancelled";
  if (x.state === "waiting") return "Payment link out, nothing paid yet";
  const sc = x.schedule;
  if (!sc || sc.how === "none") return "No payment dates";
  const list = sc.installments;
  const n = list.length;
  const when = n ? `${payDay(list[0].date)}${n > 1 ? ` – ${payDay(list[n - 1].date)}` : ""}` : "";
  const by = sc.how === "auto_pay" ? "Auto-pay" : sc.how === "stripe" ? "Stripe" : "Collected by you";
  return `${by} · ${n} payment${n === 1 ? "" : "s"} of ${money(list[0]?.cents ?? 0)}${when ? `, ${when}` : ""}`;
}

/** Finished and settled: nothing left to train or to pay. */
const settled = (x: PackageAccount) =>
  x.balanceCents === 0 && x.unpaidDeliveredCents === 0 && x.sessions.booked === 0 && x.sessions.available === 0 && x.state !== "past_due" && x.state !== "waiting";

/**
 * Every package in order, Package 1 first, each with its training and its
 * money as two bars. Settled ones fold into one line; the others are cards,
 * the one being trained now and the one being paid now tagged as such.
 */
function PackageHistory({ packages, ledger, money, isAdmin, onOpenSessions, onRecord, onSetDates }: {
  packages: PackageAccount[];
  ledger: any[];
  money: (c: number) => string;
  isAdmin: boolean;
  onOpenSessions?: () => void;
  onRecord: (saleId: string) => void;
  onSetDates: (saleId: string) => void;
}) {
  const done = packages.filter(settled);
  const live = packages.filter((x) => !settled(x));
  const doneLabel = done.length === 1 ? done[0].label : `Packages ${done.map((x) => x.number).join(", ")}`;
  const card = (x: PackageAccount) => (
    <PackageCard key={x.saleId} x={x} ledger={ledger} money={money} isAdmin={isAdmin} onOpenSessions={onOpenSessions} onRecord={onRecord} onSetDates={onSetDates} />
  );
  return (
    <section className="space-y-2" data-billing-packages>
      <h4 className="text-[15px] font-semibold">
        Packages <span className="font-normal text-muted-foreground">· {packages.map((x) => x.number).join(" → ")}</span>
      </h4>
      {done.length > 0 && (
        <Folder title={`${doneLabel} · paid in full`} summary={done.length > 1 ? `${done.length}` : undefined} data-billing-packages-settled>
          {done.map(card)}
        </Folder>
      )}
      {live.map(card)}
    </section>
  );
}

function PackageCard({ x, ledger, money, isAdmin, onOpenSessions, onRecord, onSetDates }: {
  x: PackageAccount;
  ledger: any[];
  money: (c: number) => string;
  isAdmin: boolean;
  onOpenSessions?: () => void;
  onRecord: (saleId: string) => void;
  onSetDates: (saleId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const payments = useMemo(() => salePayments(ledger.filter((l: any) => l.purchase_id === x.saleId)), [ledger, x.saleId]);
  const when = period(x.from, x.to);
  const auto = x.schedule?.how === "auto_pay" || x.schedule?.how === "stripe";
  const s = x.sessions;
  const cov = x.coverage;
  const owing = x.balanceCents > 0 && x.state !== "waiting";
  return (
    <div className="overflow-hidden rounded-xl border border-border" data-billing-package={x.number}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="w-full space-y-2 p-3 text-left">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[15px] font-semibold">
              {x.label}{when ? <span className="font-normal text-muted-foreground"> · {when}</span> : null}
            </span>
            {x.trainingNow && <RoleTag role="training" />}
            {x.payingNow && <RoleTag role="paying" />}
          </div>
          <ChevronDown className={cn("mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {/* The one being trained says so in its tag; its status adds only that it's fully booked. */}
          {!x.trainingNow ? <TrainingStatusText status={x.training} />
            : s.available === 0 && s.booked > 0 ? <TrainingStatusText status="fully_booked" /> : null}
          <PaymentStatusText status={x.payment} auto={auto} />
        </div>

        <div className="space-y-1">
          <div className="flex items-baseline justify-between gap-2 text-[13px]">
            <span className="shrink-0 text-muted-foreground">Sessions</span>
            <span className="min-w-0 text-right tabular-nums">{packageSessionsLine(x)}</span>
          </div>
          {cov ? <CoverageBar cells={cov.cells} /> : <SessionBar completed={s.completed} booked={s.booked} available={s.available} expired={s.expired} />}
        </div>

        <div className="space-y-1">
          <div className="flex items-baseline justify-between gap-2 text-[13px]">
            <span className="text-muted-foreground">Payments</span>
            <span className="tabular-nums">{money(x.paidCents)} of {money(x.totalCents)} paid</span>
          </div>
          <PaymentBar paidCents={x.paidCents} totalCents={x.totalCents} />
        </div>

        {(owing || x.unpaidDeliveredCents > 0) && (
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-[13px] tabular-nums">
            <span>Balance <span className="font-semibold">{money(x.balanceCents)}</span></span>
            {x.unpaidDeliveredCents > 0 && (
              <span className="text-warning" data-package-unpaid-delivered>{money(x.unpaidDeliveredCents)} delivered, not paid for</span>
            )}
          </div>
        )}
      </button>

      {open && (
        <div className="space-y-3 border-t border-border px-3 pb-3 pt-2">
          {cov && (
            <div className="space-y-1.5" data-package-coverage>
              <BarLegend
                items={[
                  ...(cov.covered > 0 ? [{ swatch: "done" as const, text: `${cov.covered} paid for` }] : []),
                  ...(cov.unpaid + (cov.partCents > 0 ? 1 : 0) > 0 ? [{ swatch: "unpaid" as const, text: `${cov.unpaid + (cov.partCents > 0 ? 1 : 0)} delivered, not paid for` }] : []),
                  ...(s.booked > 0 ? [{ swatch: "booked" as const, text: `${s.booked} booked` }] : []),
                  ...(s.available > 0 ? [{ swatch: "open" as const, text: `${s.available} available` }] : []),
                  ...(s.expired > 0 ? [{ swatch: "expired" as const, text: `${s.expired} expired` }] : []),
                ]}
              />
              {cov.partCents > 0 && (
                <p className="text-[12px] text-muted-foreground">One session is part paid for ({money(cov.partCents)} of {money(cov.perSessionCents)}).</p>
              )}
              {cov.aheadCents > 0 && (
                <p className="text-[12px] text-muted-foreground">{money(cov.aheadCents)} paid ahead of the training delivered.</p>
              )}
              <p className="text-[12px] text-muted-foreground">
                Payments go on the package, not a session. This spreads them over its {s.purchased} sessions ({money(cov.perSessionCents)} each) to show how much of the training is paid for.
              </p>
            </div>
          )}
          <p className="text-[13px] text-muted-foreground" data-package-origin>
            {x.renewedFrom
              ? `Renewed from ${x.renewedFrom.number ? `Package ${x.renewedFrom.number}` : "the package before"}${x.boughtOn ? ` on ${payDay(x.boughtOn)}` : ""}`
              : x.boughtOn ? `Bought ${payDay(x.boughtOn)}` : "Bought"}
            {` · ${x.name}`}
          </p>
          <p className={cn("text-[13px]", x.schedule?.how === "none" ? "text-warning" : "text-muted-foreground")}>{planLine(x, money)}</p>
          {x.schedule && x.schedule.installments.length > 0 && (
            <div>
              <div className="text-[13px] font-medium">Payments still to come</div>
              <ul className="divide-y divide-border">
                {x.schedule.installments.map((i) => <InstallmentRow key={i.key} i={i} money={money} inPackage />)}
              </ul>
            </div>
          )}
          <div>
            <div className="text-[13px] font-medium">Payments received</div>
            {payments.length > 0
              ? <PaymentHistory rows={payments} labels={new Map([[x.saleId, x.label]])} money={money} />
              : <p className="py-1 text-[13px] text-muted-foreground">None yet.</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {onOpenSessions && <Button size="sm" variant="outline" className="h-10" onClick={onOpenSessions}>View sessions</Button>}
            {isAdmin && (x.state === "left" || x.state === "past_due") && (
              <Button size="sm" variant="outline" className="h-10" onClick={() => onRecord(x.saleId)}>Record payment</Button>
            )}
            {isAdmin && x.schedule?.canSetDates && (
              <Button size="sm" variant="outline" className="h-10" onClick={() => onSetDates(x.saleId)}><CalendarClock className="mr-1.5 h-4 w-4" /> Set dates</Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Auto-pay in one line: green while it runs, red when it fails, amber when it's ending with money still owed. */
function AutoPayLine({ p, money }: { p: ClientPayments; money: (c: number) => string }) {
  const a = p.autoPay;
  if (!a) {
    const sub = p.recurring.find((r) => r.state === "renews");
    if (sub) return null; // the next payment line already says it's a subscription
    if (p.outstandingCents > 0 && p.balances.every((b) => b.how === "none" || b.how === "manual")) {
      return <p className="text-[13px] text-muted-foreground" data-auto-pay="none">No auto-pay: payments come in by hand.</p>;
    }
    return null;
  }
  const each = `${money(a.cents)}${a.per ? ` every ${a.per}` : ""}`;
  if (a.state === "failing") {
    return <p className="flex items-center gap-2 text-[13px] text-destructive" data-auto-pay="failing"><Dot tone="error" />Auto-pay failed. Stripe retries {each}; ask them to update their card if it keeps failing.</p>;
  }
  if (a.state === "ending") {
    return (
      <p className={cn("flex items-center gap-2 text-[13px]", a.uncoveredCents > 0 ? "text-warning" : "text-muted-foreground")} data-auto-pay="ending">
        <Dot tone={a.uncoveredCents > 0 ? "attention" : "muted"} />
        Auto-pay ({each}) is ending{a.next ? ` ${payDay(a.next)}` : ""}{a.uncoveredCents > 0 ? `, with ${money(a.uncoveredCents)} left that nothing collects` : ""}.
      </p>
    );
  }
  return (
    <p className="flex items-center gap-2 text-[13px] text-muted-foreground" data-auto-pay="on">
      <Dot tone="done" />
      <span>Auto-pay on · {each}{a.lastScheduled ? ` · last scheduled payment ${payDay(a.lastScheduled)}` : ""}</span>
    </p>
  );
}

function Dot({ tone }: { tone: "done" | "error" | "attention" | "muted" }) {
  return <span className={cn("h-2 w-2 shrink-0 rounded-full", tone === "done" && "bg-success", tone === "error" && "bg-destructive", tone === "attention" && "bg-warning", tone === "muted" && "bg-muted-foreground")} aria-hidden />;
}

function AttentionRow({ title, text, action, tone = "attention" }: { title: string; text: string; action?: ReactNode; tone?: "attention" | "neutral" }) {
  return (
    <div className={cn("space-y-2 rounded-xl border p-3", tone === "attention" ? "border-warning/40" : "border-border")}>
      <div className="text-[14px] font-medium">{title}</div>
      <p className="text-[13px] text-muted-foreground">{text}</p>
      {action && <div className="flex flex-wrap gap-2">{action}</div>}
    </div>
  );
}

const STATE_CHIP: Partial<Record<Installment["state"], { text: string; tone: "error" | "attention" | "neutral" }>> = {
  failed: { text: "Failed", tone: "error" },
  overdue: { text: "Overdue", tone: "error" },
  unconfirmed: { text: "Not confirmed", tone: "attention" },
  due_today: { text: "Today", tone: "attention" },
};

function InstallmentRow({ i, money, action, inPackage }: { i: Installment; money: (c: number) => string; action?: ReactNode; inPackage?: boolean }) {
  const chip = STATE_CHIP[i.state];
  return (
    <li className="flex min-h-12 items-center gap-3 py-2" data-installment={i.state}>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-medium tabular-nums">{payDay(i.date)}</div>
        <div className="text-[13px] text-muted-foreground">
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

function Upcoming({ items, money, isAdmin, onRecord }: { items: Installment[]; money: (c: number) => string; isAdmin: boolean; onRecord: (saleId: string) => void }) {
  return (
    <ul className="divide-y divide-border">
      {items.map((i) => (
        <InstallmentRow
          key={i.key}
          i={i}
          money={money}
          action={isAdmin && !i.auto && (i.state === "due_today" || i.state === "unconfirmed") ? <Button size="sm" variant="outline" className="h-9" onClick={() => onRecord(i.saleId)}>Record</Button> : null}
        />
      ))}
    </ul>
  );
}

function PaymentHistory({ rows, labels, money }: { rows: PaymentRow[]; labels: Map<string, string>; money: (c: number) => string }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, 8);
  return (
    <>
      <ul className="divide-y divide-border">
        {shown.map((r) => (
          <li key={r.id} className={cn("flex items-center justify-between gap-3 py-2", r.voided && "text-muted-foreground")} data-payment={r.kind}>
            <div className="min-w-0">
              <div className={cn("text-[14px] font-medium", r.voided && "line-through")}>{payDay(r.date) || "No date"}</div>
              <div className="text-[13px] text-muted-foreground">
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
      {rows.length > 8 && (
        <button type="button" onClick={() => setAll((v) => !v)} className="flex min-h-10 w-full items-center justify-center gap-1 text-[13px] text-muted-foreground">
          {all ? "Show fewer" : `Show all ${rows.length}`}
          <ChevronDown className={cn("h-4 w-4 transition-transform", all && "rotate-180")} />
        </button>
      )}
    </>
  );
}

function Folder({ title, summary, children, ...rest }: { title: string; summary?: string; children: ReactNode } & Record<`data-${string}`, unknown>) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-xl border border-border" {...rest}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex min-h-12 w-full items-center justify-between gap-3 px-3 text-left">
        <span className="text-[15px] font-medium">{title}</span>
        <span className="flex items-center gap-1 text-[13px] text-muted-foreground">
          {summary}
          <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
        </span>
      </button>
      {open && <div className="space-y-2 border-t border-border px-3 pb-2 pt-1">{children}</div>}
    </section>
  );
}

/* ---------------- Set payment dates ---------------- */

const EVERY = ["week", "2 weeks", "month"] as const;

/**
 * When a balance collected by hand is due: the first payment's date and, for
 * a plan, how often after that. Shows the dates before saving. Nothing is
 * charged; Stripe-collected sales keep Stripe's dates (the server refuses).
 */
function SetPaymentDatesDialog({ sale, balance, open, onOpenChange, onDone }: {
  sale: any;
  balance: SaleSchedule | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const fn = useServerFn(setPaymentDates);
  const plan = Number(sale.number_of_payments ?? 0) > 1;
  const [first, setFirst] = useState<string>(String(sale.first_payment_date ?? "").slice(0, 10));
  const per = billingPeriod(sale);
  const [every, setEvery] = useState<(typeof EVERY)[number]>(EVERY.find((e) => e === per) ?? "2 weeks");
  const left = balance?.money.leftCents ?? 0;
  const currency = balance?.money.currency ?? sale.currency ?? "CAD";
  const each = plan ? Math.round(Number(sale.installment_amount ?? 0) * 100 * (1 + (balance?.money.rate ?? 0))) : left;
  const count = plan && each > 0 ? Math.max(1, Math.ceil(left / each)) : 1;
  const made = balance?.money.plan?.made ?? 0;
  const preview = /^\d{4}-\d{2}-\d{2}$/.test(first)
    ? Array.from({ length: count }, (_, k) => addPeriod(plan ? addPeriod(first, every, made) : first, every, k)).slice(0, 12)
    : [];
  const m = useMutation({
    mutationFn: () => fn({ data: { purchase_id: sale.id, first_payment_date: first, every: plan ? every : null } }),
    onSuccess: () => { toast.success("Payment dates set", { description: "Nothing was charged." }); onOpenChange(false); onDone(); },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't set the dates"),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] w-[calc(100vw-2rem)] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Payment dates</DialogTitle>
          <DialogDescription>{balance?.label ?? sale.offer_name}: {formatMoney(left / 100, currency)} left. You collect these; nothing is charged.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="first-payment">{plan ? "First payment" : "Due"}</Label>
            <Input id="first-payment" type="date" className="h-11" value={first} onChange={(e) => setFirst(e.target.value)} />
            {plan && made > 0 && <p className="mt-1 text-[12px] text-muted-foreground">{made} payment{made === 1 ? " is" : "s are"} already in, so the next one is {made} period{made === 1 ? "" : "s"} after this.</p>}
          </div>
          {plan && (
            <div>
              <Label>How often</Label>
              <div className="mt-1 grid grid-cols-3 gap-2">
                {EVERY.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => setEvery(e)}
                    className={cn("h-11 rounded-lg border text-[14px]", every === e ? "border-foreground bg-foreground text-background" : "border-border")}
                  >
                    Every {e}
                  </button>
                ))}
              </div>
            </div>
          )}
          {preview.length > 0 && (
            <div className="rounded-lg bg-muted/50 p-3 text-[13px]">
              <div className="mb-1 text-muted-foreground">{count === 1 ? "Due" : `${count} payments`}</div>
              <div className="tabular-nums">{preview.map((d) => payDay(d)).join(", ")}{count > preview.length ? ", …" : ""}</div>
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="h-11" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="h-11" disabled={!preview.length || m.isPending} onClick={() => m.mutate()}>{m.isPending ? "Saving…" : "Save dates"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
