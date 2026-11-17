/**
 * Repeating bills set up on purpose (business_recurring_expenses): software,
 * a phone plan, gym rent. Each one is added to the books on its day as an
 * expense to check (never confirmed by itself), so a bill that changed or was
 * cancelled is caught when it's checked. Setting one up never pays or charges
 * anything; it only saves typing the same expense every month.
 */
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Plus, Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DateField } from "@/components/ui/date-field";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { PICKABLE_CATEGORIES, expenseCategory } from "@/lib/business-expense-categories";
import { PAYMENT_METHODS, minorToInput, parseMoneyToMinor, type RecurringExpenseRow } from "@/lib/business-books";
import { saveRecurringExpense, setRecurringExpenseActive } from "@/lib/business-books.functions";
import { fmtCad } from "@/lib/business-tax";
import { businessToday } from "@/lib/billing-schedule";
import { billingDay } from "@/lib/date-range";
import { addDays } from "@/lib/books/period";
import { datesDue, firstOnOrAfter, nextOnProblem, nextRecurringDate, sortBills, yearlyCost, type Every } from "@/lib/books/recurring";
import type { RecurringExpense } from "@/lib/books/money-view";

/** What the form opens with: a bill to edit, a suggestion from the books, or nothing. */
export type BillDraft = RecurringExpenseRow | (Partial<RecurringExpenseRow> & { id?: undefined }) | null;

type Form = {
  vendor: string;
  description: string;
  category: string;
  amount: string;
  tax: string;
  payment_method: string;
  business_use_pct: string;
  every: Every;
  next_on: string;
  notes: string;
};

