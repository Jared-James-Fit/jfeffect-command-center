import { useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRight, BookOpen, Camera, Loader2, Receipt, Sparkles, Ticket } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ASSISTANT_NAME, toExpenseEntry, toTaxPaymentEntry, toTaxSettings, type OpenSaleRow } from "@/lib/business-books";
import { buildBooksSnapshot, fmtCad } from "@/lib/business-tax";
import { businessToday } from "@/lib/billing-schedule";
import { RECEIPT_ACCEPT } from "@/lib/receipt-upload";
import { openSummer } from "@/components/summer/summer-assistant";
import { SendPaymentRequestDialog } from "@/components/send-payment-request-dialog";
import { BOOKS_KEY, useSnapReceipts } from "@/components/admin/books/use-snap-receipts";
import { RecordPaymentDialog, type PaymentToRecord } from "./record-payment-dialog";
import { PeriodBars, RankBars, shortCad, shortMonth } from "./finance-charts";
import { CollectList, Kpi, PaymentLine, Section, useBooksData } from "./finance-ui";
import { MyCalendarCard } from "./my-calendar-card";

function QuickAction({ icon: Icon, label, onClick, to, search, primary, busy }: {
  icon: typeof Camera; label: string; onClick?: () => void; to?: string; search?: Record<string, string>; primary?: boolean; busy?: boolean;
}) {
  const body = (
    <>
      {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Icon className="h-5 w-5" />}
      <span className="text-xs font-semibold leading-tight">{label}</span>
    </>
  );
  const cls = cn(
    "flex min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-2xl border p-3 text-center transition-colors",
    primary ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90" : "bg-card hover:bg-secondary",
  );
  if (to) return <Link to={to as any} search={search as any} className={cls}>{body}</Link>;
  return <button type="button" className={cls} onClick={onClick} disabled={busy}>{body}</button>;
}

/** On Home, lists show a few lines; "View all" opens Payments. */
const HOME_COLLECT = 3;
const HOME_LATEST = 4;

/**
 * The finance login's home: today's money at a glance and the jobs it does
 * most, one tap each. Snap a receipt, record a payment, send a payment link,
 * ask Cleo. Lists stay short here; Books and Payments hold the full story.
 */
