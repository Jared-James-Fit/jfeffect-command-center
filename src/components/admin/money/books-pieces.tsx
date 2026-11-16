/**
 * Pieces of the books shared by the money screens: recording a payment made
 * to CRA, the list of them, and the tax settings (and Cleo's).
 */
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, SlidersHorizontal, Sparkles, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ASSISTANT_NAME, minorToInput, parseMoneyToMinor, toTaxSettings, type BooksData, type TaxPaymentRow } from "@/lib/business-books";
import { fmtCad } from "@/lib/business-tax";
import { businessToday } from "@/lib/billing-schedule";
import { addTaxPayment, deleteTaxPayment, getSummerProfile, saveTaxSettings } from "@/lib/business-books.functions";
import { useBooksMode } from "@/components/admin/books/books-mode";
import { SummerCustomizeDialog } from "@/components/admin/books/summer-customize";
import { summerTone } from "@/lib/summer-persona";

const money = fmtCad;

export function TaxPaymentDialog({ open, onClose, year, kind, onSaved }: { open: boolean; onClose: () => void; year: number; kind: "gst_hst" | "income_tax"; onSaved: () => void }) {
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

export function PaymentsList({ payments, year, kind, onChanged }: { payments: TaxPaymentRow[]; year: number; kind: "gst_hst" | "income_tax"; onChanged: () => void }) {
  const delFn = useServerFn(deleteTaxPayment);
  const canDelete = useBooksMode() === "owner";
  const rows = payments.filter((p) => p.tax_year === year && p.kind === kind);
  if (!rows.length) return <p className="text-[13px] text-muted-foreground">None recorded for {year}.</p>;
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
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
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

export function TaxSettings({ data, onSaved }: { data: BooksData; onSaved: () => void }) {
  return (
    <div className="space-y-4">
      <SummerSettingsCard onSaved={onSaved} />
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
    <Card className="space-y-4 p-4">
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
      <p className="text-xs text-muted-foreground">{ASSISTANT_NAME} uses these to answer questions. Only you and your bookkeeper see the books.</p>
    </Card>
  );
}
