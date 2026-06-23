import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ActionButton } from "@/components/action-button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { findDefaultFor, CARDIO_INTENSITIES } from "@/lib/nutrition-cardio";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  clientId: string;
  existing: any[];
  /** Distinct day labels from the client's active nutrition target. */
  nutritionLabels: string[];
  /** Full nutrition_target_days rows so we can count frequency per label. */
  nutritionDays?: any[];
};

/** Count how many times each day_label appears in nutrition_target_days.
 *  Each row = one day of the week, so count = days/week for that label. */
function countByLabel(days: any[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of days) {
    const l = d.day_label as string;
    out[l] = (out[l] ?? 0) + 1;
  }
  return out;
}

/** Sensible default cardio config per nutrition day type. */
const DEFAULT_CONFIG: Record<string, {
  cardio_type: string;
  duration_minutes: number;
  intensity: string;
  calorie_target_min: number | null;
  calorie_target_max: number | null;
  client_notes: string;
}> = {
  "Training Day": {
    cardio_type: "Incline Walking",
    duration_minutes: 25,
    intensity: "Zone 2",
    calorie_target_min: 150,
    calorie_target_max: 200,
    client_notes: "Steady incline walk after lifting. Keep heart rate in Zone 2.",
  },
  "Rest Day": {
    cardio_type: "Outdoor Walking",
    duration_minutes: 25,
    intensity: "Low Intensity",
    calorie_target_min: null,
    calorie_target_max: null,
    client_notes: "Easy outdoor walk. Aim for daily steps, low fatigue.",
  },
  "High Day": {
    cardio_type: "Outdoor Walking",
    duration_minutes: 20,
    intensity: "Low Intensity",
    calorie_target_min: null,
    calorie_target_max: null,
    client_notes: "Optional light walk. Keep fatigue low.",
  },
  "Low Day": {
    cardio_type: "Outdoor Walking",
    duration_minutes: 30,
    intensity: "Low Intensity",
    calorie_target_min: null,
    calorie_target_max: null,
    client_notes: "Easy walk on low-calorie days. Keep fatigue minimal.",
  },
  "Daily": {
    cardio_type: "Incline Walking",
    duration_minutes: 25,
    intensity: "Zone 2",
    calorie_target_min: null,
    calorie_target_max: null,
    client_notes: "Daily cardio session.",
  },
};

function defaultConfigFor(label: string) {
  return DEFAULT_CONFIG[label] ?? {
    cardio_type: "Outdoor Walking",
    duration_minutes: 25,
    intensity: "Low Intensity",
    calorie_target_min: null,
    calorie_target_max: null,
    client_notes: "",
  };
}

type RowDraft = {
  day_type: string;
  enabled: boolean;
  frequency_per_week: number;
  duration_minutes: number;
  cardio_type: string;
  intensity: string;
};

