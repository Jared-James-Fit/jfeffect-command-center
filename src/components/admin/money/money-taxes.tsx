/**
 * Taxes: GST/HST and income tax kept apart from each other and from the
 * business's profit. GST/HST is real money owed (or coming back), from what
 * was recorded on payments and receipts, by the regular method, on the
 * filing periods the business is registered for. Income tax + CPP is always
 * an estimate to set money aside with, never a bill. Anything the books
 * can't settle is flagged for the accountant instead of being guessed.
 */
import { useState } from "react";
import { AlertTriangle, CalendarClock, Landmark, Plus, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { expenseCategory } from "@/lib/business-expense-categories";
import { billingDay, billingRange } from "@/lib/date-range";
import { elapsed } from "@/lib/books/period";
import { useMoney } from "./money-context";
import { Line, MoneyCard, money, pctWord } from "./money-ui";
import { PaymentsList, TaxPaymentDialog, TaxSettings } from "./books-pieces";

export function MoneyTaxes() {
  const m = useMoney();
  const s = m.snapshot;
  const f = m.figures;
  const [paying, setPaying] = useState<"gst_hst" | "income_tax" | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const reg = s.settings.gstRegistered;
  const corp = s.settings.businessStructure === "corporation";
  const thisYear = Number(m.today.slice(0, 4));
  const seen = elapsed(m.period, m.today);
  const crossesYears = seen.start.slice(0, 4) !== seen.end.slice(0, 4);
  const capital = m.data.expenses.filter((e) => e.expense_date.startsWith(String(s.year)) && expenseCategory(e.category).kind === "capital");
  const flags = s.issues.filter((i) => ["rates", "zero-tax-revenue", "refund-tax-estimated", "membership-no-tax", "foreign-currency", "gst-number", "no-receipt"].includes(i.id));
  const notMb = s.settings.province !== "MB";

  return (
    <div className="space-y-4" data-money-taxes>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] text-muted-foreground">
          GST/HST for {m.period.label}; income tax for the {s.year} tax year{crossesYears ? ` (the year this period ends in)` : ""}.
        </p>
        <Button variant="outline" size="sm" className="h-9 shrink-0" onClick={() => setSettingsOpen(true)}><Settings2 className="mr-1.5 h-4 w-4" /> Settings</Button>
      </div>

      {reg ? (
        <MoneyCard title="GST/HST" icon={Landmark}>
          <div className="grid gap-x-8 lg:grid-cols-2">
            <div data-taxes-gst-period>
              <div className="mb-1 text-[13px] text-muted-foreground">{m.period.label}</div>
              <Line label="Collected on sales (line 103)" value={money(f.gst.collectedMinor)} />
              <Line label="Paid on expenses, claimed back (line 106)" value={f.gst.itcMinor ? `−${money(f.gst.itcMinor)}` : money(0)} />
              <Line
                strong
                label={f.gst.netMinor >= 0 ? "Net GST/HST to pay (line 109)" : "Net GST/HST refund (line 109)"}
                value={money(Math.abs(f.gst.netMinor))}
              />
              <p className="mt-1 text-[12px] text-muted-foreground">
                Regular method: the GST/HST charged on what was paid in this period, less the input tax credits on receipts dated in it. Sales before GST/HST: {money(f.sales.netMinor)} (line 101).
              </p>
            </div>
            <div className="mt-4 border-t border-border pt-3 lg:mt-0 lg:border-t-0 lg:pt-0">
              <div className="mb-1 text-[13px] text-muted-foreground">{s.year}, filed {s.gst.frequency === "annual" ? "once a year" : s.gst.frequency}</div>
              <ul className="divide-y divide-border">
                {s.gst.periods.map((p) => (
                  <li key={p.key} className="flex items-baseline justify-between gap-3 py-2 text-[14px]">
                    <span className="min-w-0">
                      {s.gst.frequency === "annual" ? billingRange(p.start, p.end, { thisYear }) : p.label}
                      <span className="block text-[12px] text-muted-foreground">
                        {p.closed ? "Closed" : "Still open"} · {p.filingDue === p.paymentDue ? `due ${billingDay(p.filingDue, { thisYear })}` : `pay by ${billingDay(p.paymentDue, { thisYear })}, file by ${billingDay(p.filingDue, { thisYear })}`}
                      </span>
                    </span>
                    <span className="shrink-0 tabular-nums font-medium">{money(p.netTaxMinor)}</span>
                  </li>
                ))}
              </ul>
              <Line label={`Paid to CRA for ${s.year}`} value={s.gst.paidMinor ? `−${money(s.gst.paidMinor)}` : money(0)} muted />
              <Line strong label={s.gst.owingMinor >= 0 ? "Still to pay" : "Overpaid"} value={money(Math.abs(s.gst.owingMinor))} />
              <div className="mt-2">
                <PaymentsList payments={m.data.taxPayments} year={s.year} kind="gst_hst" onChanged={m.refresh} />
                <Button variant="outline" size="sm" className="mt-2 h-9" onClick={() => setPaying("gst_hst")}><Plus className="mr-1 h-4 w-4" /> Record a GST/HST payment</Button>
              </div>
            </div>
          </div>
        </MoneyCard>
      ) : (
        <MoneyCard title="GST/HST" icon={Landmark}>
          <p className="text-[14px] text-muted-foreground">The books say the business isn't registered for GST/HST, so none is counted. If you charge GST, turn it on in Settings.</p>
        </MoneyCard>
      )}

      <MoneyCard title={corp ? "Corporate tax (estimate)" : "Income tax + CPP (estimate)"}>
        <div className="grid gap-x-8 lg:grid-cols-2">
          <div>
            <div className="mb-1 text-[13px] text-muted-foreground">{s.year}</div>
            <Line label="Taxable profit so far" value={money(s.incomeTax.ytd.netBusinessIncomeMinor)} />
            {!corp ? <Line label="CPP (both halves)" value={money(s.incomeTax.ytd.cpp.totalMinor)} muted /> : null}
            {!corp ? <Line label="Income tax (federal + Manitoba)" value={money(s.incomeTax.ytd.incomeTaxOnBusinessMinor)} muted /> : null}
            <Line label="Already paid" value={s.incomeTax.paidMinor ? `−${money(s.incomeTax.paidMinor)}` : money(0)} muted />
            <Line strong label="Put aside now" value={money(Math.max(0, s.incomeTax.owingNowMinor))} />
            {s.inProgress ? (
              <Line label={`If the pace holds, by Dec 31`} value={money(Math.max(0, s.incomeTax.owingProjectedMinor))} muted sub={s.projection.basis} />
            ) : null}
          </div>
          <div className="mt-4 border-t border-border pt-3 lg:mt-0 lg:border-t-0 lg:pt-0">
            <div className="mb-1 text-[13px] text-muted-foreground">From {m.period.label}</div>
            <Line label="Taxable profit" value={money(f.taxableProfitMinor)} />
            <Line strong label="Put aside from this period" value={`~${money(m.reserve.minor)}`} sub="What this period's profit adds to the year's estimate. Add up a year's periods and you get its total." />
            {!corp ? (
              <p className="mt-1 text-[12px] text-muted-foreground">
                Your next dollar of profit is taxed about {pctWord(s.incomeTax.projected.marginalRate)} (income tax + CPP, {s.incomeTax.ytd.ratesYear} rates{s.incomeTax.ytd.ratesExact ? "" : ", the latest on file"}). Of every $100 of coaching you sell from here, put aside {reg ? "the $5 GST and " : ""}about ${Math.round(s.setAsideRate * 100)} for tax.
              </p>
            ) : null}
            <div className="mt-2">
              <PaymentsList payments={m.data.taxPayments} year={s.year} kind="income_tax" onChanged={m.refresh} />
              <Button variant="outline" size="sm" className="mt-2 h-9" onClick={() => setPaying("income_tax")}><Plus className="mr-1 h-4 w-4" /> Record an income tax payment</Button>
            </div>
          </div>
        </div>
        <p className={cn("mt-3 rounded-xl p-3 text-[12px]", notMb ? "bg-warning/15" : "bg-muted/50 text-muted-foreground")}>
          {notMb ? `Estimates use Manitoba rates, but the books say ${s.settings.province}. Ask your accountant before setting money aside from them. ` : ""}
          Estimates for setting money aside, from {s.incomeTax.ytd.ratesYear} federal and Manitoba rates{s.settings.otherIncomeAnnualMinor ? ` on top of ${money(s.settings.otherIncomeAnnualMinor)} other income` : ""}. Your accountant files the real numbers.
        </p>
      </MoneyCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <MoneyCard title={`T2125 summary, ${s.year}`}>
          <ul className="divide-y divide-border" data-taxes-t2125>
            {s.t2125.map((l) => (
              <li key={l.line} className={cn("flex items-baseline gap-3 py-1.5 text-[14px]", l.line === "9369" && "font-semibold")}>
                <span className="w-11 shrink-0 text-[12px] tabular-nums text-muted-foreground">{l.line}</span>
                <span className="min-w-0 flex-1">{l.label}</span>
                <span className="shrink-0 tabular-nums">{money(l.amountMinor)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[12px] text-muted-foreground">The lines your accountant enters, GST/HST excluded, counted when paid. Prepaid coaching that runs into next year may be moved to that year by your accountant.</p>
        </MoneyCard>

        <MoneyCard title="Equipment (capital cost allowance)">
          {capital.length ? (
            <ul className="divide-y divide-border">
              {capital.map((e) => {
                const cat = expenseCategory(e.category);
                return (
                  <li key={e.id} className="flex items-baseline justify-between gap-3 py-2 text-[14px]">
                    <span className="min-w-0">
                      {e.vendor || e.description || "Equipment"}
                      <span className="block text-[12px] text-muted-foreground">{billingDay(e.expense_date, { thisYear })} · class {cat.ccaClass}, {pctWord(cat.ccaRate ?? 0)} a year</span>
                    </span>
                    <span className="shrink-0 tabular-nums">{money(Number(e.amount_minor))}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-[14px] text-muted-foreground">No equipment over $500 bought in {s.year}.</p>
          )}
          <p className="mt-2 text-[12px] text-muted-foreground">Equipment over $500 is claimed over several years. This year's claim is estimated at the class rate; later years need your accountant's schedule.</p>
        </MoneyCard>
      </div>

      {flags.length ? (
        <MoneyCard title="For your accountant to check" icon={AlertTriangle}>
          <ul className="space-y-2.5">
            {flags.map((i) => (
              <li key={i.id}>
                <div className="text-[14px] font-medium">{i.title}{i.amountMinor ? <span className="font-normal text-muted-foreground"> · {money(i.amountMinor)}</span> : null}</div>
                <p className="text-[12px] text-muted-foreground">{i.detail}</p>
              </li>
            ))}
          </ul>
        </MoneyCard>
      ) : null}

      <MoneyCard title="Deadlines" icon={CalendarClock}>
        <ul className="divide-y divide-border">
          {s.deadlines.filter((d) => d.date >= m.today).slice(0, 6).map((d, i) => (
            <li key={i} className="flex items-baseline justify-between gap-3 py-2 text-[14px]">
              <span className="min-w-0">{d.title}<span className="block text-[12px] text-muted-foreground">{d.detail}</span></span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{billingDay(d.date, { thisYear })}</span>
            </li>
          ))}
        </ul>
      </MoneyCard>

      <TaxPaymentDialog open={!!paying} onClose={() => setPaying(null)} year={s.year} kind={paying ?? "gst_hst"} onSaved={m.refresh} />
      <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader className="mb-4 text-left"><SheetTitle>Tax settings</SheetTitle></SheetHeader>
          <TaxSettings data={m.data} onSaved={m.refresh} />
        </SheetContent>
      </Sheet>
    </div>
  );
}
