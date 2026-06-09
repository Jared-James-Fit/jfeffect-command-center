import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, Dumbbell, Link2, Calculator } from "lucide-react";
import { toast } from "sonner";
import {
  listClientMaxes, upsertClientMax, deleteClientMax, effectiveMax, buildMaxIndex,
  defaultRoundingStep, ROUNDING_MODES, MAX_SOURCES,
  type ClientMaxRow, type MaxSource, type RoundingMode,
} from "@/lib/pl-maxes";
import { cn } from "@/lib/utils";

const COMMON_LIFTS = [
  "Competition Squat", "Competition Bench Press", "Competition Deadlift",
  "Pause Squat", "Close Grip Bench", "Block Pull", "Belt Squat",
  "Front Squat", "Tempo Squat", "Deficit Deadlift", "Overhead Press",
];

export function ClientMaxesPanel({ clientId }: { clientId: string }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Partial<ClientMaxRow> | null>(null);

  const { data: maxes = [], isLoading } = useQuery({
    queryKey: ["pl-client-maxes", clientId],
    queryFn: () => listClientMaxes(clientId),
    enabled: !!clientId,
  });

  const index = useMemo(() => buildMaxIndex(maxes), [maxes]);
  const active = maxes.filter((m) => m.active);
  const inactive = maxes.filter((m) => !m.active);

  const openNew = () => setEditing({
    client_id: clientId,
    lift: "",
    unit: "kg",
    source: "tested",
    active: true,
    rounding_mode: "nearest",
    rounding_step: 2.5,
    manual_override: false,
  });

  const remove = async (id: string) => {
    if (!confirm("Delete this max?")) return;
    try {
      await deleteClientMax(id);
      qc.invalidateQueries({ queryKey: ["pl-client-maxes", clientId] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    }
  };

  return (
    <Card className="border-border bg-card p-6 md:col-span-3">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-bold">
            <Dumbbell className="h-4 w-4" /> Exercise Maxes
          </h3>
          <p className="text-xs text-muted-foreground">
            1RM &amp; training maxes used by the Program Builder for % calculations.
          </p>
        </div>
        <Button size="sm" onClick={openNew}>
          <Plus className="mr-1 h-4 w-4" /> Add max
        </Button>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : maxes.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-secondary/30 p-6 text-center text-sm text-muted-foreground">
          No maxes set yet. Add a max so the Program Builder can calculate loads from %.
        </div>
      ) : (
        <div className="space-y-2">
          {active.map((m) => (
            <MaxRow key={m.id} row={m} index={index} onEdit={() => setEditing(m)} onDelete={() => remove(m.id)} />
          ))}
          {inactive.length > 0 && (
            <div className="pt-3">
              <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Inactive</div>
              {inactive.map((m) => (
                <MaxRow key={m.id} row={m} index={index} onEdit={() => setEditing(m)} onDelete={() => remove(m.id)} />
              ))}
            </div>
          )}
        </div>
      )}

      <MaxEditorDialog
        clientId={clientId}
        value={editing}
        existing={maxes}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ["pl-client-maxes", clientId] }); }}
      />
    </Card>
  );
}

