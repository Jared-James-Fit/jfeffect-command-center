import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar, History } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useServerFn } from "@tanstack/react-start";
import { updatePurchaseTermDates } from "@/lib/purchase-term-dates.functions";
import { toast } from "sonner";
import { DateField } from "@/components/ui/date-field";
import { format, parseISO } from "date-fns";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** The sale's record as a PDF (purchase-pdf.ts), handed to the share sheet or downloaded. */
export async function downloadPurchasePdf(r: any, clientName?: string | null) {
  try {
    const { deliverPurchasePdf } = await import("@/lib/purchase-pdf");
    await deliverPurchasePdf(r, clientName);
  } catch (e: any) {
    toast.error("Could not make the PDF: " + (e?.message ?? "Unknown error"));
  }
}

// ── Term Date Editor ─────────────────────────────────────────────────────────

export function TermDateEditor({ purchase, clientId, onClose }: { purchase: any; clientId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const updateFn = useServerFn(updatePurchaseTermDates);
  const [startDate, setStartDate] = useState(purchase.term_start_date ?? "");
  const [endDate, setEndDate] = useState(purchase.term_end_date ?? "");
  const [serviceStart, setServiceStart] = useState(
    (purchase.service_start_date ?? "").slice(0, 10),
  );
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const history: any[] = purchase.term_date_history ?? [];

  const autoFillEndDate = () => {
    if (!startDate || !purchase.term_length_snapshot || !purchase.term_unit_snapshot) return;
    try {
      const start = parseISO(startDate);
      const len = purchase.term_length_snapshot as number;
      const unit = purchase.term_unit_snapshot as string;
      const end = new Date(start);
      if (unit === "days") end.setDate(end.getDate() + len);
      else if (unit === "weeks") end.setDate(end.getDate() + len * 7);
      else if (unit === "months") end.setMonth(end.getMonth() + len);
      else if (unit === "years") end.setFullYear(end.getFullYear() + len);
      setEndDate(end.toISOString().split("T")[0]);
    } catch {}
  };

  const save = async () => {
    if (!startDate || !endDate) return toast.error("Both start and end dates are required");
    if (startDate > endDate) return toast.error("Start date must be before end date");
    setBusy(true);
    try {
      await updateFn({
        data: {
          purchaseId: purchase.id,
          startDate,
          endDate,
          reason: reason.trim() || undefined,
          serviceStartDate: serviceStart || null,
        },
      });
      toast.success("Service dates updated");
      qc.invalidateQueries({ queryKey: ["client-purchases", clientId] });
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to update dates");
    } finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-primary" /> Edit Service Dates
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="rounded-lg bg-secondary/30 px-3 py-2 text-sm">
            <div className="font-semibold">{purchase.offer_name}</div>
            {purchase.term_length_snapshot && (
              <div className="text-xs text-muted-foreground mt-0.5">
                Product term: {purchase.term_length_snapshot} {purchase.term_unit_snapshot}
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="term-start" className="text-sm font-semibold">
              Service Start Date <span className="text-destructive">*</span>
            </Label>
            <DateField
              id="term-start"
              aria-label="Service start date"
              value={startDate}
              onChange={(v) => { setStartDate(v); }}
            />
            <p className="text-xs text-muted-foreground">When does the client's service begin? Defaults to purchase date.</p>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="term-end" className="text-sm font-semibold">
                Service End Date / Next Renewal <span className="text-destructive">*</span>
              </Label>
              {purchase.term_length_snapshot && startDate && (
                <button type="button" onClick={autoFillEndDate} className="text-xs text-primary underline underline-offset-2">
                  Auto-fill ({purchase.term_length_snapshot} {purchase.term_unit_snapshot})
                </button>
              )}
            </div>
            <DateField id="term-end" aria-label="Service end date" value={endDate} min={startDate} onChange={setEndDate} />
            <p className="text-xs text-muted-foreground">When does the service expire or next renewal is due?</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="coaching-start" className="text-sm font-semibold">Coaching starts (access)</Label>
            <DateField
              id="coaching-start"
              aria-label="Coaching start date"
              placeholder="Same as service start"
              value={serviceStart}
              onChange={setServiceStart}
            />
            <p className="text-xs text-muted-foreground">
              Controls when access turns Active. Stripe billing dates are unchanged.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="term-reason" className="text-sm font-semibold">
              Reason <span className="text-muted-foreground font-normal">(optional — saved to history)</span>
            </Label>
            <Input id="term-reason" placeholder="e.g. Client requested extension, correcting start date…" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          {history.length > 0 && (
            <div>
              <button type="button" onClick={() => setShowHistory(!showHistory)} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
                <History className="h-3.5 w-3.5" />
                {showHistory ? "Hide" : "Show"} change history ({history.length})
              </button>
              {showHistory && (
                <div className="mt-2 space-y-1.5 max-h-40 overflow-y-auto rounded-lg border border-border bg-secondary/20 p-2">
                  {[...history].reverse().map((h, i) => (
                    <div key={i} className="text-xs border-b border-border/50 pb-1.5 last:border-0 last:pb-0">
                      <div className="font-medium">{h.start_date ?? "—"} → {h.end_date ?? "—"}</div>
                      <div className="text-muted-foreground">
                        {h.changed_at ? format(new Date(h.changed_at), "MMM d, yyyy 'at' h:mm a") : "Unknown date"}
                        {h.reason ? ` · ${h.reason}` : ""}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy || !startDate || !endDate}>
            {busy ? "Saving…" : "Save dates"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
