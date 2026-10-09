import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FileText, Loader2, Paperclip, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { PICKABLE_CATEGORIES, expenseCategory } from "@/lib/business-expense-categories";
import { ASSISTANT_NAME, PAYMENT_METHODS, RECEIPTS_BUCKET, minorToInput, parseMoneyToMinor, type ExpenseRow } from "@/lib/business-books";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { expenseTaxView, fmtCad } from "@/lib/business-tax";
import { businessToday } from "@/lib/billing-schedule";
import { deleteExpense, saveExpense } from "@/lib/business-books.functions";
import { useBooksMode } from "./books-mode";
import { RECEIPT_ACCEPT, receiptSignedUrl, uploadReceiptFile } from "@/lib/receipt-upload";

type Form = {
  expense_date: string;
  vendor: string;
  description: string;
  category: string;
  amount: string;
  tax: string;
  currency: string;
  payment_method: string;
  business_use_pct: string;
  notes: string;
  receipt_path: string | null;
  receipt_mime: string | null;
};

function toForm(e: ExpenseRow | null): Form {
  return {
    expense_date: e?.expense_date ?? businessToday(),
    vendor: e?.vendor ?? "",
    description: e?.description ?? "",
    category: e && e.category !== "uncategorized" ? e.category : "",
    amount: e ? minorToInput(Number(e.amount_minor)) : "",
    tax: e ? minorToInput(Number(e.tax_minor)) : "",
    currency: e?.currency ?? "CAD",
    payment_method: e?.payment_method ?? "",
    business_use_pct: String(e ? Number(e.business_use_pct) : 100),
    notes: e?.notes ?? "",
    receipt_path: e?.receipt_path ?? null,
    receipt_mime: e?.receipt_mime ?? null,
  };
}

