/**
 * Transactions: every dollar in and out in the period, in one list. Money in
 * comes from client payments (the payment ledger, never edited here) and other
 * income (business_other_income, edited here), money out from expenses (edit,
 * attach a receipt; a repeating bill's link back to it), and payments to CRA. Filters
 * fit what's shown: services for money in, categories for money out. The
 * totals line is always the sum of the rows on screen.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Paperclip, Repeat, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { EXPENSE_CATEGORIES, expenseCategory } from "@/lib/business-expense-categories";
import { deleteTaxPayment, markExpensesReviewed } from "@/lib/business-books.functions";
import { receiptSignedUrl } from "@/lib/receipt-upload";
import { NO_TAX_REASONS } from "@/lib/business-books";
import { rhythmWords } from "@/components/admin/books/recurring-bills";
import { billingDay } from "@/lib/date-range";
import { elapsed } from "@/lib/books/period";
import {
  NEEDS_ATTENTION, SERVICE_LABEL, filterLedger, ledgerEntries, ledgerTotals, methodWord,
  type LedgerEntry, type LedgerFilter, type LedgerFlag,
} from "@/lib/books/money-view";
import { useMoney } from "./money-context";
import { money } from "./money-ui";

const FLAG_WORD: Record<LedgerFlag, string> = {
  needs_review: "Check it",
  no_receipt: "No receipt",
  uncategorized: "No category",
  personal: "Personal",
  no_gst: "No GST/HST recorded",
  tax_estimated: "GST/HST estimated",
  foreign: "Not CAD",
};

const TYPES: Array<{ key: LedgerFilter["type"]; label: string }> = [
  { key: "all", label: "All" },
  { key: "in", label: "Money in" },
  { key: "out", label: "Money out" },
];

export function MoneyLedger() {
  const m = useMoney();
  const seen = elapsed(m.period, m.today);
  const all = useMemo(
    () => ledgerEntries({ revenue: m.revenue, expenses: m.data.expenses, taxPayments: m.data.taxPayments, settings: m.settings, range: seen }),
    [m.revenue, m.data.expenses, m.data.taxPayments, m.settings, seen.start, seen.end],
  );
  const [filter, setFilter] = useState<LedgerFilter>({ type: "all", ...(m.ledgerPreset ?? {}) });
  useEffect(() => {
    if (m.ledgerPreset) setFilter({ type: "all", ...m.ledgerPreset });
  }, [m.ledgerPreset]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [limit, setLimit] = useState(60);

  const rows = useMemo(() => filterLedger(all, filter), [all, filter]);
  const totals = ledgerTotals(rows);
  const attentionCount = useMemo(() => filterLedger(all, { type: filter.type, attention: true }).length, [all, filter.type]);
  const methods = useMemo(() => [...new Set(all.map((r) => (r.method ?? "other").toLowerCase()))].sort(), [all]);
  const groups = useMemo(() => {
    const ins = Object.entries(SERVICE_LABEL).map(([k, v]) => ({ key: k, label: v, side: "in" as const }));
    const outs = EXPENSE_CATEGORIES.map((c) => ({ key: c.key, label: c.label, side: "out" as const }));
    const present = new Set(all.map((r) => r.group));
    return [...(filter.type !== "out" ? ins : []), ...(filter.type !== "in" ? outs : [])].filter((g) => present.has(g.key));
  }, [all, filter.type]);

  const set = (patch: Partial<LedgerFilter>) => {
    setFilter((f) => ({ ...f, ...patch }));
    setLimit(60);
  };
  const filtered = !!(filter.group || filter.method || filter.attention || filter.q);

  return (
    <div className="space-y-3" data-money-ledger>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex rounded-lg border border-border p-0.5" role="tablist" aria-label="Money in or out">
          {TYPES.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={filter.type === t.key}
              onClick={() => set({ type: t.key, group: null })}
              className={cn("h-9 flex-1 rounded-md px-3 text-[14px] sm:flex-none", filter.type === t.key ? "bg-secondary font-semibold text-foreground" : "text-muted-foreground")}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input value={filter.q ?? ""} onChange={(e) => set({ q: e.target.value })} placeholder="Search client, vendor, notes, reference" className="h-10 pl-9" />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => set({ attention: !filter.attention })}
          aria-pressed={!!filter.attention}
          className={cn("h-9 rounded-full border px-3.5 text-[13px]", filter.attention ? "border-foreground bg-foreground text-background" : "border-border")}
          data-ledger-attention
        >
          Needs a look{attentionCount ? ` · ${attentionCount}` : ""}
        </button>
        <Select value={filter.group ?? "any"} onValueChange={(v) => set({ group: v === "any" ? null : v })}>
          <SelectTrigger className="h-9 w-auto min-w-36 rounded-full text-[13px]" aria-label="Service or category"><SelectValue /></SelectTrigger>
          <SelectContent className="max-h-80">
            <SelectItem value="any">{filter.type === "in" ? "Every service" : filter.type === "out" ? "Every category" : "Everything"}</SelectItem>
            {groups.map((g) => <SelectItem key={`${g.side}:${g.key}`} value={g.key}>{g.label}</SelectItem>)}
          </SelectContent>
        </Select>
        {methods.length > 1 ? (
          <Select value={filter.method ?? "any"} onValueChange={(v) => set({ method: v === "any" ? null : v })}>
            <SelectTrigger className="h-9 w-auto min-w-32 rounded-full text-[13px]" aria-label="Payment method"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any method</SelectItem>
              {methods.map((x) => <SelectItem key={x} value={x}>{methodWord(x === "other" ? null : x)}</SelectItem>)}
            </SelectContent>
          </Select>
        ) : null}
        {filtered ? (
          <Button variant="ghost" size="sm" className="h-9" onClick={() => setFilter({ type: filter.type })}><X className="mr-1 h-3.5 w-3.5" /> Clear</Button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-y border-border py-2 text-[13px]" data-ledger-totals>
        <span className="text-muted-foreground">{totals.count} item{totals.count === 1 ? "" : "s"} · {m.period.label}</span>
        <span className="tabular-nums">
          {filter.type !== "out" ? <>In <span className="font-semibold">{money(totals.inMinor)}</span></> : null}
          {filter.type === "all" ? " · " : null}
          {filter.type !== "in" ? <>Out <span className="font-semibold">{money(totals.outMinor)}</span></> : null}
        </span>
      </div>

      {filter.attention && filter.type !== "in" ? <ConfirmAll rows={rows} /> : null}

      {rows.length ? (
        <ul className="divide-y divide-border" data-ledger-rows>
          {rows.slice(0, limit).map((r) => (
            <LedgerRow key={r.id} r={r} open={openId === r.id} onToggle={() => setOpenId(openId === r.id ? null : r.id)} />
          ))}
        </ul>
      ) : (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center text-[14px] text-muted-foreground">
          {all.length ? "Nothing matches these filters." : `No money in or out in ${m.period.label}.`}
          {!all.length ? (
            <div className="mt-3 flex justify-center gap-2">
              <Button variant="outline" size="sm" className="h-9" onClick={m.snapReceipt}>Snap a receipt</Button>
              <Button variant="outline" size="sm" className="h-9" onClick={() => m.openExpense("new")}>Add an expense</Button>
            </div>
          ) : null}
        </div>
      )}
      {rows.length > limit ? (
        <Button variant="outline" className="h-10 w-full" onClick={() => setLimit(limit + 60)}>Show {Math.min(60, rows.length - limit)} more</Button>
      ) : null}
    </div>
  );
}

/** "Needs a look" on receipts Cleo read: confirm the ones that look complete in one tap. */
function ConfirmAll({ rows }: { rows: LedgerEntry[] }) {
  const m = useMoney();
  const markFn = useServerFn(markExpensesReviewed);
  const ready = rows.filter((r) => r.expense && r.flags.includes("needs_review") && r.expense.category !== "uncategorized" && Number(r.expense.amount_minor) > 0);
  if (ready.length < 2) return null;
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-muted/50 px-3 py-2 text-[13px]">
      <span>{ready.length} read receipts look complete.</span>
      <Button size="sm" variant="outline" className="h-9" onClick={async () => {
        try {
          await markFn({ data: { ids: ready.map((r) => r.expense!.id) } });
          toast.success("Confirmed");
          m.refresh();
        } catch (e: any) {
          toast.error(e?.message ?? "Couldn't confirm them");
        }
      }}>Confirm all</Button>
    </div>
  );
}

