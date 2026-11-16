/**
 * Reports: the period's profit and loss on screen, and every report as a file
 * for a spreadsheet or the accountant (the phone's share sheet, a download on
 * a computer). Each is built from the same figures as the screens.
 */
import { Fragment, useState } from "react";
import { toast } from "sonner";
import { FileSpreadsheet, FileText, Loader2, Paperclip } from "lucide-react";
import { cn } from "@/lib/utils";
import { saveFiles } from "@/lib/file-share";
import { receiptSignedUrl } from "@/lib/receipt-upload";
import { elapsed } from "@/lib/books/period";
import { ledgerEntries } from "@/lib/books/money-view";
import { gstCsv, profitAndLoss, receivablesCsv, statementCsv, transactionsCsv } from "@/lib/books/reports";
import { useMoney } from "./money-context";
import { MoneyCard, money } from "./money-ui";

type Report = {
  key: string;
  title: string;
  sub: string;
  icon: typeof FileText;
  build: () => Promise<File | null>;
  /** Only when it applies. */
  show?: boolean;
};

export function MoneyReports() {
  const m = useMoney();
  const [busy, setBusy] = useState<string | null>(null);
  const [ready, setReady] = useState<{ key: string; file: File } | null>(null);
  const seen = elapsed(m.period, m.today);
  const rows = profitAndLoss(m.figures, m.prev, m.settings.gstRegistered);
  const vsLabel = m.vs?.label ?? null;
  const name = m.settings.businessName;
  const tag = m.period.label;
  const slugged = (s: string) => s.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  const s = m.snapshot;

  const reports: Report[] = [
    {
      key: "pnl-pdf", title: "Profit and loss (PDF)", sub: `${tag}${vsLabel ? `, beside ${vsLabel}` : ""}`, icon: FileText,
      build: async () => {
        const ex = await import("@/lib/books-export");
        return ex.statementPdfFile({ businessName: name, title: "Profit and loss", periodLabel: tag, vsLabel, rows, footnote: "Sales are payments received less refunds, GST/HST excluded. Expenses are the business-use share before GST/HST claimed back; personal spending is left out. Taxable profit is an estimate for planning; the accountant files the final numbers." });
      },
    },
    {
      key: "pnl-csv", title: "Profit and loss (CSV)", sub: tag, icon: FileSpreadsheet,
      build: async () => (await import("@/lib/books-export")).textFile(`${slugged(name)}-profit-and-loss-${slugged(tag)}.csv`, statementCsv(`${name}: profit and loss`, tag, vsLabel, rows)),
    },
    {
      key: "tx-csv", title: "Every transaction (CSV)", sub: `Money in and out, ${tag}`, icon: FileSpreadsheet,
      build: async () => (await import("@/lib/books-export")).textFile(
        `${slugged(name)}-transactions-${slugged(tag)}.csv`,
        transactionsCsv(ledgerEntries({ revenue: m.revenue, expenses: m.data.expenses, taxPayments: m.data.taxPayments, settings: m.settings, range: seen })),
      ),
    },
    {
      key: "gst-csv", title: "GST/HST lines (CSV)", sub: `Lines 101 to 109, ${tag}`, icon: FileSpreadsheet, show: m.settings.gstRegistered,
      build: async () => (await import("@/lib/books-export")).textFile(`${slugged(name)}-gst-hst-${slugged(tag)}.csv`, gstCsv(tag, m.figures)),
    },
    {
      key: "owed-csv", title: "What clients owe (CSV)", sub: "As of today, client by client", icon: FileSpreadsheet, show: !!m.receivables,
      build: async () => (await import("@/lib/books-export")).textFile(`${slugged(name)}-owed-${m.today}.csv`, receivablesCsv(m.receivables!)),
    },
    {
      key: "year-end", title: `${s.year} year-end package (PDF)`, sub: "T2125 lines, expenses by category, GST/HST, estimates", icon: FileText,
      build: async () => (await import("@/lib/books-export")).yearEndPdfFile(s, m.data),
    },
    {
      key: "gst-worksheet", title: `${s.year} GST/HST worksheet (PDF)`, sub: "Every filing period", icon: FileText, show: m.settings.gstRegistered,
      build: async () => (await import("@/lib/books-export")).gstWorksheetPdfFile(s),
    },
    {
      key: "receipts", title: `${s.year} receipts book (PDF)`, sub: "One receipt a page, in date order", icon: Paperclip,
      build: async () => {
        const f = await (await import("@/lib/books-export")).receiptsPdfFile(s, m.data.expenses, (p) => receiptSignedUrl(p, 900));
        if (!f) toast.message(`No receipts on file for ${s.year} yet`);
        return f;
      },
    },
    {
      key: "revenue-csv", title: `${s.year} revenue (CSV)`, sub: "Every payment and refund", icon: FileSpreadsheet,
      build: async () => (await import("@/lib/books-export")).revenueCsvFile(s, m.data),
    },
    {
      key: "expenses-csv", title: `${s.year} expenses (CSV)`, sub: "With T2125 lines, deductible and ITC", icon: FileSpreadsheet,
      build: async () => (await import("@/lib/books-export")).expensesCsvFile(s, m.data),
    },
  ].filter((r) => r.show !== false);

  const hand = async (key: string, file: File) => {
    const out = await saveFiles([file]);
    if (out === "again") {
      setReady({ key, file });
      toast.message("Ready. Tap Save to keep it.");
    } else {
      setReady(null);
      if (out === "failed") toast.error("Couldn't save the file");
    }
  };

  const run = async (r: Report) => {
    if (ready?.key === r.key) return hand(r.key, ready.file);
    setBusy(r.key);
    try {
      const file = await r.build();
      if (file) await hand(r.key, file);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't make the report");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]" data-money-reports>
      <MoneyCard title={`Profit and loss · ${tag}`}>
        <table className="w-full text-[14px]" data-report-pnl>
          {vsLabel ? (
            <thead className="text-[12px] text-muted-foreground">
              <tr><th /><th className="pb-1 text-right font-medium">{tag}</th><th className="pb-1 pl-3 text-right font-medium">{vsLabel}</th></tr>
            </thead>
          ) : null}
          <tbody>
            {rows.map((r, i) => {
              const memo = r.label.startsWith("Memo: ");
              const firstMemo = memo && !rows[i - 1]?.label.startsWith("Memo: ");
              const label = memo ? r.label.slice(6, 7).toUpperCase() + r.label.slice(7) : r.label;
              return (
                <Fragment key={i}>
                  {firstMemo ? (
                    <tr><td colSpan={vsLabel ? 3 : 2} className="pb-1 pt-4 text-[12px] font-medium text-muted-foreground">Not part of profit</td></tr>
                  ) : null}
                  <tr className={cn(r.strong && "font-semibold", memo && "text-muted-foreground", r.label === "Profit before income tax" && "border-t border-border")}>
                    <td className={cn("py-1.5 pr-2", r.indent && "pl-4")}>
                      {label}
                      {r.note ? <span className="block text-[12px] font-normal text-muted-foreground">{r.note}</span> : null}
                    </td>
                    <td className="py-1.5 text-right align-top tabular-nums">{r.minor == null ? "" : money(r.minor)}</td>
                    {vsLabel ? <td className="py-1.5 pl-3 text-right align-top tabular-nums text-muted-foreground">{r.prevMinor == null ? "" : money(r.prevMinor)}</td> : null}
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
        <p className="mt-2 text-[12px] text-muted-foreground">Cash basis: money is counted the day it moved.</p>
      </MoneyCard>

      <MoneyCard title="Download">
        <ul className="divide-y divide-border" data-report-list>
          {reports.map((r) => {
            const Icon = r.icon;
            const isReady = ready?.key === r.key;
            return (
              <li key={r.key}>
                <button type="button" onClick={() => void run(r)} disabled={!!busy && busy !== r.key} className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-muted/30 disabled:opacity-50">
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium">{r.title}</span>
                    <span className="block truncate text-[12px] text-muted-foreground">{r.sub}</span>
                  </span>
                  {busy === r.key ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : isReady ? <span className="rounded-full bg-foreground px-2.5 py-1 text-[12px] text-background">Save</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-[12px] text-muted-foreground">Keep receipts and records for 6 years. The period reports follow the dates picked above; the year's follow the year it ends in.</p>
      </MoneyCard>
    </div>
  );
}
