import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  AlertTriangle, CalendarClock, Camera, CheckCircle2, ChevronDown, Download, FileSpreadsheet, FileText,
  Info, Lightbulb, Loader2, Paperclip, Plus, RefreshCw, Search, SlidersHorizontal, Sparkles, Trash2,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { EXPENSE_CATEGORIES, expenseCategory } from "@/lib/business-expense-categories";
import {
  ASSISTANT_NAME, minorToInput, parseMoneyToMinor, toExpenseEntry, toTaxPaymentEntry, toTaxSettings,
  type BooksData, type ExpenseRow, type TaxPaymentRow,
} from "@/lib/business-books";
import { buildBooksSnapshot, expenseTaxView, fmtCad, MONTH_NAMES, type BooksSnapshot } from "@/lib/business-tax";
import { businessToday } from "@/lib/billing-schedule";
import {
  addTaxPayment, deleteTaxPayment, getBooksData, getSummerProfile, markExpensesReviewed, saveTaxSettings, scanReceipt, syncStripeFees,
} from "@/lib/business-books.functions";
import { RECEIPT_ACCEPT, receiptSignedUrl, uploadReceiptFile } from "@/lib/receipt-upload";
import { ExpenseDialog } from "./expense-dialog";
import { BooksModeContext, useBooksMode, type BooksMode } from "./books-mode";
import { openSummer } from "@/components/summer/summer-assistant";
import { SummerCustomizeDialog } from "./summer-customize";
import { summerTone } from "@/lib/summer-persona";

const BOOKS_KEY = ["books-data"];
const STRIPE_FEE_STALE_MS = 12 * 60 * 60 * 1000;

