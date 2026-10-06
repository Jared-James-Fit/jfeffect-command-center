import { useEffect, useState } from "react";
import { Flame, Pencil, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { describeWarmup, readWarmup, warmupKey, writeWarmup, type StoredWarmup, type WarmupUnit } from "@/lib/final-warmup";
import { WARMUP_MAX_REPS } from "@/lib/load-suggestion";

/** Local, per-session state for a card's final warm-up (device storage, 16 h). */
export function useFinalWarmup(dayId: string, rowId: string) {
  const key = warmupKey(dayId, rowId);
  const [value, setValue] = useState<StoredWarmup | null>(() => (typeof window === "undefined" ? null : readWarmup(key)));
  useEffect(() => { setValue(readWarmup(key)); }, [key]);
  const set = (v: StoredWarmup | null) => { setValue(v); writeWarmup(key, v); };
  return [value, set] as const;
}

const FEEL: Array<{ rpe: number; label: string }> = [
  { rpe: 6, label: "Easy" },
  { rpe: 7, label: "Solid" },
  { rpe: 8, label: "Heavy" },
];

/**
 * "Final warm-up (optional)" for squat / bench / deadlift cards. Entering it
 * sharpens the first working-set suggestion; skipping it changes nothing.
 */
export function FinalWarmupInput({
  value,
  unit,
  hasHistory,
  onChange,
}: {
  value: StoredWarmup | null;
  unit: WarmupUnit;
  /** True when there is already enough history for a suggestion (so this only sharpens it). */
  hasHistory: boolean;
  onChange: (v: StoredWarmup | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [load, setLoad] = useState("");
  const [reps, setReps] = useState("");
  const [rpe, setRpe] = useState<number | null>(null);

  const open = () => {
    setLoad(value ? String(Math.round(value.load * 10) / 10) : "");
    setReps(value ? String(value.reps) : "");
    setRpe(value?.rpe ?? null);
    setEditing(true);
  };
  const loadNum = Number(load.replace(",", "."));
  const repsNum = Number(reps);
  const valid = loadNum > 0 && Number.isFinite(loadNum) && Number.isInteger(repsNum) && repsNum >= 1 && repsNum <= WARMUP_MAX_REPS;
  const save = () => {
    if (!valid) return;
    onChange({ load: loadNum, unit, reps: repsNum, rpe, savedAt: Date.now() });
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="mt-1.5 space-y-2 rounded-lg border border-border bg-card px-2.5 py-2" data-testid="final-warmup-form">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-bold">
            <Flame className="h-3.5 w-3.5 text-orange-500" aria-hidden="true" />
            Final warm-up <span className="font-medium text-muted-foreground">(optional)</span>
          </div>
          <button type="button" onClick={() => setEditing(false)} aria-label="Cancel" className="rounded-full p-1 text-muted-foreground hover:bg-muted">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex items-end gap-2">
          <label className="min-w-0 flex-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Weight ({unit})
            <input
              inputMode="decimal"
              value={load}
              onChange={(e) => setLoad(e.target.value)}
              className="mt-0.5 h-10 w-full rounded-md border border-input bg-background px-2 text-base font-bold tabular-nums text-foreground"
              aria-label={`Final warm-up weight in ${unit}`}
            />
          </label>
          <span className="pb-2.5 text-sm font-bold text-muted-foreground">×</span>
          <label className="w-16 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Reps
            <input
              inputMode="numeric"
              value={reps}
              onChange={(e) => setReps(e.target.value.replace(/[^0-9]/g, ""))}
              className="mt-0.5 h-10 w-full rounded-md border border-input bg-background px-2 text-base font-bold tabular-nums text-foreground"
              aria-label="Final warm-up reps"
            />
          </label>
        </div>
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">How did it feel? (optional)</div>
          <div className="flex gap-1.5" role="group" aria-label="How the final warm-up felt">
            {FEEL.map((f) => (
              <button
                key={f.rpe}
                type="button"
                onClick={() => setRpe(rpe === f.rpe ? null : f.rpe)}
                aria-pressed={rpe === f.rpe}
                className={cn(
                  "h-9 flex-1 rounded-md border text-xs font-bold transition",
                  rpe === f.rpe ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-foreground hover:bg-muted",
                )}
              >
                {f.label} <span className="font-medium opacity-70">RPE {f.rpe}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={save}
            disabled={!valid}
            className="h-9 flex-1 rounded-md bg-primary text-xs font-bold text-primary-foreground disabled:opacity-40"
          >
            Update suggestion
          </button>
          {value && (
            <button
              type="button"
              onClick={() => { onChange(null); setEditing(false); }}
              className="h-9 rounded-md border border-border px-3 text-xs font-semibold text-muted-foreground hover:bg-muted"
            >
              Remove
            </button>
          )}
        </div>
      </div>
    );
  }

  if (value) {
    return (
      <div className="mt-1 inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground" data-testid="final-warmup-chip">
        <Flame className="h-3 w-3 text-orange-500" aria-hidden="true" />
        Final warm-up <span className="font-bold tabular-nums text-foreground">{describeWarmup(value, unit)}</span>
        <button type="button" onClick={open} aria-label="Edit final warm-up" className="rounded p-0.5 hover:bg-foreground/10">
          <Pencil className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={open}
      data-testid="final-warmup-prompt"
      className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-2 py-1 text-[11px] font-semibold text-muted-foreground transition hover:bg-muted active:scale-[0.98]"
    >
      <Flame className="h-3 w-3 text-orange-500" aria-hidden="true" />
      {hasHistory ? "Add final warm-up (optional)" : "Add final warm-up for a suggestion (optional)"}
    </button>
  );
}
