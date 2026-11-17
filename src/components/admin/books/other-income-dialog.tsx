/**
 * Record money the business earned that isn't a client's sale: a sponsorship,
 * a workshop, a referral or affiliate payout, a product sold outside the app.
 * It counts in Sales, GST/HST and the T2125 like any payment
 * (business_other_income → normalizeRevenue). A client's payment is never
 * recorded here: it goes on their sale, so their Billing stays right.
 */
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FileText, Loader2, Paperclip, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { DateField } from "@/components/ui/date-field";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import {
  NO_TAX_REASONS, OTHER_INCOME_KINDS, RECEIPTS_BUCKET, minorToInput, parseMoneyToMinor,
  type NoTaxReason, type OtherIncomeKind, type OtherIncomeRow,
} from "@/lib/business-books";
import { deleteOtherIncome, saveOtherIncome } from "@/lib/business-books.functions";
import { fmtCad } from "@/lib/business-tax";
import { businessToday } from "@/lib/billing-schedule";
import { needsAccount } from "@/lib/payment-proof";
import { taxInside } from "@/lib/sale-money";
import { DepositAccountPicker } from "@/components/billing/payment-proof";
import { RECEIPT_ACCEPT, receiptSignedUrl, uploadReceiptFile } from "@/lib/receipt-upload";
import { useBooksMode } from "./books-mode";

/** How it came in (the payment ledger's own words, so Transactions groups them together). */
const METHODS = [
  { value: "etransfer", label: "E-transfer" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "cheque", label: "Cheque" },
  { value: "cash", label: "Cash" },
  { value: "stripe", label: "Stripe" },
  { value: "paypal", label: "PayPal" },
  { value: "other", label: "Other" },
] as const;

/** GST in Manitoba; anything else is typed (HST from a client in another province). */
const GST = 0.05;

type Form = {
  received_on: string;
  amount: string;
  hasTax: boolean;
  tax: string;
  taxTouched: boolean;
  reason: NoTaxReason | null;
  kind: OtherIncomeKind;
  payer: string;
  description: string;
  currency: string;
  method: string;
  account: string | null;
  reference: string;
  notes: string;
  proof_path: string | null;
  proof_mime: string | null;
};

function toForm(row: OtherIncomeRow | null, gstRegistered: boolean): Form {
  const tax = row ? Number(row.tax_minor) : 0;
  return {
    received_on: row?.received_on ?? businessToday(),
    amount: row ? minorToInput(Number(row.amount_minor)) : "",
    hasTax: row ? tax > 0 : gstRegistered,
    tax: row && tax > 0 ? minorToInput(tax) : "",
    taxTouched: !!row && tax > 0,
    reason: row?.no_tax_reason ?? null,
    kind: row?.kind ?? "sponsorship",
    payer: row?.payer ?? "",
    description: row?.description ?? "",
    currency: row?.currency ?? "CAD",
    method: row?.method ?? "etransfer",
    account: row?.deposit_account_id ?? null,
    reference: row?.reference ?? "",
    notes: row?.notes ?? "",
    proof_path: row?.proof_path ?? null,
    proof_mime: row?.proof_mime ?? null,
  };
}

const chip = (on: boolean) => cn("h-11 justify-start", on && "border-foreground bg-secondary");

