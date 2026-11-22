/**
 * The money workspace: Overview, Transactions, Taxes and Reports over one
 * period. The books (payments, expenses, tax payments) load once and every
 * figure is worked out on the phone from them (money-view.ts); what clients
 * owe is read from the Billing model on the server (getReceivables). The
 * period lives in the address, so Back and shared links keep it.
 *
 * Used by Sales (the owner) and the finance login's Books page.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Camera, ChevronDown, FilePlus2, HandCoins, Landmark, Loader2, MessageCircle, Plus, Repeat } from "lucide-react";
import { useCleoAccess } from "@/hooks/use-cleo-access";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { ASSISTANT_NAME, toExpenseEntry, toTaxPaymentEntry, toTaxSettings, type ExpenseRow, type OtherIncomeRow } from "@/lib/business-books";
import { buildBooksSnapshot, fmtCad } from "@/lib/business-tax";
import { expenseCategory } from "@/lib/business-expense-categories";
import { businessToday } from "@/lib/billing-schedule";
import { RECEIPT_ACCEPT } from "@/lib/receipt-upload";
import { comparisonFor, decodePeriod, elapsed, encodePeriod, periodFor, type CompareMode, type Period } from "@/lib/books/period";
import { booksFirstDay, moneyFigures, periodTaxReserve, type LedgerFilter } from "@/lib/books/money-view";
import { RECEIVABLES_KEY, useReceivables } from "./use-receivables";
import { useBooksData } from "@/components/admin/finance/finance-ui";
import { ExpenseDialog } from "@/components/admin/books/expense-dialog";
import { OtherIncomeDialog } from "@/components/admin/books/other-income-dialog";
import { RecurringBillDialog, type BillDraft } from "@/components/admin/books/recurring-bills";
import { BOOKS_KEY, useSnapReceipts } from "@/components/admin/books/use-snap-receipts";
import { BooksModeContext, type BooksMode } from "@/components/admin/books/books-mode";
import { openSummer } from "@/components/summer/summer-assistant";
import { TaxPaymentDialog } from "./books-pieces";
import { MONEY_VIEWS, MoneyContext, type MoneyCtx, type MoneyView } from "./money-context";
import { PeriodBar } from "./period-bar";
import { MoneyOverview } from "./money-overview";
import { MoneyLedger } from "./money-ledger";
import { MoneyTaxes } from "./money-taxes";
import { MoneyReports } from "./money-reports";
import { useScrollFade } from "@/hooks/use-scroll-fade";


export type MoneyState = { view?: MoneyView; p?: string; cmp?: CompareMode };

export function MoneyWorkspace({ view, periodCode, compare = "previous", onState, mode, tabs = false, initialLedger }: {
  view: MoneyView;
  periodCode?: string;
  compare?: CompareMode;
  onState: (patch: MoneyState) => void;
  mode: BooksMode;
  /** Show the Overview · Transactions · Taxes · Reports row (pages without their own menu). */
  tabs?: boolean;
  /** Open Transactions on this filter (an old "receipts to check" link). */
  initialLedger?: Partial<LedgerFilter> | null;
}) {
  const qc = useQueryClient();
  const today = businessToday();
  const cleoOn = useCleoAccess();
  const books = useBooksData();
  const receivables = useReceivables();
  const { snap, scanning, label: snapLabel } = useSnapReceipts();
  const fileRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<ExpenseRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [taxPay, setTaxPay] = useState(false);
  const [income, setIncome] = useState<OtherIncomeRow | "new" | null>(null);
  const [bill, setBill] = useState<{ draft: BillDraft } | null>(null);
  const [ledgerPreset, setLedgerPreset] = useState<Partial<LedgerFilter> | null>(initialLedger ?? null);

  // A filter a tap elsewhere opened Transactions with stays only while Transactions is open.
  useEffect(() => {
    if (view !== "transactions") setLedgerPreset(null);
  }, [view]);

  const period: Period = useMemo(() => decodePeriod(periodCode, today) ?? periodFor("this_month", today), [periodCode, today]);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: BOOKS_KEY });
    void qc.invalidateQueries({ queryKey: RECEIVABLES_KEY });
  };

  const derived = useMemo(() => {
    const data = books.data;
    if (!data) return null;
    const settings = toTaxSettings(data.settings);
    const expenses = data.expenses.map(toExpenseEntry);
    const seen = elapsed(period, today);
    // Nothing to compare with before the books start: no "None in …" on every figure.
    const asked = comparisonFor(period, compare, today);
    const firstDay = booksFirstDay(data.revenue, expenses);
    const vs = asked && (!firstDay || asked.end < firstDay) ? null : asked;
    const noEarlier = !!asked && !vs;
    const figures = moneyFigures({ revenue: data.revenue, expenses, settings, range: seen });
    const prev = vs ? moneyFigures({ revenue: data.revenue, expenses, settings, range: vs }) : null;
    const reserve = periodTaxReserve({ revenue: data.revenue, expenses, settings, range: seen });
    const snapshot = buildBooksSnapshot({
      year: Number(seen.end.slice(0, 4)),
      asOf: data.asOf,
      settings,
      revenue: data.revenue,
      expenses,
      taxPayments: data.taxPayments.map(toTaxPaymentEntry),
    });
    return { data, settings, expenses, vs, noEarlier, figures, prev, reserve, snapshot };
  }, [books.data, period, compare, today]);

  const onFiles = async (files: FileList | null) => {
    const res = await snap(files);
    if (!res) return;
    if (res.count === 1 && res.last) {
      if (res.last.status === "reviewed") {
        toast.success(`${ASSISTANT_NAME} filed it: ${res.last.vendor ?? "Receipt"} ${fmtCad(Number(res.last.amount_minor))}, ${expenseCategory(res.last.category).label}`);
      } else {
        setEditing(res.last);
      }
    } else if (res.count > 1) {
      toast.success(`${res.filed} filed${res.unread ? `, ${res.unread} to check` : ""}`);
    }
    void qc.invalidateQueries({ queryKey: RECEIVABLES_KEY });
  };

  if (books.isLoading) return <MoneySkeleton />;
  if (books.error || !derived) {
    return (
      <div className="p-4 md:p-6">
        <Card className="border-destructive/30 p-4 text-[14px] text-destructive">
          Couldn't load the books: {(books.error as any)?.message ?? "unknown error"}
          <Button variant="outline" size="sm" className="ml-3 h-9" onClick={() => void books.refetch()}>Try again</Button>
        </Card>
      </div>
    );
  }

  const firstYear = Math.min(...(derived.data.years.length ? derived.data.years : [Number(today.slice(0, 4))]));
  const ctx: MoneyCtx = {
    data: derived.data,
    mode,
    today,
    settings: derived.settings,
    period,
    compare,
    vs: derived.vs,
    revenue: derived.data.revenue,
    expenses: derived.expenses,
    figures: derived.figures,
    reserve: derived.reserve,
    prev: derived.prev,
    snapshot: derived.snapshot,
    receivables: receivables.data ?? null,
    receivablesError: receivables.error ? "Couldn't read client balances right now." : null,
    setPeriod: (p) => onState({ p: encodePeriod(p) }),
    go: (v, ledger) => {
      if (ledger) setLedgerPreset({ ...ledger });
      onState({ view: v });
      if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
    },
    ledgerPreset,
    openExpense: (row) => (row === "new" ? setAdding(true) : setEditing(row)),
    openOtherIncome: (row) => setIncome(row),
    openBill: (draft) => setBill({ draft }),
    snapReceipt: () => fileRef.current?.click(),
    snapping: scanning,
    snapLabel,
    refresh,
  };

  return (
    <BooksModeContext.Provider value={mode}>
      <MoneyContext.Provider value={ctx}>
        <div className="space-y-4 p-4 md:p-6" data-money={view}>
          {tabs ? <MoneyTabs view={view} onView={(v) => onState({ view: v })} /> : null}
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 lg:w-[30rem]">
              <PeriodBar
                period={period}
                compare={compare}
                vs={derived.vs}
                noEarlier={derived.noEarlier}
                showCompare={view === "overview" || view === "reports"}
                today={today}
                firstYear={firstYear}
                onPeriod={(p) => onState({ p: encodePeriod(p) })}
                onCompare={(c) => onState({ cmp: c })}
              />
            </div>
            <div className="flex gap-2">
              <input ref={fileRef} type="file" accept={RECEIPT_ACCEPT} multiple className="hidden" onChange={(e) => { void onFiles(e.target.files); e.target.value = ""; }} />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button className="h-10 flex-1 lg:flex-none" disabled={scanning} data-money-add>
                    {scanning ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Plus className="mr-1.5 h-4 w-4" />}
                    {scanning ? snapLabel : "Add"}
                    <ChevronDown className="ml-1 h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  <DropdownMenuItem onSelect={() => fileRef.current?.click()}><Camera className="mr-2 h-4 w-4" /> Snap a receipt</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setAdding(true)}><FilePlus2 className="mr-2 h-4 w-4" /> Add an expense by hand</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setBill({ draft: null })}><Repeat className="mr-2 h-4 w-4" /> Set up a repeating bill</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setIncome("new")}><HandCoins className="mr-2 h-4 w-4" /> Record other income</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setTaxPay(true)}><Landmark className="mr-2 h-4 w-4" /> Record a payment to CRA</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {cleoOn && (
                <Button variant="outline" className="h-10" onClick={() => openSummer({ year: Number(elapsed(period, today).end.slice(0, 4)) })} aria-label={`Ask ${ASSISTANT_NAME}`}>
                  <MessageCircle className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">Ask {ASSISTANT_NAME}</span>
                </Button>
              )}
            </div>
          </div>

          {view === "overview" && <MoneyOverview />}
          {view === "transactions" && <MoneyLedger />}
          {view === "taxes" && <MoneyTaxes />}
          {view === "reports" && <MoneyReports />}
        </div>

        <ExpenseDialog
          expense={editing}
          open={!!editing || adding}
          onClose={() => { setEditing(null); setAdding(false); }}
          onChanged={refresh}
          gstRegistered={derived.settings.gstRegistered}
        />
        <OtherIncomeDialog
          income={income === "new" ? null : income}
          open={income !== null}
          onClose={() => setIncome(null)}
          onChanged={refresh}
          gstRegistered={derived.settings.gstRegistered}
        />
        <RecurringBillDialog
          draft={bill?.draft ?? null}
          open={bill !== null}
          onClose={() => setBill(null)}
          onChanged={refresh}
          gstRegistered={derived.settings.gstRegistered}
        />
        <TaxPaymentDialog open={taxPay} onClose={() => setTaxPay(false)} year={Number(elapsed(period, today).end.slice(0, 4))} kind="gst_hst" onSaved={refresh} />
      </MoneyContext.Provider>
    </BooksModeContext.Provider>
  );
}

/** Overview · Transactions · Taxes · Reports as one row of words (the client tabs' style). */
export function MoneyTabs({ view, onView }: { view: MoneyView; onView: (v: MoneyView) => void }) {
  const { ref, style } = useScrollFade<HTMLDivElement>();
  return (
    <nav aria-label="Money" className="-mx-4 border-b border-border px-4 sm:mx-0 sm:px-0">
      <div ref={ref} style={style} className="-mb-px flex overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {MONEY_VIEWS.map((t) => {
          const on = view === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => onView(t.key)}
              aria-current={on ? "page" : undefined}
              className={cn("relative flex h-11 shrink-0 items-center px-3 text-[15px]", on ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {t.label}
              <span aria-hidden className={cn("absolute inset-x-3 bottom-0 h-0.5 rounded-full", on ? "bg-foreground" : "bg-transparent")} />
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function MoneySkeleton() {
  return (
    <div className="space-y-4 p-4 md:p-6" aria-busy="true">
      <Skeleton className="h-10 w-full max-w-md rounded-full" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
      </div>
      <Skeleton className="h-36 rounded-2xl" />
      <Skeleton className="h-72 rounded-2xl" />
    </div>
  );
}
