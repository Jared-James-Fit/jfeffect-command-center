import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { DEFAULT_CARDIO_PRESETS, findDefaultFor, presetToRow, type CardioPreset } from "@/lib/nutrition-cardio";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  clientId: string;
  existing: any[];
  nutritionLabels: string[];
};

export function CardioApplyDefaultsDialog({ open, onOpenChange, clientId, existing, nutritionLabels }: Props) {
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [mode, setMode] = useState<"create" | "update">("create");

  const presets = DEFAULT_CARDIO_PRESETS;
  const status = useMemo(() => presets.map((p) => {
    const inNutrition = nutritionLabels.length === 0 || nutritionLabels.includes(p.day_type);
    const existingRow = findDefaultFor(existing, p.day_type);
    return { preset: p, inNutrition, existingRow };
  }), [presets, existing, nutritionLabels]);

  const anyExisting = status.some((s) => !!s.existingRow);

  useEffect(() => {
    if (!open) return;
    const init: Record<string, boolean> = {};
    status.forEach((s) => { init[s.preset.day_type] = s.inNutrition; });
    setSelected(init);
    setMode(anyExisting ? "update" : "create");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = async () => {
    setSaving(true);
    const inserts: any[] = [];
    const updates: Array<{ id: string; patch: any }> = [];
    for (const s of status) {
      if (!selected[s.preset.day_type]) continue;
      if (s.existingRow) {
        if (mode === "update") {
          const row = presetToRow(s.preset, clientId);
          // keep existing start_date and notes if admin has customized notes
          const patch: any = {
            cardio_type: row.cardio_type,
            custom_type: null,
            intensity: row.intensity,
            frequency_per_week: row.frequency_per_week,
            duration_minutes: row.duration_minutes,
            calorie_target_min: row.calorie_target_min,
            calorie_target_max: row.calorie_target_max,
            show_calories_to_client: row.show_calories_to_client,
            client_notes: s.existingRow.client_notes || row.client_notes,
            status: "Active",
            enabled: true,
            visible_to_client: true,
            last_updated_at: new Date().toISOString(),
          };
          updates.push({ id: s.existingRow.id, patch });
        }
      } else {
        inserts.push(presetToRow(s.preset, clientId));
      }
    }

    try {
      if (inserts.length) {
        const { error } = await supabase.from("cardio_targets").insert(inserts);
        if (error) throw error;
      }
      for (const u of updates) {
        const { error } = await supabase.from("cardio_targets").update(u.patch).eq("id", u.id);
        if (error) throw error;
      }
      toast.success(
        `${inserts.length ? `Created ${inserts.length}` : ""}${inserts.length && updates.length ? " · " : ""}${updates.length ? `Updated ${updates.length}` : ""}` || "Nothing to apply",
      );
      qc.invalidateQueries({ queryKey: ["cardio-targets", clientId] });
      qc.invalidateQueries({ queryKey: ["cardio-targets"] });
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message ?? "Failed to apply defaults");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Apply Default Cardio</DialogTitle>
          <DialogDescription>
            Creates a clean default cardio plan synced with the client's nutrition day types. You can fully edit each target afterwards.
          </DialogDescription>
        </DialogHeader>

        {anyExisting && (
          <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
            Default cardio targets already exist for one or more day types. Choose how to handle them:
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant={mode === "update" ? "default" : "outline"} onClick={() => setMode("update")}>Update existing</Button>
              <Button size="sm" variant={mode === "create" ? "default" : "outline"} onClick={() => setMode("create")}>Keep existing, add missing</Button>
            </div>
          </div>
        )}

        <ul className="space-y-2">
          {status.map(({ preset, inNutrition, existingRow }) => (
            <li key={preset.day_type} className="flex items-start gap-3 rounded-md border border-border bg-secondary/30 p-3">
              <Checkbox
                id={`def-${preset.day_type}`}
                checked={!!selected[preset.day_type]}
                onCheckedChange={(v) => setSelected({ ...selected, [preset.day_type]: !!v })}
                className="mt-1"
              />
              <label htmlFor={`def-${preset.day_type}`} className="flex-1 cursor-pointer space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold">{preset.display_label} Cardio</span>
                  {existingRow && <Badge variant="outline" className="text-[10px]">Exists</Badge>}
                  {!inNutrition && nutritionLabels.length > 0 && (
                    <Badge variant="outline" className="border-muted-foreground/40 text-[10px] text-muted-foreground">Not in nutrition plan</Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {preset.cardio_type} · {preset.duration_minutes} min · {preset.intensity} · {preset.frequency_per_week}×/wk
                  {preset.calorie_target_min ? ` · ~${preset.calorie_target_min}–${preset.calorie_target_max} cal` : ""}
                </div>
              </label>
            </li>
          ))}
        </ul>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={apply} disabled={saving} className="bg-gradient-primary font-bold uppercase">
            {saving ? "Applying…" : "Apply"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}