export function OtherIncomeDialog({
  income, open, onClose, onChanged, gstRegistered,
}: {
  /** null = new */
  income: OtherIncomeRow | null;
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
  gstRegistered: boolean;
}) {
  const save = useServerFn(saveOtherIncome);
  const remove = useServerFn(deleteOtherIncome);
  const canDelete = useBooksMode() === "owner";
  const [form, setForm] = useState<Form>(() => toForm(income, gstRegistered));
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setForm(toForm(income, gstRegistered));
  }, [open, income, gstRegistered]);

  useEffect(() => {
    let cancelled = false;
    setProofUrl(null);
    if (form.proof_path) receiptSignedUrl(form.proof_path).then((u) => !cancelled && setProofUrl(u));
    return () => {
      cancelled = true;
    };
  }, [form.proof_path]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const amountMinor = parseMoneyToMinor(form.amount);
  // GST worked out of the amount until it's typed over (HST, or a rounding the payer used).
  const autoTax = amountMinor ? taxInside(amountMinor, GST) : 0;
  const taxMinor = gstRegistered && form.hasTax ? (form.taxTouched ? parseMoneyToMinor(form.tax) ?? 0 : autoTax) : 0;
  const landsInAccount = needsAccount(form.method);

  const attach = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const { path, mime } = await uploadReceiptFile(file);
      setForm((f) => ({ ...f, proof_path: path, proof_mime: mime }));
    } catch (e: any) {
      toast.error(e?.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  // A proof uploaded here but never saved would be orphaned.
  const close = () => {
    if (form.proof_path && form.proof_path !== (income?.proof_path ?? null)) {
      void supabase.storage.from(RECEIPTS_BUCKET).remove([form.proof_path]);
    }
    onClose();
  };

  const submit = async () => {
    if (!amountMinor) return void toast.error("Enter the amount that came in");
    if (taxMinor > amountMinor) return void toast.error("GST/HST can't be more than the amount");
    setBusy(true);
    try {
      await save({
        data: {
          id: income?.id,
          received_on: form.received_on,
          payer: form.payer.trim() || null,
          description: form.description.trim() || null,
          kind: form.kind,
          amount_minor: amountMinor,
          tax_minor: taxMinor,
          no_tax_reason: taxMinor > 0 || !gstRegistered ? null : form.reason,
          currency: form.currency,
          method: form.method || null,
          deposit_account_id: landsInAccount ? form.account : null,
          reference: form.reference.trim() || null,
          notes: form.notes.trim() || null,
          proof_path: form.proof_path,
          proof_mime: form.proof_mime,
        },
      });
      toast.success(income ? "Updated" : `${fmtCad(amountMinor)} recorded`);
      onChanged();
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save it");
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    if (!income) return;
    setBusy(true);
    try {
      await remove({ data: { id: income.id } });
      toast.success("Deleted");
      onChanged();
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't delete it");
    } finally {
      setBusy(false);
    }
  };

  const isPdf = (form.proof_mime ?? "").includes("pdf");
  const kindHint = OTHER_INCOME_KINDS.find((k) => k.key === form.kind)?.hint;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[92dvh] max-w-lg overflow-y-auto" data-other-income-dialog>
        <DialogHeader>
          <DialogTitle>{income ? "Other income" : "Record other income"}</DialogTitle>
          <DialogDescription>
            Business income that isn't a client's package or plan. A client's payment goes on their sale instead, so their billing stays right.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>What it was</Label>
            <div className="grid grid-cols-2 gap-2">
              {OTHER_INCOME_KINDS.map((k) => (
                <Button key={k.key} type="button" variant="outline" className={chip(form.kind === k.key)} aria-pressed={form.kind === k.key} onClick={() => set("kind", k.key)}>
                  {k.label}
                </Button>
              ))}
            </div>
            {kindHint ? <p className="text-[12px] text-muted-foreground">{kindHint}</p> : null}
          </div>

          <div className="grid grid-cols-[1fr_6.5rem] gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="oi-amount">Amount received</Label>
              <Input id="oi-amount" inputMode="decimal" value={form.amount} onChange={(e) => set("amount", e.target.value)} placeholder="0.00" className="h-12 text-lg tabular-nums" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="oi-currency">Currency</Label>
              <select
                id="oi-currency"
                value={form.currency}
                onChange={(e) => set("currency", e.target.value)}
                className="h-12 w-full rounded-lg border border-input bg-background px-2 text-base"
              >
                {["CAD", "USD", "EUR", "GBP"].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {gstRegistered ? (
            <div className="space-y-2 rounded-xl border border-border p-3">
              <label className="flex items-center gap-2 text-[14px]">
                <Checkbox checked={form.hasTax} onCheckedChange={(v) => set("hasTax", !!v)} />
                GST/HST is in this amount
              </label>
              {form.hasTax ? (
                <div className="flex items-center gap-2">
                  <Label htmlFor="oi-tax" className="shrink-0 text-[13px] text-muted-foreground">GST/HST in it</Label>
                  <Input
                    id="oi-tax"
                    inputMode="decimal"
                    value={form.taxTouched ? form.tax : minorToInput(autoTax)}
                    onChange={(e) => setForm((f) => ({ ...f, tax: e.target.value, taxTouched: true }))}
                    className="h-10 tabular-nums"
                  />
                  {form.taxTouched ? (
                    <Button type="button" variant="ghost" size="sm" className="h-10 shrink-0" onClick={() => setForm((f) => ({ ...f, tax: "", taxTouched: false }))}>5%</Button>
                  ) : null}
                </div>
              ) : (
                <div className="space-y-1.5">
                  <div className="text-[13px] text-muted-foreground">Why no GST/HST?</div>
                  <div className="grid gap-2">
                    {NO_TAX_REASONS.map((r) => (
                      <Button key={r.key} type="button" variant="outline" className={cn(chip(form.reason === r.key), "h-auto min-h-11 flex-col items-start gap-0.5 py-2 text-left")} aria-pressed={form.reason === r.key} onClick={() => set("reason", form.reason === r.key ? null : r.key)}>
                        <span>{r.label}</span>
                        <span className="whitespace-normal text-[12px] font-normal text-muted-foreground">{r.hint}</span>
                      </Button>
                    ))}
                  </div>
                  {!form.reason ? <p className="text-[12px] text-muted-foreground">Not sure? Leave it and it's flagged for your accountant to check.</p> : null}
                </div>
              )}
              {amountMinor ? (
                <p className="text-[12px] tabular-nums text-muted-foreground">
                  {taxMinor > 0 ? `${fmtCad(amountMinor - taxMinor)} in sales + ${fmtCad(taxMinor)} GST/HST` : `${fmtCad(amountMinor)} in sales, no GST/HST`}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="oi-payer">From</Label>
              <Input id="oi-payer" value={form.payer} onChange={(e) => set("payer", e.target.value.slice(0, 120))} placeholder="Who paid it" className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="oi-date">Date received</Label>
              <DateField id="oi-date" value={form.received_on} onChange={(v) => set("received_on", v)} max={businessToday()} className="h-11" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="oi-desc">What for</Label>
            <Input id="oi-desc" value={form.description} onChange={(e) => set("description", e.target.value.slice(0, 500))} placeholder="Spring deadlift clinic" className="h-11" />
          </div>

          <div className="space-y-1.5">
            <Label>How it came in</Label>
            <div className="grid grid-cols-3 gap-2">
              {METHODS.map((m) => (
                <Button key={m.value} type="button" variant="outline" className={cn(chip(form.method === m.value), "justify-center px-2")} aria-pressed={form.method === m.value} onClick={() => set("method", m.value)}>
                  {m.label}
                </Button>
              ))}
            </div>
          </div>
          {landsInAccount ? (
            <div className="space-y-1.5">
              <Label>Paid into</Label>
              <DepositAccountPicker value={form.account} onChange={(id) => set("account", id)} />
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="oi-ref">Reference (optional)</Label>
            <Input id="oi-ref" value={form.reference} onChange={(e) => set("reference", e.target.value.slice(0, 120))} placeholder={form.method === "cheque" ? "Cheque #" : "Confirmation or invoice #"} className="h-11" />
          </div>

          <div className="space-y-1.5">
            <Label>Proof (optional)</Label>
            {form.proof_path ? (
              proofUrl ? (
                <a href={proofUrl} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-border bg-muted/30">
                  {isPdf ? (
                    <div className="flex h-24 items-center justify-center gap-2 text-[14px] text-muted-foreground"><FileText className="h-5 w-5" /> Open PDF</div>
                  ) : (
                    <img src={proofUrl} alt="Proof" className="max-h-56 w-full object-contain" />
                  )}
                </a>
              ) : (
                <div className="flex h-24 items-center justify-center rounded-xl border border-border text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
              )
            ) : null}
            <input ref={fileRef} type="file" accept={RECEIPT_ACCEPT} className="hidden" onChange={(e) => { void attach(e.target.files?.[0]); e.target.value = ""; }} />
            <Button type="button" variant="outline" className="h-11 w-full" disabled={uploading} onClick={() => fileRef.current?.click()}>
              {uploading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Paperclip className="mr-1.5 h-4 w-4" />}
              {form.proof_path ? "Replace" : "Attach proof"}
            </Button>
            {!form.proof_path ? <p className="text-[12px] text-muted-foreground">The invoice, a deposit screenshot or the contract.</p> : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="oi-notes">Notes</Label>
            <Textarea id="oi-notes" rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value.slice(0, 2000))} placeholder="Anything your accountant should know" />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {income && canDelete ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" className="text-destructive hover:text-destructive" disabled={busy}>
                  <Trash2 className="mr-1.5 h-4 w-4" /> Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this income?</AlertDialogTitle>
                  <AlertDialogDescription>Only if it was recorded by mistake. It comes out of Sales and GST/HST, and its proof is deleted too.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep it</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void doDelete()}>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : <span />}
          <Button className="h-11" onClick={() => void submit()} disabled={busy || uploading || !amountMinor}>
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            {income ? "Save" : amountMinor ? `Record ${fmtCad(amountMinor)}` : "Record"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