function LedgerRow({ r, open, onToggle }: { r: LedgerEntry; open: boolean; onToggle: () => void }) {
  const m = useMoney();
  const incoming = r.amountMinor > 0;
  const flags = r.flags.filter((f) => f !== "tax_estimated");
  return (
    <li data-ledger-row={r.kind}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-muted/30">
        <span className="w-12 shrink-0 text-[12px] tabular-nums text-muted-foreground">{billingDay(r.date)}</span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[14px] font-medium">{r.who}</span>
            {r.expense?.receipt_path || r.revenue?.other?.proof_path ? <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Receipt attached" /> : null}
          </div>
          <div className="truncate text-[12px] text-muted-foreground">
            {r.what}{r.method ? ` · ${methodWord(r.method)}` : ""}
          </div>
          {flags.length ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {flags.map((f) => (
                <span key={f} className={cn("rounded-full px-2 py-0.5 text-[11px]", NEEDS_ATTENTION.includes(f) ? "bg-warning/15 text-foreground" : "bg-muted text-muted-foreground")}>{FLAG_WORD[f]}</span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="shrink-0 text-right">
          <div className={cn("text-[14px] font-semibold tabular-nums", incoming && "text-success")}>
            {incoming ? "+" : "−"}{money(Math.abs(r.amountMinor))}
          </div>
          {r.taxMinor ? <div className="text-[11px] tabular-nums text-muted-foreground">{r.kind === "out" ? "ITC" : Math.abs(r.taxMinor) > Math.abs(r.netMinor) * 0.07 ? "HST" : "GST"} {money(Math.abs(r.taxMinor))}</div> : null}
        </div>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open ? <RowDetail r={r} /> : null}
    </li>
  );
}

function RowDetail({ r }: { r: LedgerEntry }) {
  const m = useMoney();
  const bill = r.expense?.recurring_id ? (m.data.recurring ?? []).find((b) => b.id === r.expense!.recurring_id) ?? null : null;
  const other = r.revenue?.other ?? null;
  const delTax = useServerFn(deleteTaxPayment);
  const lines: Array<[string, string]> = [["Date", billingDay(r.date, { year: "always" }) ?? r.date]];
  if (r.kind === "in" || r.kind === "refund") {
    lines.push([r.kind === "refund" ? "Refunded" : "Received", money(Math.abs(r.amountMinor))]);
    if (m.settings.gstRegistered) lines.push(["GST/HST in it", money(Math.abs(r.taxMinor)) + (r.flags.includes("tax_estimated") ? " (worked out from the payment it refunds)" : "")]);
    lines.push(["Sales (before GST/HST)", money(Math.abs(r.netMinor))]);
    if (r.detail) lines.push(["For", r.detail]);
    const other = r.revenue?.other;
    if (other && !Number(other.tax_minor) && other.no_tax_reason) {
      lines.push(["No GST/HST", NO_TAX_REASONS.find((x) => x.key === other.no_tax_reason)?.label ?? other.no_tax_reason]);
    }
    if (other?.notes) lines.push(["Notes", other.notes]);
  } else if (r.kind === "out" && r.expense) {
    const cat = expenseCategory(r.expense.category);
    lines.push(["Paid", money(Math.abs(r.amountMinor))]);
    if (m.settings.gstRegistered) lines.push(["GST/HST you claim back", money(Math.abs(r.taxMinor))]);
    lines.push(["Business cost", money(Math.abs(r.netMinor)) + (Number(r.expense.business_use_pct) < 100 ? ` (${Number(r.expense.business_use_pct)}% business use)` : "")]);
    lines.push(["Category", `${cat.label}${cat.t2125Line ? ` · T2125 line ${cat.t2125Line}` : ""}`]);
    if (r.detail) lines.push(["What", r.detail]);
    if (r.expense.notes) lines.push(["Notes", r.expense.notes]);
    if (bill) lines.push(["Repeats", `${rhythmWords(bill.every, bill.day_of_month, bill.next_on)}${bill.active ? `, next ${billingDay(bill.next_on)}` : " (stopped)"}`]);
  } else if (r.kind === "tax" && r.taxPayment) {
    lines.push(["Paid to CRA", money(Math.abs(r.amountMinor))]);
    if (r.detail) lines.push(["For", r.detail]);
    lines.push(["Not an expense", "A tax payment comes off what you owe CRA; it isn't counted in Spent."]);
  }
  if (r.method) lines.push(["Method", methodWord(r.method)]);
  if (r.reference) lines.push(["Reference", r.reference]);

  return (
    <div className="mb-3 rounded-xl bg-muted/40 p-3 text-[13px]" data-ledger-detail>
      <dl className="space-y-1">
        {lines.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4">
            <dt className="shrink-0 text-muted-foreground">{k}</dt>
            <dd className="min-w-0 text-right">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 flex flex-wrap gap-2">
        {r.expense ? (
          <>
            <Button size="sm" variant="outline" className="h-9" onClick={() => m.openExpense(r.expense!)}>
              {r.flags.includes("needs_review") ? "Check and confirm" : r.flags.includes("no_receipt") ? "Edit · attach receipt" : "Edit"}
            </Button>
            {r.expense.receipt_path ? (
              <Button size="sm" variant="ghost" className="h-9" onClick={async () => {
                const url = await receiptSignedUrl(r.expense!.receipt_path!, 600);
                if (url) window.open(url, "_blank", "noopener,noreferrer");
              }}><Paperclip className="mr-1.5 h-3.5 w-3.5" /> View receipt</Button>
            ) : null}
          </>
        ) : null}
        {bill ? (
          <Button size="sm" variant="ghost" className="h-9" onClick={() => m.openBill(bill)}><Repeat className="mr-1.5 h-3.5 w-3.5" /> The repeating bill</Button>
        ) : null}
        {other ? (
          <>
            <Button size="sm" variant="outline" className="h-9" onClick={() => m.openOtherIncome(other)}>
              {r.flags.includes("no_gst") ? "Edit · say why no GST/HST" : "Edit"}
            </Button>
            {other.proof_path ? (
              <Button size="sm" variant="ghost" className="h-9" onClick={async () => {
                const url = await receiptSignedUrl(other.proof_path!, 600);
                if (url) window.open(url, "_blank", "noopener,noreferrer");
              }}><Paperclip className="mr-1.5 h-3.5 w-3.5" /> View proof</Button>
            ) : null}
          </>
        ) : null}
        {(r.kind === "in" || r.kind === "refund") && m.mode === "owner" && r.revenue?.clientId ? (
          <Button size="sm" variant="outline" className="h-9" asChild>
            <Link to="/admin/clients/$id" params={{ id: r.revenue.clientId }} search={{ tab: "billing" } as any}>Client's billing <ChevronRight className="ml-0.5 h-3.5 w-3.5" /></Link>
          </Button>
        ) : null}
        {r.kind === "tax" && r.taxPayment && m.mode === "owner" ? (
          <Button size="sm" variant="ghost" className="h-9 text-destructive hover:text-destructive" onClick={async () => {
            if (!window.confirm("Delete this tax payment record? Only do this if it was entered by mistake.")) return;
            try {
              await delTax({ data: { id: r.taxPayment!.id } });
              m.refresh();
            } catch (e: any) {
              toast.error(e?.message ?? "Couldn't delete it");
            }
          }}>Delete record</Button>
        ) : null}
      </div>
      {(r.kind === "in" || r.kind === "refund") && !other ? (
        <p className="mt-2 text-[12px] text-muted-foreground">Payments are corrected where they were recorded (the client's Billing tab, or Stripe), never here, so the books always match them.</p>
      ) : null}
    </div>
  );
}