export function ExpenseDialog({
  expense,
  open,
  onClose,
  onChanged,
  gstRegistered,
}: {
  /** null = new expense */
  expense: ExpenseRow | null;
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
  gstRegistered: boolean;
}) {
  const save = useServerFn(saveExpense);
  const remove = useServerFn(deleteExpense);
  const canDelete = useBooksMode() === "owner";
  const [form, setForm] = useState<Form>(() => toForm(expense));
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setForm(toForm(expense));
  }, [open, expense]);

  useEffect(() => {
    let cancelled = false;
    setReceiptUrl(null);
    if (form.receipt_path) receiptSignedUrl(form.receipt_path).then((u) => !cancelled && setReceiptUrl(u));
    return () => {
      cancelled = true;
    };
  }, [form.receipt_path]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const amountMinor = parseMoneyToMinor(form.amount);
  const taxMinor = parseMoneyToMinor(form.tax) ?? 0;
  const use = Math.min(100, Math.max(0, Number(form.business_use_pct) || 0));
  const preview = useMemo(() => {
    if (amountMinor == null || !form.category) return null;
    return expenseTaxView(
      {
        id: "", date: form.expense_date, vendor: null, description: null, category: form.category, amountMinor, taxMinor,
        businessUsePct: use, currency: form.currency, hasReceipt: !!form.receipt_path, status: "reviewed", source: "manual",
      },
      gstRegistered,
    );
  }, [amountMinor, taxMinor, use, form.category, form.expense_date, form.currency, form.receipt_path, gstRegistered]);

  const ai = expense?.ai_summary ?? null;
  const fromStripe = expense?.source === "stripe_fees";
  const cat = form.category ? expenseCategory(form.category) : null;

  const attach = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const { path, mime } = await uploadReceiptFile(file);
      setForm((f) => ({ ...f, receipt_path: path, receipt_mime: mime }));
    } catch (e: any) {
      toast.error(e?.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    if (amountMinor == null) return void toast.error("Enter the total paid");
    if (!form.category) return void toast.error("Pick a category");
    if (taxMinor > amountMinor) return void toast.error("GST/HST can't be more than the total");
    setBusy(true);
    try {
      await save({
        data: {
          id: expense?.id,
          expense_date: form.expense_date,
          vendor: form.vendor.trim() || null,
          description: form.description.trim() || null,
          category: form.category,
          amount_minor: amountMinor,
          tax_minor: taxMinor,
          currency: form.currency,
          payment_method: form.payment_method || null,
          business_use_pct: use,
          notes: form.notes.trim() || null,
          receipt_path: form.receipt_path,
          receipt_mime: form.receipt_mime,
        },
      });
      toast.success(expense ? "Expense updated" : "Expense added");
      onChanged();
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save");
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    if (!expense) return;
    setBusy(true);
    try {
      await remove({ data: { id: expense.id } });
      toast.success("Expense deleted");
      onChanged();
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not delete");
    } finally {
      setBusy(false);
    }
  };

  const isPdf = (form.receipt_mime ?? "").includes("pdf");

  // A receipt uploaded in this dialog but never saved would be orphaned.
  const close = () => {
    if (form.receipt_path && form.receipt_path !== (expense?.receipt_path ?? null)) {
      void supabase.storage.from(RECEIPTS_BUCKET).remove([form.receipt_path]);
    }
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[92dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{expense ? (expense.status === "needs_review" ? "Check this receipt" : "Edit expense") : "Add expense"}</DialogTitle>
          <DialogDescription>
            {fromStripe
              ? "Synced from Stripe. Amounts refresh on each sync; your category and business-use % are kept."
              : "Total paid includes tax. GST/HST is the part you claim back, so leave PST out of it."}
          </DialogDescription>
        </DialogHeader>

        {ai && (expense?.status === "needs_review" || ai.notes || ai.pst) && (
          <div className={cn("flex gap-2 rounded-md border p-3 text-sm", expense?.status === "needs_review" ? "border-amber-500/40 bg-amber-500/10" : "bg-muted/40")}>
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <div className="space-y-1">
              {ai.read === false ? (
                <p>{ASSISTANT_NAME} couldn't read this one{ai.notes ? ` (${ai.notes})` : ""}. Fill in the details from the receipt.</p>
              ) : (
                <p>
                  {ASSISTANT_NAME} filed this{typeof ai.confidence === "number" ? ` (${Math.round(ai.confidence * 100)}% sure)` : ""}.
                  {ai.notes ? ` ${ai.notes}` : ""}
                </p>
              )}
              {typeof ai.pst === "number" && ai.pst > 0 && (
                <p className="text-muted-foreground">PST/RST on the receipt: {fmtCad(ai.pst)}. Not claimable, so it stays in the cost.</p>
              )}
            </div>
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="exp-date">Date</Label>
              <Input id="exp-date" type="date" value={form.expense_date} max={businessToday()} onChange={(e) => set("expense_date", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="exp-vendor">Vendor</Label>
              <Input id="exp-vendor" value={form.vendor} onChange={(e) => set("vendor", e.target.value)} placeholder="Rogue Fitness" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="exp-desc">What for</Label>
              <Input id="exp-desc" value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Lifting straps for client sessions" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Category</Label>
              <Select value={form.category} onValueChange={(v) => set("category", v)}>
                <SelectTrigger><SelectValue placeholder="Pick a category" /></SelectTrigger>
                <SelectContent className="max-h-80">
                  {PICKABLE_CATEGORIES.map((c) => (
                    <SelectItem key={c.key} value={c.key}>
                      {c.label}{c.t2125Line ? ` · ${c.t2125Line}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {cat && <p className="text-xs text-muted-foreground">{cat.examples}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="exp-amount">Total paid</Label>
              <Input id="exp-amount" inputMode="decimal" value={form.amount} onChange={(e) => set("amount", e.target.value)} placeholder="0.00" />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="exp-tax">GST/HST</Label>
                {amountMinor != null && amountMinor > 0 && (
                  <button
                    type="button"
                    className="text-xs font-medium text-primary hover:underline"
                    onClick={() => set("tax", minorToInput(Math.round((amountMinor * 5) / 105)))}
                  >
                    5% included
                  </button>
                )}
              </div>
              <Input id="exp-tax" inputMode="decimal" value={form.tax} onChange={(e) => set("tax", e.target.value)} placeholder="0.00" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="exp-use">Business use %</Label>
              <div className="flex gap-1.5">
                <Input id="exp-use" inputMode="numeric" value={form.business_use_pct} onChange={(e) => set("business_use_pct", e.target.value.replace(/[^\d.]/g, ""))} />
                {[100, 50].map((p) => (
                  <Button key={p} type="button" variant="outline" size="sm" className="h-10 px-2" onClick={() => set("business_use_pct", String(p))}>{p}%</Button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Paid with</Label>
              <Select value={form.payment_method || "none"} onValueChange={(v) => set("payment_method", v === "none" ? "" : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not set</SelectItem>
                  {PAYMENT_METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  {form.payment_method && !(PAYMENT_METHODS as readonly string[]).includes(form.payment_method) && (
                    <SelectItem value={form.payment_method}>{form.payment_method}</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Currency</Label>
              <Select value={form.currency} onValueChange={(v) => set("currency", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["CAD", "USD", "EUR", "GBP"].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  {!["CAD", "USD", "EUR", "GBP"].includes(form.currency) && <SelectItem value={form.currency}>{form.currency}</SelectItem>}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="exp-notes">Notes</Label>
              <Textarea id="exp-notes" rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Anything your accountant should know" />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Receipt</Label>
            {form.receipt_path ? (
              receiptUrl ? (
                <a href={receiptUrl} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-md border bg-muted/30">
                  {isPdf ? (
                    <div className="flex h-40 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                      <FileText className="h-8 w-8" /> Open PDF
                    </div>
                  ) : (
                    <img src={receiptUrl} alt="Receipt" className="max-h-80 w-full object-contain" />
                  )}
                </a>
              ) : (
                <div className="flex h-40 items-center justify-center rounded-md border text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
              )
            ) : (
              <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                {fromStripe ? "Stripe's monthly statement is the record for these fees." : "No receipt yet. GST can only be claimed back with one."}
              </div>
            )}
            {!fromStripe && (
              <>
                <input ref={fileRef} type="file" accept={RECEIPT_ACCEPT} className="hidden" onChange={(e) => { void attach(e.target.files?.[0]); e.target.value = ""; }} />
                <Button type="button" variant="outline" size="sm" className="w-full" disabled={uploading} onClick={() => fileRef.current?.click()}>
                  {uploading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Paperclip className="mr-1.5 h-4 w-4" />}
                  {form.receipt_path ? "Replace receipt" : "Attach receipt"}
                </Button>
              </>
            )}
            {preview && (
              <div className="space-y-1 rounded-md bg-muted/40 p-3 text-xs">
                {cat?.kind === "capital" ? (
                  <div className="flex justify-between"><span>First-year CCA</span><span className="font-semibold">{fmtCad(preview.ccaMinor)}</span></div>
                ) : (
                  <div className="flex justify-between"><span>Deductible</span><span className="font-semibold">{fmtCad(preview.deductibleMinor)}</span></div>
                )}
                <div className="flex justify-between"><span>GST back (ITC)</span><span className="font-semibold">{fmtCad(preview.itcMinor)}</span></div>
                {cat?.deductiblePct === 0.5 && <p className="text-muted-foreground">Meals: half is deductible.</p>}
                {cat?.kind === "excluded" && <p className="text-muted-foreground">Personal: kept on file, never deducted.</p>}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {expense && canDelete ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" className="text-destructive hover:text-destructive" disabled={busy}>
                  <Trash2 className="mr-1.5 h-4 w-4" /> Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this expense?</AlertDialogTitle>
                  <AlertDialogDescription>The receipt file is deleted too. This can't be undone.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep it</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void doDelete()}>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={close} disabled={busy}>Cancel</Button>
            <Button onClick={() => void submit()} disabled={busy || uploading}>
              {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {expense?.status === "needs_review" ? "Looks right, save" : "Save"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