function MaxRow({
  row, index, onEdit, onDelete,
}: {
  row: ClientMaxRow;
  index: Map<string, ClientMaxRow>;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const eff = effectiveMax(row, index);
  return (
    <div className={cn(
      "grid grid-cols-12 items-center gap-2 rounded-md border border-border bg-secondary/20 px-3 py-2 text-sm",
      !row.active && "opacity-60",
    )}>
      <div className="col-span-12 sm:col-span-4 min-w-0">
        <div className="flex items-center gap-1.5 font-semibold">
          <span className="truncate">{row.lift}</span>
          {row.source_lift && (
            <Badge variant="outline" className="gap-0.5 text-[9px]">
              <Link2 className="h-2.5 w-2.5" />
              {row.variation_modifier ?? 100}% of {row.source_lift}
            </Badge>
          )}
        </div>
        <div className="text-[10px] text-muted-foreground">
          {row.source}{row.tested_at ? ` · ${row.tested_at}` : ""}
        </div>
      </div>
      <div className="col-span-4 sm:col-span-2 text-center">
        <div className="text-[10px] uppercase text-muted-foreground">1RM</div>
        <div className="font-mono font-bold">{eff.one_rm != null ? `${eff.one_rm} ${row.unit}` : "—"}</div>
      </div>
      <div className="col-span-4 sm:col-span-2 text-center">
        <div className="text-[10px] uppercase text-muted-foreground">TM</div>
        <div className="font-mono font-bold">{eff.training_max != null ? `${eff.training_max} ${row.unit}` : "—"}</div>
      </div>
      <div className="col-span-4 sm:col-span-2 text-center">
        <div className="text-[10px] uppercase text-muted-foreground">Est.</div>
        <div className="font-mono">{eff.estimated_1rm != null ? `${eff.estimated_1rm} ${row.unit}` : "—"}</div>
      </div>
      <div className="col-span-12 sm:col-span-2 flex justify-end gap-1">
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onEdit} title="Edit">
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={onDelete} title="Delete">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

export function MaxEditorDialog({
  clientId, value, existing, onClose, onSaved,
}: {
  clientId: string;
  value: Partial<ClientMaxRow> | null;
  existing: ClientMaxRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<Partial<ClientMaxRow>>({});
  const [saving, setSaving] = useState(false);

  // Reset form whenever a new value is opened.
  useMemo(() => { if (value) setForm(value); }, [value]);

  if (!value) return null;
  const isEdit = !!form.id;

  const set = (patch: Partial<ClientMaxRow>) => setForm((f) => ({ ...f, ...patch }));

  const save = async () => {
    if (!form.lift || !form.lift.trim()) { toast.error("Lift name is required"); return; }
    setSaving(true);
    try {
      await upsertClientMax({
        ...form,
        client_id: clientId,
        lift: form.lift.trim(),
        unit: (form.unit as "kg" | "lb") ?? "kg",
        rounding_mode: (form.rounding_mode as RoundingMode) ?? "nearest",
        rounding_step: form.rounding_step ?? defaultRoundingStep((form.unit as "kg" | "lb") ?? "kg"),
        source: (form.source as MaxSource) ?? "manual",
        active: form.active ?? true,
        manual_override: form.manual_override ?? false,
      });
      onSaved();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const others = existing.filter((m) => m.id !== form.id);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit max" : "Add max"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Lift name</Label>
            <Input
              list="common-lifts"
              value={form.lift ?? ""}
              onChange={(e) => set({ lift: e.target.value })}
              placeholder="e.g. Competition Squat"
            />
            <datalist id="common-lifts">
              {COMMON_LIFTS.map((l) => <option key={l} value={l} />)}
            </datalist>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Match the exercise name used in the program builder exactly.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label>1RM</Label>
              <Input
                inputMode="decimal"
                value={form.one_rm ?? ""}
                onChange={(e) => set({ one_rm: e.target.value ? Number(e.target.value) : null })}
              />
            </div>
            <div>
              <Label>Training Max</Label>
              <Input
                inputMode="decimal"
                value={form.training_max ?? ""}
                onChange={(e) => set({ training_max: e.target.value ? Number(e.target.value) : null })}
              />
            </div>
            <div>
              <Label>Est. 1RM</Label>
              <Input
                inputMode="decimal"
                value={form.estimated_1rm ?? ""}
                onChange={(e) => set({ estimated_1rm: e.target.value ? Number(e.target.value) : null })}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label>Unit</Label>
              <Select value={form.unit ?? "kg"} onValueChange={(v) => set({ unit: v as "kg" | "lb", rounding_step: defaultRoundingStep(v as "kg" | "lb") })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="kg">kg</SelectItem>
                  <SelectItem value="lb">lb</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Source</Label>
              <Select value={form.source ?? "tested"} onValueChange={(v) => set({ source: v as MaxSource })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MAX_SOURCES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Tested on</Label>
              <Input
                type="date"
                value={form.tested_at ?? ""}
                onChange={(e) => set({ tested_at: e.target.value || null })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Rounding</Label>
              <Select value={form.rounding_mode ?? "nearest"} onValueChange={(v) => set({ rounding_mode: v as RoundingMode })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROUNDING_MODES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Round to step ({form.unit ?? "kg"})</Label>
              <Input
                inputMode="decimal"
                value={form.rounding_step ?? ""}
                placeholder={String(defaultRoundingStep((form.unit as "kg" | "lb") ?? "kg"))}
                onChange={(e) => set({ rounding_step: e.target.value ? Number(e.target.value) : null })}
              />
            </div>
          </div>

          <div className="rounded-md border border-border bg-secondary/30 p-3 space-y-2">
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Variation (optional)</div>
            <p className="text-[10px] text-muted-foreground">
              Pull max from another lift (e.g. Pause Squat = 90% of Competition Squat).
            </p>
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <Label>Use max from</Label>
                <Select
                  value={form.source_lift ?? "__none"}
                  onValueChange={(v) => set({ source_lift: v === "__none" ? null : v })}
                >
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">— None —</SelectItem>
                    {others.map((m) => <SelectItem key={m.id} value={m.lift}>{m.lift}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Modifier %</Label>
                <Input
                  inputMode="decimal"
                  value={form.variation_modifier ?? ""}
                  placeholder="90"
                  onChange={(e) => set({ variation_modifier: e.target.value ? Number(e.target.value) : null })}
                />
              </div>
            </div>
            {form.source_lift && (
              <label className="flex items-center gap-2 text-xs">
                <Switch
                  checked={!!form.manual_override}
                  onCheckedChange={(c) => set({ manual_override: c })}
                />
                <span>Manual override — use my entered numbers, ignore variation</span>
              </label>
            )}
          </div>

          <div>
            <Label>Notes</Label>
            <Textarea
              value={form.notes ?? ""}
              onChange={(e) => set({ notes: e.target.value })}
              rows={2}
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={form.active ?? true}
              onCheckedChange={(c) => set({ active: c })}
            />
            <span>Active</span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            <Calculator className="mr-1 h-4 w-4" />
            {saving ? "Saving…" : isEdit ? "Save" : "Add max"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}