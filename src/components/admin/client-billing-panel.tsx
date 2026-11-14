/**
 * A client's Billing tab: money, read in the order a coach needs it.
 *
 *  1. The glance (package-snapshot.tsx): the package they're training on and
 *     the one being paid off, the same block as the Summary and Sessions tabs.
 *  2. What's owed: one number, outstanding, split by when it's due (overdue,
 *     due now, scheduled, no dates yet) in one bar; then, kept apart because
 *     it's not a due date, the training already delivered that payments
 *     haven't covered, with how it's worked out one tap away.
 *  3. Payment plans: each way money comes in and which packages it pays, in
 *     order, with the real dates (one auto-pay pays one package at a time).
 *  4. What needs the coach (a balance with no dates, training not billed).
 *  5. The packages (package-list.tsx), then links out and payment history.
 *
 * Everything reads payment-schedule.ts (useClientPayments), so the tabs never
 * disagree. Amounts are in the dollars the client pays. Nothing here charges
 * anyone.
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
import { CardHeader } from "@/components/nutrition/nutrition-ui";
import { RecordPaymentDialog } from "@/components/admin/sale-payment-dialogs";
import { TermDateEditor } from "@/components/purchase-records-panel";
import { useClientPayments } from "@/components/billing/use-client-payments";
import { ClientPackageSnapshot } from "@/components/billing/package-snapshot";
import { InstallmentRow, PackageList, PaymentHistory, payDay } from "@/components/billing/package-list";
import { renewSessionPackage, setPaymentDates } from "@/lib/billing.functions";
import { useAuth } from "@/lib/auth";
import { formatMoney } from "@/lib/payment-display";
import { billingPeriod, salePayments } from "@/lib/sale-money";
import { addPeriod } from "@/lib/session-packages";
import { paymentPlans, type PaymentPlan } from "@/lib/package-view";
import { saleLabels, type ClientPayments, type SaleSchedule } from "@/lib/payment-schedule";
import { cn } from "@/lib/utils";

export { payDay };

export function ClientBillingPanel({ clientId, onOpenSessions }: { clientId: string; onOpenSessions?: () => void }) {
  const qc = useQueryClient();
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const { data, payments, isLoading, isError, refetch, isFetching } = useClientPayments(clientId);
  const [recording, setRecording] = useState<string | null>(null);
  const [dating, setDating] = useState<string | null>(null);
  const [termOf, setTermOf] = useState<string | null>(null);

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
  const termSale = saleOf(termOf);

  return (
    <Card className="space-y-4 border-border bg-card p-3 md:col-span-3 md:p-6" data-billing-overview>
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
        <>
          {payments.packages.length > 0 && <ClientPackageSnapshot clientId={clientId} onOpenSessions={onOpenSessions} money={false} />}
          <BillingOverview
            p={payments}
            ledger={data.ledger ?? []}
            labels={saleLabels(sales)}
            isAdmin={isAdmin}
            clientId={clientId}
            renewing={renew.isPending}
            onOpenSessions={onOpenSessions}
            onRecord={setRecording}
            onSetDates={setDating}
            onEditDates={setTermOf}
            onRenew={(id) => renew.mutate(id)}
          />
        </>
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
      {termSale && <TermDateEditor purchase={termSale} clientId={clientId} onClose={() => { setTermOf(null); invalidate(); }} />}
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
 * The overview under the glance. Pure view over the payments model, so it can
 * be checked with fixture data (Marc's real records are the reference).
 */
