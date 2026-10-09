import { useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowRight, BookOpen, Camera, CheckCircle2, Loader2, Receipt, Send, Sparkles, Ticket } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getBooksData } from "@/lib/business-books.functions";
import { ASSISTANT_NAME, toExpenseEntry, toTaxPaymentEntry, toTaxSettings, type BooksData, type OpenSaleRow } from "@/lib/business-books";
import { buildBooksSnapshot, fmtCad } from "@/lib/business-tax";
import { businessToday } from "@/lib/billing-schedule";
import { RECEIPT_ACCEPT } from "@/lib/receipt-upload";
import { openSummer } from "@/components/summer/summer-assistant";
import { SendPaymentRequestDialog } from "@/components/send-payment-request-dialog";
import { BOOKS_KEY, useSnapReceipts } from "@/components/admin/books/use-snap-receipts";
import { RecordPaymentDialog, type PaymentToRecord } from "./record-payment-dialog";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-10-08" -> "Oct 8". */
const day = (iso: string) => `${MON[Number(iso.slice(5, 7)) - 1] ?? ""} ${Number(iso.slice(8, 10))}`;

const short = (minor: number) => {
  const v = minor / 100;
  return Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${Math.round(v)}`;
};

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "warn" }) {
  return (
    <Card className="min-w-0 p-3 sm:p-4">
      <div className="truncate text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-xl font-semibold tabular-nums sm:text-2xl", tone === "good" && "text-emerald-500", tone === "warn" && "text-amber-500")}>{value}</div>
      {sub && <div className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</div>}
    </Card>
  );
}

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

/**
 * The finance login's home: today's money at a glance and the jobs it does
 * most, one tap each. Snap a receipt, record a payment, send a payment link,
 * ask Cleo. Everything else is one tap away in Books, Payments and the menu.
 */
export function FinanceHome() {
  const qc = useQueryClient();
  const loadFn = useServerFn(getBooksData);
  const { snap, scanning, label: snapLabel } = useSnapReceipts();
  const fileRef = useRef<HTMLInputElement>(null);
  const [recording, setRecording] = useState<PaymentToRecord | null>(null);
  const [sending, setSending] = useState<OpenSaleRow | null>(null);
  const today = businessToday();

  const { data, isLoading, error } = useQuery({
    queryKey: BOOKS_KEY,
    queryFn: () => loadFn() as Promise<BooksData>,
    staleTime: 30_000,
  });

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
  const latest = [...data.revenue].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
  const toCheck = data.expenses.filter((e) => e.status === "needs_review").length;
  const gst = s.settings.gstRegistered;
  const refresh = () => qc.invalidateQueries({ queryKey: BOOKS_KEY });

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
        <QuickAction icon={BookOpen} label="Books" to="/admin/sales" search={{ tab: "taxes" }} />
        <QuickAction icon={Ticket} label="Discounts" to="/admin/discount-codes" />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Sales this month" value={fmtCad(thisMonthSales)} sub={`Last month ${short(lastMonthSales)}`} tone="good" />
        <Kpi label="To collect" value={fmtCad(toCollect)} sub={open.length ? `${open.length} unpaid` : "All paid up"} tone={toCollect > 0 ? "warn" : undefined} />
        <Kpi label="Set aside now" value={fmtCad(s.setAsideNowMinor)} sub={`GST ${short(Math.max(0, s.gst.owingMinor))} + tax ${short(Math.max(0, s.incomeTax.owingNowMinor))}`} />
        {gst
          ? <Kpi label="GST/HST owing" value={fmtCad(s.gst.owingMinor)} sub={`${short(s.revenue.collectedMinor)} collected, ${short(s.gst.paidMinor)} paid`} />
          : <Kpi label="Profit so far" value={fmtCad(s.profitMinor)} sub={`${s.year} to date`} />}
      </div>

      {toCheck > 0 && (
        <Link to="/admin/sales" search={{ tab: "taxes" } as any} className="flex items-center gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          <Receipt className="h-5 w-5 shrink-0 text-amber-500" />
          <span className="min-w-0 flex-1"><strong>{toCheck} receipt{toCheck === 1 ? "" : "s"} to check.</strong> {ASSISTANT_NAME} couldn't read everything.</span>
          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Link>
      )}

      <Card className="p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-sm font-semibold">Money to collect</h3>
          <Link to="/admin/transactions" className="text-xs font-medium text-primary">All payments</Link>
        </div>
        {open.length === 0 ? (
          <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> Nothing outstanding.</div>
        ) : (
          <ul className="divide-y">
            {open.slice(0, 8).map((o) => (
              <li key={o.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{o.client ?? "Client"}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {o.offer ?? "Purchase"}{o.createdOn ? ` · since ${day(o.createdOn)}` : ""}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-semibold tabular-nums">{fmtCad(o.outstandingMinor)}</div>
                    {o.status && <div className="text-[11px] text-muted-foreground">{o.status}</div>}
                  </div>
                </div>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="outline" className="h-8 flex-1 sm:flex-none" onClick={() => setRecording(o)}>
                    <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> Record payment
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 flex-1 sm:flex-none" onClick={() => setSending(o)}>
                    <Send className="mr-1.5 h-3.5 w-3.5" /> Send link
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {open.length > 8 && <div className="border-t px-4 py-2 text-xs text-muted-foreground">+{open.length - 8} more in All payments</div>}
      </Card>

      <Card className="p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-sm font-semibold">Latest payments</h3>
          <Link to="/admin/sales" search={{ tab: "taxes" } as any} className="text-xs font-medium text-primary">Books</Link>
        </div>
        {latest.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted-foreground">No payments yet this year.</div>
        ) : (
          <ul className="divide-y">
            {latest.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="w-12 shrink-0 text-xs tabular-nums text-muted-foreground">{day(r.date)}</span>
                <span className="min-w-0 flex-1 truncate">{r.clientName ?? "Client"}{r.product ? <span className="text-muted-foreground"> · {r.product}</span> : null}</span>
                <span className={cn("shrink-0 font-semibold tabular-nums", r.kind === "refund" && "text-destructive")}>
                  {r.kind === "refund" ? "-" : ""}{fmtCad(r.grossMinor)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

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
