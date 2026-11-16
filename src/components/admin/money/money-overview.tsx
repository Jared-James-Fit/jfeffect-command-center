/**
 * Overview: the business's money in one read, for the period picked. Made,
 * spent, kept, owed and what taxes need, each against the comparison
 * period; the months around it; where the money came from and went.
 */
import { Link } from "@tanstack/react-router";
import { AlertTriangle, CalendarClock, CheckCircle2, ChevronRight, Info, Landmark, Repeat, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { changeOf, monthlySeries, recurringExpenses } from "@/lib/books/money-view";
import { bookedIn } from "@/lib/books/receivables";
import { chartMonths, elapsed, monthPeriod } from "@/lib/books/period";
import { billingDay } from "@/lib/date-range";
import { MoneyChart } from "./money-chart";
import { useMoney } from "./money-context";
import { Line, MoneyCard, RankList, Stat, money, pctWord, shortMoney } from "./money-ui";

export function MoneyOverview() {
  const m = useMoney();
  const { figures: f, prev, vs, period, today, snapshot: s, receivables: r, settings } = m;
  const vsLabel = vs?.label ?? null;
  const months = chartMonths(period, today);
  const points = monthlySeries({ revenue: m.revenue, expenses: m.expenses, settings, months });
  const seen = elapsed(period, today);
  const inPeriod = (ym: string) => ym >= seen.start.slice(0, 7) && ym <= seen.end.slice(0, 7);
  const sold = bookedIn(r, seen);
  const years = seen.start.slice(0, 4) === seen.end.slice(0, 4) ? seen.end.slice(0, 4) : `${seen.start.slice(0, 4)} and ${seen.end.slice(0, 4)}`;
  const gstReg = settings.gstRegistered;
  const recurring = recurringExpenses(m.data.expenses, today);

  return (
    <div className="space-y-4" data-money-overview>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          testId="sales"
          label="Sales"
          value={money(f.sales.netMinor)}
          change={changeOf(f.sales.netMinor, prev?.sales.netMinor)}
          good="up"
          vs={vsLabel}
          sub={`${money(f.sales.collectedMinor)} came in${gstReg ? " with GST" : ""}${f.sales.refundsMinor ? ` · ${money(f.sales.refundsMinor)} refunded` : ""}`}
          definition={<>Payments received in this period, less refunds, with GST/HST taken out: what the business earned. Counted the day the money came in.</>}
          onClick={() => m.go("transactions", { type: "in" })}
        />
        <Stat
          testId="spent"
          label="Spent"
          value={money(f.spent.minor)}
          change={changeOf(f.spent.minor, prev?.spent.minor)}
          good="none"
          vs={vsLabel}
          sub={f.spent.count ? `${f.spent.count} expense${f.spent.count === 1 ? "" : "s"}${f.spent.personalMinor ? ` · ${money(f.spent.personalMinor)} personal left out` : ""}` : "Nothing recorded"}
          definition={<>Business expenses paid in this period: the business-use share, before the GST/HST you claim back, with personal spending left out. Equipment counts when it's paid for.</>}
          onClick={() => m.go("transactions", { type: "out" })}
        />
        <Stat
          testId="profit"
          label="Profit"
          value={money(f.profitMinor)}
          tone={f.profitMinor < 0 ? "warn" : undefined}
          change={changeOf(f.profitMinor, prev?.profitMinor)}
          good="up"
          vs={vsLabel}
          sub={f.margin != null ? `${pctWord(f.margin)} of sales kept` : undefined}
          definition={<>Sales minus what was spent, before income tax. Taxable profit is worked out differently (meals are half deductible, equipment is claimed over years); it's under Taxes.</>}
        />
        <Stat
          testId="owed"
          label="Owed to you"
          value={r ? money(r.outstandingCents) : m.receivablesError ? "—" : "…"}
          tone={r && r.overdueCents > 0 ? "bad" : undefined}
          sub={
            r
              ? r.overdueCents > 0
                ? `${money(r.overdueCents)} overdue`
                : r.outstandingCents > 0
                  ? "Nothing overdue"
                  : "All paid up"
              : m.receivablesError ?? "Reading balances"
          }
          definition={<>What clients owe right now, with GST, read from each client's Billing tab. Balances on a payment schedule aren't overdue; payment links nobody has paid aren't counted. Not tied to the period.</>}
          onClick={() => document.getElementById("money-owed")?.scrollIntoView({ behavior: "smooth", block: "start" })}
        />
      </div>

      <MoneyCard title="Taxes for this period" icon={Landmark} action={<Button variant="ghost" size="sm" className="h-8" onClick={() => m.go("taxes")}>Taxes <ChevronRight className="ml-0.5 h-4 w-4" /></Button>}>
        <div className="grid gap-x-6 sm:grid-cols-2" data-money-taxes-strip>
          {gstReg ? (
            <div>
              <Line label="GST/HST collected" value={money(f.gst.collectedMinor)} muted />
              <Line label="Less GST/HST you paid on expenses" value={f.gst.itcMinor ? `−${money(f.gst.itcMinor)}` : money(0)} muted />
              <Line
                label={f.gst.netMinor >= 0 ? "GST/HST to pay CRA" : "GST/HST coming back"}
                value={money(Math.abs(f.gst.netMinor))}
                strong
                sub="Set aside: it isn't the business's money."
              />
            </div>
          ) : (
            <p className="py-1.5 text-[14px] text-muted-foreground">Not registered for GST/HST (Taxes → Settings).</p>
          )}
          <div className="border-t border-border pt-2 sm:border-t-0 sm:pt-0">
            <Line label="Taxable profit (estimate)" value={money(f.taxableProfitMinor)} muted />
            <Line
              label="Income tax + CPP to put aside"
              value={`~${money(m.reserve.minor)}`}
              strong
              sub={`What this period's profit adds to the ${years} estimate, after the basic personal amount. Not a bill.`}
            />
          </div>
        </div>
      </MoneyCard>

      <MoneyCard title="Month by month">
        <MoneyChart points={points} inPeriod={inPeriod} onPickMonth={(ym) => m.setPeriod(monthPeriod(ym, today))} />
        <p className="mt-2 text-[12px] text-muted-foreground">
          {months.length >= 12 && period.unit !== "year" ? "The year around this period. " : ""}Tap a month to open it. Before GST/HST.
        </p>
      </MoneyCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <MoneyCard title="Where sales came from">
          <RankList
            rows={f.byService.map((b) => ({ key: b.key, label: b.label, minor: b.minor, sub: `${b.count} payment${b.count === 1 ? "" : "s"}` }))}
            color="var(--money-in)"
            empty="No sales in this period."
            total={f.sales.netMinor}
            onPick={(key) => m.go("transactions", { type: "in", group: key })}
          />
          {f.byClient.length ? (
            <div className="mt-4 border-t border-border pt-3">
              <div className="mb-2 flex items-center gap-1.5 text-[13px] text-muted-foreground"><Users className="h-3.5 w-3.5" /> Top clients</div>
              <ul className="space-y-1.5">
                {f.byClient.slice(0, 3).map((c) => (
                  <li key={c.key} className="flex justify-between gap-3 text-[14px]"><span className="truncate">{c.label}</span><span className="tabular-nums">{money(c.minor)}</span></li>
                ))}
              </ul>
            </div>
          ) : null}
          {sold.rows.length ? (
            <p className="mt-3 border-t border-border pt-3 text-[13px] text-muted-foreground" data-money-sold>
              Sold in this period: <span className="font-medium text-foreground">{money(sold.minor)}</span> before GST in {sold.rows.length} package{sold.rows.length === 1 ? "" : "s"} or plan{sold.rows.length === 1 ? "" : "s"}, paid or still being paid. Counted in Sales as the money comes in.
            </p>
          ) : null}
        </MoneyCard>

        <MoneyCard title="Where money went">
          <RankList
            rows={f.byCategory.map((c) => ({ key: c.key, label: c.label, minor: c.minor, sub: `${c.count}` }))}
            color="var(--money-out)"
            empty="Nothing spent in this period."
            total={f.spent.minor}
            onPick={(key) => m.go("transactions", { type: "out", group: key })}
          />
          {recurring.length ? (
            <div className="mt-4 border-t border-border pt-3" data-money-recurring>
              <div className="mb-2 flex items-center gap-1.5 text-[13px] text-muted-foreground"><Repeat className="h-3.5 w-3.5" /> Every month</div>
              <ul className="space-y-1.5">
                {recurring.slice(0, 4).map((x) => (
                  <li key={x.key} className="flex justify-between gap-3 text-[14px]">
                    <span className="min-w-0 truncate">{x.vendor} <span className="text-[12px] text-muted-foreground">· {x.category}</span></span>
                    <span className="shrink-0 tabular-nums">{money(x.minor)}<span className="text-[12px] text-muted-foreground">/mo</span></span>
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-[12px] text-muted-foreground">About {money(recurring.reduce((t, x) => t + x.yearlyMinor, 0))} a year at this pace.</p>
            </div>
          ) : null}
        </MoneyCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <OwedCard />
        <ToDoCard />
      </div>
    </div>
  );
}

function OwedCard() {
  const m = useMoney();
  const r = m.receivables;
  const owner = m.mode === "owner";
  return (
    <MoneyCard title="Owed to you" id="money-owed">
      {!r ? (
        <p className="text-[14px] text-muted-foreground">{m.receivablesError ?? "Reading every client's balance…"}</p>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-muted/50 p-2.5">
              <div className={cn("text-[16px] font-semibold tabular-nums", r.overdueCents > 0 && "text-destructive")}>{shortMoney(r.overdueCents)}</div>
              <div className="text-[12px] text-muted-foreground">Overdue</div>
            </div>
            <div className="rounded-xl bg-muted/50 p-2.5">
              <div className="text-[16px] font-semibold tabular-nums">{shortMoney(r.expected30Cents)}</div>
              <div className="text-[12px] text-muted-foreground">Next 30 days</div>
            </div>
            <div className="rounded-xl bg-muted/50 p-2.5">
              <div className={cn("text-[16px] font-semibold tabular-nums", r.unscheduledCents > 0 && "text-warning")}>{shortMoney(r.unscheduledCents)}</div>
              <div className="text-[12px] text-muted-foreground">No dates</div>
            </div>
          </div>
          {r.lines.length ? (
            <ul className="divide-y divide-border" data-money-owed-lines>
              {r.lines.slice(0, 6).map((l) => {
                const body = (
                  <>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-medium">{l.client}</div>
                      <div className="truncate text-[12px] text-muted-foreground">
                        {l.label}
                        {l.overdueSince ? ` · overdue since ${billingDay(l.overdueSince)}` : l.next ? ` · next ${money(l.next.cents)} ${billingDay(l.next.date)}` : l.unscheduledCents ? " · no payment dates" : ""}
                        {l.how === "auto_pay" ? " · auto-pay" : ""}
                      </div>
                    </div>
                    <div className={cn("shrink-0 text-[14px] font-semibold tabular-nums", l.overdueCents > 0 && "text-destructive")}>{money(l.outstandingCents)}</div>
                    {owner ? <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" /> : null}
                  </>
                );
                return (
                  <li key={l.saleId}>
                    {owner ? (
                      <Link to="/admin/clients/$id" params={{ id: l.clientId }} search={{ tab: "billing" } as any} className="flex items-center gap-3 py-2.5 hover:bg-muted/30">{body}</Link>
                    ) : (
                      <div className="flex items-center gap-3 py-2.5">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="flex items-center gap-2 text-[14px] text-muted-foreground"><CheckCircle2 className="h-4 w-4 text-success" /> No client owes anything right now.</p>
          )}
          {r.waiting.length ? (
            <p className="text-[12px] text-muted-foreground" data-money-waiting>
              Not counted: {r.waiting.length} payment link{r.waiting.length === 1 ? "" : "s"} nobody has paid yet ({money(r.waitingCents)}){r.waiting.length <= 2 ? `: ${r.waiting.map((w) => w.client).join(", ")}` : ""}. They're owed once paid or started.
            </p>
          ) : null}
        </div>
      )}
    </MoneyCard>
  );
}

const ISSUE_TO: Record<string, { attention?: boolean; type?: "in" | "out"; flagNote?: string }> = {
  "needs-review": { type: "out", attention: true },
  uncategorized: { type: "out", attention: true },
  "no-receipt": { type: "out", attention: true },
  "zero-tax-revenue": { type: "in", attention: true },
  "foreign-currency": { attention: true },
};

function ToDoCard() {
  const m = useMoney();
  const s = m.snapshot;
  const upcoming = s.deadlines.filter((d) => d.date >= m.today).slice(0, 3);
  const issues = s.issues.filter((i) => i.severity === "warn" || i.id === "gst-number");
  return (
    <MoneyCard title="To keep the books right" icon={AlertTriangle}>
      {issues.length ? (
        <ul className="space-y-2.5" data-money-issues>
          {issues.map((i) => {
            const to = ISSUE_TO[i.id];
            return (
              <li key={i.id} className="flex items-start gap-2.5">
                {i.severity === "warn" ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" /> : <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-medium">{i.title}</div>
                  <p className="text-[12px] text-muted-foreground">{i.detail}</p>
                </div>
                {to ? (
                  <Button size="sm" variant="outline" className="h-9 shrink-0" onClick={() => m.go("transactions", { type: to.type ?? "all", attention: true })}>Review</Button>
                ) : i.id === "gst-number" ? (
                  <Button size="sm" variant="outline" className="h-9 shrink-0" onClick={() => m.go("taxes")}>Add</Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="flex items-center gap-2 text-[14px] text-muted-foreground"><CheckCircle2 className="h-4 w-4 text-success" /> Nothing to fix for {s.year}.</p>
      )}
      {upcoming.length ? (
        <div className="mt-4 border-t border-border pt-3">
          <div className="mb-2 flex items-center gap-1.5 text-[13px] text-muted-foreground"><CalendarClock className="h-3.5 w-3.5" /> Coming up</div>
          <ul className="space-y-1.5">
            {upcoming.map((d, i) => (
              <li key={i} className="flex justify-between gap-3 text-[14px]">
                <span className="min-w-0 truncate">{d.title}</span>
                <span className="shrink-0 text-[13px] tabular-nums text-muted-foreground">{billingDay(d.date)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </MoneyCard>
  );
}