export function FinanceHome() {
  const qc = useQueryClient();
  const { snap, scanning, label: snapLabel } = useSnapReceipts();
  const fileRef = useRef<HTMLInputElement>(null);
  const [recording, setRecording] = useState<PaymentToRecord | null>(null);
  const [sending, setSending] = useState<OpenSaleRow | null>(null);
  const today = businessToday();
  const { data, isLoading, error } = useBooksData();

  const s = useMemo(() => {
    if (!data) return null;
    return buildBooksSnapshot({
      year: Number(today.slice(0, 4)),
      asOf: data.asOf,
      settings: toTaxSettings(data.settings),
      revenue: data.revenue,
      expenses: data.expenses.map(toExpenseEntry),
      taxPayments: data.taxPayments.map(toTaxPaymentEntry),
    });
  }, [data, today]);

  const onSnap = async (files: FileList | null) => {
    const res = await snap(files);
    if (!res) return;
    if (res.count === 1 && res.last) {
      toast.success(res.last.status === "reviewed"
        ? `${ASSISTANT_NAME} filed it: ${res.last.vendor ?? "Receipt"} ${fmtCad(Number(res.last.amount_minor))}`
        : "Receipt added. Check it in Books.");
    } else if (res.count > 1) {
      toast.success(`${res.filed} filed${res.unread ? `, ${res.unread} to check in Books` : ""}`);
    }
  };

  if (isLoading) {
    return <div className="flex items-center justify-center p-12 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }
  if (error || !data || !s) {
    return (
      <div className="p-4 md:p-6">
        <Card className="border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Couldn't load the books: {(error as any)?.message ?? "unknown error"}
        </Card>
      </div>
    );
  }

  const month = today.slice(0, 7);
  const prevMonth = (() => {
    const [y, m] = month.split("-").map(Number);
    return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  })();
  const thisMonthSales = s.months.find((m) => m.month === month)?.salesMinor ?? 0;
  const lastMonthSales = s.months.find((m) => m.month === prevMonth)?.salesMinor ?? 0;
  const open = [...data.openSales].sort((a, b) => b.outstandingMinor - a.outstandingMinor);
  const toCollect = open.reduce((sum, o) => sum + o.outstandingMinor, 0);
  const latest = [...data.revenue].sort((a, b) => b.date.localeCompare(a.date)).slice(0, HOME_LATEST);
  const toCheck = data.expenses.filter((e) => e.status === "needs_review").length;
  const gst = s.settings.gstRegistered;
  const refresh = () => qc.invalidateQueries({ queryKey: BOOKS_KEY });
  // January to now: empty future months would only flatten the chart.
  const monthBars = s.months
    .filter((m) => m.month <= month)
    .map((m) => ({ key: m.month, label: shortMonth(m.month), valueMinor: Math.max(0, m.salesMinor), hint: "Sales" }));
  const products = s.revenue.byProduct.slice(0, 4).map((p) => ({ label: p.product, valueMinor: p.salesMinor, sub: `×${p.count}` }));

  return (
    <div className="space-y-5 p-4 md:p-6">
      <div>
        <h2 className="text-lg font-semibold">Today's money</h2>
        <p className="text-sm text-muted-foreground">Live from payments and receipts, as of today.</p>
      </div>

      <input ref={fileRef} type="file" accept={RECEIPT_ACCEPT} multiple className="hidden" onChange={(e) => { void onSnap(e.target.files); e.target.value = ""; }} />
      <div className="grid grid-cols-4 gap-2 sm:gap-3">
        <QuickAction icon={Camera} label={snapLabel} primary busy={scanning} onClick={() => fileRef.current?.click()} />
        <QuickAction icon={Sparkles} label={`Ask ${ASSISTANT_NAME}`} onClick={() => openSummer({ year: Number(today.slice(0, 4)) })} />
        <QuickAction icon={BookOpen} label="Books" to="/admin/finance/books" />
        <QuickAction icon={Ticket} label="Discounts" to="/admin/discount-codes" />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Sales this month" value={fmtCad(thisMonthSales)} sub={`Last month ${shortCad(lastMonthSales)}`} tone="good" />
        <Kpi label="To collect" value={fmtCad(toCollect)} sub={open.length ? `${open.length} unpaid` : "All paid up"} tone={toCollect > 0 ? "warn" : undefined} />
        <Kpi label="Set aside now" value={fmtCad(s.setAsideNowMinor)} sub={`GST ${shortCad(Math.max(0, s.gst.owingMinor))} + tax ${shortCad(Math.max(0, s.incomeTax.owingNowMinor))}`} />
        {gst
          ? <Kpi label="GST/HST owing" value={fmtCad(s.gst.owingMinor)} sub={`${shortCad(s.revenue.collectedMinor)} collected, ${shortCad(s.gst.paidMinor)} paid`} />
          : <Kpi label="Profit so far" value={fmtCad(s.profitMinor)} sub={`${s.year} to date`} />}
      </div>

      <MyCalendarCard />

      {toCheck > 0 && (
        <Link to={"/admin/finance/books" as any} search={{ tab: "expenses", filter: "review" } as any} className="flex items-center gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          <Receipt className="h-5 w-5 shrink-0 text-amber-500" />
          <span className="min-w-0 flex-1"><strong>{toCheck} receipt{toCheck === 1 ? "" : "s"} to check.</strong> {ASSISTANT_NAME} couldn't read everything.</span>
          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Link>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Sales by month" right={<><span className="font-semibold text-foreground tabular-nums">{fmtCad(s.revenue.salesMinor)}</span> in {s.year}</>}>
          <PeriodBars data={monthBars} highlight={month} ariaLabel={`Sales by month for ${s.year}, before GST/HST`} />
          <p className="mt-1 text-[11px] text-muted-foreground">Before GST/HST, net of refunds. This month in colour.</p>
        </Section>

        <Section
          title="Money to collect"
          right={toCollect > 0 ? <span className="font-semibold text-amber-600 tabular-nums dark:text-amber-400">{fmtCad(toCollect)}</span> : undefined}
          footer={open.length > HOME_COLLECT ? { label: `View all ${open.length}`, to: "/admin/finance/payments" } : null}
          flush
        >
          <CollectList rows={open.slice(0, HOME_COLLECT)} today={today} onRecord={setRecording} onSend={setSending} />
        </Section>

        <Section title="Latest payments" footer={{ label: "View all payments", to: "/admin/finance/payments" }} flush>
          {latest.length === 0
            ? <p className="px-4 pb-4 text-sm text-muted-foreground">No payments yet.</p>
            : <ul className="divide-y border-t">{latest.map((r) => <PaymentLine key={r.id} r={r} />)}</ul>}
        </Section>

        <Section title="Top products" right={`${s.year} sales`} footer={{ label: "Open the books", to: "/admin/finance/books" }}>
          <RankBars rows={products} empty="No sales yet this year." />
        </Section>
      </div>

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