export function CardioApplyDefaultsDialog({
  open,
  onOpenChange,
  clientId,
  existing,
  nutritionLabels,
  nutritionDays = [],
}: Props) {
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<"update" | "create">("create");
  const [rows, setRows] = useState<RowDraft[]>([]);

  // Count how many days/week each label occupies in the nutrition plan
  const labelCounts = useMemo(() => countByLabel(nutritionDays), [nutritionDays]);

  // Effective label list: use nutrition plan labels, fall back to sensible defaults
  const effectiveLabels = useMemo(() => {
    if (nutritionLabels.length > 0) return nutritionLabels;
    return ["Training Day", "Rest Day"];
  }, [nutritionLabels]);

  // Total days currently assigned across all enabled rows
  const totalDays = rows.filter((r) => r.enabled).reduce((s, r) => s + r.frequency_per_week, 0);
  const remaining = 7 - totalDays;
  const isValid = totalDays === 7;

  const anyExisting = existing.some(
    (e) => effectiveLabels.includes(e.day_type) && !e.program_name,
  );

  // Initialise rows whenever the dialog opens
  useEffect(() => {
    if (!open) return;
    const init: RowDraft[] = effectiveLabels.map((label) => {
      const existingRow = findDefaultFor(existing, label);
      const cfg = defaultConfigFor(label);
      // Frequency priority: nutrition plan count → existing cardio row → smart default
      const nutritionCount = labelCounts[label] ?? 0;
      const freq =
        nutritionCount > 0
          ? nutritionCount
          : existingRow?.frequency_per_week ??
            (label === "Training Day" ? 4 : label === "High Day" ? 2 : 3);
      return {
        day_type: label,
        enabled: true,
        frequency_per_week: freq,
        duration_minutes: existingRow?.duration_minutes ?? cfg.duration_minutes,
        cardio_type: existingRow?.cardio_type ?? cfg.cardio_type,
        intensity: existingRow?.intensity ?? cfg.intensity,
      };
    });
    setRows(init);
    setMode(anyExisting ? "update" : "create");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateRow = (idx: number, patch: Partial<RowDraft>) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const apply = async () => {
    if (!isValid) {
      toast.error(
        `Frequencies must add up to exactly 7 days/week. Currently: ${totalDays}`,
      );
      return;
    }
    setSaving(true);
    const inserts: any[] = [];
    const updates: Array<{ id: string; patch: any }> = [];
    for (const row of rows) {
      if (!row.enabled) continue;
      const existingRow = findDefaultFor(existing, row.day_type);
      const cfg = defaultConfigFor(row.day_type);
      const payload = {
        client_id: clientId,
        day_type: row.day_type,
        custom_day_type: null,
        cardio_type: row.cardio_type,
        custom_type: null,
        intensity: row.intensity,
        frequency_per_week: row.frequency_per_week,
        duration_minutes: row.duration_minutes,
        calorie_target_min: cfg.calorie_target_min,
        calorie_target_max: cfg.calorie_target_max,
        show_calories_to_client: cfg.calorie_target_min != null,
        client_notes: existingRow?.client_notes || cfg.client_notes,
        start_date: new Date().toISOString().slice(0, 10),
        status: "Active",
        enabled: true,
        visible_to_client: true,
        program_name: null,
        last_updated_at: new Date().toISOString(),
      };
      if (existingRow) {
        if (mode === "update") {
          // Don't overwrite start_date or client_id on updates
          const { client_id: _cid, start_date: _sd, program_name: _pn, ...patch } =
            payload as any;
          updates.push({ id: existingRow.id, patch });
        }
      } else {
        inserts.push(payload);
      }
    }
    try {
      if (inserts.length) {
        const { error } = await supabase.from("cardio_targets").insert(inserts);
        if (error) throw error;
      }
      for (const u of updates) {
        const { error } = await supabase
          .from("cardio_targets")
          .update(u.patch)
          .eq("id", u.id);
        if (error) throw error;
      }
      const msg =
        [
          inserts.length ? `Created ${inserts.length}` : "",
          updates.length ? `Updated ${updates.length}` : "",
        ]
          .filter(Boolean)
          .join(" · ") || "Nothing to apply";
      toast.success(msg);
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
            Synced with your client's nutrition day types. Frequencies must add
            up to exactly 7 days/week.
          </DialogDescription>
        </DialogHeader>

        {anyExisting && (
          <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
            Default cardio targets already exist for one or more day types. Choose
            how to handle them:
            <div className="mt-2 flex gap-2">
              <ActionButton
                size="sm"
                variant={mode === "update" ? "default" : "outline"}
                onClick={() => setMode("update")}
              >
                Update existing
              </ActionButton>
              <ActionButton
                size="sm"
                variant={mode === "create" ? "default" : "outline"}
                onClick={() => setMode("create")}
              >
                Keep existing, add missing
              </ActionButton>
            </div>
          </div>
        )}

        {/* 7-day total indicator */}
        <div
          className={`flex items-center justify-between rounded-md border px-3 py-2 text-sm font-medium ${
            isValid
              ? "border-success/40 bg-success/10 text-success"
              : "border-warning/40 bg-warning/10 text-warning"
          }`}
        >
          <span>Weekly total</span>
          <span className="font-bold tabular-nums">
            {totalDays} / 7 days
            {!isValid && remaining > 0 && (
              <span className="ml-2 text-xs font-normal">
                ({remaining} unassigned)
              </span>
            )}
            {!isValid && remaining < 0 && (
              <span className="ml-2 text-xs font-normal">
                ({Math.abs(remaining)} over)
              </span>
            )}
          </span>
        </div>

        <ul className="space-y-2">
          {rows.map((row, idx) => {
            const existingRow = findDefaultFor(existing, row.day_type);
            const nutritionCount = labelCounts[row.day_type] ?? 0;
            return (
              <li
                key={row.day_type}
                className={`rounded-md border p-3 transition-colors ${
                  row.enabled
                    ? "border-border bg-secondary/30"
                    : "border-border/40 bg-secondary/10 opacity-60"
                }`}
              >
                <div className="flex items-start gap-3">
                  <Checkbox
                    id={`def-${row.day_type}`}
                    checked={row.enabled}
                    onCheckedChange={(v) => updateRow(idx, { enabled: !!v })}
                    className="mt-1"
                  />
                  <div className="flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <label
                        htmlFor={`def-${row.day_type}`}
                        className="cursor-pointer font-bold"
                      >
                        {row.day_type} Cardio
                      </label>
                      {existingRow && (
                        <Badge variant="outline" className="text-[10px]">
                          Exists
                        </Badge>
                      )}
                      {nutritionCount > 0 && (
                        <Badge
                          variant="outline"
                          className="border-primary/40 text-[10px] text-primary"
                        >
                          {nutritionCount}×/wk in nutrition
                        </Badge>
                      )}
                      {nutritionLabels.length > 0 &&
                        !nutritionLabels.includes(row.day_type) && (
                          <Badge
                            variant="outline"
                            className="border-muted-foreground/40 text-[10px] text-muted-foreground"
                          >
                            Not in nutrition plan
                          </Badge>
                        )}
                    </div>

                    {row.enabled && (
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                            Days/wk
                          </p>
                          <Input
                            type="number"
                            min={1}
                            max={7}
                            value={row.frequency_per_week}
                            onChange={(e) =>
                              updateRow(idx, {
                                frequency_per_week: Math.max(
                                  1,
                                  Math.min(7, Number(e.target.value) || 1),
                                ),
                              })
                            }
                            className="h-8 text-sm"
                          />
                        </div>
                        <div>
                          <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                            Duration
                          </p>
                          <div className="flex items-center gap-1">
                            <Input
                              type="number"
                              min={5}
                              max={120}
                              value={row.duration_minutes}
                              onChange={(e) =>
                                updateRow(idx, {
                                  duration_minutes: Math.max(
                                    5,
                                    Number(e.target.value) || 25,
                                  ),
                                })
                              }
                              className="h-8 text-sm"
                            />
                            <span className="shrink-0 text-xs text-muted-foreground">
                              min
                            </span>
                          </div>
                        </div>
                        <div>
                          <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                            Intensity
                          </p>
                          <select
                            value={row.intensity}
                            onChange={(e) =>
                              updateRow(idx, { intensity: e.target.value })
                            }
                            className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                          >
                            {CARDIO_INTENSITIES.map((i) => (
                              <option key={i} value={i}>
                                {i}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        <DialogFooter>
          <ActionButton variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </ActionButton>
          <ActionButton
            onClick={apply}
            jobLabel="Applying default cardio"
            disabled={!isValid || saving}
            className="bg-gradient-primary font-bold uppercase"
          >
            {isValid
              ? `Apply (${totalDays}/7 days)`
              : remaining > 0
                ? `Need ${remaining} more day${remaining !== 1 ? "s" : ""}`
                : `${Math.abs(remaining)} day${Math.abs(remaining) !== 1 ? "s" : ""} over`}
          </ActionButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