export function BillingOverview({ p, ledger, labels, isAdmin, clientId, renewing, onOpenSessions, onRecord, onSetDates, onEditDates, onRenew }: {
  p: ClientPayments;
  ledger: any[];
  labels: Map<string, string>;
  isAdmin: boolean;
  clientId?: string;
  renewing?: boolean;
  onOpenSessions?: () => void;
  onRecord: (saleId: string) => void;
  onSetDates: (saleId: string) => void;
  onEditDates?: (saleId: string) => void;
  onRenew: (fromSaleId: string) => void;
}) {
  const money = (c: number) => formatMoney(c / 100, p.currency);
  const history = useMemo(() => salePayments(ledger), [ledger]);
  const needsDates = p.balances.filter((b) => b.how === "none");
  const ended = p.recurring.filter((r) => r.state === "cancelling");
  const plans = useMemo(() => paymentPlans(p.balances), [p.balances]);
  const dueAuto = p.upcoming.some((i) => (i.state === "due_today" || i.state === "unconfirmed") && i.auto);
  const somethingOwed = p.outstandingCents > 0 || p.unpaidDeliveredCents > 0;

  return (
    <>
      {somethingOwed ? (
        <OwedSection p={p} money={money} dueAuto={dueAuto} />
      ) : (
        <section className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-3" data-billing-totals>
          <span className="text-[15px] font-semibold">{p.paidCents > 0 ? "Paid up" : "Nothing billed yet"}</span>
          {p.paidCents > 0 && <span className="text-[13px] tabular-nums text-muted-foreground">Paid so far <span className="font-semibold text-foreground" data-paid>{money(p.paidCents)}</span></span>}
        </section>
      )}

      {p.overdue.length > 0 && (
        <section className="space-y-1 rounded-xl border border-destructive/40 p-3" data-billing-overdue>
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

      {plans.length > 0 && <PaymentPlans plans={plans} p={p} money={money} isAdmin={isAdmin} onRecord={onRecord} />}

      {(p.notBilled || needsDates.length > 0 || ended.length > 0) ? (
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
        <PackageList
          packages={p.packages}
          ledger={ledger}
          money={money}
          mode="billing"
          isAdmin={isAdmin}
          clientId={clientId}
          onOpenSessions={onOpenSessions}
          onRecord={onRecord}
          onSetDates={onSetDates}
          onEditDates={onEditDates}
        />
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
    </>
  );
}

/**
 * What's owed, one number first: outstanding, and a bar of when it's due.
 * Training delivered and not paid for sits apart under it: it's the value of
 * sessions already done, never a payment that's due (it's paid as the plan's
 * dates come), so it never adds to the outstanding.
 */
function OwedSection({ p, money, dueAuto }: { p: ClientPayments; money: (c: number) => string; dueAuto: boolean }) {
  const [how, setHow] = useState(false);
  const parts = [
    { key: "overdue", label: "Overdue", cents: p.overdueCents, bar: "bg-destructive", text: "text-destructive" },
    { key: "due", label: dueAuto ? "Due now · auto-pay" : "Due now", cents: p.dueNowCents, bar: "bg-warning", text: dueAuto ? "" : "text-warning" },
    { key: "scheduled", label: "Scheduled", cents: p.scheduledCents, bar: "bg-foreground/35", text: "" },
    { key: "undated", label: "No dates yet", cents: p.unscheduledCents, bar: "bg-warning/50", text: "text-warning" },
  ];
  const shown = parts.filter((x) => x.cents > 0 || x.key === "overdue" || x.key === "due");
  const total = Math.max(1, p.outstandingCents);
  const unpaid = p.packages.filter((x) => x.unpaidDeliveredCents > 0);
  return (
    <section className="space-y-3 rounded-xl border border-border p-3" data-billing-totals>
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-[13px] text-muted-foreground">Outstanding</div>
          <div className={cn("text-[26px] font-semibold leading-tight tabular-nums", p.overdueCents > 0 && "text-destructive")} data-outstanding>{money(p.outstandingCents)}</div>
        </div>
        <div className="text-right text-[12px] text-muted-foreground">
          <div>Paid so far <span className="font-semibold tabular-nums text-foreground" data-paid>{money(p.paidCents)}</span></div>
          <div>{p.taxIncluded ? "Tax included" : "Before tax (no tax on file yet)"}</div>
        </div>
      </div>

      {p.outstandingCents > 0 && (
        <div className="space-y-2" data-billing-split>
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-border" role="img" aria-label={shown.map((x) => `${x.label} ${money(x.cents)}`).join(", ")}>
            {parts.filter((x) => x.cents > 0).map((x) => (
              <span key={x.key} className={cn("h-full border-l-2 border-card first:border-l-0", x.bar)} style={{ width: `${(x.cents / total) * 100}%` }} />
            ))}
          </div>
          <dl className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
            {shown.map((x) => (
              <div key={x.key} className="flex items-center gap-1.5 whitespace-nowrap" data-split={x.label}>
                <dt className="flex items-center gap-1.5 text-muted-foreground">
                  <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", x.cents > 0 ? x.bar : "bg-border")} />
                  {x.label}
                </dt>
                <dd className={cn("font-semibold tabular-nums", x.cents > 0 ? x.text : "text-muted-foreground")}>{money(x.cents)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {p.unpaidDeliveredCents > 0 && (
        <div className="space-y-2 border-t border-border pt-3" data-unpaid-delivered>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[14px] font-medium">
                <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-warning" />
                Unpaid training delivered
              </div>
              <p className="text-[12px] text-muted-foreground">Sessions already done that payments haven't covered yet. Not a payment that's due: it's paid as the plan's dates come.</p>
            </div>
            <div className="shrink-0 text-[15px] font-semibold tabular-nums">{money(p.unpaidDeliveredCents)}</div>
          </div>
          <button type="button" aria-expanded={how} onClick={() => setHow((v) => !v)} className="flex min-h-9 items-center gap-1 text-[13px] text-muted-foreground">
            How it's worked out<ChevronDown className={cn("h-4 w-4 transition-transform", how && "rotate-180")} />
          </button>
          {how && (
            <ul className="space-y-1 rounded-lg bg-muted/50 p-2.5 text-[13px] tabular-nums" data-unpaid-how>
              {unpaid.map((x) => {
                const done = Math.min(x.sessions.completed, x.sessions.purchased);
                const each = x.coverage?.perSessionCents ?? 0;
                return (
                  <li key={x.saleId} className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 text-muted-foreground">
                      <span className="text-foreground">{x.label}</span> · {done} done × {money(each)}{x.paidCents > 0 ? ` − ${money(x.paidCents)} paid` : ""}
                    </span>
                    <span className="shrink-0 font-semibold">{money(x.unpaidDeliveredCents)}</span>
                  </li>
                );
              })}
              {p.notBilledDeliveredCents > 0 && (
                <li className="flex items-baseline justify-between gap-3">
                  <span className="text-muted-foreground">Past the last package, not billed yet</span>
                  <span className="shrink-0 font-semibold">{money(p.notBilledDeliveredCents)}</span>
                </li>
              )}
              <li className="pt-1 text-[12px] text-muted-foreground">A package's price is split evenly over the sessions it sold; booked sessions aren't counted until they're done.</li>
            </ul>
          )}
        </div>
      )}

      <AutoPayLine p={p} money={money} />
    </section>
  );
}

/** Each way money comes in, and which packages it pays, in order, on the real dates. */
function PaymentPlans({ plans, p, money, isAdmin, onRecord }: {
  plans: PaymentPlan[];
  p: ClientPayments;
  money: (c: number) => string;
  isAdmin: boolean;
  onRecord: (saleId: string) => void;
}) {
  const [dates, setDates] = useState(false);
  const per = p.autoPay?.per ?? null;
  return (
    <section className="space-y-2" data-payment-plans>
      <h4 className="px-0.5 text-[15px] font-semibold">{plans.length === 1 ? "Payment plan" : "Payment plans"}</h4>
      {plans.map((plan) => (
        <div key={plan.key} className={cn("rounded-xl border p-3", plan.late ? "border-destructive/40" : "border-border")} data-payment-plan={plan.how}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="text-[14px] font-semibold">
              {plan.how === "auto_pay" ? "Auto-pay" : plan.how === "stripe" ? "Stripe plan" : "Collected by you"}
              <span className="font-normal text-muted-foreground"> · {money(plan.eachCents)}{plan.how === "auto_pay" && per ? ` every ${per}` : " a payment"}</span>
            </span>
            {plan.ends && <span className="text-[13px] text-muted-foreground">Ends {payDay(plan.ends)}</span>}
          </div>
          <ol className="mt-2 space-y-1.5">
            {plan.steps.map((st, i) => (
              <li key={st.saleId} className="flex items-center gap-2.5" data-plan-step={st.label}>
                <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold", i === 0 ? "bg-foreground text-background" : "bg-muted text-muted-foreground")}>{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[14px]">{st.label}<span className="text-muted-foreground"> · {st.payments} payment{st.payments === 1 ? "" : "s"}</span></div>
                  <div className="text-[12px] text-muted-foreground">{st.payments > 1 ? `${payDay(st.first)} – ${payDay(st.last)}` : payDay(st.first)}</div>
                </div>
                <span className="shrink-0 text-[14px] font-semibold tabular-nums">{money(st.cents)}</span>
              </li>
            ))}
          </ol>
          {plan.how === "auto_pay" && plan.steps.length > 1 && (
            <p className="mt-2 text-[12px] text-muted-foreground">Auto-pay finishes paying one package before it starts the next.</p>
          )}
        </div>
      ))}
      {p.upcoming.length > 0 && (
        <div>
          <button type="button" aria-expanded={dates} onClick={() => setDates((v) => !v)} className="flex min-h-9 items-center gap-1 px-0.5 text-[13px] text-muted-foreground" data-billing-upcoming>
            Every payment date ({p.upcoming.length})<ChevronDown className={cn("h-4 w-4 transition-transform", dates && "rotate-180")} />
          </button>
          {dates && (
            <ul className="divide-y divide-border rounded-xl border border-border px-3">
              {p.upcoming.map((i) => (
                <InstallmentRow
                  key={i.key}
                  i={i}
                  money={money}
                  action={isAdmin && !i.auto && (i.state === "due_today" || i.state === "unconfirmed") ? <Button size="sm" variant="outline" className="h-9" onClick={() => onRecord(i.saleId)}>Record</Button> : null}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/** Auto-pay only when it's news: red when it fails, amber when it's ending with money still owed. */
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
  // Running as planned: the payment plan card says it (each payment, what it pays, when it ends).
  return null;
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
