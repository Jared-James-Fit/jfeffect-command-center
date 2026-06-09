import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Dumbbell, Plus, Trash2, Save, Link2, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
  exercise_id?: string | null;
  one_rm: number | "";
  training_max: number | "";
  unit: "kg" | "lb";
  scope: "block" | "profile";
  source_lift?: string | null;
  variation_modifier?: number | "";
};

export function BlockMaxesButton({
  clientId,
  blockId,
  size = "sm",
  variant = "default",
}: {
  clientId?: string | null;
  blockId?: string | null;
  size?: "sm" | "default";
  variant?: "default" | "outline" | "secondary";
}) {
  const [open, setOpen] = useState(false);
  const disabled = !clientId || !blockId;
  return (
    <>
      <Button
        size={size}
        variant={variant}
        className="h-8 gap-1.5 text-xs font-semibold"
        onClick={() => {
          if (disabled) {
            toast.info("Assign this template to a client block to set 1RM / TM values.");
            return;
          }
          setOpen(true);
        }}
        title={disabled ? "Available once assigned to a client block" : "Set 1RM / TM"}
      >
        <Dumbbell className="h-3.5 w-3.5" /> Set 1RM / TM
      </Button>
      {open && clientId && blockId && (
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
  // Full exercise library for the "Add Exercise Max" picker.
  const { data: libraryExercises = [] } = useQuery<{ id: string; name: string; muscle_group: string | null; category: string | null }[]>({
    queryKey: ["pl-maxes-exercise-library"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("exercises")
        .select("id, name, muscle_group, category")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [customName, setCustomName] = useState("");
  // Main lift unit selector (applies to Squat/Bench/Deadlift rows only).
  const [mainUnit, setMainUnit] = useState<"kg" | "lb">("kg");
  const [applyExistingRows, setApplyExistingRows] = useState<"yes" | "no">("no");

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
          id: m.id, lift: m.lift, exercise_id: m.exercise_id,
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
        id: m.id, lift: m.lift, exercise_id: m.exercise_id,
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

  // Apply the chosen main-lift unit to the three SBD draft rows. Numbers stay
  // the same — admin opts into conversion per-row if they want it.
  const applyMainUnit = (u: "kg" | "lb") => {
    setMainUnit(u);
    setDrafts((arr) => arr.map((d) =>
      DEFAULT_LIFTS.includes(d.lift) ? { ...d, unit: u } : d
    ));
  };

  // Per-row unit change: if there's a value, ask whether to convert or keep.
  const changeRowUnit = (i: number, nextUnit: "kg" | "lb") => {
    const d = drafts[i];
    if (d.unit === nextUnit) return;
    const hasNumber = d.one_rm !== "" || d.training_max !== "";
    if (!hasNumber) { update(i, { unit: nextUnit }); return; }
    const convert = window.confirm(
      `Changing ${d.lift} from ${d.unit} to ${nextUnit}.\n\n` +
      `OK = Convert the value (e.g. 100 kg → 220 lb)\n` +
      `Cancel = Keep the number (e.g. 100 kg → 100 lb)`
    );
    if (convert) {
      const f = nextUnit === "lb" ? 2.20462262 : 1 / 2.20462262;
      update(i, {
        unit: nextUnit,
        one_rm: d.one_rm === "" ? "" : Number((Number(d.one_rm) * f).toFixed(1)),
        training_max: d.training_max === "" ? "" : Number((Number(d.training_max) * f).toFixed(1)),
      });
    } else {
      update(i, { unit: nextUnit });
    }
  };

  const addExerciseRow = (lift: string, exerciseId?: string | null) => {
    const name = lift.trim();
    if (!name) return;
    if (drafts.some((d) => d.lift.toLowerCase() === name.toLowerCase())) {
      toast.error("Already in list");
      return;
    }
    setDrafts((arr) => [...arr, {
      lift: name,
      exercise_id: exerciseId ?? null,
      one_rm: "", training_max: "", unit: mainUnit, scope: "profile",
    }]);
    setPickerOpen(false);
    setCustomMode(false);
    setCustomName("");
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
          exercise_id: d.exercise_id ?? null,
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
            {/* Quick main-lift unit selector */}
            <div className="rounded-md border border-primary/30 bg-primary/5 p-2.5 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wide text-primary">Set Squat / Bench / Deadlift unit</span>
                <div className="inline-flex rounded-md border border-border bg-background p-0.5">
                  <button
                    type="button"
                    onClick={() => applyMainUnit("kg")}
                    className={`rounded px-3 py-1 text-xs font-semibold ${mainUnit === "kg" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                  >kg</button>
                  <button
                    type="button"
                    onClick={() => applyMainUnit("lb")}
                    className={`rounded px-3 py-1 text-xs font-semibold ${mainUnit === "lb" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                  >lb</button>
                </div>
              </div>
              <div>
                <div className="mb-1 text-[11px] font-semibold text-foreground">
                  Apply this unit to existing Squat, Bench, and Deadlift rows in this block?
                </div>
                <RadioGroup value={applyExistingRows} onValueChange={(v) => setApplyExistingRows(v as any)} className="space-y-1">
                  <label className="flex items-start gap-2 text-xs">
                    <RadioGroupItem value="yes" id="apply-yes" className="mt-0.5" />
                    <span><strong>Yes</strong> — update existing Squat/Bench/Deadlift rows too</span>
                  </label>
                  <label className="flex items-start gap-2 text-xs">
                    <RadioGroupItem value="no" id="apply-no" className="mt-0.5" />
                    <span><strong>No</strong> — only update the max inputs</span>
                  </label>
                </RadioGroup>
                {applyExistingRows === "yes" && (
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Existing rows update on save: any Competition Squat / Bench / Deadlift rows in this block switch to {mainUnit}.
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-12 gap-1 px-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              <div className="col-span-4">Exercise</div>
              <div className="col-span-2 text-center">1RM</div>
              <div className="col-span-2 text-center">Training Max</div>
              <div className="col-span-1 text-center">Unit</div>
              <div className="col-span-2 text-center">Scope</div>
              <div className="col-span-1" />
            </div>
            {drafts.map((d, i) => (
              <div key={`${d.lift}-${i}`} className="space-y-1 rounded-md border border-border bg-secondary/20 px-2 py-1.5">
              <div className="grid grid-cols-12 items-center gap-1">
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
                <Select value={d.unit} onValueChange={(v) => changeRowUnit(i, v as "kg" | "lb")}>
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
              {/* Variation mapping: "Use max from … modifier %" */}
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-[10px] text-muted-foreground">
                <span className="font-semibold uppercase tracking-wide">Use max from</span>
                <Select
                  value={d.source_lift ?? "__none"}
                  onValueChange={(v) => update(i, { source_lift: v === "__none" ? null : v, variation_modifier: v === "__none" ? "" : (d.variation_modifier === "" || d.variation_modifier == null ? 100 : d.variation_modifier) })}
                >
                  <SelectTrigger className="h-6 w-[180px] text-[11px]"><SelectValue placeholder="— direct max —" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">— direct max —</SelectItem>
                    {drafts
                      .filter((other, oi) => oi !== i && other.lift && other.lift.toLowerCase() !== d.lift.toLowerCase())
                      .map((other) => (
                        <SelectItem key={other.lift} value={other.lift}>{other.lift}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                {d.source_lift && (
                  <>
                    <span>· Modifier</span>
                    <Input
                      className="h-6 w-16 text-center font-mono text-[11px]"
                      inputMode="decimal"
                      placeholder="100"
                      value={d.variation_modifier}
                      onChange={(e) => update(i, { variation_modifier: e.target.value === "" ? "" : Number(e.target.value) })}
                    />
                    <span>%</span>
                  </>
                )}
              </div>
              </div>
            ))}

            {/* Add Exercise Max — searches the full Exercise Library */}
            <div className="flex flex-wrap items-center gap-2 pt-2">
              <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                <PopoverTrigger asChild>
                  <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs">
                    <Plus className="h-3 w-3" /> Add Exercise Max
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[320px] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search exercise library…" />
                    <CommandList className="max-h-[280px]">
                      <CommandEmpty>
                        <div className="px-2 py-3 text-xs text-muted-foreground">
                          No exercise found.{" "}
                          <button
                            type="button"
                            className="font-semibold text-primary underline"
                            onClick={() => { setCustomMode(true); setPickerOpen(false); }}
                          >
                            Add custom name
                          </button>
                        </div>
                      </CommandEmpty>
                      <CommandGroup heading="Quick add">
                        {MORE_LIFTS
                          .filter((l) => !drafts.some((d) => d.lift.toLowerCase() === l.toLowerCase()))
                          .map((l) => (
                            <CommandItem key={`quick-${l}`} value={l} onSelect={() => addExerciseRow(l, null)}>
                              <Search className="mr-2 h-3 w-3 opacity-50" /> {l}
                            </CommandItem>
                          ))}
                      </CommandGroup>
                      <CommandGroup heading="Exercise library">
                        {libraryExercises
                          .filter((ex) => !drafts.some((d) => d.lift.toLowerCase() === ex.name.toLowerCase()))
                          .slice(0, 200)
                          .map((ex) => (
                            <CommandItem
                              key={ex.id}
                              value={`${ex.name} ${ex.muscle_group ?? ""} ${ex.category ?? ""}`}
                              onSelect={() => addExerciseRow(ex.name, ex.id)}
                            >
                              <div className="flex w-full items-center justify-between gap-2">
                                <span className="truncate">{ex.name}</span>
                                {ex.muscle_group && (
                                  <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                                    {ex.muscle_group}
                                  </span>
                                )}
                              </div>
                            </CommandItem>
                          ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {customMode && (
                <div className="flex items-center gap-1">
                  <Input
                    autoFocus
                    className="h-8 w-48 text-xs"
                    placeholder="Custom exercise name"
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") addExerciseRow(customName, null); }}
                  />
                  <Button size="sm" variant="outline" className="h-8" onClick={() => addExerciseRow(customName, null)}>
                    Add
                  </Button>
                  <Button size="sm" variant="ghost" className="h-8" onClick={() => { setCustomMode(false); setCustomName(""); }}>
                    Cancel
                  </Button>
                </div>
              )}
              <span className="text-[11px] text-muted-foreground">
                Pick any exercise — Pause Squat, Close Grip Bench, Block Pull, hip thrust, leg press, custom names, anything.
              </span>
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