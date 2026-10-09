import { Fragment, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Loader2, Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { OpenSaleRow } from "@/lib/business-books";
import { fmtCad } from "@/lib/business-tax";
import { businessToday } from "@/lib/billing-schedule";
import { SendPaymentRequestDialog } from "@/components/send-payment-request-dialog";
import { BOOKS_KEY } from "@/components/admin/books/use-snap-receipts";
import { RecordPaymentDialog, type PaymentToRecord } from "./record-payment-dialog";
import { daysBetween, longMonth, methodLabel, PeriodBars, RankBars, shortCad, shortDay } from "./finance-charts";
import { CollectList, Kpi, PaymentLine, Section, useBooksData } from "./finance-ui";

const WEEKS = 12;
const COLLECT_PREVIEW = 5;
const PAGE = 10;

/** Monday of the week holding `iso` (YYYY-MM-DD). */
function mondayOf(iso: string): string {
  const t = Date.parse(`${iso}T00:00:00Z`);
  const back = (new Date(t).getUTCDay() + 6) % 7;
  return new Date(t - back * 86_400_000).toISOString().slice(0, 10);
}
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

type Kind = "all" | "payment" | "refund";

/**
 * The finance login's Payments: money in by week, how clients pay, everything
 * still owed (with record / send link), and every payment, newest first.
 * Stripe's own ledger (receipts, invoices, payouts) stays one tap away.
 */
export function FinancePayments() {
  const qc = useQueryClient();
  const today = businessToday();
  const { data, isLoading, error } = useBooksData();
  const [recording, setRecording] = useState<PaymentToRecord | null>(null);
  const [sending, setSending] = useState<OpenSaleRow | null>(null);
  const [allOpen, setAllOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<Kind>("all");
  const [limit, setLimit] = useState(PAGE);

  const rows = useMemo(() => [...(data?.revenue ?? [])].sort((a, b) => b.date.localeCompare(a.date)), [data]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (kind !== "all" && r.kind !== kind) return false;
      if (!q) return true;
      return [r.clientName, r.product, methodLabel(r.method), r.reference].some((v) => (v ?? "").toLowerCase().includes(q));
    });
  }, [rows, query, kind]);

  if (isLoading) {
    return <div className="flex items-center justify-center p-12 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }
  if (error || !data) {
    return (
      <div className="p-4 md:p-6">
        <Card className="border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Couldn't load payments: {(error as any)?.message ?? "unknown error"}
        </Card>
      </div>
    );
  }

  const year = today.slice(0, 4);
  const month = today.slice(0, 7);
  const thisYear = rows.filter((r) => r.date.startsWith(year));
  const payments = thisYear.filter((r) => r.kind === "payment");
  const refunds = thisYear.filter((r) => r.kind === "refund");
  const sum = (list: typeof rows) => list.reduce((t, r) => t + r.grossMinor, 0);
  const monthIn = payments.filter((r) => r.date.startsWith(month));

  const open = [...data.openSales].sort((a, b) => b.outstandingMinor - a.outstandingMinor);
  const toCollect = open.reduce((t, o) => t + o.outstandingMinor, 0);
  const ages = { fresh: 0, month: 0, old: 0, undated: 0 };
  for (const o of open) {
    if (!o.createdOn) { ages.undated += o.outstandingMinor; continue; }
    const d = daysBetween(o.createdOn, today);
    if (d < 30) ages.fresh += o.outstandingMinor;
    else if (d <= 60) ages.month += o.outstandingMinor;
    else ages.old += o.outstandingMinor;
  }

  // Money received per week (refunds shown in the list, not netted here).
  const thisWeek = mondayOf(today);
  const weekStarts = Array.from({ length: WEEKS }, (_, i) => addDays(thisWeek, (i - WEEKS + 1) * 7));
  const byWeek = new Map(weekStarts.map((w) => [w, 0]));
  for (const r of rows) {
    if (r.kind !== "payment" || r.date < weekStarts[0]) continue;
    const w = mondayOf(r.date);
    if (byWeek.has(w)) byWeek.set(w, (byWeek.get(w) ?? 0) + r.grossMinor);
  }
  const weekBars = weekStarts.map((w) => ({ key: w, label: shortDay(w), valueMinor: byWeek.get(w) ?? 0, hint: `Week of ${shortDay(w)}` }));
  const weeksTotal = weekBars.reduce((t, w) => t + w.valueMinor, 0);

  const methods = new Map<string, { valueMinor: number; count: number }>();
  for (const r of payments) {
    const k = methodLabel(r.method);
    const m = methods.get(k) ?? { valueMinor: 0, count: 0 };
    methods.set(k, { valueMinor: m.valueMinor + r.grossMinor, count: m.count + 1 });
  }
  const methodRows = [...methods.entries()]
    .sort((a, b) => b[1].valueMinor - a[1].valueMinor)
    .slice(0, 5)
    .map(([label, m]) => ({ label, valueMinor: m.valueMinor, sub: `×${m.count}` }));

  // The list shows `limit` rows; month headers carry the whole month's total.
  const monthTotals = new Map<string, number>();
  for (const r of filtered) {
    const k = r.date.slice(0, 7);
    monthTotals.set(k, (monthTotals.get(k) ?? 0) + (r.kind === "refund" ? -r.grossMinor : r.grossMinor));
  }
  const visible = filtered.slice(0, limit);
  const refresh = () => qc.invalidateQueries({ queryKey: BOOKS_KEY });

  return (
    <div className="space-y-5 p-4 md:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">Payments</h2>
          <p className="text-sm text-muted-foreground">Money in, money owed, every payment.</p>
        </div>
        <Button asChild size="sm" variant="outline" className="h-8 shrink-0">
          <Link to="/admin/transactions">Stripe activity <ArrowUpRight className="ml-1 h-3.5 w-3.5" /></Link>
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="In this month" value={fmtCad(sum(monthIn))} sub={`${monthIn.length} payment${monthIn.length === 1 ? "" : "s"}`} tone="good" />
        <Kpi label="To collect" value={fmtCad(toCollect)} sub={open.length ? `${open.length} unpaid` : "All paid up"} tone={toCollect > 0 ? "warn" : undefined} />
        <Kpi label={`In ${year}`} value={fmtCad(sum(payments))} sub={`${payments.length} payments`} />
        <Kpi label={`Refunds ${year}`} value={fmtCad(sum(refunds))} sub={refunds.length ? `${refunds.length} refund${refunds.length === 1 ? "" : "s"}` : "None"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Section
          className="lg:col-span-2"
          title={`Money in, last ${WEEKS} weeks`}
          right={<><span className="font-semibold text-foreground tabular-nums">{fmtCad(weeksTotal)}</span> total</>}
        >
          <PeriodBars data={weekBars} highlight={thisWeek} ariaLabel={`Payments received per week, last ${WEEKS} weeks`} />
          <p className="mt-1 text-[11px] text-muted-foreground">Payments received, GST/HST included. This week in colour.</p>
        </Section>
        <Section title="How clients pay" right={`${year}`}>
          <RankBars rows={methodRows} empty="No payments yet this year." />
        </Section>
      </div>

      <Section
        title="Money to collect"
        right={toCollect > 0 ? <span className="font-semibold text-amber-600 tabular-nums dark:text-amber-400">{fmtCad(toCollect)}</span> : undefined}
        footer={open.length > COLLECT_PREVIEW
          ? { label: allOpen ? "Show fewer" : `Show all ${open.length}`, onClick: () => setAllOpen((v) => !v) }
          : null}
        flush
      >
        {open.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-4 pb-3">
            {[
              { label: "Under 30 days", v: ages.fresh },
              { label: "30–60 days", v: ages.month },
              { label: "Over 60 days", v: ages.old, warn: true },
              { label: "No date", v: ages.undated },
            ].filter((a) => a.v > 0).map((a) => (
              <span
                key={a.label}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[11px] tabular-nums",
                  a.warn ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300" : "text-muted-foreground",
                )}
              >
                {a.label} <span className="font-semibold text-foreground">{shortCad(a.v)}</span>
              </span>
            ))}
          </div>
        )}
        <CollectList rows={allOpen ? open : open.slice(0, COLLECT_PREVIEW)} today={today} onRecord={setRecording} onSend={setSending} />
      </Section>

      <Section
        title="All payments"
        right={`${filtered.length} ${filtered.length === 1 ? "entry" : "entries"}`}
        footer={filtered.length > limit ? { label: `Show more (${filtered.length - limit} left)`, onClick: () => setLimit((n) => n + PAGE) } : null}
        flush
      >
        <div className="flex flex-col gap-2 px-4 pb-3 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => { setQuery(e.target.value); setLimit(PAGE); }}
              placeholder="Search client, product or method"
              className="h-9 pl-8"
              aria-label="Search payments"
            />
          </div>
          <div className="flex shrink-0 rounded-lg border p-0.5" role="group" aria-label="Show">
            {(["all", "payment", "refund"] as const).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                onClick={() => { setKind(k); setLimit(PAGE); }}
                className={cn(
                  "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  kind === k ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {k === "all" ? "All" : k === "payment" ? "Payments" : "Refunds"}
              </button>
            ))}
          </div>
        </div>
        {visible.length === 0 ? (
          <p className="border-t px-4 py-6 text-center text-sm text-muted-foreground">No payments match.</p>
        ) : (
          <ul className="border-t">
            {visible.map((r, i) => {
              const m = r.date.slice(0, 7);
              const first = i === 0 || visible[i - 1].date.slice(0, 7) !== m;
              return (
                <Fragment key={r.id}>
                  {first && (
                    <li className="flex items-baseline justify-between bg-muted/40 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                      <span>{longMonth(m)}</span>
                      <span className="tabular-nums">{fmtCad(monthTotals.get(m) ?? 0)}</span>
                    </li>
                  )}
                  <PaymentLine r={r} />
                </Fragment>
              );
            })}
          </ul>
        )}
      </Section>

      <RecordPaymentDialog sale={recording} onOpenChange={(v) => { if (!v) setRecording(null); }} onSaved={() => void refresh()} />
      {sending && (
        <SendPaymentRequestDialog
          open={!!sending}
          onOpenChange={(v) => { if (!v) setSending(null); }}
          purchaseId={sending.id}
          clientName={sending.client}
          hasPhone
          hasLink
        />
      )}
    </div>
  );
}