const money = fmtCad;
const short = (minor: number) => {
  const v = minor / 100;
  return Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${Math.round(v)}`;
};
const pct = (n: number) => `${Math.round(n * 100)}%`;

function Kpi({ label, value, sub, tone, compact }: { label: string; value: string; sub?: string; tone?: "good" | "warn" | "primary"; compact?: boolean }) {
  return (
    <Card className={cn("min-w-0", compact ? "p-3 sm:p-4" : "p-4")}>
      <div className="truncate text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={cn("mt-1 font-semibold tabular-nums", compact ? "text-base sm:text-2xl" : "text-2xl", tone === "good" && "text-emerald-500", tone === "warn" && "text-amber-500", tone === "primary" && "text-primary")}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </Card>
  );
}

export function TaxesBooksPage({ mode = "owner" }: { mode?: BooksMode } = {}) {
  return (
    <BooksModeContext.Provider value={mode}>
      <TaxesBooksPageInner />
    </BooksModeContext.Provider>
  );
}

function TaxesBooksPageInner() {
  const mode = useBooksMode();
  const qc = useQueryClient();
  const loadFn = useServerFn(getBooksData);
  const scanFn = useServerFn(scanReceipt);
  const feesFn = useServerFn(syncStripeFees);
  const today = businessToday();
  const currentYear = Number(today.slice(0, 4));

  const { data, isLoading, error } = useQuery({
    queryKey: BOOKS_KEY,
    queryFn: () => loadFn() as Promise<BooksData>,
    staleTime: 30_000,
  });

  const [year, setYear] = useState(currentYear);
  const [tab, setTab] = useState("overview");
  const [editing, setEditing] = useState<ExpenseRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [expenseFilter, setExpenseFilter] = useState<string>("all");
  const [scanState, setScanState] = useState<{ done: number; total: number } | null>(null);
  const [syncingFees, setSyncingFees] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const autoSynced = useRef(false);

  const refresh = () => qc.invalidateQueries({ queryKey: BOOKS_KEY });

  const snapshot: BooksSnapshot | null = useMemo(() => {
    if (!data) return null;
    return buildBooksSnapshot({
      year,
      asOf: data.asOf,
      settings: toTaxSettings(data.settings),
      revenue: data.revenue,
      expenses: data.expenses.map(toExpenseEntry),
      taxPayments: data.taxPayments.map(toTaxPaymentEntry),
    });
  }, [data, year]);

  const runFeeSync = async (silent: boolean) => {
    setSyncingFees(true);
    try {
      const res: any = await feesFn({ data: { year } });
      if (!res?.ok) {
        if (!silent) toast.error(res?.error ?? "Stripe fee sync failed");
      } else {
        if (!silent) toast.success(`Stripe fees synced: ${res.months} month${res.months === 1 ? "" : "s"}`);
        await refresh();
      }
    } catch (e: any) {
      if (!silent) toast.error(e?.message ?? "Stripe fee sync failed");
    } finally {
      setSyncingFees(false);
    }
  };

  // Keep Stripe fees current without anyone pressing a button.
  useEffect(() => {
    if (!data || autoSynced.current || year !== currentYear) return;
    const last = data.settings?.stripe_fees_synced_at ? Date.parse(data.settings.stripe_fees_synced_at) : 0;
    if (Date.now() - last < STRIPE_FEE_STALE_MS) return;
    if (!data.revenue.some((r) => r.stripe)) return;
    autoSynced.current = true;
    void runFeeSync(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, year, currentYear]);

  const onFiles = async (files: FileList | null) => {
    const list = Array.from(files ?? []);
    if (!list.length) return;
    setScanState({ done: 0, total: list.length });
    let last: ExpenseRow | null = null;
    let filed = 0;
    let unread = 0;
    for (const [i, file] of list.entries()) {
      try {
        const { path, mime } = await uploadReceiptFile(file);
        const res: any = await scanFn({ data: { path, mime } });
        last = res.expense as ExpenseRow;
        if (res.read && last.status === "reviewed") filed++;
        else unread++;
      } catch (e: any) {
        toast.error(`${file.name}: ${e?.message ?? "upload failed"}`);
      }
      setScanState({ done: i + 1, total: list.length });
    }
    setScanState(null);
    await refresh();
    setTab("expenses");
    if (list.length === 1 && last) {
      if (last.status === "reviewed") {
        toast.success(`${ASSISTANT_NAME} filed it: ${last.vendor ?? "Receipt"} ${money(Number(last.amount_minor))}, ${expenseCategory(last.category).label}`);
      }
      setEditing(last);
    } else if (list.length > 1) {
      toast.success(`${filed} filed${unread ? `, ${unread} to check` : ""}`);
      if (unread) setExpenseFilter("review");
    }
  };

  const exportAs = async (kind: string) => {
    if (!snapshot || !data) return;
    setExporting(kind);
    try {
      const ex = await import("@/lib/books-export");
      if (kind === "year-end") await ex.downloadYearEndPdf(snapshot, data);
      if (kind === "gst") await ex.downloadGstWorksheetPdf(snapshot);
      if (kind === "receipts") {
        const n = await ex.downloadReceiptsPdf(snapshot, data.expenses, (p) => receiptSignedUrl(p, 900));
        if (!n) toast.message("No receipts on file for this year yet");
      }
      if (kind === "revenue-csv") ex.downloadRevenueCsv(snapshot, data);
      if (kind === "expenses-csv") ex.downloadExpensesCsv(snapshot, data);
    } catch (e: any) {
      toast.error(e?.message ?? "Export failed");
    } finally {
      setExporting(null);
    }
  };

  if (isLoading) {
    return <div className="flex items-center justify-center p-12 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }
  if (error || !data || !snapshot) {
    return (
      <div className="p-4 md:p-6">
        <Card className="border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Couldn't load the books: {(error as any)?.message ?? "unknown error"}
        </Card>
      </div>
    );
  }

  const s = snapshot;
  const years = data.years.length ? data.years : [currentYear];
  const gstRegistered = s.settings.gstRegistered;
  const reviewCount = data.expenses.filter((e) => e.status === "needs_review").length;

  return (
    <div className="space-y-5 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Taxes & Books</h2>
          <p className="text-sm text-muted-foreground">
            Live from your payments and receipts. {s.inProgress ? `${s.year} so far, as of today.` : `${s.year} is closed.`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="h-9 w-[92px]" aria-label="Tax year"><SelectValue /></SelectTrigger>
            <SelectContent>{years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
          </Select>
          <input ref={fileRef} type="file" accept={RECEIPT_ACCEPT} multiple className="hidden" onChange={(e) => { void onFiles(e.target.files); e.target.value = ""; }} />
          <Button size="sm" className="h-9" onClick={() => fileRef.current?.click()} disabled={!!scanState}>
            {scanState ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Camera className="mr-1.5 h-4 w-4" />}
            {scanState ? `Reading ${scanState.done + (scanState.done < scanState.total ? 1 : 0)} of ${scanState.total}` : "Snap receipt"}
          </Button>
          {mode === "owner" && (
            <Button size="sm" variant="outline" className="h-9" onClick={() => openSummer({ year })}>
              <Sparkles className="mr-1.5 h-4 w-4 text-amber-500" /> Ask {ASSISTANT_NAME}
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="h-9" disabled={!!exporting}>
                {exporting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}
                Download <ChevronDown className="ml-1 h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel>{s.year} for your accountant</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => void exportAs("year-end")}><FileText className="mr-2 h-4 w-4" /> Year-end package (PDF)</DropdownMenuItem>
              {gstRegistered && <DropdownMenuItem onClick={() => void exportAs("gst")}><FileText className="mr-2 h-4 w-4" /> GST/HST worksheet (PDF)</DropdownMenuItem>}
              <DropdownMenuItem onClick={() => void exportAs("receipts")}><Paperclip className="mr-2 h-4 w-4" /> Receipts book (PDF)</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => void exportAs("revenue-csv")}><FileSpreadsheet className="mr-2 h-4 w-4" /> Revenue (CSV)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void exportAs("expenses-csv")}><FileSpreadsheet className="mr-2 h-4 w-4" /> Expenses (CSV)</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Real-time numbers */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label="Set aside now"
          value={money(s.setAsideNowMinor)}
          sub={`GST ${short(Math.max(0, s.gst.owingMinor))} + income tax/CPP ${short(Math.max(0, s.incomeTax.owingNowMinor))}`}
        />
        <Kpi
          label="GST/HST owing"
          value={money(s.gst.owingMinor)}
          sub={gstRegistered ? `${short(s.revenue.collectedMinor)} collected, ${short(s.expenses.itcMinor)} back, ${short(s.gst.paidMinor)} paid` : "Not registered"}
        />
        <Kpi
          label="Profit so far"
          value={money(s.profitMinor)}
          sub={`${short(s.revenue.salesMinor)} sales, ${short(s.expenses.deductibleMinor + s.expenses.ccaMinor)} expenses`}
          tone={s.profitMinor >= 0 ? "good" : "warn"}
        />
        <Kpi
          label={s.inProgress ? `Tax for ${s.year} (projected)` : `Tax for ${s.year}`}
          value={money(s.incomeTax.projected.totalMinor)}
          sub={s.settings.businessStructure === "corporation" ? "Corporate tax estimate" : `Income tax + CPP on ${short(s.projection.profitMinor)} profit`}
        />
      </div>

      {s.inProgress && s.settings.businessStructure === "sole_proprietor" && (
        <Card className="flex items-start gap-3 bg-muted/40 p-4 text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p>
            For every <strong>$100</strong> of coaching you sell from here{gstRegistered ? " (plus GST)" : ""}, put aside
            {gstRegistered ? <> the <strong>$5 GST</strong> and</> : null} about <strong>${Math.round(s.setAsideRate * 100)}</strong> for income tax and CPP.
            That's your rate at {short(s.projection.profitMinor)} projected profit.
          </p>
        </Card>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="expenses">
            Expenses{reviewCount ? <Badge variant="destructive" className="ml-1.5 h-5 px-1.5 text-[10px]">{reviewCount}</Badge> : null}
          </TabsTrigger>
          {gstRegistered && <TabsTrigger value="gst">GST/HST</TabsTrigger>}
          <TabsTrigger value="year-end">Year-end</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <OverviewTab s={s} today={today} onGo={(t, filter) => { setTab(t); if (filter) setExpenseFilter(filter); }} onSyncFees={() => void runFeeSync(false)} syncingFees={syncingFees} />
        </TabsContent>
        <TabsContent value="expenses" className="mt-4">
          <ExpensesTab
            s={s}
            data={data}
            filter={expenseFilter}
            setFilter={setExpenseFilter}
            onEdit={setEditing}
            onAdd={() => setAdding(true)}
            onSnap={() => fileRef.current?.click()}
            onSyncFees={() => void runFeeSync(false)}
            syncingFees={syncingFees}
            onChanged={refresh}
          />
        </TabsContent>
        {gstRegistered && (
          <TabsContent value="gst" className="mt-4">
            <GstTab s={s} payments={data.taxPayments} onChanged={refresh} />
          </TabsContent>
        )}
        <TabsContent value="year-end" className="mt-4">
          <YearEndTab s={s} payments={data.taxPayments} onChanged={refresh} onExport={(k) => void exportAs(k)} exporting={exporting} />
        </TabsContent>
        <TabsContent value="settings" className="mt-4">
          <SettingsTab data={data} onSaved={refresh} />
        </TabsContent>
      </Tabs>

      <ExpenseDialog
        expense={editing}
        open={!!editing || adding}
        onClose={() => { setEditing(null); setAdding(false); }}
        onChanged={refresh}
        gstRegistered={gstRegistered}
      />

    </div>
  );
}

// ---------------------------------------------------------------------------

function OverviewTab({
  s, today, onGo, onSyncFees, syncingFees,
}: {
  s: BooksSnapshot;
  today: string;
  onGo: (tab: string, filter?: string) => void;
  onSyncFees: () => void;
  syncingFees: boolean;
}) {
  const chart = s.months.map((m) => ({
    name: MONTH_NAMES[Number(m.month.slice(5)) - 1].slice(0, 3),
    Sales: Math.round(m.salesMinor / 100),
    Expenses: Math.round(m.expensesMinor / 100),
  }));
  const upcoming = s.deadlines.filter((d) => d.date >= today).slice(0, 5);
  const issueAction: Record<string, () => void> = {
    "needs-review": () => onGo("expenses", "review"),
    uncategorized: () => onGo("expenses", "uncategorized"),
    "no-receipt": () => onGo("expenses", "no-receipt"),
    "gst-number": () => onGo("settings"),
    "stripe-fees": onSyncFees,
  };

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="p-4 lg:col-span-2">
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className="text-sm font-semibold">Sales vs expenses by month</h3>
          <span className="text-xs text-muted-foreground">GST/HST excluded</span>
        </div>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : String(v))} />
              <Tooltip
                formatter={(v: number) => `$${v.toLocaleString("en-CA")}`}
                contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Sales" fill="var(--primary)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Expenses" fill="var(--muted-foreground)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Projection to Dec 31: {money(s.projection.salesMinor)} sales, {money(s.projection.profitMinor)} profit. {s.projection.basis}
        </p>
      </Card>

      <Card className="p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><CalendarClock className="h-4 w-4" /> Coming up</h3>
        {upcoming.length ? (
          <ul className="space-y-3 text-sm">
            {upcoming.map((d, i) => (
              <li key={i}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{d.title}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{d.date}</span>
                </div>
                <p className="text-xs text-muted-foreground">{d.detail}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Nothing due for {s.year}.</p>
        )}
      </Card>

      <Card className="p-4 lg:col-span-2">
        <h3 className="mb-3 text-sm font-semibold">Books checklist</h3>
        {s.issues.length ? (
          <ul className="divide-y">
            {s.issues.map((i) => (
              <li key={i.id} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
                {i.severity === "warn" ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" /> : <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{i.title}{i.amountMinor ? <span className="font-normal text-muted-foreground"> · {money(i.amountMinor)}</span> : null}</div>
                  <p className="text-xs text-muted-foreground">{i.detail}</p>
                </div>
                {issueAction[i.id] && (
                  <Button size="sm" variant="outline" className="h-7 shrink-0 text-xs" onClick={issueAction[i.id]} disabled={i.id === "stripe-fees" && syncingFees}>
                    {i.id === "stripe-fees" ? (syncingFees ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Sync") : "Fix"}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-2 text-sm text-emerald-600"><CheckCircle2 className="h-4 w-4" /> Books are clean for {s.year}.</p>
        )}
      </Card>

      <Card className="p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Lightbulb className="h-4 w-4 text-amber-500" /> Tips from your numbers</h3>
        {s.tips.length ? (
          <ul className="space-y-3 text-sm">
            {s.tips.map((t) => (
              <li key={t.id}>
                <div className="font-medium">{t.title}{t.savingsMinor ? <span className="text-emerald-600"> · save ~{money(t.savingsMinor)}</span> : null}</div>
                <p className="text-xs text-muted-foreground">{t.detail}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Nothing stands out. Ask {ASSISTANT_NAME} for a review.</p>
        )}
      </Card>

      <Card className="p-4 lg:col-span-3">
        <div className="grid gap-6 md:grid-cols-3">
          <TopList title="Top clients" rows={s.revenue.byClient.slice(0, 6).map((r) => [r.client, r.salesMinor, r.count])} />
          <TopList title="By product" rows={s.revenue.byProduct.slice(0, 6).map((r) => [r.product, r.salesMinor, r.count])} />
          <TopList title="By payment method" rows={s.revenue.byMethod.map((r) => [r.method === "etransfer" ? "E-transfer" : r.method.charAt(0).toUpperCase() + r.method.slice(1), r.salesMinor, r.count])} />
        </div>
      </Card>
    </div>
  );
}

function TopList({ title, rows }: { title: string; rows: Array<[string, number, number]> }) {
  return (
    <div>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">{title}</h4>
      {rows.length ? (
        <ul className="space-y-1.5 text-sm">
          {rows.map(([label, v, n]) => (
            <li key={label} className="flex items-baseline justify-between gap-2">
              <span className="truncate">{label} <span className="text-xs text-muted-foreground">({n})</span></span>
              <span className="shrink-0 tabular-nums">{money(v)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No sales yet.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function ExpensesTab({
  s, data, filter, setFilter, onEdit, onAdd, onSnap, onSyncFees, syncingFees, onChanged,
}: {
  s: BooksSnapshot;
  data: BooksData;
  filter: string;
  setFilter: (f: string) => void;
  onEdit: (e: ExpenseRow) => void;
  onAdd: () => void;
  onSnap: () => void;
  onSyncFees: () => void;
  syncingFees: boolean;
  onChanged: () => void;
}) {
  const [q, setQ] = useState("");
  const markFn = useServerFn(markExpensesReviewed);
  const yearRows = data.expenses.filter((e) => e.expense_date.startsWith(String(s.year)));
  const rows = yearRows.filter((e) => {
    if (filter === "review" && e.status !== "needs_review") return false;
    if (filter === "no-receipt" && (e.receipt_path || e.source === "stripe_fees" || expenseCategory(e.category).kind === "excluded")) return false;
    if (filter === "uncategorized" && e.category !== "uncategorized") return false;
    if (!["all", "review", "no-receipt", "uncategorized"].includes(filter) && e.category !== filter) return false;
    if (q) {
      const hay = `${e.vendor ?? ""} ${e.description ?? ""} ${e.notes ?? ""} ${expenseCategory(e.category).label}`.toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  });
  const reviewable = rows.filter((e) => e.status === "needs_review" && e.category !== "uncategorized" && Number(e.amount_minor) > 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Kpi compact label="Paid" value={money(s.expenses.totalMinor)} sub={`${s.expenses.count} expenses`} />
        <Kpi compact label="Deductible" value={money(s.expenses.deductibleMinor + s.expenses.ccaMinor)} sub={s.expenses.ccaMinor ? `incl. ${short(s.expenses.ccaMinor)} CCA` : "Lowers income tax"} tone="good" />
        <Kpi compact label="GST back" value={money(s.expenses.itcMinor)} sub="Input tax credits" tone="good" />
      </div>

      <Card className="p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search vendor, item, notes" className="h-9 pl-8" />
          </div>
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="h-9 sm:w-56"><SelectValue /></SelectTrigger>
            <SelectContent className="max-h-80">
              <SelectItem value="all">All expenses</SelectItem>
              <SelectItem value="review">Needs review</SelectItem>
              <SelectItem value="no-receipt">Missing receipt</SelectItem>
              <SelectItem value="uncategorized">Uncategorized</SelectItem>
              {EXPENSE_CATEGORIES.filter((c) => c.key !== "uncategorized").map((c) => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex gap-2">
            <Button size="sm" className="h-9 flex-1 sm:flex-none" onClick={onSnap}><Camera className="mr-1.5 h-4 w-4" /> Snap</Button>
            <Button size="sm" variant="outline" className="h-9 flex-1 sm:flex-none" onClick={onAdd}><Plus className="mr-1.5 h-4 w-4" /> Add</Button>
            <Button size="sm" variant="outline" className="h-9" onClick={onSyncFees} disabled={syncingFees} title="Pull Stripe fees">
              {syncingFees ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              <span className="ml-1.5 hidden md:inline">Stripe fees</span>
            </Button>
          </div>
        </div>
        {reviewable.length > 1 && filter === "review" && (
          <div className="mt-2 flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-xs">
            <span>{reviewable.length} look complete. Confirm them all if they're right.</span>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={async () => {
              try { await markFn({ data: { ids: reviewable.map((e) => e.id) } }); toast.success("Confirmed"); onChanged(); }
              catch (e: any) { toast.error(e?.message ?? "Could not confirm"); }
            }}>Confirm all</Button>
          </div>
        )}
      </Card>

      {rows.length ? (
        <Card className="divide-y overflow-hidden">
          {rows.map((e) => {
            const cat = expenseCategory(e.category);
            const v = expenseTaxView(toExpenseEntry(e), s.settings.gstRegistered);
            return (
              <button key={e.id} type="button" onClick={() => onEdit(e)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-accent/50">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  {e.receipt_path ? <Paperclip className="h-4 w-4" /> : e.source === "stripe_fees" ? <span className="text-xs font-bold">S</span> : <FileText className="h-4 w-4 opacity-40" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{e.vendor || e.description || "Receipt"}</span>
                    {e.status === "needs_review" && <Badge variant="outline" className="h-5 border-amber-500/50 px-1.5 text-[10px] text-amber-600">Check</Badge>}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {e.expense_date} · {cat.label}{e.vendor && e.description ? ` · ${e.description}` : ""}{Number(e.business_use_pct) < 100 ? ` · ${Number(e.business_use_pct)}% business` : ""}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-sm font-semibold tabular-nums">{money(Number(e.amount_minor))}{e.currency !== "CAD" ? <span className="text-xs font-normal"> {e.currency}</span> : null}</div>
                  <div className="text-[11px] text-muted-foreground tabular-nums">
                    {cat.kind === "excluded" ? "Personal" : `${short(v.deductibleMinor + v.ccaMinor)} off · ${short(v.itcMinor)} GST`}
                  </div>
                </div>
              </button>
            );
          })}
        </Card>
      ) : (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          {yearRows.length ? "Nothing matches." : (
            <div className="space-y-3">
              <p>No expenses for {s.year} yet. Snap a receipt and {ASSISTANT_NAME} files it for you.</p>
              <Button size="sm" onClick={onSnap}><Camera className="mr-1.5 h-4 w-4" /> Snap receipt</Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function TaxPaymentDialog({ open, onClose, year, kind, onSaved }: { open: boolean; onClose: () => void; year: number; kind: "gst_hst" | "income_tax"; onSaved: () => void }) {
  const addFn = useServerFn(addTaxPayment);
  const [form, setForm] = useState({ paid_on: businessToday(), amount: "", period_label: "", reference: "", kind, tax_year: year });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setForm({ paid_on: businessToday(), amount: "", period_label: "", reference: "", kind, tax_year: year });
  }, [open, kind, year]);
  const submit = async () => {
    const amount = parseMoneyToMinor(form.amount);
    if (!amount) return void toast.error("Enter the amount paid");
    setBusy(true);
    try {
      await addFn({ data: { paid_on: form.paid_on, kind: form.kind, tax_year: form.tax_year, amount_minor: amount, period_label: form.period_label || null, reference: form.reference || null } });
      toast.success("Payment recorded");
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Record a tax payment</DialogTitle>
          <DialogDescription>Money you already sent to CRA. It comes off what you owe.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v as any })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="gst_hst">GST/HST remittance or instalment</SelectItem>
                <SelectItem value="income_tax">Income tax / CPP instalment or balance</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Amount</Label><Input inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.00" /></div>
            <div className="space-y-1.5"><Label>Paid on</Label><Input type="date" value={form.paid_on} onChange={(e) => setForm({ ...form, paid_on: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>For tax year</Label><Input inputMode="numeric" value={String(form.tax_year)} onChange={(e) => setForm({ ...form, tax_year: Number(e.target.value.replace(/\D/g, "")) || year })} /></div>
            <div className="space-y-1.5"><Label>Period</Label><Input value={form.period_label} onChange={(e) => setForm({ ...form, period_label: e.target.value })} placeholder="Q3, annual" /></div>
          </div>
          <div className="space-y-1.5"><Label>Confirmation #</Label><Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="Optional" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={busy}>{busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PaymentsList({ payments, year, kind, onChanged }: { payments: TaxPaymentRow[]; year: number; kind: "gst_hst" | "income_tax"; onChanged: () => void }) {
  const delFn = useServerFn(deleteTaxPayment);
  const canDelete = useBooksMode() === "owner";
  const rows = payments.filter((p) => p.tax_year === year && p.kind === kind);
  if (!rows.length) return <p className="text-xs text-muted-foreground">No payments recorded for {year}.</p>;
  return (
    <ul className="divide-y text-sm">
      {rows.map((p) => (
        <li key={p.id} className="flex items-center justify-between gap-2 py-1.5">
          <span>{p.paid_on}{p.period_label ? ` · ${p.period_label}` : ""}{p.reference ? <span className="text-xs text-muted-foreground"> · #{p.reference}</span> : null}</span>
          <span className="flex items-center gap-1">
            <span className="tabular-nums">{money(Number(p.amount_minor))}</span>
            {canDelete && (
              <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Delete payment" onClick={async () => {
                if (!window.confirm("Delete this payment record?")) return;
                try { await delFn({ data: { id: p.id } }); onChanged(); } catch (e: any) { toast.error(e?.message ?? "Could not delete"); }
              }}><Trash2 className="h-3.5 w-3.5" /></Button>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

function GstTab({ s, payments, onChanged }: { s: BooksSnapshot; payments: TaxPaymentRow[]; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const q = s.gst.quickMethod;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Collected (103)" value={money(s.revenue.collectedMinor)} />
        <Kpi label="ITCs (106)" value={money(s.expenses.itcMinor)} tone="good" />
        <Kpi label="Net tax (109)" value={money(s.gst.netTaxMinor)} />
        <Kpi label="Still owing" value={money(s.gst.owingMinor)} sub={`${money(s.gst.paidMinor)} paid`} />
      </div>

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Period ({s.gst.frequency})</th>
              <th className="px-3 py-2 text-right">101 Sales</th>
              <th className="px-3 py-2 text-right">103 Collected</th>
              <th className="px-3 py-2 text-right">106 ITCs</th>
              <th className="px-3 py-2 text-right">109 Net</th>
              <th className="px-3 py-2 text-right">Due</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {s.gst.periods.map((p) => (
              <tr key={p.key}>
                <td className="px-3 py-2">{p.label}{!p.closed && <span className="ml-1.5 text-xs text-muted-foreground">(open)</span>}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(p.salesMinor)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(p.collectedMinor)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(p.itcMinor)}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{money(p.netTaxMinor)}</td>
                <td className="px-3 py-2 text-right text-xs tabular-nums text-muted-foreground">{p.filingDue === p.paymentDue ? p.filingDue : `Pay ${p.paymentDue} · file ${p.filingDue}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">GST/HST payments made</h3>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setOpen(true)}><Plus className="mr-1 h-3.5 w-3.5" /> Record</Button>
          </div>
          <PaymentsList payments={payments} year={s.year} kind="gst_hst" onChanged={onChanged} />
        </Card>
        {q && (
          <Card className="p-4 text-sm">
            <h3 className="mb-2 text-sm font-semibold">Quick Method check</h3>
            <p className="text-muted-foreground">
              On {money(q.eligibleSalesGrossMinor)} of GST sales (tax in), the Quick Method (3.6% less a 1% credit on the first $30k) would be about{" "}
              <strong className="text-foreground">{money(q.remitMinor)}</strong> vs <strong className="text-foreground">{money(q.regularMinor)}</strong> on the regular method.
            </p>
            <p className={cn("mt-2 font-medium", q.savingsMinor > 0 ? "text-emerald-600" : "text-muted-foreground")}>
              {q.savingsMinor > 0 ? `About ${money(q.savingsMinor)} less. Ask your accountant about electing (form GST74).` : "The regular method is cheaper for you right now."}
            </p>
          </Card>
        )}
      </div>
      <TaxPaymentDialog open={open} onClose={() => setOpen(false)} year={s.year} kind="gst_hst" onSaved={onChanged} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function YearEndTab({
  s, payments, onChanged, onExport, exporting,
}: {
  s: BooksSnapshot;
  payments: TaxPaymentRow[];
  onChanged: () => void;
  onExport: (k: string) => void;
  exporting: string | null;
}) {
  const [open, setOpen] = useState(false);
  const corp = s.settings.businessStructure === "corporation";
  const est = [
    { label: "Net business income", ytd: s.incomeTax.ytd.netBusinessIncomeMinor, proj: s.incomeTax.projected.netBusinessIncomeMinor },
    ...(corp ? [] : [
      { label: "CPP (both halves)", ytd: s.incomeTax.ytd.cpp.totalMinor, proj: s.incomeTax.projected.cpp.totalMinor },
      { label: "Income tax (federal + MB)", ytd: s.incomeTax.ytd.incomeTaxOnBusinessMinor, proj: s.incomeTax.projected.incomeTaxOnBusinessMinor },
    ]),
    { label: corp ? "Corporate tax" : "Total income tax + CPP", ytd: s.incomeTax.ytd.totalMinor, proj: s.incomeTax.projected.totalMinor, bold: true },
    { label: "Already paid", ytd: -s.incomeTax.paidMinor || 0, proj: -s.incomeTax.paidMinor || 0 },
    { label: "Still owing", ytd: s.incomeTax.owingNowMinor, proj: s.incomeTax.owingProjectedMinor, bold: true },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="overflow-hidden p-0">
          <div className="border-b px-4 py-3">
            <h3 className="text-sm font-semibold">T2125 statement of business activities</h3>
            <p className="text-xs text-muted-foreground">The lines your accountant enters. GST/HST excluded.</p>
          </div>
          <table className="w-full text-sm">
            <tbody className="divide-y">
              {s.t2125.map((l) => (
                <tr key={l.line} className={cn(l.line === "9369" && "bg-muted/40 font-semibold")}>
                  <td className="w-14 px-4 py-2 text-xs tabular-nums text-muted-foreground">{l.line}</td>
                  <td className="py-2">{l.label}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{money(l.amountMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card className="overflow-hidden p-0">
          <div className="border-b px-4 py-3">
            <h3 className="text-sm font-semibold">{corp ? "Corporate tax estimate" : "Income tax + CPP estimate"}</h3>
            <p className="text-xs text-muted-foreground">
              {s.incomeTax.ytd.ratesYear} federal + Manitoba rates{s.incomeTax.ytd.ratesExact ? "" : " (latest loaded)"}.
              {!corp && s.settings.otherIncomeAnnualMinor > 0 ? ` Stacked on ${money(s.settings.otherIncomeAnnualMinor)} other income.` : ""}
            </p>
          </div>
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted-foreground">
              <tr><th /><th className="px-4 py-2 text-right">So far</th><th className="px-4 py-2 text-right">{s.inProgress ? "By Dec 31" : "Final"}</th></tr>
            </thead>
            <tbody className="divide-y">
              {est.map((r) => (
                <tr key={r.label} className={cn(r.bold && "font-semibold")}>
                  <td className="px-4 py-2">{r.label}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{money(r.ytd)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{money(r.proj)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!corp && (
            <p className="border-t px-4 py-2 text-xs text-muted-foreground">
              Marginal rate on the next dollar: {pct(s.incomeTax.projected.marginalRate)}. Effective: {pct(s.incomeTax.projected.effectiveRate)}.
            </p>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Income tax payments made</h3>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setOpen(true)}><Plus className="mr-1 h-3.5 w-3.5" /> Record</Button>
          </div>
          <PaymentsList payments={payments} year={s.year} kind="income_tax" onChanged={onChanged} />
        </Card>
        <Card className="p-4">
          <h3 className="mb-2 text-sm font-semibold">Send to your accountant</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button variant="outline" className="justify-start" disabled={!!exporting} onClick={() => onExport("year-end")}><FileText className="mr-2 h-4 w-4" /> Year-end package</Button>
            {s.gst.registered && <Button variant="outline" className="justify-start" disabled={!!exporting} onClick={() => onExport("gst")}><FileText className="mr-2 h-4 w-4" /> GST/HST worksheet</Button>}
            <Button variant="outline" className="justify-start" disabled={!!exporting} onClick={() => onExport("receipts")}><Paperclip className="mr-2 h-4 w-4" /> Receipts book</Button>
            <Button variant="outline" className="justify-start" disabled={!!exporting} onClick={() => onExport("expenses-csv")}><FileSpreadsheet className="mr-2 h-4 w-4" /> Expenses CSV</Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Keep receipts and these records for 6 years. Estimates are for planning; your accountant files the final numbers.</p>
        </Card>
      </div>
      <TaxPaymentDialog open={open} onClose={() => setOpen(false)} year={s.year} kind="income_tax" onSaved={onChanged} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function SummerSettingsCard({ onSaved }: { onSaved: () => void }) {
  const qc = useQueryClient();
  const profileFn = useServerFn(getSummerProfile);
  const [open, setOpen] = useState(false);
  const { data: profile } = useQuery({
    queryKey: ["summer-profile"],
    queryFn: () => profileFn() as Promise<{ tone: string | null; instructions: string | null; isOwner: boolean }>,
    staleTime: 5 * 60_000,
  });
  const persona = { tone: profile?.tone, instructions: profile?.instructions };
  const tone = summerTone(persona.tone);
  return (
    <Card className="max-w-2xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-300 to-orange-500 text-white">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold">{ASSISTANT_NAME}</div>
            <p className="text-xs text-muted-foreground">Vibe: {tone.label}. {persona.instructions?.trim() ? "Your custom instructions are on." : "No custom instructions yet."}</p>
          </div>
        </div>
        <Button size="sm" variant="outline" className="shrink-0" onClick={() => setOpen(true)}>
          <SlidersHorizontal className="mr-1.5 h-4 w-4" /> Customize
        </Button>
      </div>
      <SummerCustomizeDialog
        open={open}
        onClose={() => setOpen(false)}
        persona={persona}
        onSaved={() => {
          onSaved();
          qc.invalidateQueries({ queryKey: ["summer-profile"] });
        }}
      />
    </Card>
  );
}

function SettingsTab({ data, onSaved }: { data: BooksData; onSaved: () => void }) {
  const mode = useBooksMode();
  return (
    <div className="space-y-4">
      {mode === "owner" && <SummerSettingsCard onSaved={onSaved} />}
      <TaxSettingsForm data={data} onSaved={onSaved} />
    </div>
  );
}

function TaxSettingsForm({ data, onSaved }: { data: BooksData; onSaved: () => void }) {
  const saveFn = useServerFn(saveTaxSettings);
  const st = toTaxSettings(data.settings);
  const [form, setForm] = useState({
    business_name: st.businessName,
    business_structure: st.businessStructure,
    gst_registered: st.gstRegistered,
    gst_number: st.gstNumber ?? "",
    gst_filing_frequency: st.gstFilingFrequency,
    other_income: minorToInput(st.otherIncomeAnnualMinor),
    accountant_name: st.accountantName ?? "",
    notes: data.settings?.notes ?? "",
  });
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const other = parseMoneyToMinor(form.other_income || "0");
    if (other == null) return void toast.error("Other income must be a number");
    setBusy(true);
    try {
      await saveFn({
        data: {
          business_name: form.business_name.trim() || "Jared James Fit",
          business_structure: form.business_structure,
          gst_registered: form.gst_registered,
          gst_number: form.gst_number.trim() || null,
          gst_filing_frequency: form.gst_filing_frequency,
          other_income_annual_minor: other,
          accountant_name: form.accountant_name.trim() || null,
          notes: form.notes.trim() || null,
        },
      });
      toast.success("Tax settings saved");
      onSaved();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="max-w-2xl space-y-4 p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Business name (on the PDFs)</Label>
          <Input value={form.business_name} onChange={(e) => setForm({ ...form, business_name: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label>Business structure</Label>
          <Select value={form.business_structure} onValueChange={(v) => setForm({ ...form, business_structure: v as any })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="sole_proprietor">Sole proprietor (T2125)</SelectItem>
              <SelectItem value="corporation">Corporation (T2)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Province</Label>
          <Input value="Manitoba" disabled />
        </div>
        <div className="flex items-center justify-between rounded-md border p-3 sm:col-span-2">
          <div>
            <div className="text-sm font-medium">GST/HST registered</div>
            <div className="text-xs text-muted-foreground">You charge GST through Stripe, so this should stay on.</div>
          </div>
          <Switch checked={form.gst_registered} onCheckedChange={(v) => setForm({ ...form, gst_registered: v })} />
        </div>
        {form.gst_registered && (
          <>
            <div className="space-y-1.5">
              <Label>GST/HST number</Label>
              <Input value={form.gst_number} onChange={(e) => setForm({ ...form, gst_number: e.target.value.toUpperCase() })} placeholder="123456789RT0001" />
            </div>
            <div className="space-y-1.5">
              <Label>Filing frequency</Label>
              <Select value={form.gst_filing_frequency} onValueChange={(v) => setForm({ ...form, gst_filing_frequency: v as any })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="annual">Annual</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">It's on your GST registration letter from CRA. Most new small businesses file annually.</p>
            </div>
          </>
        )}
        <div className="space-y-1.5">
          <Label>Other income this year</Label>
          <Input inputMode="decimal" value={form.other_income} onChange={(e) => setForm({ ...form, other_income: e.target.value })} placeholder="0.00" />
          <p className="text-xs text-muted-foreground">Job or other income, so the estimate uses your real tax bracket.</p>
        </div>
        <div className="space-y-1.5">
          <Label>Accountant</Label>
          <Input value={form.accountant_name} onChange={(e) => setForm({ ...form, accountant_name: e.target.value })} placeholder="Name or firm" />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Notes for {ASSISTANT_NAME} and your accountant</Label>
          <Textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="e.g. Home office is 10% of the apartment. Car is 30% business." />
        </div>
      </div>
      <div className="flex justify-end">
        <Button onClick={() => void submit()} disabled={busy}>{busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Save settings</Button>
      </div>
      <p className="text-xs text-muted-foreground">{ASSISTANT_NAME} uses these to answer questions. Only admins can see Taxes & Books.</p>
    </Card>
  );
}
