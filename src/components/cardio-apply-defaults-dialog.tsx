import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ActionButton } from "@/components/action-button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { findDefaultFor, CARDIO_INTENSITIES } from "@/lib/nutrition-cardio";
import { Lock } from "lucide-react";
import { WEEK_DAYS, SHORT_DAY, type WeekDay } from "@/lib/training-schedule";
import { setRecurringHighDays, setFullCardioRestDays, DEFAULT_HIGH_WEEKDAY } from "@/lib/high-day-schedule";
import { todayLocalISO } from "@/lib/today";

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

/** Count how many times each day_label appears in nutrition_target_days. */
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
    cardio_type: "Incline Treadmill Walk",
    duration_minutes: 15,
    intensity: "Zone 2",
    calorie_target_min: null,
    calorie_target_max: null,
    client_notes: "Incline 5 · speed 2–3 mph. Complete the session when ANY ONE target is reached; stop when whichever target comes first.",
  },
  "Rest Day": {
    cardio_type: "Incline Treadmill Walk",
    duration_minutes: 15,
    intensity: "Zone 2",
    calorie_target_min: null,
    calorie_target_max: null,
    client_notes: "Incline 5 · speed 2–3 mph. Complete the session when ANY ONE target is reached; stop when whichever target comes first.",
  },
  "High Day": {
    cardio_type: "Incline Treadmill Walk",
    duration_minutes: 15,
    intensity: "Zone 2",
    calorie_target_min: null,
    calorie_target_max: null,
    client_notes: "Incline 5 · speed 2–3 mph. Complete the session when ANY ONE target is reached; stop when whichever target comes first.",
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

/**
 * RowDraft uses string for frequency_per_week so the input is uncontrolled
 * while typing. We only parse to number on blur / apply.
 */
type RowDraft = {
  day_type: string;
  enabled: boolean;
  /** String so the input doesn't clamp while the user is mid-type. */
  frequency_str: string;
  /** Whether this row's frequency is locked (auto-calculated as remainder). */
  locked: boolean;
  duration_minutes: number;
  cardio_type: string;
  intensity: string;
};

function parseFreq(s: string): number {
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

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

  // Fetch client schedule data to determine training days
  const { data: clientPrefs } = useQuery({
    queryKey: ["client-prefs-cardio-dialog", clientId],
    enabled: open && !!clientId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const [{ data }, activeBlock] = await Promise.all([
        supabase
          .from("clients")
          .select("committed_training_frequency, committed_training_days, preferred_training_days, preferred_high_days, preferred_rest_days, full_cardio_rest_days")
          .eq("id", clientId)
          .maybeSingle(),
        (supabase.from("pl_blocks") as any)
          .select("start_date")
          .eq("client_id", clientId)
          .eq("status", "Active")
          .order("start_date", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      return { ...(data ?? {}), active_block_start_date: activeBlock.data?.start_date ?? null };
    },
  });

  // Count how many days/week each label occupies in the nutrition plan
  const labelCounts = useMemo(() => countByLabel(nutritionDays), [nutritionDays]);

  // Effective label list: use nutrition plan labels, fall back to sensible defaults
  const effectiveLabels = useMemo(() => {
    if (nutritionLabels.length > 0) return nutritionLabels;
    return ["Training Day", "Rest Day"];
  }, [nutritionLabels]);

  // Derive training days from workout schedule
  const trainingDaysCount = useMemo(() => {
    // Priority: committed_training_frequency > preferred_training_days.length > nutrition count
    if (clientPrefs?.committed_training_frequency != null) {
      return clientPrefs.committed_training_frequency;
    }
    if ((clientPrefs?.preferred_training_days ?? []).length > 0) {
      return (clientPrefs!.preferred_training_days as string[]).length;
    }
    return labelCounts["Training Day"] ?? 0;
  }, [clientPrefs, labelCounts]);

  // Derive high days from meal plan (nutrition_target_days count)
  const highDaysCount = useMemo(() => {
    return labelCounts["High Day"] ?? (clientPrefs?.preferred_high_days ?? []).length ?? 0;
  }, [labelCounts, clientPrefs]);

  // ── Weekday assignment for High Day ─────────────────────────────────
  // Source of truth: clients.preferred_high_days. Falls back to the centralized default
  // when the client has one High Day per week but no assigned weekday.
  const [highDayWeekday, setHighDayWeekday] = useState<WeekDay>(DEFAULT_HIGH_WEEKDAY);
  useEffect(() => {
    if (!open) return;
    const existing = (clientPrefs?.preferred_high_days ?? []).find(
      (d: string) => (WEEK_DAYS as readonly string[]).includes(d),
    ) as WeekDay | undefined;
    setHighDayWeekday(existing ?? DEFAULT_HIGH_WEEKDAY);
  }, [open, clientPrefs?.preferred_high_days]);

  // ── Full Cardio Rest weekday (defaults to a non-training, non-high day) ─
  const [fullRestEnabled, setFullRestEnabled] = useState(false);
  const [fullRestWeekday, setFullRestWeekday] = useState<WeekDay>("Saturday");
  useEffect(() => {
    if (!open) return;
    const existing = (clientPrefs?.full_cardio_rest_days ?? []).find(
      (d: string) => (WEEK_DAYS as readonly string[]).includes(d),
    ) as WeekDay | undefined;
    if (existing) {
      setFullRestEnabled(true);
      setFullRestWeekday(existing);
    } else {
      // Default: pick a non-training, non-high weekday
      const training = new Set<string>(clientPrefs?.preferred_training_days ?? []);
      const pick = (WEEK_DAYS as readonly WeekDay[]).find(
        (d) => !training.has(d) && d !== highDayWeekday,
      );
      setFullRestEnabled(false);
      setFullRestWeekday(pick ?? "Saturday");
    }
  }, [open, clientPrefs?.full_cardio_rest_days, clientPrefs?.preferred_training_days, highDayWeekday]);

  const anyExisting = existing.some(
    (e) => effectiveLabels.includes(e.day_type) && !e.program_name,
  );

  // Initialise rows whenever the dialog opens or client data loads
  useEffect(() => {
    if (!open) return;

    const init: RowDraft[] = effectiveLabels.map((label) => {
      const existingRow = findDefaultFor(existing, label);
      const cfg = defaultConfigFor(label);

      // Determine frequency for this label
      let freq: number;
      let locked = false;

      if (label === "Training Day") {
        // Training days come from the workout schedule — locked
        freq = trainingDaysCount > 0 ? trainingDaysCount : (existingRow?.frequency_per_week ?? 4);
        locked = trainingDaysCount > 0;
      } else if (label === "High Day") {
        // High days come from the meal plan — locked
        freq = highDaysCount > 0 ? highDaysCount : (existingRow?.frequency_per_week ?? 1);
        locked = highDaysCount > 0;
      } else if (label === "Rest Day" || label === "Non-Training Day") {
        // Rest/non-training days = remainder after training + high days
        // Will be recalculated after all rows are set
        freq = existingRow?.frequency_per_week ?? 3;
        locked = false; // will be recalculated
      } else {
        // Other day types: use nutrition count or existing
        const nutritionCount = labelCounts[label] ?? 0;
        freq = nutritionCount > 0 ? nutritionCount : (existingRow?.frequency_per_week ?? 1);
        locked = nutritionCount > 0;
      }

      return {
        day_type: label,
        enabled: true,
        frequency_str: String(freq),
        locked,
        duration_minutes: existingRow?.duration_minutes ?? cfg.duration_minutes,
        cardio_type: existingRow?.cardio_type ?? cfg.cardio_type,
        intensity: existingRow?.intensity ?? cfg.intensity,
      };
    });

    // Auto-calculate the remainder for Rest/Non-Training Day
    const lockedTotal = init
      .filter((r) => r.locked && r.enabled)
      .reduce((s, r) => s + parseFreq(r.frequency_str), 0);
    const restIdx = init.findIndex(
      (r) => r.day_type === "Rest Day" || r.day_type === "Non-Training Day",
    );
    if (restIdx !== -1 && (trainingDaysCount > 0 || highDaysCount > 0)) {
      const remainder = Math.max(0, 7 - lockedTotal);
      init[restIdx] = { ...init[restIdx], frequency_str: String(remainder), locked: true };
    }

    setRows(init);
    setMode(anyExisting ? "update" : "create");
  }, [open, trainingDaysCount, highDaysCount]); // eslint-disable-line react-hooks/exhaustive-deps

  // Total days currently assigned across all enabled rows
  const totalDays = rows
    .filter((r) => r.enabled)
    .reduce((s, r) => s + parseFreq(r.frequency_str), 0);
  const remaining = 7 - totalDays;
  const isValid = totalDays === 7;

  const updateRow = (idx: number, patch: Partial<RowDraft>) => {
    setRows((prev) => {
      const next = prev.map((r, i) => (i === idx ? { ...r, ...patch } : r));

      // Auto-recalculate the rest/non-training day remainder whenever a non-locked row changes
      const restIdx = next.findIndex(
        (r) => r.day_type === "Rest Day" || r.day_type === "Non-Training Day",
      );
      if (restIdx !== -1 && next[restIdx].locked && restIdx !== idx) {
        const otherTotal = next
          .filter((r, i) => i !== restIdx && r.enabled)
          .reduce((s, r) => s + parseFreq(r.frequency_str), 0);
        const remainder = Math.max(0, 7 - otherTotal);
        next[restIdx] = { ...next[restIdx], frequency_str: String(remainder) };
      }
      return next;
    });
  };

  const scheduledWeekdaysFor = (dayType: string): string[] => {
    const training = new Set<string>(clientPrefs?.preferred_training_days ?? []);
    if (dayType === "Training Day") return Array.from(training);
    if (dayType === "High Day") return [highDayWeekday];
    if (dayType === "Rest Day" || dayType === "Non-Training Day") {
      return (WEEK_DAYS as readonly WeekDay[]).filter((day) => !training.has(day) && day !== highDayWeekday && (!fullRestEnabled || day !== fullRestWeekday));
    }
    return [];
  };

  const apply = async () => {
    if (!isValid) {
      toast.error(`Frequencies must add up to exactly 7 days/week. Currently: ${totalDays}`);
      return;
    }
    setSaving(true);
    // Adjust Non-Training Day frequency down by 1 when Full Cardio Rest is on,
    // so the remaining Non-Training days actually get cardio and the rest day
    // is preserved but excluded from cardio.
    let effectiveRows = rows;
    if (fullRestEnabled) {
      effectiveRows = rows.map((r) => {
        if (r.day_type === "Rest Day" || r.day_type === "Non-Training Day") {
          const f = Math.max(0, parseFreq(r.frequency_str) - 1);
          return { ...r, frequency_str: String(f) };
        }
        return r;
      });
    }
    const inserts: any[] = [];
    const updates: Array<{ id: string; patch: any }> = [];
    for (const row of effectiveRows) {
      if (!row.enabled) continue;
      const freq = parseFreq(row.frequency_str);
      if (freq <= 0) continue;
      const existingRow = findDefaultFor(existing, row.day_type);
      const cfg = defaultConfigFor(row.day_type);
      const targetStartDate = (clientPrefs as any)?.active_block_start_date ?? todayLocalISO();
      const payload = {
        client_id: clientId,
        day_type: row.day_type,
        custom_day_type: null,
        cardio_type: row.cardio_type,
        custom_type: null,
        intensity: row.intensity,
        frequency_per_week: freq,
        // Once known, weekdays become the one schedule consumed by calendar, client logging and analytics.
        // Empty only preserves the older resolver when a legacy client has no committed weekday data yet.
        scheduled_weekdays: scheduledWeekdaysFor(row.day_type),
        duration_minutes: row.duration_minutes,
        calorie_target_min: cfg.calorie_target_min,
        calorie_target_max: cfg.calorie_target_max,
        show_calories_to_client: cfg.calorie_target_min != null,
        client_notes: existingRow?.client_notes || cfg.client_notes,
        start_date: targetStartDate,
        status: "Active",
        enabled: true,
        visible_to_client: true,
        program_name: null,
        last_updated_at: new Date().toISOString(),
      };
      if (existingRow) {
        if (mode === "update") {
          const { client_id: _cid, start_date: _sd, program_name: _pn, ...patch } = payload as any;
          updates.push({ id: existingRow.id, patch });
        }
      } else {
        inserts.push(payload);
      }
    }
    try {
      // Persist weekday assignments FIRST so downstream calendar views resolve
      // the correct dates even if the target inserts fail later.
      try {
        await setRecurringHighDays(clientId, [highDayWeekday]);
      } catch (err) {
        // Non-fatal: log but continue with cardio target writes.
        console.warn("Failed to save High Day weekday", err);
      }
      try {
        await setFullCardioRestDays(clientId, fullRestEnabled ? [fullRestWeekday] : []);
      } catch (err) {
        console.warn("Failed to save Full Cardio Rest weekday", err);
      }
      if (inserts.length) {
        const { error } = await supabase.from("cardio_targets").insert(inserts);
        if (error) throw error;
      }
      for (const u of updates) {
        const { error } = await supabase.from("cardio_targets").update(u.patch).eq("id", u.id);
        if (error) throw error;
      }
      const msg = [
        inserts.length ? `Created ${inserts.length}` : "",
        updates.length ? `Updated ${updates.length}` : "",
      ].filter(Boolean).join(" · ") || "Nothing to apply";
      toast.success(msg);
      qc.invalidateQueries({ queryKey: ["cardio-targets", clientId] });
      qc.invalidateQueries({ queryKey: ["cardio-targets"] });
      qc.invalidateQueries({ queryKey: ["client-prefs-cardio-dialog", clientId] });
      qc.invalidateQueries({ queryKey: ["cal-client-cardio", clientId] });
      qc.invalidateQueries({ queryKey: ["client-cardio-resolved", clientId] });
      qc.invalidateQueries({ queryKey: ["week-sched-data"] });
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
            Training days are pulled from the workout schedule. High days from the meal plan.
            Non-training days fill the remaining 7-day balance automatically.
          </DialogDescription>
        </DialogHeader>

        {anyExisting && (
          <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
            Default cardio targets already exist for one or more day types. Choose how to handle them:
            <div className="mt-2 flex gap-2">
              <ActionButton size="sm" variant={mode === "update" ? "default" : "outline"} onClick={() => setMode("update")}>
                Update existing
              </ActionButton>
              <ActionButton size="sm" variant={mode === "create" ? "default" : "outline"} onClick={() => setMode("create")}>
                Keep existing, add missing
              </ActionButton>
            </div>
          </div>
        )}

        {/* 7-day total indicator */}
        <div className={`flex items-center justify-between rounded-md border px-3 py-2 text-sm font-medium ${
          isValid ? "border-success/40 bg-success/10 text-success" : "border-warning/40 bg-warning/10 text-warning"
        }`}>
          <span>Weekly total</span>
          <span className="font-bold tabular-nums">
            {totalDays} / 7 days
            {!isValid && remaining > 0 && <span className="ml-2 text-xs font-normal">({remaining} unassigned)</span>}
            {!isValid && remaining < 0 && <span className="ml-2 text-xs font-normal">({Math.abs(remaining)} over)</span>}
          </span>
        </div>

        {/* Compact weekly preview */}
        <WeeklyPreview
          trainingDays={clientPrefs?.preferred_training_days ?? []}
          highDayWeekday={highDayWeekday}
          fullRestEnabled={fullRestEnabled}
          fullRestWeekday={fullRestWeekday}
          rows={rows}
        />

        <ul className="space-y-2">
          {rows.map((row, idx) => {
            const existingRow = findDefaultFor(existing, row.day_type);
            const nutritionCount = labelCounts[row.day_type] ?? 0;
            return (
              <li
                key={row.day_type}
                className={`rounded-md border p-3 transition-colors ${
                  row.enabled ? "border-border bg-secondary/30" : "border-border/40 bg-secondary/10 opacity-60"
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
                      <label htmlFor={`def-${row.day_type}`} className="cursor-pointer font-bold">
                        {row.day_type} Cardio
                      </label>
                      {existingRow && <Badge variant="outline" className="text-[10px]">Exists</Badge>}
                      {row.locked && (
                        <Badge variant="outline" className="border-primary/40 text-[10px] text-primary flex items-center gap-1">
                          <Lock className="h-2.5 w-2.5" />
                          {row.day_type === "Training Day" ? "From schedule" :
                           row.day_type === "High Day" ? "From meal plan" : "Auto-calculated"}
                        </Badge>
                      )}
                      {nutritionCount > 0 && !row.locked && (
                        <Badge variant="outline" className="border-primary/40 text-[10px] text-primary">
                          {nutritionCount}×/wk in nutrition
                        </Badge>
                      )}
                      {nutritionLabels.length > 0 && !nutritionLabels.includes(row.day_type) && (
                        <Badge variant="outline" className="border-muted-foreground/40 text-[10px] text-muted-foreground">
                          Not in nutrition plan
                        </Badge>
                      )}
                    </div>

                    {row.enabled && row.day_type === "High Day" && (
                      <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1.5 text-[11px]">
                        <div className="mb-1 font-semibold text-amber-700 dark:text-amber-500">
                          Scheduled weekday
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {(WEEK_DAYS as readonly WeekDay[]).map((d) => (
                            <button
                              key={d}
                              type="button"
                              onClick={() => setHighDayWeekday(d)}
                              className={`h-6 rounded px-2 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                                highDayWeekday === d
                                  ? "bg-amber-500 text-white"
                                  : "border border-border bg-background text-muted-foreground hover:bg-secondary"
                              }`}
                            >
                              {SHORT_DAY[d]}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {row.enabled && (row.day_type === "Rest Day" || row.day_type === "Non-Training Day") && parseFreq(row.frequency_str) >= 2 && (
                      <div className="rounded-md border border-border bg-background px-2 py-1.5 text-[11px]">
                        <label className="flex items-center gap-2">
                          <Checkbox
                            checked={fullRestEnabled}
                            onCheckedChange={(v) => setFullRestEnabled(!!v)}
                          />
                          <span className="font-semibold">Full Cardio Rest day</span>
                          <span className="text-muted-foreground">(no cardio prescribed)</span>
                        </label>
                        {fullRestEnabled && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {(WEEK_DAYS as readonly WeekDay[]).map((d) => (
                              <button
                                key={d}
                                type="button"
                                onClick={() => setFullRestWeekday(d)}
                                className={`h-6 rounded px-2 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                                  fullRestWeekday === d
                                    ? "bg-muted-foreground text-background"
                                    : "border border-border bg-background text-muted-foreground hover:bg-secondary"
                                }`}
                              >
                                {SHORT_DAY[d]}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {row.enabled && (
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                            Days/wk
                          </p>
                          {row.locked ? (
                            // Locked rows show a read-only display
                            <div className="flex h-8 items-center rounded-md border border-border/60 bg-muted/40 px-2 text-sm font-bold tabular-nums">
                              {row.frequency_str}
                            </div>
                          ) : (
                            // Editable rows use string state — no clamping while typing
                            <Input
                              type="number"
                              min={0}
                              max={7}
                              value={row.frequency_str}
                              onChange={(e) => updateRow(idx, { frequency_str: e.target.value })}
                              onBlur={(e) => {
                                // Clamp only on blur, not on every keystroke
                                const n = Math.max(0, Math.min(7, parseInt(e.target.value, 10) || 0));
                                updateRow(idx, { frequency_str: String(n) });
                              }}
                              className="h-8 text-sm"
                            />
                          )}
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
                              onChange={(e) => updateRow(idx, { duration_minutes: Math.max(5, Number(e.target.value) || 25) })}
                              className="h-8 text-sm"
                            />
                            <span className="shrink-0 text-xs text-muted-foreground">min</span>
                          </div>
                        </div>
                        <div>
                          <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                            Intensity
                          </p>
                          <select
                            value={row.intensity}
                            onChange={(e) => updateRow(idx, { intensity: e.target.value })}
                            className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                          >
                            {CARDIO_INTENSITIES.map((i) => (
                              <option key={i} value={i}>{i}</option>
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
          <ActionButton variant="outline" onClick={() => onOpenChange(false)}>Cancel</ActionButton>
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

function WeeklyPreview({
  trainingDays,
  highDayWeekday,
  fullRestEnabled,
  fullRestWeekday,
  rows,
}: {
  trainingDays: string[];
  highDayWeekday: WeekDay;
  fullRestEnabled: boolean;
  fullRestWeekday: WeekDay;
  rows: RowDraft[];
}) {
  const trainingSet = new Set(trainingDays);
  const trainingRow = rows.find((r) => r.day_type === "Training Day" && r.enabled);
  const highRow = rows.find((r) => r.day_type === "High Day" && r.enabled);
  const restRow = rows.find(
    (r) => (r.day_type === "Rest Day" || r.day_type === "Non-Training Day") && r.enabled,
  );
  return (
    <div className="rounded-md border border-border bg-secondary/20 p-2">
      <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        Weekly preview
      </div>
      <ul className="grid grid-cols-7 gap-1">
        {(WEEK_DAYS as readonly WeekDay[]).map((d) => {
          const isTraining = trainingSet.has(d);
          const isHigh = d === highDayWeekday;
          const isFullRest = fullRestEnabled && d === fullRestWeekday && !isTraining && !isHigh;
          let tone = "border-border bg-background text-muted-foreground";
          let label = "";
          let sub = "";
          if (isHigh) {
            tone = "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-500";
            label = "High";
            sub = highRow?.cardio_type ?? "";
          } else if (isTraining) {
            tone = "border-primary/40 bg-primary/10 text-primary";
            label = "Training";
            sub = trainingRow?.cardio_type ?? "";
          } else if (isFullRest) {
            tone = "border-muted-foreground/40 bg-muted/40 text-muted-foreground";
            label = "Rest";
            sub = "Cardio Rest";
          } else {
            tone = "border-border bg-background text-foreground";
            label = "Non-Training";
            sub = restRow?.cardio_type ?? "";
          }
          return (
            <li
              key={d}
              className={`rounded border p-1 text-center transition-colors ${tone}`}
              title={`${d} · ${label}${sub ? " · " + sub : ""}`}
            >
              <div className="text-[9px] font-black uppercase tracking-widest">{SHORT_DAY[d]}</div>
              <div className="text-[9px] font-bold leading-tight">{label}</div>
              {sub && <div className="truncate text-[8px] opacity-80">{sub}</div>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
