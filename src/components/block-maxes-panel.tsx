import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Dumbbell, Plus, Trash2, Save, Link2 } from "lucide-react";
import { toast } from "sonner";
import {
  listClientMaxes, upsertClientMax, deleteClientMax, effectiveMax, buildMaxIndex,
  defaultRoundingStep, type ClientMaxRow,
} from "@/lib/pl-maxes";

const DEFAULT_LIFTS = ["Competition Squat", "Competition Bench Press", "Competition Deadlift"];
const MORE_LIFTS = [
  "Pause Squat", "Tempo Squat", "Front Squat", "Belt Squat",
  "Close Grip Bench", "Spoto Press", "Overhead Press",
  "Block Pull", "Deficit Deadlift",
];

type Draft = {
  id?: string;
  lift: string;
  one_rm: number | "";
  training_max: number | "";
  unit: "kg" | "lb";
  scope: "block" | "profile";
  source_lift?: string | null;
  variation_modifier?: number | "";
};

export function BlockMaxesButton({ clientId, blockId }: { clientId: string; blockId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setOpen(true)}>
        <Dumbbell className="h-3.5 w-3.5" /> Block Maxes
      </Button>
      {open && (
        <BlockMaxesDialog clientId={clientId} blockId={blockId} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function BlockMaxesDialog({
  clientId, blockId, onClose,
}: { clientId: string; blockId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: maxes = [], isLoading } = useQuery({
    queryKey: ["pl-client-maxes", clientId, blockId],
    queryFn: () => listClientMaxes(clientId, blockId),
  });

  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [saving, setSaving] = useState(false);
  const [addLift, setAddLift] = useState<string>("");

  // Seed drafts from existing maxes once loaded.
  useEffect(() => {
    if (isLoading) return;
    const byLift = new Map<string, ClientMaxRow>();
    for (const m of maxes) if (m.active) byLift.set(m.lift, m);
    const initial: Draft[] = [];
    // Always show the three main lifts.
    for (const lift of DEFAULT_LIFTS) {
      const m = byLift.get(lift);
      if (m) {
        initial.push({
          id: m.id, lift: m.lift,
          one_rm: m.one_rm ?? "", training_max: m.training_max ?? "",
          unit: m.unit, scope: m.block_id ? "block" : "profile",
          source_lift: m.source_lift,
          variation_modifier: m.variation_modifier ?? "",
        });
      } else {
        initial.push({ lift, one_rm: "", training_max: "", unit: "kg", scope: "profile" });
      }
    }
    // Any extra existing maxes the user added beyond the defaults.
    for (const m of maxes) {
      if (!m.active) continue;
      if (DEFAULT_LIFTS.includes(m.lift)) continue;
      initial.push({
        id: m.id, lift: m.lift,
        one_rm: m.one_rm ?? "", training_max: m.training_max ?? "",
        unit: m.unit, scope: m.block_id ? "block" : "profile",
        source_lift: m.source_lift,
        variation_modifier: m.variation_modifier ?? "",
      });
    }
    setDrafts(initial);
  }, [isLoading, maxes]);

  const index = useMemo(() => buildMaxIndex(maxes), [maxes]);

  const update = (i: number, patch: Partial<Draft>) =>
    setDrafts((arr) => arr.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));

  const addRow = () => {
    const lift = addLift.trim();
    if (!lift) return;
    if (drafts.some((d) => d.lift.toLowerCase() === lift.toLowerCase())) {
      toast.error("Already in list");
      return;
    }
    setDrafts((arr) => [...arr, { lift, one_rm: "", training_max: "", unit: "kg", scope: "profile" }]);
    setAddLift("");
  };

  const removeRow = async (i: number) => {
    const d = drafts[i];
    if (d.id && confirm(`Delete max for ${d.lift}?`)) {
      try { await deleteClientMax(d.id); } catch (e: any) { toast.error(e?.message ?? "Failed"); return; }
    }
    setDrafts((arr) => arr.filter((_, idx) => idx !== i));
  };

  const saveAll = async () => {
    setSaving(true);
    try {
      for (const d of drafts) {
        // Skip empty rows that have no existing record.
        if (!d.id && d.one_rm === "" && d.training_max === "" && !d.source_lift) continue;
        await upsertClientMax({
          client_id: clientId,
          lift: d.lift.trim(),
          one_rm: d.one_rm === "" ? null : Number(d.one_rm),
          training_max: d.training_max === "" ? null : Number(d.training_max),
          unit: d.unit,
          source: "manual",
          active: true,
          rounding_mode: "nearest",
          rounding_step: defaultRoundingStep(d.unit),
          source_lift: d.source_lift || null,
          variation_modifier: d.variation_modifier === "" || d.variation_modifier == null
            ? null : Number(d.variation_modifier),
          block_id: d.scope === "block" ? blockId : null,
        });
      }
      toast.success("Maxes saved");
      qc.invalidateQueries({ queryKey: ["pl-client-maxes", clientId] });
      qc.invalidateQueries({ queryKey: ["pl-client-maxes", clientId, blockId] });
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const availableLifts = MORE_LIFTS.filter(
    (l) => !drafts.some((d) => d.lift.toLowerCase() === l.toLowerCase()),
  );

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Dumbbell className="h-4 w-4" /> Block Training Maxes
          </DialogTitle>
          <DialogDescription>
            Set the maxes used for % programming in this block. Choose <strong>Block only</strong> to
            keep the client's global profile max unchanged, or <strong>Save to profile</strong> to
            update their main max going forward.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-12 gap-1 px-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              <div className="col-span-4">Exercise</div>
              <div className="col-span-2 text-center">1RM</div>
              <div className="col-span-2 text-center">Training Max</div>
              <div className="col-span-1 text-center">Unit</div>
              <div className="col-span-2 text-center">Scope</div>
              <div className="col-span-1" />
            </div>
            {drafts.map((d, i) => (
              <div key={`${d.lift}-${i}`} className="grid grid-cols-12 items-center gap-1 rounded-md border border-border bg-secondary/20 px-2 py-1.5">
                <div className="col-span-4 min-w-0">
                  <Input
                    className="h-7 text-xs"
                    value={d.lift}
                    onChange={(e) => update(i, { lift: e.target.value })}
                  />
                  {d.source_lift && (
                    <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                      <Link2 className="h-2.5 w-2.5" />
                      {d.variation_modifier || 100}% of {d.source_lift}
                    </div>
                  )}
                </div>
                <Input
                  className="col-span-2 h-7 text-center font-mono text-xs"
                  inputMode="decimal" placeholder="—"
                  value={d.one_rm}
                  onChange={(e) => update(i, { one_rm: e.target.value === "" ? "" : Number(e.target.value) })}
                />
                <Input
                  className="col-span-2 h-7 text-center font-mono text-xs"
                  inputMode="decimal" placeholder="—"
                  value={d.training_max}
                  onChange={(e) => update(i, { training_max: e.target.value === "" ? "" : Number(e.target.value) })}
                />
                <Select value={d.unit} onValueChange={(v) => update(i, { unit: v as "kg" | "lb" })}>
                  <SelectTrigger className="col-span-1 h-7 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="kg">kg</SelectItem>
                    <SelectItem value="lb">lb</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={d.scope} onValueChange={(v) => update(i, { scope: v as "block" | "profile" })}>
                  <SelectTrigger className="col-span-2 h-7 text-[11px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="profile">Save to profile</SelectItem>
                    <SelectItem value="block">Block only</SelectItem>
                  </SelectContent>
                </Select>
                <div className="col-span-1 flex justify-end">
                  <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => removeRow(i)} title="Remove">
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}

            <div className="flex items-center gap-2 pt-2">
              <Select value={addLift} onValueChange={setAddLift}>
                <SelectTrigger className="h-8 flex-1 text-xs"><SelectValue placeholder="Add another lift…" /></SelectTrigger>
                <SelectContent>
                  {availableLifts.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                  <SelectItem value="__custom">— Custom name —</SelectItem>
                </SelectContent>
              </Select>
              {addLift === "__custom" && (
                <Input
                  className="h-8 flex-1 text-xs"
                  placeholder="Custom lift name"
                  onKeyDown={(e) => { if (e.key === "Enter") { setAddLift((e.target as HTMLInputElement).value); addRow(); } }}
                  onBlur={(e) => setAddLift(e.target.value)}
                />
              )}
              <Button size="sm" variant="outline" className="h-8" onClick={addRow} disabled={!addLift || addLift === "__custom"}>
                <Plus className="mr-1 h-3 w-3" /> Add
              </Button>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={saveAll} disabled={saving}>
            <Save className="mr-1 h-4 w-4" /> {saving ? "Saving…" : "Save Maxes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}