function toForm(d: BillDraft, today: string): Form {
  return {
    vendor: d?.vendor ?? "",
    description: d?.description ?? "",
    category: d?.category && d.category !== "uncategorized" ? d.category : "",
    amount: d?.amount_minor != null ? minorToInput(Number(d.amount_minor)) : "",
    tax: d?.tax_minor != null ? minorToInput(Number(d.tax_minor)) : "",
    payment_method: d?.payment_method ?? "",
    business_use_pct: String(d?.business_use_pct != null ? Number(d.business_use_pct) : 100),
    every: d?.every ?? "month",
    next_on: d?.next_on ?? addDays(today, 1),
    notes: d?.notes ?? "",
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Every month on the 5th" / "Every year on Mar 5". */
export function rhythmWords(every: Every, day: number, nextOn: string): string {
  if (every === "year") return `Every year on ${MONTHS[Number(nextOn.slice(5, 7)) - 1]} ${day}`;
  const sfx = day % 10 === 1 && day !== 11 ? "st" : day % 10 === 2 && day !== 12 ? "nd" : day % 10 === 3 && day !== 13 ? "rd" : "th";
  return day >= 29 ? `Every month on the ${day}${sfx} (or the month's last day)` : `Every month on the ${day}${sfx}`;
}

export function RecurringBillDialog({ draft, open, onClose, onChanged, gstRegistered }: {
  draft: BillDraft;
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
  gstRegistered: boolean;
}) {
  const save = useServerFn(saveRecurringExpense);
  const setActive = useServerFn(setRecurringExpenseActive);
  const today = businessToday();
  const editing = draft && "id" in draft && draft.id ? (draft as RecurringExpenseRow) : null;
  const [form, setForm] = useState<Form>(() => toForm(draft, today));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setForm(toForm(draft, today));
  }, [open, draft]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const amountMinor = parseMoneyToMinor(form.amount);
  const taxMinor = gstRegistered ? parseMoneyToMinor(form.tax) ?? 0 : 0;
  const use = Math.min(100, Math.max(0, Number(form.business_use_pct) || 0));
  const day = Number(form.next_on.slice(8, 10)) || 1;
  const due = useMemo(() => datesDue(form.next_on, form.every, day, today), [form.next_on, form.every, day, today]);
  const problem = editing ? nextOnProblem(form.next_on, editing.last_added_on) : null;
  const minNext = editing?.last_added_on ? addDays(editing.last_added_on, 1) : undefined;
  const cat = form.category ? expenseCategory(form.category) : null;

  const submit = async () => {
    if (!form.vendor.trim()) return void toast.error("Name who you pay");
    if (!form.category) return void toast.error("Pick a category");
    if (!amountMinor) return void toast.error("Enter what it costs");
    if (taxMinor > amountMinor) return void toast.error("GST/HST can't be more than the total");
    if (problem) return void toast.error(problem);
    setBusy(true);
    try {
      const res = await save({
        data: {
          id: editing?.id,
          vendor: form.vendor.trim(),
          description: form.description.trim() || null,
          category: form.category,
          amount_minor: amountMinor,
          tax_minor: taxMinor,
          currency: "CAD",
          payment_method: form.payment_method || null,
          business_use_pct: use,
          every: form.every,
          day_of_month: day,
          next_on: form.next_on,
          active: editing ? editing.active : true,
          notes: form.notes.trim() || null,
        },
      });
      toast.success(res.added ? `Saved. ${res.added} added to check in Transactions.` : editing ? "Saved" : `Set up. The first one goes in on ${billingDay(form.next_on)}.`);
      onChanged();
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save it");
    } finally {
      setBusy(false);
    }
  };

  const toggle = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      const restart = !editing.active;
      // Started again from tomorrow (never back over days it already added).
      const from = minNext && minNext > addDays(today, 1) ? minNext : addDays(today, 1);
      const next = restart ? firstOnOrAfter(from, editing.every, editing.day_of_month) : undefined;
      await setActive({ data: { id: editing.id, active: restart, next_on: next } });
      toast.success(restart ? `Started again. Next one on ${billingDay(next!)}.` : "Stopped. Nothing more is added; what it added stays.");
      onChanged();
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't change it");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] max-w-lg overflow-y-auto" data-recurring-dialog>
        <DialogHeader>
          <DialogTitle>{editing ? "Repeating bill" : "Set up a repeating bill"}</DialogTitle>
          <DialogDescription>
            It's added to your expenses on its day, marked to check, so you confirm the amount and attach the receipt. Nothing is paid or charged.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rb-vendor">Who you pay</Label>
              <Input id="rb-vendor" value={form.vendor} onChange={(e) => set("vendor", e.target.value.slice(0, 120))} placeholder="Canva" className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rb-desc">What for</Label>
              <Input id="rb-desc" value={form.description} onChange={(e) => set("description", e.target.value.slice(0, 500))} placeholder="Design for posts" className="h-11" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Category</Label>
            <Select value={form.category} onValueChange={(v) => set("category", v)}>
              <SelectTrigger className="h-11"><SelectValue placeholder="Pick a category" /></SelectTrigger>
              <SelectContent className="max-h-80">
                {PICKABLE_CATEGORIES.map((c) => (
                  <SelectItem key={c.key} value={c.key}>{c.label}{c.t2125Line ? ` · ${c.t2125Line}` : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {cat ? <p className="text-[12px] text-muted-foreground">{cat.examples}</p> : null}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="rb-amount">Each time, total</Label>
              <Input id="rb-amount" inputMode="decimal" value={form.amount} onChange={(e) => set("amount", e.target.value)} placeholder="0.00" className="h-11 tabular-nums" />
            </div>
            {gstRegistered ? (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="rb-tax">GST/HST</Label>
                  {amountMinor ? (
                    <button type="button" className="text-[12px] text-muted-foreground underline-offset-2 hover:underline" onClick={() => set("tax", minorToInput(Math.round((amountMinor * 5) / 105)))}>5% included</button>
                  ) : null}
                </div>
                <Input id="rb-tax" inputMode="decimal" value={form.tax} onChange={(e) => set("tax", e.target.value)} placeholder="0.00" className="h-11 tabular-nums" />
              </div>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label>How often</Label>
            <div className="grid grid-cols-2 gap-2">
              {(["month", "year"] as const).map((e) => (
                <Button key={e} type="button" variant="outline" className={cn("h-11", form.every === e && "border-foreground bg-secondary")} aria-pressed={form.every === e} onClick={() => set("every", e)}>
                  {e === "month" ? "Every month" : "Every year"}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rb-next">{editing ? "Next one" : "First one"}</Label>
            <DateField id="rb-next" value={form.next_on} onChange={(v) => set("next_on", v)} min={minNext} className="h-11" />
            <p className={cn("text-[12px]", problem ? "text-destructive" : "text-muted-foreground")} data-recurring-preview>
              {problem
                ? problem
                : due.length
                  ? `${rhythmWords(form.every, day, form.next_on)}. Saving adds ${due.length} now to check (${billingDay(due[0])}${due.length > 1 ? ` to ${billingDay(due[due.length - 1])}` : ""}), then the next on ${billingDay(nextRecurringDate(due[due.length - 1], form.every, day))}.`
                  : `${rhythmWords(form.every, day, form.next_on)}, starting ${billingDay(form.next_on)}.`}
              {amountMinor && !problem ? ` About ${fmtCad(yearlyCost({ amount_minor: amountMinor, every: form.every }))} a year.` : ""}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="rb-use">Business use %</Label>
              <Input id="rb-use" inputMode="numeric" value={form.business_use_pct} onChange={(e) => set("business_use_pct", e.target.value.replace(/[^\d.]/g, ""))} className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label>Paid with</Label>
              <Select value={form.payment_method || "none"} onValueChange={(v) => set("payment_method", v === "none" ? "" : v)}>
                <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not set</SelectItem>
                  {PAYMENT_METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rb-notes">Notes</Label>
            <Textarea id="rb-notes" rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value.slice(0, 2000))} placeholder="Annual plan renews in March" />
          </div>
          {editing?.last_added_on ? (
            <p className="text-[12px] text-muted-foreground">Last added {billingDay(editing.last_added_on, { year: "always" })}. Changes apply from the next one; what it already added stays as it is.</p>
          ) : null}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {editing ? (
            <Button variant="ghost" className={cn(editing.active && "text-destructive hover:text-destructive")} onClick={() => void toggle()} disabled={busy}>
              {editing.active ? "Stop it" : "Start it again"}
            </Button>
          ) : <span />}
          <Button className="h-11" onClick={() => void submit()} disabled={busy || !!problem}>
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            {editing ? "Save" : "Set it up"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The repeating bills in "Where money went": the ones set up (tap to edit),
 * then any the books show paid most months that aren't set up yet (Set it up).
 */
export function RecurringBillsList({ bills, detected, onOpen, money, today }: {
  bills: RecurringExpenseRow[];
  detected: RecurringExpense[];
  onOpen: (draft: BillDraft) => void;
  money: (minor: number) => string;
  today: string;
}) {
  const active = sortBills(bills).filter((b) => b.active);
  const stopped = bills.filter((b) => !b.active);
  const yearly = active.reduce((t, b) => t + yearlyCost(b), 0);
  if (!active.length && !detected.length) {
    return (
      <div className="mt-4 border-t border-border pt-3" data-money-recurring>
        <Button variant="ghost" className="-ml-2 h-10 text-muted-foreground" onClick={() => onOpen(null)}>
          <Repeat className="mr-1.5 h-4 w-4" /> Set up a repeating bill
        </Button>
      </div>
    );
  }
  return (
    <div className="mt-4 border-t border-border pt-3" data-money-recurring>
      <div className="mb-2 flex items-center gap-1.5 text-[13px] text-muted-foreground"><Repeat className="h-3.5 w-3.5" /> Repeating bills</div>
      {active.length ? (
        <ul className="divide-y divide-border">
          {active.map((b) => (
            <li key={b.id}>
              <button type="button" className="flex w-full items-center justify-between gap-3 py-2 text-left" onClick={() => onOpen(b)} data-recurring-bill>
                <span className="min-w-0">
                  <span className="block truncate text-[14px]">{b.vendor}</span>
                  <span className="block truncate text-[12px] text-muted-foreground">{expenseCategory(b.category).label} · next {billingDay(b.next_on)}</span>
                </span>
                <span className="shrink-0 text-[14px] tabular-nums">{money(Number(b.amount_minor))}<span className="text-[12px] text-muted-foreground">/{b.every === "year" ? "yr" : "mo"}</span></span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {detected.length ? (
        <div className={cn(active.length && "mt-2 border-t border-border pt-2")} data-recurring-detected>
          <p className="text-[12px] text-muted-foreground">Paid most months. Set them up and they're added for you:</p>
          <ul className="divide-y divide-border">
            {detected.slice(0, 4).map((x) => (
              <li key={x.key} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-[14px]">{x.vendor}</span>
                  <span className="block truncate text-[12px] text-muted-foreground">{x.category} · {money(x.minor)}/mo</span>
                </span>
                <Button size="sm" variant="outline" className="h-9 shrink-0" onClick={() => onOpen(draftFromDetected(x, today))}>Set it up</Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" className="-ml-2 h-9 text-muted-foreground" onClick={() => onOpen(null)}><Plus className="mr-1 h-4 w-4" /> Add one</Button>
        {active.length ? <span className="text-[12px] text-muted-foreground">About {money(yearly)} a year{stopped.length ? ` · ${stopped.length} stopped` : ""}</span> : null}
      </div>
    </div>
  );
}

/**
 * A suggestion from the books as a new bill: same vendor, category, amount and
 * GST, on the day of the month it was last paid, starting after the last one
 * and never before tomorrow (months nobody entered aren't assumed paid; a
 * date picked in the past adds them, and the form says so first).
 */
export function draftFromDetected(x: RecurringExpense, today: string): BillDraft {
  const day = Number(x.lastDate.slice(8, 10)) || 1;
  const afterLast = nextRecurringDate(x.lastDate, "month", day);
  const fromTomorrow = firstOnOrAfter(addDays(today, 1), "month", day);
  return {
    vendor: x.vendor,
    category: x.categoryKey,
    amount_minor: x.minor,
    tax_minor: Math.min(x.taxMinor, x.minor),
    business_use_pct: x.businessUsePct,
    payment_method: x.paymentMethod,
    every: "month",
    day_of_month: day,
    next_on: afterLast > fromTomorrow ? afterLast : fromTomorrow,
  };
}
