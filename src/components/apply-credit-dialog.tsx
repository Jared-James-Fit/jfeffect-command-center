import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { ArrowRightLeft } from "lucide-react";
import { applySessionCreditUpgrade } from "@/lib/pt-pack.functions";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  clientId: string;
  onSaved: () => void;
};

function fmt(minor: number, currency = "CAD") {
  return `${currency} ${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Upgrade / switch package flow: converts AVAILABLE (unscheduled) sessions on
 * the selected packs into dollar credit at paid value per session, then creates
 * the new package with that credit applied as payment. Ledger events keep a
 * full audit trail — old credits are never silently deleted.
 */
export function ApplyCreditDialog({ open, onOpenChange, clientId, onSaved }: Props) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [newName, setNewName] = useState("");
  const [newSessions, setNewSessions] = useState<number>(10);
  const [newPrice, setNewPrice] = useState<string>("");
  const [differencePaid, setDifferencePaid] = useState(false);
  const [expiry, setExpiry] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: balance = [] } = useQuery<any[]>({
    queryKey: ["pt-balance", clientId],
    enabled: open,
    queryFn: async () => {
      const { data } = await (supabase as any).rpc("session_balance", { _client_id: clientId });
      return (data ?? []) as any[];
    },
  });
  const { data: purchases = [] } = useQuery<any[]>({
    queryKey: ["pt-pack-purchases", clientId],
    enabled: open,
    queryFn: async () => {
      const { data } = await supabase
        .from("purchase_records")
        .select("id, offer_name, currency, sessions_purchased, amount_paid_cents")
        .eq("client_id", clientId)
        .gt("sessions_purchased", 0);
      return data ?? [];
    },
  });

  const sources = useMemo(() => {
    return purchases
      .map((p) => {
        const row = balance.find((b) => b.purchase_id === p.id);
        const avail = Math.max(Number(row?.remaining ?? 0), 0);
        const sessions = Math.max(Number(p.sessions_purchased ?? 0), 1);
        const paidUnit = Math.round(Number(p.amount_paid_cents ?? 0) / sessions);
        return { id: p.id as string, name: p.offer_name as string, avail, paidUnit, credit: avail * paidUnit };
      })
      .filter((s) => s.avail > 0);
  }, [purchases, balance]);

  useEffect(() => {
    if (!open) return;
    setSelected(Object.fromEntries(sources.map((s) => [s.id, true])));
    setNewName("");
    setNewSessions(10);
    setNewPrice("");
    setDifferencePaid(false);
    setExpiry("");
    setNote("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const chosen = sources.filter((s) => selected[s.id]);
  const creditMinor = chosen.reduce((s, c) => s + c.credit, 0);
  const sessionsConverted = chosen.reduce((s, c) => s + c.avail, 0);
  const priceMinor = Math.round((Number(newPrice) || 0) * 100);
  const differenceMinor = Math.max(priceMinor - creditMinor, 0);

  const save = async () => {
    if (chosen.length === 0) return toast.error("Select at least one package to convert");
    if (!newName.trim()) return toast.error("Name the new package");
    if (!newSessions || newSessions < 1) return toast.error("Enter sessions for the new package");
    if (note.trim().length < 2) return toast.error("Add a note for the audit trail");
    if (differenceMinor > 0 && !differencePaid) {
      if (!confirm(`Difference of ${fmt(differenceMinor)} is NOT marked paid.\n\nThe new package will stay pending until paid. Continue?`)) return;
    }
    setSaving(true);
    try {
      const res = await applySessionCreditUpgrade({
        data: {
          clientId,
          sourcePurchaseIds: chosen.map((c) => c.id),
          newPackageName: newName.trim(),
          newSessionCount: newSessions,
          newPriceMinor: priceMinor,
          differencePaid,
          expiryDate: expiry || null,
          note: note.trim(),
        },
      });
      toast.success(
        `Credit applied — ${fmt(res.creditMinor)} converted` +
          (res.outstandingMinor > 0 ? ` · ${fmt(res.outstandingMinor)} still due` : " · new package active"),
      );
      qc.invalidateQueries({ queryKey: ["pt-balance", clientId] });
      qc.invalidateQueries({ queryKey: ["pt-pack-purchases", clientId] });
      qc.invalidateQueries({ queryKey: ["client-session-credits", clientId] });
      qc.invalidateQueries({ queryKey: ["client-purchases", clientId] });
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Upgrade failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-4 w-4 text-primary" /> Apply Credit / Upgrade Package
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="mb-1 block">Convert credit from</Label>
            {sources.length === 0 ? (
              <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
                No available (unscheduled) sessions to convert.
              </p>
            ) : (
              <div className="space-y-2">
                {sources.map((s) => (
                  <label key={s.id} className="flex items-center gap-3 rounded-md border border-border bg-secondary/20 px-3 py-2 cursor-pointer">
                    <Checkbox
                      checked={!!selected[s.id]}
                      onCheckedChange={(v) => setSelected((prev) => ({ ...prev, [s.id]: !!v }))}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{s.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {s.avail} available × {fmt(s.paidUnit)} paid value = <strong className="text-foreground">{fmt(s.credit)}</strong>
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div>
            <Label>New package name</Label>
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Personal Training · 10 sessions" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Sessions in new package</Label>
              <Input
                type="number" min={1} max={500} value={newSessions}
                onChange={(e) => setNewSessions(Math.max(1, parseInt(e.target.value || "1", 10) || 1))}
              />
            </div>
            <div>
              <Label>New package price (CAD)</Label>
              <Input type="number" min={0} step="0.01" value={newPrice} placeholder="500" onChange={(e) => setNewPrice(e.target.value)} />
            </div>
          </div>

          {priceMinor > 0 && chosen.length > 0 && (
            <div className="rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm space-y-0.5">
              <div>{sessionsConverted} session{sessionsConverted === 1 ? "" : "s"} converted · credit <strong>{fmt(creditMinor)}</strong></div>
              <div>
                {fmt(priceMinor)} new package − {fmt(creditMinor)} credit ={" "}
                <strong className={differenceMinor > 0 ? "text-warning" : "text-success"}>{fmt(differenceMinor)} due</strong>
              </div>
            </div>
          )}

          {differenceMinor > 0 && (
            <div className="flex items-center justify-between rounded-md border border-border bg-secondary/30 px-3 py-2">
              <Label className="text-xs">Difference paid ({fmt(differenceMinor)})</Label>
              <Switch checked={differencePaid} onCheckedChange={setDifferencePaid} />
            </div>
          )}

          <div>
            <Label>Expiry date (optional)</Label>
            <Input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
          </div>

          <div>
            <Label>Note (required)</Label>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Client upgrading to a bigger package…" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || chosen.length === 0} className="bg-gradient-primary font-bold uppercase">
            {saving ? "Applying…" : "Apply Credit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}